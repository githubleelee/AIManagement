/**
 * Actor 注入（T0-03 最小骨架）
 *
 * 职责：把「当前请求是谁」注入到 request 上，供各模块调用 `can()` 时使用。
 *
 * ===========================================================================
 * 契约依据与边界
 * ===========================================================================
 *
 * - 契约决策 I-3 的失败信封要求鉴权失败返回 **401 UNAUTHENTICATED**；
 *   决策 I-4 的错误码表同样规定 UNAUTHENTICATED ↔ 401。
 * - 现有 `error-handler.ts` 已明确：**其它 Fastify 客户端错误保持原始状态码、
 *   不得按 4xx 区间改写**。因此这里必须抛**带 statusCode 的错误**（而不是抛
 *   `AppError`），让错误处理器按原状态码透出。
 *   注意 `AppError` 的 status 联合类型为 `401 | 403 | 404 | 409 | 422`，
 *   但使用它需要确认其 code 与 `ErrorCode` 一致；为减少耦合，本文件沿用
 *   T0-01 已确立的 `errorWithStatus` 约定（测试文件里已有同名用法）。
 *
 * - 本文件**只做身份识别，不做权限判定**。权限一律由 `can()` 现查库得出，
 *   因此满足决策 I-10「不做进程内缓存、权限变更即时生效」。
 * - **不实现端点 1 `/auth/login` 与端点 2 `/auth/me`**：那属于 M1 的交付范围，
 *   本骨架只提供「有了 token 就能被识别」的能力，供各模块在 M1 完成前写接口测试。
 * ===========================================================================
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { verifyToken } from './token.js'

/** 注入到 request 上的当前用户 id（未登录时为 undefined）。 */
declare module 'fastify' {
  interface FastifyRequest {
    actorUserId?: string
  }
}

/** 未认证时的状态码与错误码（契约决策 I-4）。 */
const UNAUTHENTICATED_STATUS = 401

/**
 * 构造带 HTTP 状态码的错误。
 *
 * 与 error-handler.ts 的约定一致：带 statusCode 的错误会被**原样透出**，
 * 不会被改写成 422，从而保住契约要求的 401 语义。
 */
function errorWithStatus(statusCode: number, message: string): Error {
  const error = new Error(message)
  ;(error as Error & { statusCode: number }).statusCode = statusCode
  return error
}

/**
 * 从 Authorization 头解析并校验令牌，成功时返回 userId。
 * 支持 `Bearer <token>` 形式（大小写不敏感）。
 */
function readBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/**
 * 注册 actor 解析钩子。
 *
 * 采用 `onRequest` 钩子而**不是**全局强制鉴权：本骨架不预设哪些端点需要登录，
 * 由各端点自行声明 `{ preHandler: requireAuth }`。这样不会误拦后续可能出现的
 * 公开端点（例如端点 1 登录本身）。
 */
export function registerActorResolver(app: FastifyInstance, prisma: PrismaClient): void {
  app.decorateRequest('actorUserId', undefined)

  app.addHook('onRequest', async (req) => {
    const token = readBearerToken(req)
    if (!token) return

    const userId = verifyToken(token)
    if (!userId) return

    // 确认用户仍存在：用户被删除后其旧令牌应立即失效。
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) return

    req.actorUserId = userId
  })
}

/**
 * 要求已登录的 preHandler。未登录时抛 401 UNAUTHENTICATED。
 *
 * 用法：`app.get('/xxx', { preHandler: requireAuth }, handler)`
 */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.actorUserId) {
    throw errorWithStatus(UNAUTHENTICATED_STATUS, '请先登录')
  }
}

/**
 * 取当前登录用户 id；未登录时抛 401。
 * 供已挂 `requireAuth` 的处理器内部使用（此时断言一定成立）。
 */
export function currentUserId(req: FastifyRequest): string {
  if (!req.actorUserId) {
    throw errorWithStatus(UNAUTHENTICATED_STATUS, '请先登录')
  }
  return req.actorUserId
}
