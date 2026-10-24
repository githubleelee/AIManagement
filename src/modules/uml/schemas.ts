import { z } from 'zod'

/** Frozen B v1.0 wire format, distinct from the local editor document. */
export const UML_LIMITS = { nodes: 200, edges: 500, refs: 50, title: 100, description: 200, text: 100, list: 200 } as const
export const umlKindSchema = z.enum(['USECASE', 'SEQUENCE'])
const id = z.string().min(1)
const name = z.string().trim().min(1).max(UML_LIMITS.text)
const refs = z.array(id).max(UML_LIMITS.refs)

const nodeSchema = z.object({
  id: id.optional(),
  nodeType: z.enum(['ACTOR', 'USECASE', 'LIFELINE']),
  name,
  orderIndex: z.number().int().nonnegative().max(2147483647).optional(),
}).strict()
const edgeSchema = z.object({
  id: id.optional(),
  edgeType: z.enum(['ASSOCIATION', 'INCLUDE', 'EXTEND', 'SYNC', 'ASYNC', 'RETURN']),
  sourceNodeId: id,
  targetNodeId: id,
  label: z.string().trim().max(UML_LIMITS.text).nullable().optional(),
  // Accepted but deliberately ignored: order and fresh seq are server-owned.
  seq: z.unknown().optional(),
}).strict()
export const umlContentSchema = z.object({
  nodes: z.array(nodeSchema).max(UML_LIMITS.nodes),
  edges: z.array(edgeSchema).max(UML_LIMITS.edges),
}).strict()
const metadata = {
  title: z.string().trim().min(1).max(UML_LIMITS.title),
  description: z.string().trim().max(UML_LIMITS.description).nullable().optional(),
  ownerUserId: id.optional(),
  goalIds: refs.optional(),
  activityIds: refs.optional(),
  storyIds: refs.optional(),
  taskIds: refs.optional(),
}
export const umlCreateSchema = z.object({
  ...metadata,
  kind: umlKindSchema,
  nodes: umlContentSchema.shape.nodes.optional().default([]),
  edges: umlContentSchema.shape.edges.optional().default([]),
}).strict()
export const umlPatchSchema = z.object(metadata).partial().strict()
export const umlListQuerySchema = z.object({ kind: umlKindSchema.optional() }).strict()

export type UmlKind = z.infer<typeof umlKindSchema>
export type UmlContentInput = z.infer<typeof umlContentSchema>
export type UmlCreateInput = z.infer<typeof umlCreateSchema>
export type UmlPatchInput = z.infer<typeof umlPatchSchema>
