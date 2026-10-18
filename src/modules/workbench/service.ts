/**
 * US-08 个人工作台（工单 #28）—— 读取服务。
 *
 * ===========================================================================
 * 纪律（三条，缺一条这个模块就不该合）
 * ===========================================================================
 *
 * 1. **可见性过滤必须在查询层**（契约决策 I-6）。本模块不接受"先查全量、
 *    再在内存里剔掉敏感项"：那会在计数上泄漏敏感对象的存在性。做法与端点 26 一致 ——
 *    用冻结入口 `visibilityScope()` 取作用域，把 `OR(projectId=… AND id IN …)` 拼进 `where`。
 *
 * 2. **不跨模块调 service**（契约决策 I-9）。因此即使 `src/modules/task/` 里已有
 *    `loadTaskView()`，本模块也**不 import 它**，而是自己查 Prisma 并按共享类型
 *    `TaskView` 组装。（跨模块只允许经由 HTTP，见交接文档 §8。）
 *
 * 3. **三态而不是两态**。通知模块（别人的票）尚未交付，所以「被提及」返回
 *    `state='unavailable'` 且 `total=null`，**不得**返回 `0` —— 否则界面会把
 *    "还没接上"显示成"你没有消息"。
 *
 * ===========================================================================
 * 两处口径是**断言不是定论**（等 #24 结论）
 * ===========================================================================
 *
 *   - 「今天」按 **Asia/Shanghai 自然日**（C3 已于 2026-10-18 批复定案，见 `isoToday()`）；
 *   - 「未关闭」= `status != 'CLOSED'`（六状态已于 2026-10-17 落地）：
 *     DONE 只代表执行人已提交验收、不等于关闭，因此仍算「未关闭」。
 *     该口径随响应返回（见 `basis`），便于审查核对。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { createAuthorization } from '../authz/permissions.js'
import type { TaskStatus, TaskView } from '../../shared/types.js'
import type { WorkbenchBlock, WorkbenchView } from './types.js'

/** 「近期计划」的窗口天数。属本票自定口径，随响应返回，便于审查核对。 */
export const UPCOMING_WINDOW_DAYS = 7

/** 每块最多返回多少条明细。`total` 始终是精确值，不受此上限影响。 */
export const ROWS_PER_BLOCK = 50

/**
 * 按**口径时区**取"今天"（Asia/Shanghai 自然日）。
 *
 * C3 已由项目负责人 2026-10-18 批复定案：全项目统一 `Asia/Shanghai`，
 * 原实现用 UTC 日期，在中国时区下每天 08:00 之前会把"今天"算成前一天，
 * 逾期/近期计划因此偏移一天。用 `Intl` 而不是本地时钟：服务器时区不可控。
 */
function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** 在 ISO 日期字符串上加减天数（避免引入依赖）。 */
function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 明细行的取数形状：任务 + 负责人 / 验收人简要信息（与共享类型 TaskView 对齐）。 */
const TASK_INCLUDE = {
  owner: { select: { id: true, account: true, displayName: true } },
  acceptor: { select: { id: true, account: true, displayName: true } },
} as const

type TaskWithPeople = {
  id: string
  projectId: string
  storyId: string
  title: string
  description: string | null
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
  status: string
  progress: number | null
  blockedReason: string | null
  isSensitive: boolean
  createdAt: Date
  owner: { id: string; account: string; displayName: string }
  acceptor: { id: string; account: string; displayName: string }
}

/**
 * 按共享类型 `TaskView` 组装。
 * `status` 由数据库字符串收窄为联合类型 —— 与 `permissions.ts` 里
 * `m.role as ProjectRole` 同一做法（写路径已由校验器保证取值）。
 */
function toTaskView(row: TaskWithPeople): TaskView {
  return {
    id: row.id,
    projectId: row.projectId,
    storyId: row.storyId,
    title: row.title,
    description: row.description,
    ownerUserId: row.ownerUserId,
    acceptorUserId: row.acceptorUserId,
    planStart: row.planStart,
    planEnd: row.planEnd,
    status: row.status as TaskStatus,
    progress: row.progress,
    blockedReason: row.blockedReason,
    isSensitive: row.isSensitive,
    createdAt: row.createdAt.toISOString(),
    owner: row.owner,
    acceptor: row.acceptor,
  }
}

type ProjectScope = { projectId: string; mode: 'all' | 'subset'; ids: string[] }

/**
 * 可见性条件（决策 I-6）：PM 的项目不加限制；其余项目追加 `id IN (该作用域内的 id)`。
 * 作用域为空的成员项目会得到一个匹配不到任何行的分支（这正是"看不到任何对象"的语义）。
 */
function visibilityWhere(scopes: ProjectScope[]): Prisma.TaskWhereInput {
  return {
    OR: scopes.map((scope) =>
      scope.mode === 'all'
        ? { projectId: scope.projectId }
        : { projectId: scope.projectId, id: { in: scope.ids } },
    ),
  }
}

async function collect(
  prisma: PrismaClient,
  visibility: Prisma.TaskWhereInput,
  condition: Prisma.TaskWhereInput,
  orderBy: Prisma.TaskOrderByWithRelationInput[],
): Promise<{ total: number; rows: TaskView[] }> {
  // 两个条件都进同一个 where：可见性**不**在内存里做（决策 I-6）。
  const where: Prisma.TaskWhereInput = { AND: [visibility, condition] }
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({ where, orderBy, take: ROWS_PER_BLOCK, include: TASK_INCLUDE }),
  ])
  return { total, rows: rows.map((row) => toTaskView(row as TaskWithPeople)) }
}

export type BuildWorkbenchOptions = {
  /** 覆盖"今天"（测试用来钉住边界；默认按口径时区 **Asia/Shanghai** 取今天） */
  today?: string
}

/**
 * 组装个人工作台 5 块。
 *
 * `actorUserId` 来自会话（调用方保证已鉴权）。范围限定为**我参与的项目**：
 * 项目清单取自 `ProjectMember`，对象级过滤交给 `visibilityScope()`，
 * 因此非成员的项目既不会出现在清单里、也不会漏出任何对象。
 */
export async function buildWorkbench(
  prisma: PrismaClient,
  actorUserId: string,
  options: BuildWorkbenchOptions = {},
): Promise<WorkbenchView> {
  const today = options.today ?? isoToday()
  const horizon = shiftDays(today, UPCOMING_WINDOW_DAYS)
  const notClosedYet = { status: { not: 'CLOSED' } } as const

  const basis: WorkbenchView['basis'] = {
    asOf: today,
    todoMeans: '我是负责人、且还没验收关闭的任务（status 不是 CLOSED）',
    // ★ 2026-10-19 评审整改：此处原写「按 UTC 日期比较」，而 `isoToday()` 早已收敛为
    //   Asia/Shanghai —— 口径声明与实现自相矛盾，会让照文案写客户端的人算错一天
    //   （每天 08:00 之前上海比 UTC 早一天）。
    overdueMeans: `计划结束日期早于 ${today}（按 Asia/Shanghai 自然日比较）`,
    upcomingWindowDays: UPCOMING_WINDOW_DAYS,
    sixStatesNote:
      '六状态已落地（TODO/DOING/BLOCKED/SUSPENDED/DONE/CLOSED）。' +
      '「未关闭」= status 不是 CLOSED：DONE 只代表执行人已提交，仍需验收人关闭。',
  }

  const memberships = await prisma.projectMember.findMany({
    where: { userId: actorUserId },
    select: { projectId: true },
  })

  // 不参与任何项目 → 只有"空"这一种可能，直接返回，避免拼出空的 OR 条件。
  if (memberships.length === 0) {
    return { blocks: emptyBlocks(), basis }
  }

  const { visibilityScope } = createAuthorization(prisma)
  const scopes: ProjectScope[] = []
  for (const membership of memberships) {
    const scope = await visibilityScope(actorUserId, membership.projectId, 'task')
    scopes.push({
      projectId: membership.projectId,
      mode: scope.mode,
      ids: scope.mode === 'subset' ? scope.ids : [],
    })
  }
  const visibility = visibilityWhere(scopes)

  const [todo, overdue, accept, upcoming] = await Promise.all([
    collect(prisma, visibility, { ownerUserId: actorUserId, ...notClosedYet }, [
      { planEnd: 'asc' },
      { planStart: 'asc' },
    ]),
    collect(
      prisma,
      visibility,
      { ownerUserId: actorUserId, ...notClosedYet, planEnd: { lt: today } },
      [{ planEnd: 'asc' }],
    ),
    // 待验收：我是验收人、且执行人已提交（status = DONE）
    collect(prisma, visibility, { acceptorUserId: actorUserId, status: 'DONE' }, [
      { planEnd: 'asc' },
    ]),
    collect(
      prisma,
      visibility,
      {
        ownerUserId: actorUserId,
        ...notClosedYet,
        OR: [
          { planStart: { gte: today, lte: horizon } },
          { planEnd: { gte: today, lte: horizon } },
        ],
      },
      [{ planStart: 'asc' }, { planEnd: 'asc' }],
    ),
  ])

  const blocks: WorkbenchBlock[] = [
    { key: 'todo', state: 'ok', total: todo.total, rows: todo.rows },
    { key: 'overdue', state: 'ok', total: overdue.total, rows: overdue.rows },
    { key: 'accept', state: 'ok', total: accept.total, rows: accept.rows },
    {
      key: 'mention',
      state: 'unavailable',
      total: null,
      rows: [],
      note: '通知模块（别人负责的票）尚未交付，这里还没有数据源；这不代表"没有消息"。',
    },
    { key: 'upcoming', state: 'ok', total: upcoming.total, rows: upcoming.rows },
  ]

  return { blocks, basis }
}

/** 未参与任何项目时的空结果（仍返回 5 块，界面结构不变）。 */
function emptyBlocks(): WorkbenchBlock[] {
  return (['todo', 'overdue', 'accept', 'mention', 'upcoming'] as const).map((key) => ({
    key,
    state: key === 'mention' ? ('unavailable' as const) : ('ok' as const),
    total: key === 'mention' ? null : 0,
    rows: [],
    ...(key === 'mention'
      ? { note: '通知模块（别人负责的票）尚未交付，这里还没有数据源；这不代表"没有消息"。' }
      : {}),
  }))
}
