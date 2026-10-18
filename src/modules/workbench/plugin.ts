/**
 * US-08 个人工作台（工单 #28）—— 路由插件。
 *
 * 只导出插件，**不自行 `app.get()` 挂生产路由**：正式注册行在冻结的
 * `src/routes.ts` 里（契约决策 I-0 / I-9）。
 *
 * 端点：`GET /me/workbench`
 *   - 权限：登录即可（只返回"我"的数据；范围由 `ProjectMember` + `visibilityScope()` 决定）
 *   - 响应：`{ blocks: [...5 块...], basis: {...计算口径...} }`
 *   - 该端点**不在** Sprint 1 契约的 30 个端点内，属本票新增；
 *     接口说明见 `docs/us-08-workbench-api.md`，并入契约需走契约变更流程。
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import type { RouteContext } from '../../routes.js'
import { buildWorkbench } from './service.js'

export function registerWorkbenchRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/me/workbench', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const view = await buildWorkbench(ctx.prisma, actorUserId)
    return reply.status(200).send(view)
  })
}
