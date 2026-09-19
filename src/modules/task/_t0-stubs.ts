/**
 * 【临时桩】T0-04/T0-05 落地后由 src/auth 与 src/modules/authz 的真实实现替换；
 * 契约签名见决策 I-5 / I-6。本文件不得进入 main，rebase 时删除。
 *
 * 为什么需要它：T5-01 的交付范围依赖「Actor 注入」「can()」「visibilityScope()」，
 * 而 T0-04（src/auth）与 T0-05（src/modules/authz）尚未合入。本文件是任务模块
 * **唯一**允许引用鉴权能力的入口，便于真实实现落地后 one-file swap。
 *
 * 只放三件事（严格对齐契约）：
 *   1. Actor 注入：`request.actorUserId` 的钩子与读取函数；
 *   2. 决策 I-5：`Action` / `ObjectRef` / `Decision` / `can()`
 *   3. 决策 I-6：`Scope` / `visibilityScope()`
 *
 * 实现是最小可用版本：按 ProjectMember 表读角色；PM → allow；非成员 → 404
 * NOT_FOUND；写类动作 MEMBER/VIEWER → 403 FORBIDDEN；敏感对象按 ObjectVisibility
 * 表判断。真实实现合入后，本文件整体删除，`routes.ts` 与 `_test-harness.ts`
 * 的 import 指向 src/auth 与 src/modules/authz 即可。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '../../shared/errors.js'
import type { VisibilityObjectType } from '../../shared/types.js'
import { prisma } from '../../db/client.js'

// ---------------------------------------------------------------------------
// 决策 I-5：唯一鉴权入口 can()
// ---------------------------------------------------------------------------

/** 权限动作（逐字对齐契约决策 I-5） */
export type Action =
  | 'project.read' // 读取项目及其下需求与任务
  | 'project.manage_members' // 增删成员、改角色
  | 'requirement.write' // 业务目标 / 用户活动 / 用户故事的增删改
  | 'task.write' // 任务的增删改
  | 'sensitivity.manage' // 设置敏感标记与可见成员

/** 目标对象引用：调用方只传 id，不传任何权限相关字段（逐字对齐契约决策 I-5） */
export type ObjectRef =
  | { kind: 'project'; projectId: string }
  | { kind: 'goal'; projectId: string; objectId: string }
  | { kind: 'activity'; projectId: string; objectId: string }
  | { kind: 'story'; projectId: string; objectId: string }
  | { kind: 'task'; projectId: string; objectId: string }

/** 鉴权结果：can() 直接返回应使用的 HTTP 状态码与顶层错误码 */
export type Decision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

/** 写类动作：MEMBER / VIEWER 一律拒绝（403） */
const WRITE_ACTIONS: readonly Action[] = [
  'project.manage_members',
  'requirement.write',
  'task.write',
  'sensitivity.manage',
]

/** 按 ref 加载目标对象，返回其 projectId 与敏感标记；不存在返回 null。 */
async function loadTarget(
  ref: ObjectRef,
): Promise<{ projectId: string; isSensitive: boolean } | null> {
  switch (ref.kind) {
    case 'project':
      // 项目本身没有敏感标记，成员校验即可
      return { projectId: ref.projectId, isSensitive: false }
    case 'goal': {
      const row = await prisma.businessGoal.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true },
      })
      return row ? { projectId: row.projectId, isSensitive: false } : null
    }
    case 'activity': {
      const row = await prisma.userActivity.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true },
      })
      return row ? { projectId: row.projectId, isSensitive: false } : null
    }
    case 'story': {
      return prisma.userStory.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true, isSensitive: true },
      })
    }
    case 'task': {
      return prisma.task.findUnique({
        where: { id: ref.objectId },
        select: { projectId: true, isSensitive: true },
      })
    }
  }
}

/**
 * 唯一鉴权入口（契约决策 I-5 的四条接口约束）。
 *
 * 判定顺序短路（与契约一致）：
 *   非项目成员 → 404；PM → 允许；目标敏感且不在可见名单 → 404；
 *   写类动作且 MEMBER/VIEWER → 403；否则允许。
 */
export async function can(
  actorUserId: string,
  action: Action,
  ref: ObjectRef,
): Promise<Decision> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: ref.projectId, userId: actorUserId } },
  })
  if (!membership) {
    return { allow: false, status: 404, code: 'NOT_FOUND' }
  }

  if (membership.role === 'PM') {
    return { allow: true }
  }

  const target = await loadTarget(ref)
  if (!target || target.projectId !== ref.projectId) {
    return { allow: false, status: 404, code: 'NOT_FOUND' }
  }

  if ((ref.kind === 'story' || ref.kind === 'task') && target.isSensitive) {
    const visible = await prisma.objectVisibility.findUnique({
      where: {
        objectType_objectId_userId: {
          objectType: ref.kind,
          objectId: ref.objectId,
          userId: actorUserId,
        },
      },
    })
    if (!visible) {
      return { allow: false, status: 404, code: 'NOT_FOUND' }
    }
  }

  if (WRITE_ACTIONS.includes(action)) {
    return { allow: false, status: 403, code: 'FORBIDDEN' }
  }

  return { allow: true }
}

// ---------------------------------------------------------------------------
// 决策 I-6：列表可见性作用域 visibilityScope()
// ---------------------------------------------------------------------------

/** 可见性作用域（逐字对齐契约决策 I-6） */
export type Scope =
  | { mode: 'all' } // 调用者为 PM，无需过滤
  | { mode: 'subset'; ids: string[] } // 仅这些对象 id 可见

/**
 * 列表可见性作用域。
 *
 * 最小实现：PM → all；MEMBER / VIEWER → subset =（非敏感对象 ∪ 白名单内的敏感对象）。
 *
 * ★ 查询层过滤（决策 I-6）：本函数内部也**不得**「取出全量再在内存里 filter」——
 * 非敏感对象与白名单命中的敏感对象分别用 WHERE 条件在数据库里筛出，且只 select id。
 * 真实 T0-05 落地后替换为等价实现。
 */
export async function visibilityScope(
  actorUserId: string,
  projectId: string,
  objectType: VisibilityObjectType,
): Promise<Scope> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: actorUserId } },
  })
  if (!membership) {
    return { mode: 'subset', ids: [] }
  }
  if (membership.role === 'PM') {
    return { mode: 'all' }
  }

  // 白名单：该调用者在本项目该对象类型下被显式授权的 objectId（仅取 id）。
  const whitelist = await prisma.objectVisibility.findMany({
    where: { projectId, objectType, userId: actorUserId },
    select: { objectId: true },
  })
  const whitelistIds = whitelist.map((row) => row.objectId)

  // 非敏感对象：数据库 WHERE isSensitive = false，不把敏感行取回内存。
  const publicRows =
    objectType === 'task'
      ? await prisma.task.findMany({
          where: { projectId, isSensitive: false },
          select: { id: true },
        })
      : await prisma.userStory.findMany({
          where: { projectId, isSensitive: false },
          select: { id: true },
        })

  // 白名单命中的敏感对象：数据库 WHERE isSensitive = true AND id IN (...)。
  // 白名单为空时直接短路，避免 `id IN ()` 这类无意义查询。
  const whitelistedRows =
    whitelistIds.length === 0
      ? []
      : objectType === 'task'
        ? await prisma.task.findMany({
            where: { projectId, isSensitive: true, id: { in: whitelistIds } },
            select: { id: true },
          })
        : await prisma.userStory.findMany({
            where: { projectId, isSensitive: true, id: { in: whitelistIds } },
            select: { id: true },
          })

  return {
    mode: 'subset',
    ids: [...publicRows, ...whitelistedRows].map((row) => row.id),
  }
}

// ---------------------------------------------------------------------------
// Actor 注入（T0-04 的最小替身）
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    /** 当前请求的登录用户 id；由 T0-04 的 requireAuth 或本期临时桩写入 */
    actorUserId?: string
  }
}

/**
 * 临时 Actor 注入：从 `x-actor-user-id` 请求头读取调用者 id 挂到 request 上。
 *
 * 与真实 T0-04 的区别：本桩**不主动拒绝**未登录请求（只写入可空值），
 * 未登录的 401 由任务处理器调用 `requireActorUserId()` 时统一抛出。
 * 真实 requireAuth 合入后，本函数删除。
 */
export function installStubActor(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-actor-user-id']
    if (typeof header === 'string' && header.length > 0) {
      request.actorUserId = header
    }
  })
}

/** 读取 Actor；未登录时抛 401 UNAUTHENTICATED（契约 I-2b 的 401 出口规则）。 */
export function requireActorUserId(request: FastifyRequest): string {
  if (!request.actorUserId) {
    throw new AppError(401, 'UNAUTHENTICATED', '未登录或凭证失效')
  }
  return request.actorUserId
}
