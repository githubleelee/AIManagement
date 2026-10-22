import type { FastifyInstance, FastifyRequest } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { AiServiceError } from './errors.js'
import { reviewSuggestionSchema } from './schemas.js'
import type { AiBreakdownService } from './service.js'

export type AiRouteContext = {
  service: AiBreakdownService
}

function rethrow(error: unknown): never {
  if (error instanceof AiServiceError) {
    throw new AppError(error.status, error.kind, error.message)
  }
  throw error
}

/**
 * US-11 独立路由插件。当前没有写入冻结的 `src/routes.ts`；负责人完成权限适配与
 * 持久化适配后，只需在组装根注入 service 并注册本插件。
 */
export function registerAiRoutes(app: FastifyInstance, context: AiRouteContext): void {
  app.post(
    '/projects/:projectId/stories/:storyId/ai-suggestions',
    { preHandler: requireAuth },
    async (request, reply) => {
      const actorUserId = currentUserId(request)
      const { projectId, storyId } = request.params as { projectId: string; storyId: string }
      try {
        const record = await context.service.generate(actorUserId, projectId, storyId)
        return reply.status(201).send(record)
      } catch (error) {
        rethrow(error)
      }
    },
  )

  app.get(
    '/projects/:projectId/stories/:storyId/ai-suggestions',
    { preHandler: requireAuth },
    async request => {
      const actorUserId = currentUserId(request)
      const { projectId, storyId } = request.params as { projectId: string; storyId: string }
      try {
        return { items: await context.service.list(actorUserId, projectId, storyId) }
      } catch (error) {
        rethrow(error)
      }
    },
  )

  const disposeHandler = async (request: FastifyRequest) => {
      const actorUserId = currentUserId(request)
      const { projectId, storyId, suggestionId } = request.params as {
        projectId: string
        storyId: string
        suggestionId: string
      }
      const input = reviewSuggestionSchema.parse(request.body ?? {})
      try {
        return await context.service.review(actorUserId, projectId, storyId, suggestionId, input)
      } catch (error) {
        rethrow(error)
      }
    }

  app.post(
    '/projects/:projectId/stories/:storyId/ai-suggestions/:suggestionId/disposition',
    { preHandler: requireAuth },
    disposeHandler,
  )

  // ★ 2026-10-21 B 公共接入裁定（PR #82 评审 M10）：删除 `/review` 兼容别名 ——
  //   它与 `/disposition` 语义完全重复、无调用方、无测试覆盖，却会成为公共路由表里的
  //   第二个同义端点。D 的前端只调 `/disposition`，删除不影响任何既有消费方。
}
