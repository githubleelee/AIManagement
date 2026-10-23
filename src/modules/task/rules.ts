/**
 * M5 任务模块 —— 任务分配业务规则（创建与编辑共用的单一入口）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-2b：业务规则（跳字段比较 / 需查库）不走 Zod，由处理器主动抛 `AppError`
 *   - 决策 I-4：字段级错误码 `NOT_PROJECT_MEMBER` / `ACCEPTOR_EQUALS_OWNER` /
 *     `END_BEFORE_START` / `INSUFFICIENT_MEMBERS`
 *   - 决策 I-8 端点 25 / 28 与决策 I-10 部分更新语义
 *
 * 本函数是创建（端点 25）与编辑（端点 28，T5-03）共用的**唯一**分配校验入口。
 * 为支持 T5-03 的部分更新，入参不是请求体，而是「**现有值 + 请求体覆盖**」合并后的
 * 最终值：PATCH 侧只要先合并出 `TaskAssignmentInput`，再调用本函数即可，规则无需重写。
 *
 * 注意：单字段形状校验（必填、长度、日期格式）由 Zod 在处理器里先行完成，
 * 本函数只处理需要跳字段比较或查库的业务规则。
 */
import type { Prisma, PrismaClient, Task } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { FieldError } from '../../shared/types.js'

/**
 * 创建与编辑共用的业务规则入参：必须是「合并后的最终值」。
 *
 * - 创建：全部字段来自请求体（形状校验之后）。
 * - 编辑（T5-03）：`{ ...现有任务, ...请求体出现过的字段 }`。
 */
export type TaskAssignmentInput = {
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
}

/** 统一的 422 VALIDATION_FAILED 抛出，保证字段级错误码可被测试断言（契约 I-4）。 */
function validationError(message: string, details: FieldError[]): AppError {
  return new AppError(422, 'VALIDATION_FAILED', message, details)
}

/**
 * 任务分配业务规则校验；入参必须是「合并后的最终值」。
 *
 * 校验顺序（契约端点 25 明文要求）：
 *   1. 负责人是且仅是本项目成员（`ownerUserId: NOT_PROJECT_MEMBER`）
 *   2. 验收人是且仅是本项目成员（`acceptorUserId: NOT_PROJECT_MEMBER`）
 *   3. 项目成员数 ≥ 2（`INSUFFICIENT_MEMBERS`，放空 field）
 *   4. 验收人 ≠ 负责人（`acceptorUserId: ACCEPTOR_EQUALS_OWNER`）
 *   5. 计划结束 ≥ 计划开始（`planEnd: END_BEFORE_START`，`YYYY-MM-DD` 字典序即时间序）
 *
 * 第 1 / 2 步先于第 4 步：避免对空值或非成员做相等判断；
 * 第 3 步先于第 4 步：成员只有 1 人时，负责人与验收人若都是该成员，
 * 应报 `INSUFFICIENT_MEMBERS` 而不是 `ACCEPTOR_EQUALS_OWNER`（否则上一条不可能满足）。
 */
export async function assertTaskAssignment(
  prisma: Pick<PrismaClient, 'projectMember'>,
  projectId: string,
  input: TaskAssignmentInput,
): Promise<void> {
  // 1 / 2. 成员归属：一次查询取回两个候选人的成员关系。
  const memberships = await prisma.projectMember.findMany({
    where: {
      projectId,
      userId: { in: [input.ownerUserId, input.acceptorUserId] },
    },
    select: { userId: true },
  })
  const memberIds = new Set(memberships.map((membership) => membership.userId))

  if (!memberIds.has(input.ownerUserId)) {
    throw validationError('负责人必须是本项目成员', [
      { field: 'ownerUserId', code: 'NOT_PROJECT_MEMBER' },
    ])
  }
  if (!memberIds.has(input.acceptorUserId)) {
    throw validationError('验收人必须是本项目成员', [
      { field: 'acceptorUserId', code: 'NOT_PROJECT_MEMBER' },
    ])
  }

  // 3. 成员数 ≥ 2：少于 2 人时不可能满足验收独立性。该规则无归属字段，field 置空。
  const memberCount = await prisma.projectMember.count({ where: { projectId } })
  if (memberCount < 2) {
    throw validationError('项目成员不足 2 人，请先添加其他成员', [
      { field: '', code: 'INSUFFICIENT_MEMBERS' },
    ])
  }

  // 4. 验收独立性与负责人互斥（团队决策 3）。
  if (input.acceptorUserId === input.ownerUserId) {
    throw validationError('验收人不能与负责人为同一人', [
      { field: 'acceptorUserId', code: 'ACCEPTOR_EQUALS_OWNER' },
    ])
  }

  // 5. 计划结束不早于计划开始。`YYYY-MM-DD` 零填充下字典序等于时间序（T0-02 已实测）。
  if (input.planEnd < input.planStart) {
    throw validationError('计划结束不能早于计划开始', [
      { field: 'planEnd', code: 'END_BEFORE_START' },
    ])
  }
}

/** Single persistence core shared by the existing PATCH and transactional plan batches.
 * Caller owns authorization, input shape checks, and (for a batch) the transaction.
 * This does not add US12-only TODO/FS/snapshot rules to ordinary manual PATCH.
 */
export type TaskWriteDb = Pick<Prisma.TransactionClient, 'task' | 'projectMember' | 'taskDependency'>
export type AssignedTaskWrite = TaskAssignmentInput & Partial<Pick<Task,
  'title' | 'description' | 'status' | 'progress' | 'blockedReason'>>

/** FS 放行守卫的固定文案：不引用任何前置的 ID / 标题 / 正文 / 列表（契约 I-3 不得泄露不可见对象）。
 * 顶层码与字段码均取自决策 I-4 冻结表，未新增任何错误码。
 */
const FS_PREDECESSOR_NOT_CLOSED = '存在未关闭（CLOSED）的前置任务，不能开工'
const FS_PLAN_START_BEFORE_RELEASE = '后继计划开始不得早于前置计划结束的次日'

/**
 * FS 开工守卫（`DECISIONS.md` `scheduling.fs-release-closed-natural-days` 与
 * `legacy.task-start-guard-authorization`）。
 *
 * **触发点 = 本次写入把任务带入 `DOING` 且它当前不是 `DOING`**（真正「开工 / 重启开工」）。
 * 已在 `DOING` 的任务再写标题 / 进度、或只改计划日期，都不会被重复校验：
 *   - `applyTaskPlanDates` 只传 `taskId / planStart / planEnd`（`values.status === undefined`），
 *     从不改变状态，因此**永远不属于开工**，不会被本守卫拦下；
 *   - 普通 PATCH 只改 `title` / `planStart` 等字段时 `merged.status` 仍等于原状态，
 *     既不要求前置已关闭，也不会把「TODO 计划编辑」误判为「前置关闭后才可规划」。
 *
 * 校验内容（只读**同一 `db`（即调用方事务）**内的真实 FS 前置）：
 *   1. 每个 FS 前置必须 `CLOSED`（`DONE` 不算验收通过）；
 *   2. 本次写入的 `planStart` 必须晚于前置 `planEnd` —— `YYYY-MM-DD` 字典序即自然日序，
 *      「晚于」等价于「不早于次日」（含首尾、Asia/Shanghai，日期不落时区）。
 *
 * 守卫不自开事务、不提前提交：`assertTaskAssignment`、本守卫与真实 `update` 共用同一个
 * `db`（根客户端或调用方事务客户端）。前置对调用者是否可见不影响服务端校验。
 */
async function assertFsStartRelease(
  db: TaskWriteDb, projectId: string, taskId: string,
  nextStatus: Task['status'] | undefined, nextPlanStart: string,
): Promise<void> {
  // 只有「开工」（写入结果为 DOING）才需要 FS 放行校验；日期 / 其它字段写入不算开工。
  if (nextStatus !== 'DOING') return

  const current = await db.task.findUnique({
    where: { id: taskId, projectId },
    select: { status: true },
  })
  // 任务不存在 / 并发已删除：交给随后的 update 抛 P2025，由处理器按契约 I-3 映射 404。
  // 已经是 DOING：本次不是「开工」，不重复校验（不把守卫强加给已在进行的任务编辑）。
  if (!current || current.status === 'DOING') return

  const predecessors = await db.taskDependency.findMany({
    where: { projectId, successorTaskId: taskId, type: 'FS' },
    select: { predecessor: { select: { status: true, planEnd: true } } },
  })
  for (const edge of predecessors) {
    if (edge.predecessor.status !== 'CLOSED') {
      throw validationError(FS_PREDECESSOR_NOT_CLOSED, [{ field: 'status', code: 'INVALID_VALUE' }])
    }
    if (nextPlanStart <= edge.predecessor.planEnd) {
      throw validationError(FS_PLAN_START_BEFORE_RELEASE, [
        { field: 'planStart', code: 'INVALID_VALUE' },
      ])
    }
  }
}

export async function writeAssignedTask(
  db: TaskWriteDb, projectId: string, taskId: string, values: AssignedTaskWrite,
): Promise<Task> {
  await assertTaskAssignment(db, projectId, values)
  await assertFsStartRelease(db, projectId, taskId, values.status, values.planStart)
  return db.task.update({
    where: { id: taskId, projectId },
    data: {
      ownerUserId: values.ownerUserId, acceptorUserId: values.acceptorUserId,
      planStart: values.planStart, planEnd: values.planEnd,
      title: values.title, description: values.description, status: values.status,
      progress: values.progress, blockedReason: values.blockedReason,
    },
  })
}

export type TaskPlanDates = { taskId: string; planStart: string; planEnd: string }

/** Not a route or an authorization boundary. Use only inside the caller's transaction.
 * B will expose/assemble the cross-domain port; C must not import task services.
 * Does not commit, audit, decide suggestions, or publish events.
 */
export async function applyTaskPlanDates(
  tx: TaskWriteDb, projectId: string, changes: readonly TaskPlanDates[],
): Promise<TaskPlanDates[]> {
  if ('$transaction' in tx) throw new Error('Plan batches require the caller transaction client')
  if (changes.length === 0 || new Set(changes.map((c) => c.taskId)).size !== changes.length) {
    throw validationError('计划调整不能为空或包含重复任务', [{ field: 'taskId', code: 'INVALID_VALUE' }])
  }
  for (const change of changes) {
    const validDate = (value: string) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const date = new Date(`${value}T00:00:00.000Z`)
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    }
    if (!change.taskId || !validDate(change.planStart) || !validDate(change.planEnd)
      || Object.keys(change).some((key) => !['taskId', 'planStart', 'planEnd'].includes(key))) {
      throw validationError('计划调整只能包含有效任务ID和自然日', [{ field: 'planStart', code: 'INVALID_VALUE' }])
    }
  }
  const rows = await tx.task.findMany({
    where: { projectId, id: { in: changes.map((c) => c.taskId) } },
    select: { id: true, ownerUserId: true, acceptorUserId: true },
  })
  if (rows.length !== changes.length) throw new AppError(404, 'NOT_FOUND', '资源不存在')
  const tasks = new Map(rows.map((row) => [row.id, row]))
  // Validate the whole set before the first write, still in the caller transaction.
  for (const change of changes) {
    const task = tasks.get(change.taskId)!
    await assertTaskAssignment(tx, projectId, { ...task, planStart: change.planStart, planEnd: change.planEnd })
  }
  const result: TaskPlanDates[] = []
  for (const change of changes) {
    const task = tasks.get(change.taskId)!
    const updated = await writeAssignedTask(tx, projectId, task.id, {
      ownerUserId: task.ownerUserId, acceptorUserId: task.acceptorUserId,
      planStart: change.planStart, planEnd: change.planEnd,
    })
    result.push({ taskId: updated.id, planStart: updated.planStart, planEnd: updated.planEnd })
  }
  return result
}
