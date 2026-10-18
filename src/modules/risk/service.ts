/**
 * US-10 风险台账与项目关闭（工单 #30）—— 业务服务。
 *
 * ===========================================================================
 * 授权口径（项目负责人 2026-10-18 批复，已冻结）
 * ===========================================================================
 *
 * - 风险的增删改与**四态流转**统一走 `can('risk.write', { kind: 'project' })`
 *   —— 公共层保证 `risk.write` = PM + MEMBER（VIEWER 403）。
 *   **业务层不再额外判角色**：任何"只让 PM 流转"的规则都得私写角色判定，违背统一入口；
 *   而"只让负责人流转"会把 PM 削弱。四态因此**不强制单向**（允许重开）。
 * - 项目关闭 / 重开走 `can('project.close')`（公共层保证仅 PM）。
 * - 敏感风险**继承所关联任务的可见性**（见 `riskVisibilityWhere`）；
 *   对具体风险的读/写再加一道对象级可见性守卫，不可见时与"不存在"同样返回 **404**。
 *
 * ===========================================================================
 * 审计
 * ===========================================================================
 *
 * 风险创建 / 修改 / 状态变化、项目关闭 / 重开，各写一条 `AuditLog`，
 * `before` / `after` 为可解析的 JSON 字符串（与敏感设置端点同一做法）。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import { createAuthorization } from '../authz/permissions.js'
import {
  RISK_INCLUDE,
  checkClosure,
  denied,
  notFound,
  riskVisibilityWhere,
  toRiskView,
  type RiskRow,
} from './closure.js'
import type { RiskLevel, RiskStatus, RiskView } from './types.js'

export const RISK_TITLE_MAX_LENGTH = 200
export const RISK_RESOLUTION_MAX_LENGTH = 200

/** 会要求填写解决说明的状态。 */
const RESOLVED_STATUSES: readonly RiskStatus[] = ['RESOLVED', 'CLOSED']

export type RiskInput = {
  title: string
  description?: string | null
  level: RiskLevel
  ownerUserId: string
  taskId?: string | null
  /** 创建时允许直接给状态（默认 OPEN）；给 RESOLVED / CLOSED 需同时给 resolution */
  status?: RiskStatus
  resolution?: string | null
}

export type RiskPatch = Partial<RiskInput>

function validationError(message: string, field: string, code: string): AppError {
  return new AppError(422, 'VALIDATION_FAILED', message, [
    { field, code: code as never },
  ])
}

/** 冲突（状态不允许）：409 CONFLICT（错误码表已有的取值，未新增）。 */
function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message)
}

/**
 * 对象级可见性守卫：这个风险对当前调用者是否可见（继承关联任务的敏感可见性）。
 *
 * 不可见 ⇒ 与"风险不存在"同样的 404，**不泄漏存在性**。
 * 注意这**不是**角色判定：判据是"关联任务是否在我的可见作用域内"，与权限入口同源。
 */
async function assertRiskVisible(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  risk: { taskId: string | null },
): Promise<void> {
  if (risk.taskId === null) return // 不关联任务的公开风险：项目成员可见
  const { visibilityScope } = createAuthorization(prisma)
  const scope = await visibilityScope(actorUserId, projectId, 'task')
  if (scope.mode === 'all') return
  if (!scope.ids.includes(risk.taskId)) throw notFound()
}

/** 负责人必须是本项目成员（`ownerUserId: NOT_PROJECT_MEMBER`）。 */
async function assertOwnerIsMember(
  prisma: PrismaClient,
  projectId: string,
  ownerUserId: string,
): Promise<void> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: ownerUserId } },
    select: { userId: true },
  })
  if (!membership) {
    throw validationError('风险负责人必须是本项目成员', 'ownerUserId', 'NOT_PROJECT_MEMBER')
  }
}

/**
 * 关联任务必须属于本项目（`taskId: CROSS_PROJECT_REF`），**且调用者要能看到它**。
 *
 * 独立审查 S5：只校验「属于本项目」会形成一个弱存在性预言机 —— 非白名单成员拿一个
 * 猜到的敏感任务 id 建风险会得 201，而拿不存在的 id 得 422，两者差异等于确认了
 * "该 id 存在于本项目"。这里对"看不见"与"不存在"返回**同一条错误**，不区分。
 */
async function assertTaskInProject(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  taskId: string,
): Promise<void> {
  const notYours = validationError('关联任务不属于本项目', 'taskId', 'CROSS_PROJECT_REF')

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  })
  if (!task || task.projectId !== projectId) throw notYours

  const { visibilityScope } = createAuthorization(prisma)
  const scope = await visibilityScope(actorUserId, projectId, 'task')
  if (scope.mode === 'subset' && !scope.ids.includes(taskId)) throw notYours
}

/** 进入已解决 / 已关闭必须有解决说明。 */
function assertResolution(status: RiskStatus, resolution: string | null | undefined): void {
  if (RESOLVED_STATUSES.includes(status) && (resolution ?? '').trim() === '') {
    throw validationError('状态改为「已解决」或「已关闭」时必须填写解决说明', 'resolution', 'REQUIRED')
  }
}

/** 统一写一条审计（与敏感端点同构：before / after 为 JSON 字符串）。 */
function auditData(
  projectId: string,
  actorUserId: string,
  action: string,
  objectType: string,
  objectId: string,
  before: unknown,
  after: unknown,
) {
  return {
    projectId,
    actorUserId,
    action,
    objectType,
    objectId,
    before: before === null ? null : JSON.stringify(before),
    after: after === null ? null : JSON.stringify(after),
  }
}

/* ===========================================================================
 * 读
 * =========================================================================== */

export type RiskListFilter = { status?: RiskStatus; level?: RiskLevel; ownerUserId?: string }

/**
 * 项目风险清单。
 *
 * 权限：`can('project.read')`；可见性走 `riskVisibilityWhere(scope)`（**查询层**过滤，
 * 决策 I-6），计数与清单同源。按「未处理的排前、高危优先、越早发现越前」排序。
 */
export async function listRisks(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  filter: RiskListFilter = {},
): Promise<RiskView[]> {
  const { can, visibilityScope } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const scope = await visibilityScope(actorUserId, projectId, 'task')
  const rows = await prisma.risk.findMany({
    where: {
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.level ? { level: filter.level } : {}),
      ...(filter.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
      ...riskVisibilityWhere(scope),
    },
    orderBy: [{ status: 'asc' }, { level: 'asc' }, { createdAt: 'asc' }],
    include: RISK_INCLUDE,
  })
  return rows.map((row) => toRiskView(row as RiskRow))
}

/** 单条风险（供界面编辑前取值）。不可见 → 404。 */
export async function getRisk(
  prisma: PrismaClient,
  actorUserId: string,
  riskId: string,
): Promise<RiskView> {
  const { can } = createAuthorization(prisma)
  const risk = await prisma.risk.findUnique({ where: { id: riskId }, include: RISK_INCLUDE })
  if (!risk) throw notFound()

  const decision = await can(actorUserId, 'project.read', {
    kind: 'project',
    projectId: risk.projectId,
  })
  if (!decision.allow) throw denied(decision)
  await assertRiskVisible(prisma, actorUserId, risk.projectId, risk)

  return toRiskView(risk as RiskRow)
}

/* ===========================================================================
 * 写
 * =========================================================================== */

/** 新建风险（`risk.write`：PM + MEMBER；VIEWER 403）。 */
export async function createRisk(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  input: RiskInput,
): Promise<RiskView> {
  const { can } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'risk.write', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  await assertOwnerIsMember(prisma, projectId, input.ownerUserId)
  if (input.taskId) await assertTaskInProject(prisma, actorUserId, projectId, input.taskId)
  const status = input.status ?? 'OPEN'
  assertResolution(status, input.resolution)

  const created = await prisma.$transaction(async (tx) => {
    const risk = await tx.risk.create({
      data: {
        projectId,
        title: input.title,
        description: input.description ?? null,
        level: input.level,
        status,
        ownerUserId: input.ownerUserId,
        taskId: input.taskId ?? null,
        resolution: input.resolution ?? null,
      },
      include: RISK_INCLUDE,
    })
    await tx.auditLog.create({
      data: auditData(projectId, actorUserId, 'risk.create', 'risk', risk.id, null, {
        title: risk.title,
        level: risk.level,
        status: risk.status,
        ownerUserId: risk.ownerUserId,
        taskId: risk.taskId,
      }),
    })
    return risk
  })

  return toRiskView(created as RiskRow)
}

/**
 * 修改风险（含**状态流转**，同一动作 `risk.write`）。
 *
 * 四态**不强制单向**：允许 OPEN ⇄ IN_PROGRESS、已解决/已关闭回退（批复把细节交给本票定义，
 * 且不在业务层私写角色判定）。状态确实变化时额外写一条 `risk.status` 审计。
 */
export async function patchRisk(
  prisma: PrismaClient,
  actorUserId: string,
  riskId: string,
  patch: RiskPatch,
): Promise<RiskView> {
  const { can } = createAuthorization(prisma)

  const existing = await prisma.risk.findUnique({ where: { id: riskId }, include: RISK_INCLUDE })
  if (!existing) throw notFound()

  const decision = await can(actorUserId, 'risk.write', {
    kind: 'project',
    projectId: existing.projectId,
  })
  if (!decision.allow) throw denied(decision)
  await assertRiskVisible(prisma, actorUserId, existing.projectId, existing)

  const nextLevel = patch.level ?? (existing.level as RiskLevel)
  const nextStatus = patch.status ?? (existing.status as RiskStatus)
  const nextResolution = patch.resolution !== undefined ? patch.resolution : existing.resolution
  const nextOwner = patch.ownerUserId ?? existing.ownerUserId
  const nextTaskId = patch.taskId !== undefined ? patch.taskId : existing.taskId

  if (patch.ownerUserId !== undefined) {
    await assertOwnerIsMember(prisma, existing.projectId, patch.ownerUserId)
  }
  if (patch.taskId) await assertTaskInProject(prisma, actorUserId, existing.projectId, patch.taskId)
  assertResolution(nextStatus, nextResolution)

  const statusChanged = nextStatus !== existing.status

  // ---------------------------------------------------------------------------
  // 状态流转判定：公共层 `risk.flow` 的对象关系判定（2026-10-18 已落地）
  // ---------------------------------------------------------------------------
  // 权限注释第 4.6 条（与第 4.5 条 `task.progress` 同型）：PM 全部；MEMBER 仅
  //   `ownerUserId` = 本人的风险；VIEWER / 他人风险 403；风险不存在 404。
  //   ⇒ 业务层只调 `can()`，不私写任何角色判断（批复硬要求）。
  //
  // 变更史（留痕）：公共层就绪前，本票按批复 §1 用 `can('project.close')` 探针做过临时
  //   fail-closed（成员一律 403）。`risk.flow` 落地后**该探针已删除**，恢复批复最终口径：
  //   成员可流转自己负责的风险，不能流转他人的。
  if (statusChanged) {
    const flow = await can(actorUserId, 'risk.flow', {
      kind: 'risk',
      projectId: existing.projectId,
      riskId,
    })
    // 提示文案刻意写清"为什么"和"什么时候会开放"：
    // 这是临时闸门，不能让成员只看到一句"没有权限"而不知所以。
    if (!flow.allow) throw denied(flow)
  }

  const updated = await prisma.$transaction(async (tx) => {
    const risk = await tx.risk.update({
      where: { id: riskId },
      data: {
        title: patch.title ?? existing.title,
        description: patch.description !== undefined ? patch.description : existing.description,
        level: nextLevel,
        status: nextStatus,
        ownerUserId: nextOwner,
        taskId: nextTaskId,
        // 状态回退到「未处理 / 处理中」时清空解决说明 ——
        // 否则界面会把上一条旧说明渲染成「解决说明：…」，看起来像已经解决了（审查 S7）。
        resolution: RESOLVED_STATUSES.includes(nextStatus) ? (nextResolution ?? null) : null,
      },
      include: RISK_INCLUDE,
    })
    await tx.auditLog.create({
      data: auditData(
        existing.projectId,
        actorUserId,
        statusChanged ? 'risk.status' : 'risk.update',
        'risk',
        risk.id,
        { title: existing.title, level: existing.level, status: existing.status },
        { title: risk.title, level: risk.level, status: risk.status, resolution: risk.resolution },
      ),
    })
    return risk
  })

  return toRiskView(updated as RiskRow)
}

/* ===========================================================================
 * 项目关闭 / 重开（AC4 / AC5）
 * =========================================================================== */

export type ProjectLifecycleView = {
  project: { id: string; name: string; status: 'ACTIVE' | 'CLOSED' }
  /** 关闭时若被阻断，这里给出可读的计数摘要（完整清单走 closure-check） */
  blockedBy?: { tasks: number; risks: number }
}

/**
 * 关闭项目。
 *
 * 权限：`can('project.close')` —— 仅 PM（MEMBER / VIEWER 403，非成员 404）。
 * 阻断：调用与预览**同一套** `checkClosure`（不另写一份判定），
 * 非 `clear` 一律 **409 CONFLICT**。
 *
 * ⚠️ 阻断清单**不在 409 的响应体里**：契约 I-3 的错误信封只承载 `{field, code}` 明细，
 * 塞不下任务/风险对象。界面应先调 `GET .../closure-check` 拿清单再展示。
 * 这一取舍已登记在 `docs/us-10-progress-risk-api.md`。
 */
export async function closeProject(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  options: { today?: string } = {},
): Promise<ProjectLifecycleView> {
  const { can } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.close', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true },
  })
  if (!project) throw notFound()
  if (project.status === 'CLOSED') throw conflict('项目已处于关闭状态')

  const check = await checkClosure(prisma, actorUserId, projectId, options)
  if (check.verdict.state !== 'clear') {
    const tasks = check.blockingTasks.total ?? 0
    const risks = check.blockingRisks.total ?? 0
    throw conflict(
      `项目不能关闭：存在 ${tasks} 个未关闭任务、${risks} 个未处理/处理中风险（清单见 GET /projects/${projectId}/closure-check）`,
    )
  }

  // ★ 比较并交换（CAS）：只在项目**仍是 ACTIVE** 时才改并写审计。
  //   原实现是"读状态→校验→无条件 update"，并发（含前端双击）会两次都成功、
  //   各写一条 project.close 审计 —— 审计失真，独立审查 B1 已实测复现（200/200、审计 2 条）。
  //   同一写法见 src/modules/acceptance/service.ts 的 CAS。
  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.updateMany({
      where: { id: projectId, status: 'ACTIVE' },
      data: { status: 'CLOSED' },
    })
    if (updated.count === 0) return false
    await tx.auditLog.create({
      data: auditData(
        projectId,
        actorUserId,
        'project.close',
        'project',
        projectId,
        { status: 'ACTIVE' },
        { status: 'CLOSED' },
      ),
    })
    return true
  })
  if (!changed) throw conflict('项目已处于关闭状态')

  return { project: { id: project.id, name: project.name, status: 'CLOSED' } }
}

/**
 * 重开项目。
 *
 * 权限：同样用 `project.close`（批复：「重开同样仅 PM」）。
 * 前置：项目必须处于 `CLOSED`。
 */
export async function reopenProject(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
): Promise<ProjectLifecycleView> {
  const { can } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.close', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true },
  })
  if (!project) throw notFound()
  if (project.status !== 'CLOSED') throw conflict('项目未处于关闭状态，无法重开')

  // ★ 与关闭同构的 CAS：只在项目**仍是 CLOSED** 时才改并写审计（审查 B1 同源问题）
  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.updateMany({
      where: { id: projectId, status: 'CLOSED' },
      data: { status: 'ACTIVE' },
    })
    if (updated.count === 0) return false
    await tx.auditLog.create({
      data: auditData(
        projectId,
        actorUserId,
        'project.reopen',
        'project',
        projectId,
        { status: 'CLOSED' },
        { status: 'ACTIVE' },
      ),
    })
    return true
  })
  if (!changed) throw conflict('项目未处于关闭状态，无法重开')

  return { project: { id: project.id, name: project.name, status: 'ACTIVE' } }
}

/** 供路由层复用的 Prisma 类型别名（避免各文件重复 import） */
export type RiskDelegate = Prisma.RiskDelegate
export { RISK_TITLE_MAX_LENGTH as TITLE_MAX }
