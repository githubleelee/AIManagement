/**
 * US-10 项目仪表盘（工单 #30）—— 路由插件。
 *
 * 只导出插件，**不自行 `app.put()` 挂生产路由**：正式注册行在冻结的 `src/routes.ts` 里
 * （契约决策 I-0 / I-9）。
 *
 * 端点：`GET /projects/:projectId/dashboard`
 *   - 权限：`can(actor, 'project.read')` —— 四种角色都能读；非成员 404
 *   - 响应：`{ project, progress, health, byStatus, basis }`
 *   - 该端点**不在** Sprint 1 契约的 30 个端点内，属本票新增；
 *     接口与口径说明见 `docs/us-10-progress-risk-api.md`，并入契约需走契约变更流程。
 *
 * 本文件**不提供**"覆盖今天"的测试专用查询参数：口径里的"今天"固定走 UTC 日期，
 * 测试用「相对今天构造任务计划区间」的方式钉边界（与 `workbench.test.ts` 同一做法），
 * 不给生产接口开一个只为测试存在的后门。
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import type { RouteContext } from '../../routes.js'
import { buildDashboard } from './service.js'

export function registerAnalyticsRoutes(app: FastifyInstance, context: RouteContext): void {
  const prisma = context.prisma

  app.get('/projects/:projectId/dashboard', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { projectId } = request.params as { projectId: string }

    const view = await buildDashboard(prisma, actorUserId, projectId)
    return reply.status(200).send(view)
  })
}
