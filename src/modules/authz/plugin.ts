import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import type { VisibilityObjectType } from '../../shared/types.js'
import type { RouteContext } from '../../routes.js'
import { createAuthorization } from './permissions.js'
import { objectNotFound, parseSensitivityInput, setSensitivity } from './sensitivity.js'

/** M3 只导出插件，由路由总表注册。 */
export function registerSensitivityRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { can } = createAuthorization(ctx.prisma)
  for (const [path, param, objectType] of [
    ['/stories/:storyId/sensitivity', 'storyId', 'story'],
    ['/tasks/:taskId/sensitivity', 'taskId', 'task'],
  ] as const) {
    app.put(path, { preHandler: requireAuth }, async req => {
      const objectId = (req.params as Record<string, string>)[param]
      if (!objectId) throw objectNotFound(objectType)
      const projectId = objectType === 'story'
        ? (await ctx.prisma.userStory.findUnique({ where: { id: objectId }, select: { projectId: true } }))?.projectId
        : (await ctx.prisma.task.findUnique({ where: { id: objectId }, select: { projectId: true } }))?.projectId
      if (!projectId) throw objectNotFound(objectType)
      const actorUserId = currentUserId(req)
      const decision = await can(actorUserId, 'sensitivity.manage', {
        kind: objectType as VisibilityObjectType, projectId, objectId,
      })
      if (!decision.allow) {
        if (decision.status === 404) throw objectNotFound(objectType)
        throw new AppError(403, 'FORBIDDEN', '无权修改敏感设置')
      }
      const input = parseSensitivityInput(req.body)
      return setSensitivity(ctx.prisma, actorUserId, objectType, objectId, input)
    })
  }
}
