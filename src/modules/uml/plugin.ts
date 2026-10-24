/** US-15 own-domain plugin. B alone owns production registration in src/routes.ts.
 * Non-PM reads use current association visibility AND the sticky everRestricted guard.
 * Production routing and full-ticket acceptance remain separate integration work.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodType, ZodTypeDef } from 'zod'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import type { RouteContext } from '../../routes.js'
import { AppError } from '../../shared/errors.js'
import { toFieldErrors } from '../../shared/validation.js'
import { umlContentSchema, umlCreateSchema, umlListQuerySchema, umlPatchSchema } from './schemas.js'
import { createUmlDiagram, deleteUmlDiagram, getUmlDiagram, listUmlDiagrams, patchUmlDiagram, putUmlContent } from './service.js'

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(422, 'VALIDATION_FAILED', '字段校验失败', toFieldErrors(result.error.issues))
  return result.data
}
export function registerUmlRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const options = { preHandler: requireAuth }
  app.get('/projects/:projectId/uml-diagrams', options, async req => {
    const { projectId } = req.params as { projectId: string }
    const query = parse(umlListQuerySchema, req.query)
    return listUmlDiagrams(ctx.prisma, currentUserId(req), projectId, query.kind)
  })
  app.get('/uml-diagrams/:diagramId', options, async req => {
    const { diagramId } = req.params as { diagramId: string }
    return getUmlDiagram(ctx.prisma, currentUserId(req), diagramId)
  })
  app.post('/projects/:projectId/uml-diagrams', options, async (req, reply) => {
    const { projectId } = req.params as { projectId: string }
    const input = parse(umlCreateSchema, req.body)
    return reply.status(201).send(await createUmlDiagram(ctx.prisma, currentUserId(req), projectId, input))
  })
  app.patch('/uml-diagrams/:diagramId', options, async req => {
    const { diagramId } = req.params as { diagramId: string }
    return patchUmlDiagram(ctx.prisma, currentUserId(req), diagramId, parse(umlPatchSchema, req.body))
  })
  app.put('/uml-diagrams/:diagramId/content', options, async req => {
    const { diagramId } = req.params as { diagramId: string }
    return putUmlContent(ctx.prisma, currentUserId(req), diagramId, parse(umlContentSchema, req.body))
  })
  app.delete('/uml-diagrams/:diagramId', options, async (req, reply) => {
    const { diagramId } = req.params as { diagramId: string }
    await deleteUmlDiagram(ctx.prisma, currentUserId(req), diagramId)
    return reply.status(204).send()
  })
}
