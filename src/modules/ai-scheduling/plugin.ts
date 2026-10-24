import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { SchedulingGenerationError, type createSchedulingGenerator } from './generation.js'
import { dispositionSchema, type createSchedulingWorkflow } from './workflow.js'
import { dateChangesSchema } from './schemas.js'

/** C plugin only. B must register it and supply real ports in routes/app.
 * Proposed relative paths; no production mount or permission bypass is created here.
 */
export function registerSchedulingRoutes<Tx>(app: FastifyInstance, context: {
  generate: ReturnType<typeof createSchedulingGenerator<Tx>>
  workflow: ReturnType<typeof createSchedulingWorkflow<Tx>>
}) {
  const base = '/projects/:projectId/scheduling-suggestions'
  const options = { preHandler: requireAuth }
  app.post(base, options, async (request, reply) => {
    const body = z.object({ requestId: z.string().trim().min(1) }).strict().parse(request.body)
    const { projectId } = request.params as { projectId: string }
    try {
      const receipt = await context.generate({ ...body, projectId, actorUserId: currentUserId(request) })
      return reply.status(201).send(receipt)
    } catch (error) {
      if (error instanceof SchedulingGenerationError) {
        if (error.code === 'FORBIDDEN') throw new AppError(403, 'FORBIDDEN', '资源不可访问')
        if (error.code === 'NOT_FOUND') throw new AppError(404, 'NOT_FOUND', '资源不存在')
        if (error.code === 'SOURCE_CHANGED') throw new AppError(409, 'CONFLICT', '来源已变化，请重新生成')
        if (error.code === 'INVALID_REQUEST' || error.code === 'EXTERNAL_PROJECT_DATA_FORBIDDEN') {
          throw new AppError(422, 'VALIDATION_FAILED', '请求无效或当前数据不允许外发')
        }
      }
      throw error
    }
  })
  app.get(base, options, async (request) => {
    const { projectId } = request.params as { projectId: string }
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).strict().parse(request.query)
    return context.workflow.list(currentUserId(request), { projectId, ...query })
  })
  app.get(`${base}/stats`, options, async (request) => {
    const { projectId } = request.params as { projectId: string }
    return context.workflow.stats(currentUserId(request), projectId)
  })
  app.get(`${base}/:suggestionId`, options, (request) => context.workflow.get(currentUserId(request),
    request.params as { projectId: string; suggestionId: string }))
  app.get(`${base}/:suggestionId/audit`, options, async (request) => ({
    items: await context.workflow.audit(currentUserId(request), request.params as { projectId: string; suggestionId: string }),
  }))
  app.post(`${base}/:suggestionId/assessment`, options, (request) => {
    const params = request.params as { projectId: string; suggestionId: string }
    const body = z.object({ changes: dateChangesSchema }).strict().parse(request.body)
    return context.workflow.assess(currentUserId(request), { ...params, ...body })
  })
  app.post(`${base}/:suggestionId/disposition`, options, (request) => {
    const params = request.params as { projectId: string; suggestionId: string }
    // Identity and actor belong to server context. Never allow body overrides, even equal values.
    const body = z.object({
      requestId: z.string(), status: z.enum(['ACCEPTED', 'MODIFIED', 'REJECTED']),
      note: z.string().optional(), changes: z.unknown().optional(),
    }).strict().parse(request.body)
    return context.workflow.dispose(currentUserId(request), dispositionSchema.parse({ ...body, ...params }))
  })
}
