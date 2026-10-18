/**
 * US-10 风险与项目关闭阻断（工单 #30）—— 路由插件。
 *
 * 目前**只导出关闭阻断的校验预览**（只读）。风险的 CRUD 与真正的关闭动作，
 * 要等 `Risk` 表 / `Project.status` / PM 专属授权动作三项授权到位后再加。
 *
 * 与其他模块一致：只导出插件，正式注册行在冻结的 `src/routes.ts`（决策 I-0 / I-9）。
 *
 * 端点：`GET /projects/:projectId/closure-check`
 *   - 权限：`can(actor, 'project.read')`；非成员 404
 *   - 响应：`{ project, verdict, blockingTasks, blockingRisks, basis }`
 *   - 不在 Sprint 1 契约的 30 个端点内，属本票新增
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import type { RouteContext } from '../../routes.js'
import { checkClosure } from './closure.js'

export function registerRiskRoutes(app: FastifyInstance, context: RouteContext): void {
  const prisma = context.prisma

  app.get(
    '/projects/:projectId/closure-check',
    { preHandler: requireAuth },
    async (request, reply) => {
      const actorUserId = currentUserId(request)
      const { projectId } = request.params as { projectId: string }

      const view = await checkClosure(prisma, actorUserId, projectId)
      return reply.status(200).send(view)
    },
  )
}
