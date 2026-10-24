import { describe, it, expect } from 'vitest'
import { fromWire, toWire } from './api'
const base = () => ({ id: 'diagram', projectId: 'project', kind: 'USECASE', title: '合成图', description: null,
  ownerUserId: 'pm', ownerDisplayName: 'PM', createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z',
  goalCount: 0, activityCount: 0, storyCount: 0, taskCount: 0, goalRefs: [], activityRefs: [], storyRefs: [], taskRefs: [] })
const usecase = () => ({ ...base(), nodes: [
  { id: 'a', nodeType: 'ACTOR', name: '角色', orderIndex: 0 },
  { id: 'u', nodeType: 'USECASE', name: '用例', orderIndex: 0 },
  { id: 'v', nodeType: 'USECASE', name: '其他用例', orderIndex: 0 },
], edges: [
  { id: 'back', edgeType: 'ASSOCIATION', sourceNodeId: 'u', targetNodeId: 'a', label: '反向说明', seq: null },
  { id: 'forward', edgeType: 'ASSOCIATION', sourceNodeId: 'a', targetNodeId: 'u', label: null, seq: null },
  { id: 'include', edgeType: 'INCLUDE', sourceNodeId: 'u', targetNodeId: 'v', label: '包含', seq: null },
  { id: 'extend', edgeType: 'EXTEND', sourceNodeId: 'v', targetNodeId: 'u', label: null, seq: null },
] })
describe('wire/editor pure roundtrip regression (no HTTP mock)', () => {
  it('preserves both directed association tuples, reverse marker, custom and null labels', () => {
    const wire = usecase(), editor = fromWire(wire)
    expect(editor.kind).toBe('USE_CASE')
    if (editor.kind !== 'USE_CASE') throw new Error('wrong kind')
    expect(editor.relations[0]).toMatchObject({ fromId: 'a', toId: 'u', associationReversed: true })
    expect(editor.relations).toHaveLength(4)
    expect(toWire(editor).edges).toEqual(wire.edges.map(({ seq: _seq, ...edge }) => edge))
  })
  it('does not normalize null labels into empty strings during JSON export/import', () => {
    const wire = usecase(), editor = JSON.parse(JSON.stringify(fromWire(wire)))
    expect(toWire(editor).edges.map(edge => edge.label)).toEqual(['反向说明', null, '包含', null])
  })
  it('preserves all three message kinds, self messages and null labels; server seq is not sent back as authority', () => {
    const wire = { ...base(), kind: 'SEQUENCE', nodes: [
      { id: 'b', nodeType: 'LIFELINE', name: 'B', orderIndex: 1 },
      { id: 'a', nodeType: 'LIFELINE', name: 'A', orderIndex: 0 },
    ], edges: [
      { id: 'm1', edgeType: 'SYNC', sourceNodeId: 'a', targetNodeId: 'b', label: '调用', seq: 1 },
      { id: 'm2', edgeType: 'ASYNC', sourceNodeId: 'b', targetNodeId: 'b', label: null, seq: 2 },
      { id: 'm3', edgeType: 'RETURN', sourceNodeId: 'b', targetNodeId: 'a', label: null, seq: 3 },
    ] }
    const editor = fromWire(wire), back = toWire(editor)
    expect(back.nodes.map(node => node.id)).toEqual(['a', 'b'])
    expect(back.edges).toEqual(wire.edges.map(({ seq: _seq, ...edge }) => edge))
    expect(back.edges.every(edge => !('seq' in edge))).toBe(true)
    expect(back.edges[1].sourceNodeId).toBe(back.edges[1].targetNodeId)
  })
  it('retains requested message order after editing, leaving continuous seq allocation to the server', () => {
    const wire = { ...base(), kind: 'SEQUENCE', nodes: [{ id: 'a', nodeType: 'LIFELINE', name: 'A', orderIndex: 0 }],
      edges: [1, 2].map(seq => ({ id: `m${seq}`, edgeType: 'SYNC', sourceNodeId: 'a', targetNodeId: 'a', label: `消息${seq}`, seq })) }
    const editor = fromWire(wire)
    if (editor.kind !== 'SEQUENCE') throw new Error('wrong kind')
    const changed = { ...editor, messages: [...editor.messages].reverse().map((message, i) => ({ ...message, seq: i + 1 })) }
    expect(toWire(changed).edges.map(edge => edge.id)).toEqual(['m2', 'm1'])
  })
  it('rejects mismatched graph/node kinds and invalid endpoint references instead of silently dropping content', () => {
    const wire = usecase()
    expect(() => fromWire({ ...wire, kind: 'SEQUENCE' })).toThrow()
    expect(() => fromWire({ ...wire, edges: [{ ...wire.edges[0], targetNodeId: 'missing' }] })).toThrow()
  })
})
