/**
 * M1 身份与会话路由（T0-04，端点 1/2）
 *
 *   POST /auth/login —— 无需权限；账号密码换取无状态签名令牌
 *   GET  /auth/me    —— 需登录；返回当前用户简要信息
 *
 * 令牌的签发/校验复用 T0-03 的 `src/auth/token.ts`（无状态签名，不落库，避免新增 session 表）。
 * 口令校验复用 `src/auth/password.ts`。数据库经 RouteContext 注入，模块不 import 全局单例。
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../shared/errors.js'
import { issueToken } from './token.js'
import { verifyPassword } from './password.js'
import { currentUserId, requireAuth } from './actor.js'
import type { UserBrief } from '../shared/types.js'
import type { RouteContext } from '../routes.js'

const loginBody = z.object({
  account: z.string().trim().min(1),
  password: z.string().min(1),
})

function toUserBrief(user: { id: string; account: string; displayName: string }): UserBrief {
  return { id: user.id, account: user.account, displayName: user.displayName }
}

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { prisma } = ctx

  // 端点 1：POST /auth/login —— 权限：无需
  // 账号或密码错误返回同一个 401，不区分是哪一个（避免账号枚举）
  app.post('/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body)

    const user = await prisma.user.findUnique({ where: { account: body.account } })
    const passwordOk = user ? await verifyPassword(body.password, user.passwordHash) : false
    if (!user || !passwordOk) {
      throw new AppError(401, 'UNAUTHENTICATED', '账号或密码错误')
    }

    return reply.send({ token: issueToken(user.id), user: toUserBrief(user) })
  })

  // 端点 2：GET /auth/me —— 权限：已登录
  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    const userId = currentUserId(request)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', '未登录或凭证失效')
    return toUserBrief(user)
  })
}
