/** US-15's local editor document. No DB, authorization or cross-domain service calls.
 * C-owned editor format, distinct from B's frozen persistence/API envelope.
 * Explicit mapping belongs in the frontend adapter; API types remain in schemas.ts.
 */
import { z } from 'zod'

// Aligned with B's frozen v1.0 bounds; API saves regenerate node and edge ids.
export const UML_EDITOR_LIMITS = { nodes: 200, edges: 500, text: 100 } as const
const id = z.string().min(1).max(64)
const name = z.string().trim().min(1, '请输入名称').max(UML_EDITOR_LIMITS.text)
const node = z.object({ id, name }).strict()
export const useCaseRelationTypes = ['ASSOCIATION', 'INCLUDE', 'EXTEND'] as const
export const sequenceMessageTypes = ['sync', 'async', 'return'] as const

const useCaseSchema = z.object({
  formatVersion: z.literal(1),
  kind: z.literal('USE_CASE'),
  actors: z.array(node).max(UML_EDITOR_LIMITS.nodes),
  useCases: z.array(node).max(UML_EDITOR_LIMITS.nodes),
  relations: z.array(z.object({
    id, type: z.enum(useCaseRelationTypes), fromId: id, toId: id,
    label: z.string().trim().max(UML_EDITOR_LIMITS.text).nullable().optional(),
    // Wire permits ACTOR↔USECASE. Editor displays actor first, preserving saved direction.
    associationReversed: z.boolean().optional(),
  }).strict()).max(UML_EDITOR_LIMITS.edges),
}).strict()
const sequenceSchema = z.object({
  formatVersion: z.literal(1),
  kind: z.literal('SEQUENCE'),
  lifelines: z.array(node).max(UML_EDITOR_LIMITS.nodes),
  messages: z.array(z.object({
    id, fromId: id, toId: id, label: z.string().trim().max(UML_EDITOR_LIMITS.text).nullable(),
    kind: z.enum(sequenceMessageTypes), seq: z.number().int().positive(),
  }).strict()).max(UML_EDITOR_LIMITS.edges),
}).strict()

export type UseCaseDocument = z.infer<typeof useCaseSchema>
export type SequenceDocument = z.infer<typeof sequenceSchema>
export type UmlDocument = UseCaseDocument | SequenceDocument
export type UseCaseRelation = UseCaseDocument['relations'][number]
export type SequenceMessage = SequenceDocument['messages'][number]

/** Node ids and edge ids share a single namespace inside a document. */
export const umlDocumentSchema = z.discriminatedUnion('kind', [useCaseSchema, sequenceSchema])
  .superRefine((doc, ctx) => {
    const nodes = doc.kind === 'USE_CASE' ? [...doc.actors, ...doc.useCases] : doc.lifelines
    const edges = doc.kind === 'USE_CASE' ? doc.relations : doc.messages
    if (nodes.length > UML_EDITOR_LIMITS.nodes) ctx.addIssue({
      code: 'custom', message: '单图节点总数不能超过 200', path: ['nodes'],
    })
    const seen = new Set<string>()
    for (const item of [...nodes, ...edges]) {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', message: '图内编号不能重复', path: ['id'] })
      seen.add(item.id)
    }
    const nodeIds = new Set(nodes.map(n => n.id))
    const actorIds = new Set(doc.kind === 'USE_CASE' ? doc.actors.map(n => n.id) : [])
    const caseIds = new Set(doc.kind === 'USE_CASE' ? doc.useCases.map(n => n.id) : [])
    const relationKeys = new Set<string>()
    edges.forEach((edge, index) => {
      const path = [doc.kind === 'USE_CASE' ? 'relations' : 'messages', index]
      if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) {
        ctx.addIssue({ code: 'custom', message: '关系或消息端点不存在', path })
      }
      if (doc.kind === 'USE_CASE') {
        const relation = edge as UseCaseRelation
        const key = JSON.stringify([relation.type, relation.fromId, relation.toId, relation.type === 'ASSOCIATION' && !!relation.associationReversed])
        if (relationKeys.has(key)) ctx.addIssue({ code: 'custom', message: '用例图关系不能重复', path })
        relationKeys.add(key)
        // ASSOCIATION is stored actor -> use case; include/extend point use case -> use case.
        const valid = relation.type === 'ASSOCIATION'
          ? actorIds.has(edge.fromId) && caseIds.has(edge.toId)
          : caseIds.has(edge.fromId) && caseIds.has(edge.toId) && edge.fromId !== edge.toId
        if (!valid) ctx.addIssue({ code: 'custom', message: '关系类型与端点不匹配', path })
      }
    })
    if (doc.kind === 'SEQUENCE') {
      let previous = 0
      doc.messages.forEach((message, index) => {
        if (message.seq <= previous) ctx.addIssue({
          code: 'custom', message: '消息序号必须严格递增', path: ['messages', index, 'seq'],
        })
        previous = message.seq
      })
    }
  })

export function emptyUmlDocument(kind: UmlDocument['kind']): UmlDocument {
  return kind === 'USE_CASE'
    ? { formatVersion: 1, kind, actors: [], useCases: [], relations: [] }
    : { formatVersion: 1, kind, lifelines: [], messages: [] }
}

/** Removing editor-local nodes also removes their edges; not business-object unlinking. */
export function removeUmlNode(doc: UmlDocument, nodeId: string): UmlDocument {
  if (doc.kind === 'USE_CASE') return {
    ...doc,
    actors: doc.actors.filter(n => n.id !== nodeId),
    useCases: doc.useCases.filter(n => n.id !== nodeId),
    relations: doc.relations.filter(r => r.fromId !== nodeId && r.toId !== nodeId),
  }
  return {
    ...doc,
    lifelines: doc.lifelines.filter(n => n.id !== nodeId),
    messages: doc.messages.filter(m => m.fromId !== nodeId && m.toId !== nodeId)
      .map((m, index) => ({ ...m, seq: index + 1 })),
  }
}

/** UI up/down control; immutable, and seq follows the new visual order. */
export function moveSequenceMessage(doc: SequenceDocument, messageId: string, offset: -1 | 1): SequenceDocument {
  const index = doc.messages.findIndex(m => m.id === messageId)
  const destination = index + offset
  if (index < 0 || destination < 0 || destination >= doc.messages.length) return doc
  const messages = [...doc.messages]
  const current = messages[index]!
  messages[index] = messages[destination]!
  messages[destination] = current
  return { ...doc, messages: messages.map((m, i) => ({ ...m, seq: i + 1 })) }
}
