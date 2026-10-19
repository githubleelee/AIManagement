/**
 * 唯一鉴权入口 `can()` 与列表可见性作用域 `visibilityScope()`（T2 权限实现）
 *
 * ===========================================================================
 * 冻结与归属声明
 * ===========================================================================
 *
 * 契约决策 I-9「共享文件冻结清单」规定：`can()` / `visibilityScope()` 签名的
 * 唯一修改人是**权限模块负责人（成员 2，负责 T2.1–T2.8 / M3）**。
 *
 * 但 T2.x 开工前，`T3.x`（US-03）、`T1.7`、`T5.8` 等任务全部**硬依赖**该入口
 * （基线 §4.10 明确列为硬依赖）。若空等，Sprint 会退化为串行瀑布。
 *
 * 本文件从 T0 最小骨架接管，下游模块继续通过同一入口进行权限判定。
 * 最初骨架的目的是让下游模块**从一开始就调用真入口**，
 * 而不是在自己代码里散落 `if (role === 'PM')`。
 *
 * **函数签名严格按契约决策 I-5 / I-6，不得改动**；成员 2 接管时只替换内部实现，
 * 下游调用方零改动。
 * ===========================================================================
 */
import type { PrismaClient } from '@prisma/client'
import type {
  Action,
  Decision,
  ObjectRef,
  ProjectRole,
  Scope,
  VisibilityObjectType,
} from '../../shared/types.js'

/** 写类动作：MEMBER / VIEWER 执行时返回 403（对象可见，但操作不允许）。 */
const WRITE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'project.manage_members',
  'project.close',
  'requirement.write',
  'task.write',
  'sensitivity.manage',
  // 甘特图写（里程碑 / 任务依赖，仅 FS）：仅 PM —— 落在第 5 条，MEMBER / VIEWER 403。
  'gantt.write',
  // UML 图写（用例图 / 时序图及其类型化关联）：与 `gantt.write` 同型，仅 PM ——
  // 落在第 5 条，MEMBER / VIEWER 403。
  'uml.write',
])

function deny(status: 403 | 404, code: 'FORBIDDEN' | 'NOT_FOUND'): Decision {
  return { allow: false, status, code }
}

/**
 * 本入口实际用到的 Prisma delegates 的**窄 `Pick`**（C 在 #24 的请求，2026-10-18）。
 *
 * 为什么不用 `PrismaClient`：`can()` / `visibilityScope()` 需要在**同一事务内**被复用
 * （#32 受控应用路径），而 `Prisma.TransactionClient` 不满足 `PrismaClient` 的完整形状。
 * 改成只要求用到的 delegates 后：
 *   - `PrismaClient`（根客户端）与 `Prisma.TransactionClient` **结构上都满足**；
 *   - `can()` / `visibilityScope()` 的**调用语义与返回不变**，既有调用方零改动；
 *   - 本入口仍然**只读数据库、不调其他模块 service**（契约 I-9）。
 *
 * 注意：`task/rules.ts` 的 `assertTaskAssignment` 签名放宽由 ROLE-C 在其登记窗口内自行
 * 完成（B 不改 `task/` 业务文件）。
 */
export type AuthzDb = Pick<
  PrismaClient,
  | 'project'
  | 'businessGoal'
  | 'userActivity'
  | 'userStory'
  | 'task'
  | 'risk'
  | 'projectMember'
  | 'objectVisibility'
>

/**
 * 按 `ObjectRef` **现查**目标对象，取得其真实的 `projectId` 与敏感状态。
 *
 * 契约决策 I-5 约束 1：`can()` 必须自己按 id 加载目标对象，调用方无法通过传入
 * `isSensitive` / `visibleMemberIds` 等字段影响判定结果。这里必须保留该性质。
 */
async function loadTarget(
  prisma: AuthzDb,
  ref: ObjectRef,
): Promise<{ projectId: string; isSensitive: boolean } | null> {
  switch (ref.kind) {
    case 'project': {
      const p = await prisma.project.findUnique({
        where: { id: ref.projectId },
        select: { id: true },
      })
      return p ? { projectId: p.id, isSensitive: false } : null
    }
    case 'goal': {
      const g = await prisma.businessGoal.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true },
      })
      // 业务目标不参与敏感白名单（Sprint 1 只有 story / task 可标敏感）
      return g ? { projectId: g.projectId, isSensitive: false } : null
    }
    case 'activity': {
      const a = await prisma.userActivity.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true },
      })
      return a ? { projectId: a.projectId, isSensitive: false } : null
    }
    case 'story': {
      const s = await prisma.userStory.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true, isSensitive: true },
      })
      return s ? { projectId: s.projectId, isSensitive: s.isSensitive } : null
    }
    case 'task': {
      const t = await prisma.task.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true, isSensitive: true },
      })
      return t ? { projectId: t.projectId, isSensitive: t.isSensitive } : null
    }
    case 'risk': {
      // #30 风险台账：按 riskId 现查**真实** projectId（不信任调用方传入的 projectId）。
      // 敏感：风险继承所关联任务的可见性（业务口径见 `permissions.risk-status-flow`）；
      // 这里只把真实值带出来供后续判定参考，**不**把 `risk` 加入第 4 条的
      // ObjectVisibility 对象类型（第 4 条仅覆盖 story / task，不扩展）。
      const r = await prisma.risk.findUnique({
        where: { id: ref.riskId },
        select: { projectId: true, task: { select: { isSensitive: true } } },
      })
      return r ? { projectId: r.projectId, isSensitive: r.task?.isSensitive ?? false } : null
    }
    default:
      return null
  }
}

/** 读取调用者在该项目中的角色；非成员返回 null。 */
async function roleIn(
  prisma: AuthzDb,
  actorUserId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: actorUserId } },
    select: { role: true },
  })
  return m ? (m.role as ProjectRole) : null
}

/**
 * 唯一鉴权入口。
 *
 * 判定顺序（短路，命中即返回）—— 契约决策 I-5 约束 3：
 *   1. 目标对象不存在                       → 404（不泄漏对象是否存在）
 *   2. actor 不是该项目的成员                → 404（一切动作；不泄漏项目是否存在）
 *   3. actor.role === PM                    → 允许（含敏感对象）
 *   4. 目标敏感且 actor 不在白名单 → 404（含 read）
 *   4.5 条件性动作 `task.progress` / `task.accept`：VIEWER → 403；按对象关系（负责人 / 验收人）放行，否则 403
 *   4.6 条件性动作 `risk.flow`：VIEWER → 403；`ownerUserId` = 调用者放行，否则 403
 *   5. 写类动作且 actor.role ∈ {MEMBER, VIEWER} → 403（对象可见，403 不泄漏任何东西）
 *   5.5 `risk.write` 且 actor.role === VIEWER → 403（风险台账对项目成员开放，VIEWER 只读）
 *   5.6 `gantt.write`（里程碑 / 任务依赖增删改）与其它写类动作同规则：仅 PM（第 3 条放行）；
 *       MEMBER / VIEWER 一律 403，本入口不为甘特单开角色分支
 *   5.7 `uml.write`（UML 图及其关联的增删改）与其它写类动作同规则：仅 PM（第 3 条放行）；
 *       MEMBER / VIEWER 一律 403，本入口不为 UML 单开角色分支
 *   6. 其余                                 → 允许
 *
 * 契约决策 I-9：本函数**只读数据库，不调用其他模块的 service**。
 */
export function createAuthorization(prisma: AuthzDb) {
  async function can(actorUserId: string, action: Action, ref: ObjectRef): Promise<Decision> {
    // 第 1 条：目标对象不存在 → 404
    const target = await loadTarget(prisma, ref)
    if (!target) return deny(404, 'NOT_FOUND')

    // 第 2 条：非项目成员 → 404（一切动作）
    const role = await roleIn(prisma, actorUserId, target.projectId)
    if (role === null) return deny(404, 'NOT_FOUND')

    // 第 3 条：PM 允许一切（含敏感对象）
    if (role === 'PM') return { allow: true }

    // 第 4 条：仅 story/task 支持对象级敏感；直接按真实目标 id 查白名单。
    if (target.isSensitive && (ref.kind === 'story' || ref.kind === 'task')) {
      const entry = await prisma.objectVisibility.findUnique({
        where: { objectType_objectId_userId: {
          objectType: ref.kind, objectId: ref.objectId, userId: actorUserId,
        } },
        select: { projectId: true },
      })
      if (!entry || entry.projectId !== target.projectId) return deny(404, 'NOT_FOUND')
    }

    // 第 4.5 条（US-08）：两个「条件性动作」——负责人可推进自己的任务，验收人可验收。
    // 它们不是「写类动作一律 403」，而是按**对象关系**判定，因此必须在第 5 条之前处理。
    // 单独查这两个字段，避免改动 loadTarget 的既有契约（其它动作完全不受影响）。
    if (ref.kind === 'task' && (action === 'task.progress' || action === 'task.accept')) {
      // ★ VIEWER 本轮为全项目只读（契约 I-5 第 3 条）。即使 PM 把某个 VIEWER 指为
      //   任务负责人或验收人，也不得因此让它获得写能力。
      if (role === 'VIEWER') return deny(403, 'FORBIDDEN')
      const relation = await prisma.task.findUnique({
        where: { id: ref.objectId },
        select: { ownerUserId: true, acceptorUserId: true },
      })
      if (!relation) return deny(404, 'NOT_FOUND')
      if (action === 'task.progress' && relation.ownerUserId === actorUserId) return { allow: true }
      if (action === 'task.accept' && relation.acceptorUserId === actorUserId) return { allow: true }
      return deny(403, 'FORBIDDEN')
    }

    // 第 4.6 条（#30 风险状态流转，2026-10-18 项目负责人确认 `permissions.risk-flow-guard`）：
    //   与第 4.5 条同型的**对象关系判定** —— 成员只能流转 `ownerUserId` = 本人的风险。
    //   PM 已在第 3 条放行；VIEWER 全项目只读，显式 403；其他人一律 403。
    //   业务层不得再私写角色判断（公共层就绪前 A 侧 fail-closed 403，就此放开）。
    if (ref.kind === 'risk' && action === 'risk.flow') {
      if (role === 'VIEWER') return deny(403, 'FORBIDDEN')
      const relation = await prisma.risk.findUnique({
        where: { id: ref.riskId },
        select: { ownerUserId: true },
      })
      if (!relation) return deny(404, 'NOT_FOUND')
      if (relation.ownerUserId === actorUserId) return { allow: true }
      return deny(403, 'FORBIDDEN')
    }

    // 第 5 条：写类动作对 MEMBER / VIEWER → 403
    if (WRITE_ACTIONS.has(action)) return deny(403, 'FORBIDDEN')

    // 第 5.5 条（#30 风险台账，2026-10-18 项目负责人确认）：风险写操作对项目成员开放，
    //   `MEMBER` 落到第 6 条放行；`VIEWER` 全项目只读，这里显式 403（不泄漏对象内容）。
    //   敏感继承按 #30 的方案由风险模块自行处理，本入口不扩展 ObjectVisibility 的对象类型。
    if (action === 'risk.write' && role === 'VIEWER') return deny(403, 'FORBIDDEN')

    // 第 6 条：其余允许
    return { allow: true }
  }

  /**
   * 列表可见性作用域。
   *
   * 契约决策 I-6 要求：列表查询**必须在查询层过滤**（追加 `id IN (:ids)`），
   * 禁止「取出全量再在内存中过滤」——后者会在统计计数上泄漏敏感对象的存在性
   * （违反 AC-US-02-06「不泄漏存在性」）。
   *
   * 使用约定：
   *   mode === 'all'    → 查询不加可见性条件
   *   mode === 'subset' → 查询追加 id IN (:ids)；ids 为空则列表返回空集合
   *
   * 非 PM 只得到「非敏感对象 + 自己被指定的敏感对象」的 id。
   */
  async function visibilityScope(
    actorUserId: string,
    projectId: string,
    objectType: VisibilityObjectType,
  ): Promise<Scope> {
    const role = await roleIn(prisma, actorUserId, projectId)

    // 非成员：不可见任何对象（返回空集合，而非抛错——调用方已由 can() 拦过一道）
    if (role === null) return { mode: 'subset', ids: [] }

    // PM 无需过滤
    if (role === 'PM') return { mode: 'all' }

    const whitelisted = await prisma.objectVisibility.findMany({
      where: { projectId, objectType, userId: actorUserId },
      select: { objectId: true },
    })
    const ids = whitelisted.map(row => row.objectId)
    const rows = objectType === 'story'
      ? await prisma.userStory.findMany({
        where: { projectId, OR: [{ isSensitive: false }, { id: { in: ids } }] },
        select: { id: true },
      })
      : await prisma.task.findMany({
        where: { projectId, OR: [{ isSensitive: false }, { id: { in: ids } }] },
        select: { id: true },
      })
    return { mode: 'subset', ids: rows.map(row => row.id) }
  }

  return { can, visibilityScope }
}

export type Authorization = ReturnType<typeof createAuthorization>
