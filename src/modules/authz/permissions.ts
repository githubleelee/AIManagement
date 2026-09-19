/**
 * 唯一鉴权入口 `can()` 与列表可见性作用域 `visibilityScope()`（T0-04 最小骨架）
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
 * 因此本文件是**最小可执行骨架**，目的是让下游模块**从一开始就调用真入口**，
 * 而不是在自己代码里散落 `if (role === 'PM')` —— 后者违反决策 I-5，且 M3 到位后
 * 必然返工。骨架只实现判定顺序中最必要的两条，其余留 `TODO` 由成员 2 补齐。
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
  'requirement.write',
  'task.write',
  'sensitivity.manage',
])

function deny(status: 403 | 404, code: 'FORBIDDEN' | 'NOT_FOUND'): Decision {
  return { allow: false, status, code }
}

/**
 * 按 `ObjectRef` **现查**目标对象，取得其真实的 `projectId` 与敏感状态。
 *
 * 契约决策 I-5 约束 1：`can()` 必须自己按 id 加载目标对象，调用方无法通过传入
 * `isSensitive` / `visibleMemberIds` 等字段影响判定结果。这里必须保留该性质。
 */
async function loadTarget(
  prisma: PrismaClient,
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
    default:
      return null
  }
}

/** 读取调用者在该项目中的角色；非成员返回 null。 */
async function roleIn(
  prisma: PrismaClient,
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
 *   4. 【TODO(T2.3/T2.4)】目标敏感且 actor 不在白名单 → 404（含 read）
 *   5. 写类动作且 actor.role ∈ {MEMBER, VIEWER} → 403（对象可见，403 不泄漏任何东西）
 *   6. 其余                                 → 允许
 *
 * 关于第 4 条的本轮取舍：契约决策 I-5 的完整语义是「PM 与白名单成员可见」。
 * 骨架尚未实现白名单查询，故对敏感对象采取**保守拒绝**（宁可多拒，不可误放）。
 * 这使得敏感对象在 M3 完成前对非 PM 完全不可见——安全侧失败，不会造成越权泄漏。
 * 由 T2.3 / T2.4 放开为「白名单成员可见」。
 *
 * 契约决策 I-9：本函数**只读数据库，不调用其他模块的 service**。
 */
export function createAuthorization(prisma: PrismaClient) {
  async function can(actorUserId: string, action: Action, ref: ObjectRef): Promise<Decision> {
    // 第 1 条：目标对象不存在 → 404
    const target = await loadTarget(prisma, ref)
    if (!target) return deny(404, 'NOT_FOUND')

    // 第 2 条：非项目成员 → 404（一切动作）
    const role = await roleIn(prisma, actorUserId, target.projectId)
    if (role === null) return deny(404, 'NOT_FOUND')

    // 第 3 条：PM 允许一切（含敏感对象）
    if (role === 'PM') return { allow: true }

    // 第 4 条：敏感可见性 —— TODO(T2.3/T2.4/T2.6)
    //
    // 待实现：若 target.isSensitive 且 actorUserId ∉ ObjectVisibility
    //         （objectType + objectId 对应白名单）→ deny(404, 'NOT_FOUND')，含 read。
    // 注意实现时必须使用此处**现查**得到的 isSensitive，绝不能接受调用方传入。
    if (target.isSensitive) {
      return deny(404, 'NOT_FOUND')
    }

    // 第 5 条：写类动作对 MEMBER / VIEWER → 403
    if (WRITE_ACTIONS.has(action)) return deny(403, 'FORBIDDEN')

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
   * 本轮骨架：非 PM 一律返回 `{ mode: 'all' }`，**敏感过滤尚未生效**——这是
   * **已知的未完成项**，由 T2.5 实现、T3.10 / T5.8 接入。
   *
   * 为什么不先返回空集合：那会让 MEMBER 连非敏感对象都看不到，使 US-01 / US-03
   * 的开发期联调完全无法进行。当前防护来自 `can()` 对敏感对象的保守拒绝——
   * 「按 id 直取敏感对象」这条路径已安全，仅「列表 / 计数」路径待补齐。
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

    // TODO(T2.5)：实现真正的敏感过滤 ——
    //   1. 查出该项目中 objectType 类型被标记敏感的全部对象 id
    //   2. 减去调用者被授权的白名单对象 id
    //   3. 返回**可见集合**（决策 I-6 的约定是返回可见 ids，而非不可见 ids）
    void objectType
    return { mode: 'all' }
  }

  return { can, visibilityScope }
}

export type Authorization = ReturnType<typeof createAuthorization>
