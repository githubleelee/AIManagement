/**
 * US-09 任务验收（工单 #29）—— 业务服务。
 *
 * ===========================================================================
 * 纪律（四条，缺一条这个模块就不该合）
 * ===========================================================================
 *
 * 1. **判权一律走冻结入口 `can()`**（契约决策 I-5），本模块**不自行判角色**，
 *    也不看请求体里任何"我是谁 / 我能不能"的字段。写路径用 `task.accept`，
 *    读路径用 `project.read` —— 两者都由 `can()` 现查库决定 403 / 404。
 *
 * 2. **列表与计数在查询层过滤**（决策 I-6）。待验收清单把 `visibilityScope()` 的条件
 *    拼进**同一个 where**，不存在"先查全量再在内存剔除"的路径（那会泄漏敏感对象的存在性）。
 *
 * 3. **不跨模块调 service**（决策 I-9）。本模块**不 import** `src/modules/task/` 的
 *    `loadTaskView()`，自己查 Prisma 并按共享类型 `TaskView` 组装（与 US-08 工作台同一做法）。
 *
 * 4. **写路径只碰状态类字段**。验收端点只改 `status`（并按不变式清 `blockedReason`），
 *    **绝不**碰标题 / 描述 / 负责人 / 验收人 / 计划 —— 上一票出过"借弱动作捎带改标题"
 *    的越权写（US-08 审查 B-1），这里连字段通道都不存在（请求体 schema 只接受两个字段）。
 *
 * ===========================================================================
 * 状态机（依据契约门 #24 的 ROLE-A 结论 comment 6233430993，非本模块自造）
 * ===========================================================================
 *
 *   执行人 DOING → DONE（提交验收）；验收人 DONE → CLOSED（通过）或 → DOING（驳回）。
 *
 * 因此本服务**只接受** `status === 'DONE'` 的任务；其余状态一律 409 CONFLICT，
 * 并保证「状态未变、无记录落库」（AC3「未通过不得关闭」在本端点内的落点：
 * 不存在 TODO/DOING → CLOSED 的通道）。
 *
 * 「重验」不是第三种结论：它是驳回后任务回到 DOING、执行人重新提交 DONE、
 * 验收人**再次调用本端点**。同一任务因此会有多条记录（AC5 的追溯来源）。
 */
import type { PrismaClient, Task as TaskRow } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { TaskStatus, TaskView, UserBrief } from '../../shared/types.js'
import { createAuthorization } from '../authz/permissions.js'
import {
  ACCEPTANCE_REASON_MAX_LENGTH,
  type AcceptanceConclusion,
  type AcceptanceQueueItem,
  type AcceptanceQueueScope,
  type AcceptanceRecordView,
  type AcceptanceSubmitInput,
  type AcceptanceSubmitResult,
} from './types.js'

/* ===========================================================================
 * 错误构造：与其它模块逐字一致（契约 I-3 / I-4），不新增错误码
 * =========================================================================== */

/** 与「对象不存在」完全一致的 404，响应体不含对象任何字段（契约 I-3）。 */
function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', '资源不存在')
}

/** 对象可见但操作不允许：403。 */
function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
}

/** 状态冲突：409（错误码表已有 CONFLICT，本票未新增任何错误码）。 */
function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message)
}

/** 把 can() 的拒绝结果原样翻译成 AppError，调用方不自行判断 403/404（契约 I-5 约束 2）。 */
function denied(decision: { status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }): AppError {
  return decision.code === 'NOT_FOUND' ? notFound() : forbidden()
}

/** 结论 → 目标状态。两个方向都来自 #24 的结论，不是本模块的发明。 */
const NEXT_STATUS: Record<AcceptanceConclusion, TaskStatus> = {
  PASS: 'CLOSED',
  REJECT: 'DOING',
}

/* ===========================================================================
 * 视图组装（不 import 任务模块，见纪律 3）
 * =========================================================================== */

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
  owner: UserBrief
  acceptor: UserBrief
}

/** 按共享类型 `TaskView` 组装；`status` 由数据库字符串收窄（写路径已由校验器保证取值）。 */
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

type RecordRow = {
  id: string
  projectId: string
  taskId: string
  actorUserId: string
  conclusion: string
  reason: string | null
  statusBefore: string
  statusAfter: string
  createdAt: Date
}

function toRecordView(row: RecordRow, actor: UserBrief): AcceptanceRecordView {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    actorUserId: row.actorUserId,
    actor,
    conclusion: row.conclusion as AcceptanceConclusion,
    reason: row.reason,
    statusBefore: row.statusBefore as TaskStatus,
    statusAfter: row.statusAfter as TaskStatus,
    createdAt: row.createdAt.toISOString(),
  }
}

/** actor 常量：外键保证存在；取不到属数据被外部破坏，抛错交统一错误处理器转 500。 */
function requireActor(actor: UserBrief | undefined, id: string): UserBrief {
  if (!actor) throw new Error(`验收记录的 actor 不存在：${id}`)
  return actor
}

/* ===========================================================================
 * ① 判权与目标加载（**本模块唯一的 task.accept 判权点**）
 * =========================================================================== */

/**
 * 加载任务并完成 `task.accept` 判权；不允许则抛 403 / 404。
 *
 * 为什么单独抽出来：与仓库既有约定一致 —— **鉴权先于业务校验与形状校验**
 * （T5-06 有专门用例钉住"非成员 + 非法参数仍然 404"）。路由层先调本函数，
 * 再做 Zod 形状校验，因此"非验收人提交非法请求体"得到的是 **403/404**，
 * 而不是 422 —— 不会因为请求体形状而泄漏对象是否存在。
 *
 * 判权完全交给冻结入口 `can()`（契约 I-5）：本模块**不**自行判断角色，
 * 也不看请求体里的任何身份字段。
 */
export async function assertMayAccept(
  prisma: PrismaClient,
  actorUserId: string,
  taskId: string,
): Promise<TaskRow> {
  const { can } = createAuthorization(prisma)

  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) throw notFound()

  const decision = await can(actorUserId, 'task.accept', {
    kind: 'task',
    projectId: task.projectId,
    objectId: task.id,
  })
  if (!decision.allow) throw denied(decision)

  return task
}

/* ===========================================================================
 * ② 执行验收（通过 / 驳回）
 * =========================================================================== */

/**
 * 对**已判权通过**的任务执行一次验收。
 *
 * 入参 `task` 必须来自 `assertMayAccept`（同一请求内刚查出来的行）。
 *
 * 每一步失败都保证"状态未变、无记录落库"：
 *   1. 数据不变量防御：验收人 = 负责人 → 409（正常写入路径由 rules.ts 拦住，这里是兜底）
 *   2. 驳回未填原因 → 422 `reason: REQUIRED`（**服务端强制**，不靠界面）
 *   3. 当前状态不是 DONE → 409（AC3：未提交验收就不得关闭）
 *   4. 事务内 **比较并交换**：`updateMany({ where: { id, status: 'DONE' } })`，
 *      影响行数为 0 说明已被另一个并发请求验收过 → 409，且**不写记录**
 *   5. 同一事务内追加一条 `AcceptanceRecord`
 *
 * 只改 `status`（并按不变式归一 `blockedReason`）：标题 / 描述 / 负责人 / 验收人 /
 * 计划**不在**写集合里，请求体 schema 也不接受这些字段。
 */
export async function submitAcceptance(
  prisma: PrismaClient,
  actorUserId: string,
  task: TaskRow,
  input: AcceptanceSubmitInput,
): Promise<AcceptanceSubmitResult> {
  // AC2：验收人 ≠ 负责人（Sprint 1 决策 3）。创建/编辑时由 rules.ts 的
  // `ACCEPTOR_EQUALS_OWNER` 强制；这里再加一道运行时防御，防止库中不变量被破坏后
  // 出现"自己验收自己"。
  if (task.acceptorUserId === task.ownerUserId) {
    throw conflict('任务数据不一致（验收人与负责人为同一人），无法验收')
  }

  const reason = (input.reason ?? '').trim()
  if (input.conclusion === 'REJECT' && reason === '') {
    throw new AppError(422, 'VALIDATION_FAILED', '驳回必须填写原因', [
      { field: 'reason', code: 'REQUIRED' },
    ])
  }
  if (reason.length > ACCEPTANCE_REASON_MAX_LENGTH) {
    throw new AppError(422, 'VALIDATION_FAILED', '原因过长', [
      { field: 'reason', code: 'TOO_LONG' },
    ])
  }

  const statusBefore = task.status as TaskStatus
  if (statusBefore !== 'DONE') {
    // AC3 的核心：只有「执行人已提交（DONE）」才能验收，不存在直接关闭的通道。
    throw conflict('只有「待验收」的任务可以验收；请先由负责人提交验收')
  }

  const statusAfter = NEXT_STATUS[input.conclusion]

  const record = await prisma.$transaction(async (tx) => {
    // ★ 比较并交换（CAS）：只在任务**仍是 DONE** 时改。两个并发验收请求里，
    //   后到的那个 updateMany 影响 0 行 → 返回 null → 409，且不会多写一条记录。
    const changed = await tx.task.updateMany({
      where: { id: task.id, status: 'DONE' },
      data: {
        status: statusAfter,
        // 不变式：原因只在 BLOCKED 态有值（端点 28 同款）。任务能被验收说明它已不是
        // BLOCKED，这里顺手归一，避免库中残留过期原因。
        blockedReason: null,
      },
    })
    if (changed.count === 0) return null

    return tx.acceptanceRecord.create({
      data: {
        projectId: task.projectId,
        taskId: task.id,
        actorUserId,
        conclusion: input.conclusion,
        reason: reason === '' ? null : reason,
        statusBefore,
        statusAfter,
      },
    })
  })

  if (record === null) {
    throw conflict('任务状态已变化，请刷新后重试')
  }

  const fresh = await prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    include: TASK_INCLUDE,
  })
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, account: true, displayName: true },
  })

  return {
    task: toTaskView(fresh as TaskWithPeople),
    record: toRecordView(record, requireActor(actor ?? undefined, actorUserId)),
  }
}

/* ===========================================================================
 * ③ 某任务的验收历史（AC5 的读路径）
 * =========================================================================== */

/**
 * 读某任务的验收记录，**旧 → 新**（读起来就是一条时间线：提交 → 驳回 → 重验 → 通过）。
 *
 * 权限：`can(actor, 'project.read', { kind: 'task' })` —— 敏感任务对非白名单成员返回
 * 与"任务不存在"逐字一致的 404（AC7）。
 *
 * 空历史返回空数组，**不是** 404：任务存在、只是还没验收过（两种语义不能混）。
 */
export async function listTaskAcceptances(
  prisma: PrismaClient,
  actorUserId: string,
  taskId: string,
): Promise<AcceptanceRecordView[]> {
  const { can } = createAuthorization(prisma)

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true },
  })
  if (!task) throw notFound()

  const decision = await can(actorUserId, 'project.read', {
    kind: 'task',
    projectId: task.projectId,
    objectId: task.id,
  })
  if (!decision.allow) throw denied(decision)

  const rows = await prisma.acceptanceRecord.findMany({
    where: { taskId: task.id },
    orderBy: [{ createdAt: 'asc' }],
  })

  // 一次取回所有 actor，避免逐行查库（N+1）
  const actorIds = [...new Set(rows.map((row) => row.actorUserId))]
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, account: true, displayName: true },
  })
  const byId = new Map(actors.map((actor) => [actor.id, actor]))

  return rows.map((row) =>
    toRecordView(row, requireActor(byId.get(row.actorUserId), row.actorUserId)),
  )
}

/* ===========================================================================
 * ④ 验收清单（界面主链路，两种视角）
 * =========================================================================== */

/**
 * 项目内的验收清单，按 `planEnd` 升序。
 *
 * - `scope = 'acceptor'`（默认）：**我是验收人**、且执行人已提交（`status = 'DONE'`）。
 * - `scope = 'owner'`：**我是负责人**、且**最近一次验收结论是驳回** ⇒ 轮到我整改。
 *   （2026-10-18 走查发现的缺口：驳回理由原本传不到执行人。）
 *
 * ★ 可见性条件与筛选条件拼进**同一个 where**（决策 I-6）：`visibilityScope()` 的作用域
 *   与视角条件交给同一次 `findMany`。敏感任务若不在我的作用域里，既不会出现在列表里，
 *   也不会出现在任何计数里。
 *
 * ⚠️ `scope='owner'` 分支里有一次**内存筛选**（`latest.filter(...)`）。它**不是可见性过滤** ——
 *   可见性已在上面的 where 中完成，这里只是在"我已经有权看到的、我自己负责的任务的记录"
 *   上做业务判定（最近一条是否为驳回）。因为不含任何"我是否有权看到"的判断，所以不会
 *   泄漏敏感对象的存在性，不属于决策 I-6 所禁止的那类内存过滤。
 *
 * 为什么不在前端用端点 26 自己筛：那是真正的内存过滤（连可见性一起），且端点 26 只支持
 * `ownerUserId` 参数，加 `acceptorUserId` 等于改旧模块文件（需另行授权）。
 */
export async function listAcceptanceQueue(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  queueScope: AcceptanceQueueScope = 'acceptor',
): Promise<AcceptanceQueueItem[]> {
  const { can, visibilityScope } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const scope = await visibilityScope(actorUserId, projectId, 'task')
  const visibility = scope.mode === 'subset' ? { id: { in: scope.ids } } : {}

  const orderBy = [{ planEnd: 'asc' }, { createdAt: 'asc' }] as const

  if (queueScope === 'owner') {
    // 我负责的任务里，**最近一次**验收结论是驳回的那些。
    // `distinct: ['taskId']` + `orderBy createdAt desc` ⇒ 每个任务只留最新一条记录。
    const latest = await prisma.acceptanceRecord.findMany({
      where: { task: { projectId, ownerUserId: actorUserId, ...visibility } },
      orderBy: [{ taskId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['taskId'],
    })
    const rejectedTaskIds = latest
      .filter((record) => record.conclusion === 'REJECT')
      .map((record) => record.taskId)
    if (rejectedTaskIds.length === 0) return []

    const tasks = await prisma.task.findMany({
      where: { id: { in: rejectedTaskIds }, projectId, ...visibility },
      orderBy: [...orderBy],
      include: TASK_INCLUDE,
    })
    return attachLatestAcceptance(prisma, tasks as TaskWithPeople[])
  }

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      acceptorUserId: actorUserId,
      status: 'DONE',
      ...visibility,
    },
    orderBy: [...orderBy],
    include: TASK_INCLUDE,
  })
  return attachLatestAcceptance(prisma, tasks as TaskWithPeople[])
}

/**
 * 给每行挂上该任务**最近一次**验收记录（两次批量查询，避免逐行 N+1）。
 * 从未验收过的任务得到 `latestAcceptance: null`（而不是编造一条空记录）。
 */
async function attachLatestAcceptance(
  prisma: PrismaClient,
  tasks: TaskWithPeople[],
): Promise<AcceptanceQueueItem[]> {
  if (tasks.length === 0) return []

  const latest = await prisma.acceptanceRecord.findMany({
    where: { taskId: { in: tasks.map((task) => task.id) } },
    orderBy: [{ taskId: 'asc' }, { createdAt: 'desc' }],
    distinct: ['taskId'],
  })
  const latestByTask = new Map(latest.map((record) => [record.taskId, record]))

  const actorIds = [...new Set(latest.map((record) => record.actorUserId))]
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, account: true, displayName: true },
  })
  const actorById = new Map(actors.map((actor) => [actor.id, actor]))

  return tasks.map((task) => {
    const record = latestByTask.get(task.id)
    return {
      ...toTaskView(task),
      latestAcceptance: record
        ? toRecordView(record, requireActor(actorById.get(record.actorUserId), record.actorUserId))
        : null,
    }
  })
}
