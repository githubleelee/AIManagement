import { z } from 'zod'
import { apiFetch } from '../../api'
import { umlDocumentSchema, type UmlDocument } from '../../../../src/modules/uml/document'
import type { UmlContentInput, UmlCreateInput, UmlPatchInput } from '../../../../src/modules/uml/schemas'

const id = z.string().min(1)
const node = z.object({ id, nodeType: z.enum(['ACTOR', 'USECASE', 'LIFELINE']), name: z.string(), orderIndex: z.number().int() }).strict()
const edge = z.object({ id, edgeType: z.enum(['ASSOCIATION', 'INCLUDE', 'EXTEND', 'SYNC', 'ASYNC', 'RETURN']), sourceNodeId: id, targetNodeId: id, label: z.string().nullable(), seq: z.number().int().nullable() }).strict()
const summary = z.object({
  id, projectId: id, kind: z.enum(['USECASE', 'SEQUENCE']), title: z.string(), description: z.string().nullable(),
  ownerUserId: id, ownerDisplayName: z.string(), goalCount: z.number().int().nonnegative(),
  activityCount: z.number().int().nonnegative(), storyCount: z.number().int().nonnegative(), taskCount: z.number().int().nonnegative(),
  createdAt: z.string(), updatedAt: z.string(),
})
export const umlViewSchema = summary.extend({
  nodes: z.array(node).max(200), edges: z.array(edge).max(500),
  goalRefs: z.array(z.object({ id, name: z.string() })).max(50),
  activityRefs: z.array(z.object({ id, name: z.string(), goalId: id })).max(50),
  storyRefs: z.array(z.object({ id, title: z.string(), activityId: id })).max(50),
  taskRefs: z.array(z.object({ id, title: z.string(), storyId: id })).max(50),
})
const listSchema = z.object({ items: z.array(summary).max(200), total: z.number().int().nonnegative(), truncated: z.boolean() })
export type UmlView = z.infer<typeof umlViewSchema>
export type UmlList = z.infer<typeof listSchema>

/** No unknown graph kinds, types, endpoints or fields are silently dropped. */
export function fromWire(value: unknown): UmlDocument {
  const wire = umlViewSchema.parse(value)
  const nodes = [...wire.nodes].sort((a, b) => a.orderIndex - b.orderIndex)
  if (wire.kind === 'SEQUENCE') {
    if (nodes.some(n => n.nodeType !== 'LIFELINE')) throw new Error('服务端节点与时序图类型不匹配')
    return umlDocumentSchema.parse({ formatVersion: 1, kind: 'SEQUENCE',
      lifelines: nodes.map(n => ({ id: n.id, name: n.name })),
      messages: wire.edges.map(e => {
        if (!['SYNC', 'ASYNC', 'RETURN'].includes(e.edgeType)) throw new Error('服务端消息类型不匹配')
        return { id: e.id, fromId: e.sourceNodeId, toId: e.targetNodeId, label: e.label, kind: e.edgeType.toLowerCase(), seq: e.seq }
      }),
    })
  }
  if (nodes.some(n => n.nodeType === 'LIFELINE')) throw new Error('服务端节点与用例图类型不匹配')
  const actors = nodes.filter(n => n.nodeType === 'ACTOR').map(n => ({ id: n.id, name: n.name }))
  const actorIds = new Set(actors.map(n => n.id))
  return umlDocumentSchema.parse({ formatVersion: 1, kind: 'USE_CASE', actors,
    useCases: nodes.filter(n => n.nodeType === 'USECASE').map(n => ({ id: n.id, name: n.name })),
    relations: wire.edges.map(e => {
      if (!['ASSOCIATION', 'INCLUDE', 'EXTEND'].includes(e.edgeType) || e.seq !== null) throw new Error('服务端关系类型或序号不匹配')
      const reversed = e.edgeType === 'ASSOCIATION' && actorIds.has(e.targetNodeId)
      return { id: e.id, type: e.edgeType, fromId: reversed ? e.targetNodeId : e.sourceNodeId,
        toId: reversed ? e.sourceNodeId : e.targetNodeId, label: e.label, associationReversed: reversed }
    }),
  })
}
export function toWire(value: UmlDocument): UmlContentInput {
  const doc = umlDocumentSchema.parse(value)
  if (doc.kind === 'SEQUENCE') return {
    nodes: doc.lifelines.map((n, orderIndex) => ({ ...n, nodeType: 'LIFELINE', orderIndex })),
    edges: doc.messages.map(m => ({ id: m.id, sourceNodeId: m.fromId, targetNodeId: m.toId, label: m.label,
      edgeType: m.kind === 'sync' ? 'SYNC' : m.kind === 'async' ? 'ASYNC' : 'RETURN' })),
  }
  return {
    nodes: [...doc.actors.map(n => ({ ...n, nodeType: 'ACTOR' as const, orderIndex: 0 })), ...doc.useCases.map(n => ({ ...n, nodeType: 'USECASE' as const, orderIndex: 0 }))],
    edges: doc.relations.map(r => ({ id: r.id, edgeType: r.type, label: r.label ?? null,
      sourceNodeId: r.type === 'ASSOCIATION' && r.associationReversed ? r.toId : r.fromId,
      targetNodeId: r.type === 'ASSOCIATION' && r.associationReversed ? r.fromId : r.toId })),
  }
}
const path = (id: string) => `/uml-diagrams/${encodeURIComponent(id)}`
export async function listUml(projectId: string, signal?: AbortSignal): Promise<UmlList> {
  return listSchema.parse(await apiFetch<unknown>(`/projects/${encodeURIComponent(projectId)}/uml-diagrams`, { signal }))
}
export async function getUml(id: string, signal?: AbortSignal): Promise<UmlView> {
  return umlViewSchema.parse(await apiFetch<unknown>(path(id), { signal }))
}
export async function createUml(projectId: string, input: UmlCreateInput): Promise<UmlView> {
  return umlViewSchema.parse(await apiFetch<unknown>(`/projects/${encodeURIComponent(projectId)}/uml-diagrams`, { method: 'POST', body: JSON.stringify(input) }))
}
export async function patchUml(id: string, input: UmlPatchInput): Promise<UmlView> {
  return umlViewSchema.parse(await apiFetch<unknown>(path(id), { method: 'PATCH', body: JSON.stringify(input) }))
}
export async function saveUmlContent(id: string, doc: UmlDocument): Promise<UmlView> {
  return umlViewSchema.parse(await apiFetch<unknown>(`${path(id)}/content`, { method: 'PUT', body: JSON.stringify(toWire(doc)) }))
}
export function deleteUml(id: string): Promise<void> { return apiFetch<void>(path(id), { method: 'DELETE' }) }
