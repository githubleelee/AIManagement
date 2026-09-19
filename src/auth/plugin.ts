/**
 * M1 身份与会话 —— HTTP 路由插件（T0-04，端点 1/2）
 *
 *   POST /auth/login —— 无需权限；账号密码换取无状态签名令牌
 *   GET  /auth/me    —— 需登录；返回当前用户简要信息
 *
 * 契约依据
 *   - 决策 I-8 认证约定：除端点 1 外均需 `Authorization: Bearer <token>`；
 *     令牌为不透明随机串（本实现见 `src/auth/token.ts`，无状态签名、不落库）。
 *   - 决策 I-8 端点 1：账号或密码错误返回**同一个 401**，不区分是哪一个（避免账号枚举）。
 *
 * 归属与注册（决策 I-0）
 *   本文件属 M1 独占，只新增、不触碰冻结文件。
 *   正式注册行（`registerAuthRoutes(app, context)`）位于冻结文件 `src/routes.ts`；
 *   测试不手动注册 —— `createHttpTestContext()` 内部的 `buildApp()` 已包含注册。
 */
import type { FastifyInstance } from 'fastify'
import { AppError } from '../shared/errors.js'
import { issueToken } from './token.js'
import { verifyPassword } from './password.js'
import { currentUserId, requireAuth } from './actor.js'
import { findCredentialByAccount, findUserBriefById, toUserBrief } from './service.js'
import { fieldError, loginSchema, parseBody, validationFailedWith } from './schemas.js'
import type { RouteContext } from '../routes.js'

/**
 * 注册身份与会话模块的全部路由。
 *
 * 签名固定为 `(app, ctx)`（与 `src/routes.ts` 的 `RouteContext` 约定一致），
 * 数据库一律从 `ctx.prisma` 取得，不 import 全局单例。
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // ===========================================================================
  // 端点 1 —— POST /auth/login —— 权限：无需
  //
  // 请求  { account: string, password: string }
  // 响应  200 { token: string, user: UserBrief }
  // 错误  422 VALIDATION_FAILED（account / password: REQUIRED）
  //       401 UNAUTHENTICATED（账号或密码错误，不区分是哪一个）
  // ===========================================================================
  app.post('/auth/login', async (req, reply) => {
    const input = parseBody(loginSchema, req.body ?? {})

    // 纯空白账号：`.min(1)` 拦不住，trim 后判空（决策 I-4：REQUIRED 含纯空白）
    const account = input.account.trim()
    if (account === '') {
      validationFailedWith([fieldError('account', 'REQUIRED')])
    }

    const user = await findCredentialByAccount(ctx.prisma, account)
    const passwordOk = user ? await verifyPassword(input.password, user.passwordHash) : false
    if (!user || !passwordOk) {
      throw new AppError(401, 'UNAUTHENTICATED', '账号或密码错误')
    }

    return reply.send({ token: issueToken(user.id), user: toUserBrief(user) })
  })

  // ===========================================================================
  // 端点 2 —— GET /auth/me —— 权限：已登录
  //
  // 请求  —
  // 响应  200 UserBrief
  // 错误  401 UNAUTHENTICATED
  // ===========================================================================
  app.get('/auth/me', { preHandler: requireAuth }, async (req) => {
    const userId = currentUserId(req)
    const user = await findUserBriefById(ctx.prisma, userId)
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', '未登录或凭证失效')
    return user
  })
}
