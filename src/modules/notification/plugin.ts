import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import type { NotificationService } from './service.js'
import { NotificationServiceError } from './errors.js'

const listQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
})

function translate(error: unknown): never {
  if (error instanceof NotificationServiceError) {
    throw new AppError(error.status, error.kind, error.message)
  }
  throw error
}

/**
 * 独立路由插件。正式注册由 ROLE-B 在 `src/routes.ts` / `src/app.ts` 完成；
 * 本文件不自行修改公共组装根。
 */
export function registerNotificationRoutes(
  app: FastifyInstance,
  service: NotificationService,
): void {
  app.get('/me/notifications', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_FAILED', '请求参数格式错误')
    }
    const result = await service.list(
      currentUserId(request),
      parsed.data.unreadOnly === 'true',
    )
    return reply.status(200).send(result)
  })

  app.get('/notifications/:notificationId', { preHandler: requireAuth }, async (request, reply) => {
    const { notificationId } = request.params as { notificationId: string }
    try {
      return reply.status(200).send(await service.get(currentUserId(request), notificationId))
    } catch (error) {
      translate(error)
    }
  })

  app.patch(
    '/notifications/:notificationId/read',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { notificationId } = request.params as { notificationId: string }
      try {
        return reply
          .status(200)
          .send(await service.markRead(currentUserId(request), notificationId))
      } catch (error) {
        translate(error)
      }
    },
  )
}
