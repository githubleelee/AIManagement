/**
 * US-10 项目关闭阻断（工单 #30）—— 阻断校验（任务侧 + 风险侧）。
 *
 * ===========================================================================
 * 阻断条件（handoff §9 + 项目负责人批复第 4 节）
 * ===========================================================================
 *
 * 存在 **未 CLOSED 的任务**，或存在 **未处理 / 处理中（OPEN / IN_PROGRESS）的风险**
 * ⇒ 拒绝关闭，返回 409 + 阻断清单。
 *
 * 两侧判定都用**同一个可见性口径**（`visibilityScope(actor, projectId, 'task')`）：
 *   - 任务侧：`id IN (可见任务)`
 *   - 风险侧：`taskId IS NULL`（不关联任务的公开风险）**或** `taskId IN (可见任务)`
 *     —— 即"敏感风险继承所关联任务的敏感可见性"（批复第 6 项，不扩展对象类型）。
 *
 * ===========================================================================
 * 三态纪律
 * ===========================================================================
 *
 * `blocked`（确定不能关）/ `clear`（确定能关）/ `unavailable`（数据缺失，判不了）。
 * 两侧现在都有数据源，正常情况下只会出现 `blocked` 与 `clear`；
 * 保留 `unavailable` 是为了"宁可不说能关"这条纪律在异常数据下依然成立。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { Scope, TaskStatus, TaskView, UserBrief } from '../../shared/types.js'
import { createAuthorization } from '../authz/permissions.js'
import { sortRisksByPriority } from './ordering.js'
import type {
  BlockingSide,
  ClosureCheckView,
  ClosureVerdict,
  RiskLevel,
  RiskStatus,
  RiskView,
} from './types.js'
import { BLOCKING_RISK_STATUSES } from './types.js'

/** 清单最多返回多少条（`total` 始终是精确值，不受此上限影响）。 */
export const BLOCKING_ROWS_LIMIT = 50

/** 口径时区（批复冻结：Asia/Shanghai），与 analytics 一致。 */
const CALC_TIMEZONE = 'Asia/Shanghai'

export function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CALC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', '资源不存在')
}

export function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
}

export function denied(decision: { status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }): AppError {
  return decision.code === 'NOT_FOUND' ? notFound() : forbidden()
}

export const TASK_INCLUDE = {
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
  owner: UserBrief
  acceptor: UserBrief
}

/** 按共享类型 `TaskView` 组装（不 import 任务模块，决策 I-9）。 */
export function toTaskView(row: TaskWithPeople): TaskView {
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

const RISK_INCLUDE = {
  owner: { select: { id: true, account: true, displayName: true } },
} as const

export { RISK_INCLUDE }

export type RiskRow = {
  id: string
  projectId: string
  title: string
  description: string | null
  level: string
  status: string
  ownerUserId: string
  taskId: string | null
  resolution: string | null
  createdAt: Date
  updatedAt: Date
  owner: UserBrief
}

export function toRiskView(row: RiskRow): RiskView {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    level: row.level as RiskLevel,
    status: row.status as RiskStatus,
    ownerUserId: row.ownerUserId,
    owner: row.owner,
    taskId: row.taskId,
    resolution: row.resolution,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * 风险的可见性条件（批复第 6 项：敏感风险继承关联任务的可见性）。
 *
 * - PM（scope=all）→ 不加条件；
 * - 其余角色 → `taskId IS NULL`（不关联任务）**或** `taskId IN (可见任务 id)`。
 *
 * ★ 这是**查询层**条件（决策 I-6），与计数、清单同源，不做内存过滤。
 */
export function riskVisibilityWhere(scope: Scope): Prisma.RiskWhereInput {
  if (scope.mode === 'all') return {}
  return { OR: [{ taskId: null }, { taskId: { in: scope.ids } }] }
}

/**
 * 计算关闭判定（纯函数）。
 *
 * 阻断条件是"或"：任一侧成立即 `blocked`；两侧都有数据且都没阻断才 `clear`。
 */
export function verdictOf(taskBlocking: boolean, riskBlocking: boolean, dataComplete = true): ClosureVerdict {
  if (taskBlocking || riskBlocking) {
    return {
      state: 'blocked',
      canClose: false,
      note: '存在未关闭的任务或未处理/处理中的风险，项目不能关闭（见下方清单）。',
    }
  }
  if (!dataComplete) {
    return {
      state: 'unavailable',
      canClose: null,
      note: '两侧都没有阻断项，但数据不完整，无法确认是否可以关闭。',
    }
  }
  return { state: 'clear', canClose: true, note: '任务与风险两侧均无阻断项，可以关闭。' }
}

/**
 * 关闭阻断校验预览。
 *
 * 权限：`can(actor, 'project.read', { kind: 'project' })`；非成员 / 不存在 → 404（逐字一致）。
 *
 * ⚠️ 非 PM 看到的是**自己可见范围内**的阻断清单（`basis.scope = 'visible'`）——
 * 界面必须标注「可见范围」，不能以可见子集冒称全项目（批复第 3 节的同类要求）。
 */
export async function checkClosure(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  options: { today?: string } = {},
): Promise<ClosureCheckView> {
  const { can, visibilityScope } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) throw notFound()

  const scope = await visibilityScope(actorUserId, projectId, 'task')

  const taskWhere: Prisma.TaskWhereInput = {
    projectId,
    status: { not: 'CLOSED' },
    ...(scope.mode === 'subset' ? { id: { in: scope.ids } } : {}),
  }
  const riskWhere: Prisma.RiskWhereInput = {
    projectId,
    status: { in: [...BLOCKING_RISK_STATUSES] },
    ...riskVisibilityWhere(scope),
  }

  // 计数与清单各自同一个 where（I-6），total 与 rows 同源。
  const [taskTotal, tasks, riskTotal, risks] = await Promise.all([
    prisma.task.count({ where: taskWhere }),
    prisma.task.findMany({
      where: taskWhere,
      orderBy: [{ planEnd: 'asc' }, { createdAt: 'asc' }],
      take: BLOCKING_ROWS_LIMIT,
      include: TASK_INCLUDE,
    }),
    prisma.risk.count({ where: riskWhere }),
    // ⚠️ 这里**不能**用 `take` 去配合一个错序的 orderBy（2026-10-19 评审 ④）：
    //   原实现 `orderBy: [{ level: 'asc' }]` 是字典序（HIGH→LOW→MEDIUM），
    //   先截 50 条会把**高危风险挤出阻断清单**（先返回 LOW、再 MEDIUM）。
    //   故改为：取回 → 按显式 rank 排（`ordering.ts`）→ 再截 `BLOCKING_ROWS_LIMIT`。
    //   `total` 仍由上面的 `count` 精确给出，不受此上限影响（与任务侧同一纪律）。
    prisma.risk.findMany({
      where: riskWhere,
      // 基准序：同优先级时按"越早发现越先处理"；真实优先级见下面的 rank 排序
      orderBy: [{ createdAt: 'asc' }],
      include: RISK_INCLUDE,
    }),
  ])

  const blockingTasks: BlockingSide<TaskView> = {
    state: 'ok',
    total: taskTotal,
    rows: tasks.map((task) => toTaskView(task as TaskWithPeople)),
  }
  const blockingRisks: BlockingSide<RiskView> = {
    state: 'ok',
    total: riskTotal,
    // 高危优先（显式 rank），排序**后**才截到上限 —— 见上面的取数注释
    rows: sortRisksByPriority(risks as RiskRow[])
      .slice(0, BLOCKING_ROWS_LIMIT)
      .map(toRiskView),
  }

  // ★ 「我看不到阻断项」不等于「项目能关」（独立审查 S4 的重点项）：
  //   非 PM 的清单是按**可见范围**算的；他看到的都干净只能说明"判不了"，
  //   不能报 clear —— 否则同一项目 PM 得 blocked、member 得 canClose=true，
  //   等于以可见子集冒称全项目（违背批复第 3 节 C6 与三态纪律）。
  //   只有 PM（scope=all）拥有全项目基数，才允许给出确定结论。
  const verdict = verdictOf(taskTotal > 0, riskTotal > 0, scope.mode === 'all')

  return {
    project: { id: project.id, name: project.name },
    verdict,
    blockingTasks,
    blockingRisks,
    basis: {
      asOf: options.today ?? isoToday(),
      scope: scope.mode === 'all' ? 'global' : 'visible',
      blockingMeans:
        '阻断条件：存在 status != CLOSED 的任务，或存在「未处理 / 处理中」的风险（RESOLVED / CLOSED 不阻断）。',
      riskSideNote:
        '敏感风险继承所关联任务的敏感可见性：不关联任务的公开风险对项目成员可见，关联敏感任务的风险只对该任务白名单内的成员可见。',
      closeActionNote:
        '关闭 / 重开动作仅 PM 可执行（project.close）；本端点是只读预览，非 PM 看到的是自己可见范围内的阻断情况。',
    },
  }
}
