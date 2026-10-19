/**
 * US-06 甘特图（GitHub #26，本地 #12）—— 里程碑 / FS 依赖**写路径**服务。
 *
 * 设计依据：`docs/role-b-gantt-design.md` §3（模型）、§4.2（写入时校验）、§7（接口候选）；
 * 口径依据：`DECISIONS.md` 的
 *   - `scheduling.fs-release-closed-natural-days`（仅 FS、自然日含首尾）；
 *   - `ownership.public-files-single-writer`（B 单写范围）；
 *   - `contract.close-blocking-response`（**不改错误信封**：仍是 `AppError` + `details[{field,code}]`）。
 *
 * ===========================================================================
 * 职责边界
 * ===========================================================================
 *
 * - **判权只问 `can()`**：`gantt.write` 归入 `WRITE_ACTIONS`，PM 由第 3 条放行、
 *   MEMBER / VIEWER 由第 5 条得 403、非成员得 404。本文件**零角色名字面判断**，
 *   `decision.status` / `decision.code` 直接使用。
 * - **不 import 其它业务模块的 service**（契约 I-9）：需要的数据自己查 Prisma。
 * - **不新增迁移**：`Milestone` / `TaskMilestone` / `TaskDependency` 模型已在
 *   `20261018050000_add_gantt_models` 落地。
 *
 * ===========================================================================
 * 按 id 操作的权限顺序（PATCH / DELETE）
 * ===========================================================================
 *
 * `can()` 必须自己按 id 现查目标对象，所以这里先用**最小查询**（只取
 * `projectId`）拿到真实项目边界，再问 `can()`，最后才做读写：
 *
 *   对象不存在            → 404（与「非成员」逐字一致）
 *   对象存在但我是非成员  → `can()` 给 404（同一条文案）
 *   对象可见但无写权限    → `can()` 给 403
 *
 * 「对象不存在」与「不可见」必须是**同一条** 404 文案，否则 id 猜测就变成了
 * 存在性预言机（契约 I-3 / 设计 §6）。
 *
 * ===========================================================================
 * 事件（**本批不接线**）
 * ===========================================================================
 *
 * 每个写成功点都用 `【事件占位】` 注释登记将来要发布的事件名；传输实现由 ROLE-D 的
 * #37 提供，本批不注入 `GanttEventPort`、不 new no-op 实现、不调用（见 `./types.ts`）。
 */
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { FieldErrorCode } from '../../shared/types.js'
import { createAuthorization } from '../authz/permissions.js'
import type {
  MilestoneCreateInput,
  MilestonePatchInput,
  MilestoneWriteView,
  TaskDependencyCreateInput,
  TaskDependencyType,
  TaskDependencyView,
} from './types.js'

/**
 * 统一的 404 文案。
 *
 * 与 `./plugin.ts`（读端点）、`project/plugin.ts`、`workload/plugin.ts`、`board/plugin.ts`
 * 取值**逐字一致**：对象不存在、任务/里程碑不属于本项目、调用者不是项目成员，
 * 对外都是这一条，不区分（不造存在性预言机）。
 */
const NOT_FOUND_MESSAGE = '项目不存在'

/** 403 文案：`gantt.write` 仅 PM —— 与 `project/plugin.ts` 同款。 */
const FORBIDDEN_MESSAGE = '该操作需要项目经理权限'

/** `'YYYY-MM-DD'`（决策 I-10：不接受其它格式）。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', NOT_FOUND_MESSAGE)
}

/**
 * 把 `can()` 的否定结论原样变成错误：**不自行判断 403 / 404**，只用 `decision.status`。
 * 同时把文案归一成本模块唯一的一条 404 / 一条 403（响应形状不变）。
 */
function denied(decision: { status: 403 | 404 }): AppError {
  return decision.status === 404
    ? notFound()
    : new AppError(403, 'FORBIDDEN', FORBIDDEN_MESSAGE)
}

/**
 * 422 `VALIDATION_FAILED` + 字段级错误码。
 *
 * `code` 只能取 `src/shared/types.ts` 决策 I-4 冻结表里的取值
 * （`web/src/pages/requirement/terms.ts` 是 `Record<FieldErrorCode, string>` 穷举表，
 * 自造 code 会让前端无法翻译），故形参类型直接写 `FieldErrorCode`，无需断言。
 *
 * 区分度靠**顶层 code + message**：具体原因（如「不是合法日期」）写进 message。
 */
function validationError(message: string, field: string, code: FieldErrorCode): AppError {
  return new AppError(422, 'VALIDATION_FAILED', message, [{ field, code }])
}

/**
 * 409 `CONFLICT` + 字段级错误码（重复边 / FS 环）。
 *
 * 与 422 的区分在**顶层 code**（`CONFLICT` vs `VALIDATION_FAILED`），
 * 字段码同样限冻结表内取值；环 / 重复边的中文原因写进 message。
 */
function conflictError(message: string, field: string, code: FieldErrorCode): AppError {
  return new AppError(409, 'CONFLICT', message, [{ field, code }])
}

/** Prisma 已知错误码判定（P2002 唯一冲突 / P2025 记录不存在）。 */
function isPrismaErrorCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

/**
 * `'YYYY-MM-DD'` 是否**真实存在**的自然日。
 *
 * Zod 只校验形状（`dateSchema`），`2026-02-30` / `2026-13-01` 这类字形合法但日历
 * 不存在的值必须在这里拒绝（422 `INVALID_VALUE`，设计 §4.2 的写入时校验）。
 */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** 唯一鉴权入口：项目级写权限（PM 放行、MEMBER / VIEWER 403、非成员 404）。 */
async function assertCanWrite(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
): Promise<void> {
  const { can } = createAuthorization(prisma)
  const decision = await can(actorUserId, 'gantt.write', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)
}

/**
 * 里程碑负责人必须是**本项目成员**（`ownerUserId: NOT_PROJECT_MEMBER`）。
 * `undefined`（未提供）与 `null`（显式清空）都归一到 `null` —— 里程碑可无单独负责人。
 */
async function resolveOwnerUserId(
  prisma: PrismaClient,
  projectId: string,
  ownerUserId: string | null | undefined,
): Promise<string | null> {
  if (ownerUserId === undefined || ownerUserId === null) return null
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: ownerUserId } },
    select: { userId: true },
  })
  if (!membership) {
    throw validationError('里程碑负责人必须是本项目成员', 'ownerUserId', 'NOT_PROJECT_MEMBER')
  }
  return ownerUserId
}

/**
 * 关联任务必须**真实属于本项目**（直接读库取 `Task.projectId`，不信任请求体）。
 *
 * 「不存在」与「属于其它项目」返回**同一条**错误：不造存在性预言机。
 * 重复 id 去重后保留首次出现顺序，供事务内插入关联行。
 */
async function resolveTaskIdsInProject(
  prisma: PrismaClient,
  projectId: string,
  taskIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(taskIds)]
  if (unique.length === 0) return unique

  const rows = await prisma.task.findMany({
    where: { id: { in: unique }, projectId },
    select: { id: true },
  })
  if (rows.length !== unique.length) {
    throw validationError('关联任务不属于本项目', 'taskIds', 'CROSS_PROJECT_REF')
  }
  return unique
}

/** 依赖端点任务必须属于本项目；`field` 指明是前驱还是后继（422 `CROSS_PROJECT_REF`）。 */
async function assertTaskInProject(
  prisma: PrismaClient,
  projectId: string,
  taskId: string,
  field: 'predecessorTaskId' | 'successorTaskId',
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  })
  if (!task || task.projectId !== projectId) {
    // 「不可见 / 不存在 / 跨项目」共用一条：不区分三者（设计 §4.2 第 3 项）。
    throw validationError('依赖任务不属于本项目', field, 'CROSS_PROJECT_REF')
  }
}

/**
 * 加入 `predecessor → successor` 是否会形成 FS 环。
 *
 * 判定：从 `successor` 出发沿**既有边**（`predecessor → successor`）做**迭代式 BFS**，
 * 能到达 `predecessor` 即成环。**禁止递归**（长链会爆栈），队列用下标出队避免
 * `Array.shift()` 的 O(n) 移动。
 *
 * 一致性：本函数必须与插入在**同一个 `$transaction`** 内（调用方保证）。SQLite 只有
 * 单写者，Prisma 的 SQLite 连接在事务内串行执行，所以「读全量边 → BFS → 插入」不会与
 * 另一个并发建边事务交错：后开始的事务看到的必然是前者**已提交**的边。两个互反建边
 * 的并发请求（A→B 与 B→A）里，后到者因此能从既有边走到自己，判出环（`gantt-write.test.ts`
 * 的「并发互反建边」用例覆盖该论证）。
 */
async function wouldCreateCycle(
  tx: Prisma.TransactionClient,
  projectId: string,
  predecessorTaskId: string,
  successorTaskId: string,
): Promise<boolean> {
  const edges = await tx.taskDependency.findMany({
    where: { projectId, type: 'FS' },
    select: { predecessorTaskId: true, successorTaskId: true },
  })

  const successorsOf = new Map<string, string[]>()
  for (const edge of edges) {
    const list = successorsOf.get(edge.predecessorTaskId)
    if (list) list.push(edge.successorTaskId)
    else successorsOf.set(edge.predecessorTaskId, [edge.successorTaskId])
  }

  const queue: string[] = [successorTaskId]
  const visited = new Set<string>(queue)
  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i] as string
    for (const next of successorsOf.get(current) ?? []) {
      if (next === predecessorTaskId) return true
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  return false
}

/** 里程碑写响应取数：字段与读投影对齐，另附关联任务 id。 */
const MILESTONE_WRITE_SELECT = {
  id: true,
  projectId: true,
  name: true,
  dueDate: true,
  ownerUserId: true,
  createdAt: true,
  owner: { select: { id: true, account: true, displayName: true } },
} as const

/**
 * 组装 `MilestoneWriteView`：读取投影 + `taskIds`（`createdAt asc, id asc` 稳定排序）。
 *
 * `taskIds` 只含**本项目内**的已关联任务；写路径仅 PM 可达（`gantt.write` 在
 * `WRITE_ACTIONS` 里），PM 的任务可见集就是全项目，故无需再叠一层可见性过滤。
 */
async function toMilestoneWriteView(
  prisma: PrismaClient,
  milestoneId: string,
): Promise<MilestoneWriteView> {
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: MILESTONE_WRITE_SELECT,
  })
  if (!milestone) throw notFound()

  const links = await prisma.taskMilestone.findMany({
    where: { milestoneId },
    select: { task: { select: { id: true, createdAt: true } } },
  })
  const taskIds = links
    .map((link) => link.task)
    .sort((a, b) => {
      const at = a.createdAt.getTime()
      const bt = b.createdAt.getTime()
      if (at !== bt) return at < bt ? -1 : 1
      if (a.id === b.id) return 0
      return a.id < b.id ? -1 : 1
    })
    .map((task) => task.id)

  return { ...milestone, createdAt: milestone.createdAt.toISOString(), taskIds }
}

/* ===========================================================================
 * 里程碑写
 * =========================================================================== */

/**
 * 新建里程碑（`POST /projects/:projectId/milestones`）。
 *
 * 校验顺序固定（先便宜后昂贵）：日期 → 负责人成员资格 → 关联任务项目归属。
 */
export async function createMilestone(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  input: MilestoneCreateInput,
): Promise<MilestoneWriteView> {
  await assertCanWrite(prisma, actorUserId, projectId)

  if (!isCalendarDate(input.dueDate)) {
    throw validationError('里程碑截止日期不是合法的日期', 'dueDate', 'INVALID_VALUE')
  }
  const ownerUserId = await resolveOwnerUserId(prisma, projectId, input.ownerUserId)
  const taskIds = await resolveTaskIdsInProject(prisma, projectId, input.taskIds ?? [])

  // 里程碑与其关联行必须一起落地：不留「有里程碑、缺关联」的中间态。
  const created = await prisma.$transaction(async (tx) => {
    const milestone = await tx.milestone.create({
      data: { projectId, name: input.name, dueDate: input.dueDate, ownerUserId },
      select: { id: true },
    })
    if (taskIds.length > 0) {
      await tx.taskMilestone.createMany({
        data: taskIds.map((taskId) => ({ taskId, milestoneId: milestone.id })),
      })
    }
    return milestone
  })

  // 【事件占位】本批不接线（ROLE-D 的 #37 未交付）：将来在此发布
  //   `gantt.milestone.created`（payload：里程碑 id / 项目 id / 关联任务 id）。
  return toMilestoneWriteView(prisma, created.id)
}

/**
 * 修改里程碑（`PATCH /milestones/:milestoneId`）。
 *
 * `taskIds` **出现即整体替换**关联集（含 `[]` = 清空）；不出现则不动关联。
 */
export async function updateMilestone(
  prisma: PrismaClient,
  actorUserId: string,
  milestoneId: string,
  input: MilestonePatchInput,
): Promise<MilestoneWriteView> {
  // 先按 id 最小解析真实 `projectId`（只取一列，不读业务内容），再问 `can()`。
  const existing = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { projectId: true },
  })
  if (!existing) throw notFound()
  await assertCanWrite(prisma, actorUserId, existing.projectId)

  if (input.dueDate !== undefined && !isCalendarDate(input.dueDate)) {
    throw validationError('里程碑截止日期不是合法的日期', 'dueDate', 'INVALID_VALUE')
  }
  const ownerUserId =
    input.ownerUserId === undefined
      ? undefined
      : await resolveOwnerUserId(prisma, existing.projectId, input.ownerUserId)
  const taskIds =
    input.taskIds === undefined
      ? undefined
      : await resolveTaskIdsInProject(prisma, existing.projectId, input.taskIds)

  await prisma.$transaction(async (tx) => {
    try {
      await tx.milestone.update({
        where: { id: milestoneId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
          ...(ownerUserId === undefined ? {} : { ownerUserId }),
        },
        select: { id: true },
      })
    } catch (error) {
      // 并发删除竞态：解析/判权之后、写入之前该方法行被另一个请求删掉。
      // P2025 → 404（与「不存在」同一条文案，不泄漏是「刚被删」还是「从未存在」）。
      if (isPrismaErrorCode(error, 'P2025')) throw notFound()
      throw error
    }

    if (taskIds !== undefined) {
      // 整体替换：先清空再按去重后的顺序重建（同一事务，不出现中间态）。
      await tx.taskMilestone.deleteMany({ where: { milestoneId } })
      if (taskIds.length > 0) {
        await tx.taskMilestone.createMany({
          data: taskIds.map((taskId) => ({ taskId, milestoneId })),
        })
      }
    }
  })

  // 【事件占位】本批不接线：将来在此发布 `gantt.milestone.updated`（含变更字段集）。
  return toMilestoneWriteView(prisma, milestoneId)
}

/**
 * 删除里程碑（`DELETE /milestones/:milestoneId`）。
 *
 * 关联行由 schema `TaskMilestone.milestone onDelete: Cascade` 清理，本函数不手删。
 */
export async function deleteMilestone(
  prisma: PrismaClient,
  actorUserId: string,
  milestoneId: string,
): Promise<void> {
  const existing = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { projectId: true },
  })
  if (!existing) throw notFound()
  await assertCanWrite(prisma, actorUserId, existing.projectId)

  try {
    await prisma.milestone.delete({ where: { id: milestoneId } })
  } catch (error) {
    // 并发删除竞态：两个 DELETE 同时通过解析与判权，后到者拿到 P2025。
    // 映射为 404（同一条文案）；级联清理已由先到者的事务完成。
    if (isPrismaErrorCode(error, 'P2025')) throw notFound()
    throw error
  }
  // 【事件占位】本批不接线：将来在此发布 `gantt.milestone.deleted`。
}

/* ===========================================================================
 * FS 依赖写
 * =========================================================================== */

/**
 * 新建 FS 依赖（`POST /projects/:projectId/task-dependencies`）。
 *
 * 校验顺序固定（先便宜后昂贵，设计 §4.2）——字段码全部限决策 I-4 **冻结表**内取值，
 * 具体原因靠顶层 code + message 区分：
 *   1. 类型仅 `'FS'`（缺省视为 `'FS'`）→ 422 `INVALID_VALUE`（field `type`，message「仅支持 FS」）
 *   2. 拒自依赖 → 422 `INVALID_VALUE`（field `successorTaskId`，message「不能依赖自己」）
 *   3. 两端任务真实属于本项目 → 422 `CROSS_PROJECT_REF`（不存在 / 跨项目同一条）
 *   4. 重复边 → 409 `CONFLICT` + `DUPLICATE`（field `successorTaskId`，P2002 映射）
 *   5. FS 环 → 409 `CONFLICT` + `INVALID_VALUE`（field `successorTaskId`，message「形成 FS 环」）
 *
 * 4/5 与插入在**同一事务**内（见 `wouldCreateCycle` 的并发论证）。
 */
export async function createDependency(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  input: TaskDependencyCreateInput,
): Promise<TaskDependencyView> {
  await assertCanWrite(prisma, actorUserId, projectId)

  // 1. 仅 FS（字段码用表内 INVALID_VALUE，原因写进 message）
  const type = input.type ?? 'FS'
  if (type !== 'FS') {
    throw validationError('本阶段仅支持 FS 依赖，不接受 SS / FF / SF', 'type', 'INVALID_VALUE')
  }

  // 2. 自依赖
  if (input.predecessorTaskId === input.successorTaskId) {
    throw validationError('任务不能依赖自己', 'successorTaskId', 'INVALID_VALUE')
  }

  // 3. 两端任务的真实项目边界（不信请求体里的任何项目字段）
  await assertTaskInProject(prisma, projectId, input.predecessorTaskId, 'predecessorTaskId')
  await assertTaskInProject(prisma, projectId, input.successorTaskId, 'successorTaskId')

  const created = await prisma.$transaction(async (tx) => {
    // 5. 环检测先于插入：判环与插入同事务，避免「各自通过检测后同时写入」。
    if (await wouldCreateCycle(tx, projectId, input.predecessorTaskId, input.successorTaskId)) {
      throw conflictError('加入该依赖会形成 FS 环', 'successorTaskId', 'INVALID_VALUE')
    }

    try {
      return await tx.taskDependency.create({
        data: {
          projectId,
          predecessorTaskId: input.predecessorTaskId,
          successorTaskId: input.successorTaskId,
          type,
        },
        select: {
          id: true,
          projectId: true,
          predecessorTaskId: true,
          successorTaskId: true,
          type: true,
          createdAt: true,
        },
      })
    } catch (error) {
      // 4. 重复边由 `@@unique([predecessorTaskId, successorTaskId, type])` 兜底。
      //    环检测在前：重复边本身不构成环（A→B 不会让 B 到达 A），所以这里只会是重复。
      if (isPrismaErrorCode(error, 'P2002')) {
        throw conflictError('该依赖已存在', 'successorTaskId', 'DUPLICATE')
      }
      throw error
    }
  })

  // 【事件占位】本批不接线：将来在此发布 `gantt.dependency.created`
  //   （payload：边 id / 项目 id / 前后驱任务 id / 类型）。
  return {
    id: created.id,
    projectId: created.projectId,
    predecessorTaskId: created.predecessorTaskId,
    successorTaskId: created.successorTaskId,
    // 写路径只接受 FS，故库中值必为 'FS'（DB 不约束枚举，类型在此收窄）。
    type: created.type as TaskDependencyType,
    createdAt: created.createdAt.toISOString(),
  }
}

/**
 * 删除依赖边（`DELETE /task-dependencies/:dependencyId`）。
 *
 * 两端任务的 `onDelete: Restrict` 语义不因本批改变。
 */
export async function deleteDependency(
  prisma: PrismaClient,
  actorUserId: string,
  dependencyId: string,
): Promise<void> {
  const existing = await prisma.taskDependency.findUnique({
    where: { id: dependencyId },
    select: { projectId: true },
  })
  if (!existing) throw notFound()
  await assertCanWrite(prisma, actorUserId, existing.projectId)

  try {
    await prisma.taskDependency.delete({ where: { id: dependencyId } })
  } catch (error) {
    // 并发删除竞态：后到者拿到 P2025 → 404（与「不存在」同一条文案）。
    if (isPrismaErrorCode(error, 'P2025')) throw notFound()
    throw error
  }
  // 【事件占位】本批不接线：将来在此发布 `gantt.dependency.deleted`。
}
