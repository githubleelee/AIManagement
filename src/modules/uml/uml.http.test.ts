/** HTTP seam only; real isolated migrated SQLite, actual can()/sessions/transactions.
 * These tests explicitly DO NOT claim completed non-PM reads; see pending tests below.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHttpTestContext, setActiveDatabase, type HttpTestContext } from '../../../test/helpers.js'
import { makeActivity, makeGoal, makeMember, makeProject, makeStory, makeTask, makeUser } from '../../../test/factories.js'
import { registerUmlRoutes } from './plugin.js'

let ctx: HttpTestContext
let projectId: string, goalId: string, activityId: string, storyId: string, taskId: string
let pm: string, member: string, viewer: string, outsider: string
let clients: Record<'pm' | 'member' | 'viewer' | 'outsider' | 'anonymous', ReturnType<HttpTestContext['asUser']>>
const collection = () => `/projects/${projectId}/uml-diagrams`
const detail = (id: string) => `/uml-diagrams/${id}`
const usecase = () => ({
  nodes: [{ id: 'actor', nodeType: 'ACTOR', name: '参与者' }, { id: 'case', nodeType: 'USECASE', name: '登录' }, { id: 'case2', nodeType: 'USECASE', name: '验证' }],
  edges: [
    { edgeType: 'ASSOCIATION', sourceNodeId: 'actor', targetNodeId: 'case' },
    { edgeType: 'INCLUDE', sourceNodeId: 'case', targetNodeId: 'case2', label: '校验' },
    { edgeType: 'EXTEND', sourceNodeId: 'case2', targetNodeId: 'case' },
  ],
})
const sequence = () => ({
  nodes: [{ id: 'a', nodeType: 'LIFELINE', name: '客户端', orderIndex: 1 }, { id: 'b', nodeType: 'LIFELINE', name: '服务端', orderIndex: 0 }],
  edges: [
    { edgeType: 'SYNC', sourceNodeId: 'a', targetNodeId: 'b', label: '请求', seq: 100 },
    { edgeType: 'ASYNC', sourceNodeId: 'b', targetNodeId: 'b', label: '自消息', seq: -99 },
    { edgeType: 'RETURN', sourceNodeId: 'b', targetNodeId: 'a', seq: 'ignored' },
  ],
})
async function create(kind = 'USECASE', content: object = {}) {
  const res = await clients.pm.post(collection()).send({ title: '图稿', kind, ...content })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body
}
beforeAll(async () => {
  ctx = await createHttpTestContext()
  setActiveDatabase(ctx.db)
  if (!ctx.app.hasRoute({ method: 'POST', url: '/projects/:projectId/uml-diagrams' })) registerUmlRoutes(ctx.app, { prisma: ctx.db })
  await ctx.app.ready()
})
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => {
  await ctx.reset()
  pm = (await makeUser('uml-pm@example.invalid')).id
  member = (await makeUser('uml-member@example.invalid')).id
  viewer = (await makeUser('uml-viewer@example.invalid')).id
  outsider = (await makeUser('uml-outsider@example.invalid')).id
  projectId = (await makeProject(pm, 'UML HTTP 隔离测试')).projectId
  await makeMember(projectId, member, 'MEMBER')
  await makeMember(projectId, viewer, 'VIEWER')
  goalId = await makeGoal(projectId)
  activityId = await makeActivity(goalId)
  storyId = await makeStory(activityId)
  taskId = await makeTask(storyId, member, pm)
  clients = {
    pm: ctx.asUser(ctx.loginAs(pm)), member: ctx.asUser(ctx.loginAs(member)),
    viewer: ctx.asUser(ctx.loginAs(viewer)), outsider: ctx.asUser(ctx.loginAs(outsider)), anonymous: ctx.asUser(null),
  }
})

describe('US-15 PM persistence, wire format and transaction semantics', () => {
  it('creates real use-case content, fresh node ids, refs of all four kinds, and reads identical saved content', async () => {
    const saved = await create('USECASE', { ...usecase(), goalIds: [goalId, goalId], activityIds: [activityId], storyIds: [storyId], taskIds: [taskId, taskId] })
    expect(saved).toMatchObject({ kind: 'USECASE', ownerUserId: pm, goalCount: 1, activityCount: 1, storyCount: 1, taskCount: 1 })
    expect(saved.nodes).toHaveLength(3)
    expect(saved.nodes.every((n: { id: string }) => !['actor', 'case', 'case2'].includes(n.id))).toBe(true)
    expect(saved.edges.every((e: { seq: unknown }) => e.seq === null)).toBe(true)
    expect(saved.taskRefs).toEqual([expect.objectContaining({ id: taskId, storyId })])
    expect(saved.storyRefs).toEqual([expect.objectContaining({ id: storyId, activityId })])
    expect(saved.goalRefs).toEqual([expect.objectContaining({ id: goalId })])
    expect(saved.activityRefs).toEqual([expect.objectContaining({ id: activityId, goalId })])
    for (const edge of saved.edges) expect(saved.nodes.map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining([edge.sourceNodeId, edge.targetNodeId]))
    const loaded = await clients.pm.get(detail(saved.id))
    expect(loaded.status).toBe(200)
    expect(loaded.body).toEqual(saved)
    expect(saved).not.toHaveProperty('goals')
    expect(saved).not.toHaveProperty('owner')
  })
  it('treats another diagram real node id as a new local alias; cross-graph edge references do not update or expose the original graph', async () => {
    const original = await create('USECASE', usecase())
    const alias = original.nodes.find((n: { nodeType: string }) => n.nodeType === 'ACTOR').id
    const content = usecase()
    content.nodes[0]!.id = alias
    content.edges[0]!.sourceNodeId = alias
    const second = await create('USECASE', content)
    expect(second.nodes.map((n: { id: string }) => n.id)).not.toContain(alias)
    expect((await clients.pm.get(detail(original.id))).body).toEqual(original)
    const cross = await clients.pm.put(`${detail(second.id)}/content`).send({ ...usecase(), edges: [{ edgeType: 'ASSOCIATION', sourceNodeId: alias, targetNodeId: 'case' }] })
    const missing = await clients.pm.put(`${detail(second.id)}/content`).send({ ...usecase(), edges: [{ edgeType: 'ASSOCIATION', sourceNodeId: 'missing', targetNodeId: 'case' }] })
    expect(cross.status).toBe(422)
    expect(cross.body).toEqual(missing.body)
    expect((await clients.pm.get(detail(second.id))).body).toEqual(second)
    expect((await clients.pm.get(detail(original.id))).body).toEqual(original)
  })
  it('assigns seq by array order, accepts self messages, ignores client seq and sorts lifelines by orderIndex', async () => {
    const saved = await create('SEQUENCE', sequence())
    expect(saved.edges.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3])
    expect(saved.edges[1].sourceNodeId).toBe(saved.edges[1].targetNodeId)
    expect(saved.nodes.map((n: { name: string }) => n.name)).toEqual(['服务端', '客户端'])
    const changed = sequence()
    changed.edges = [changed.edges[2]!, changed.edges[0]!]
    const put = await clients.pm.put(`${detail(saved.id)}/content`).send(changed)
    expect(put.status).toBe(200)
    expect(put.body.edges.map((e: { seq: number; edgeType: string }) => [e.seq, e.edgeType])).toEqual([[1, 'RETURN'], [2, 'SYNC']])
    expect((await clients.pm.get(detail(saved.id))).body).toEqual(put.body)
  })
  it('PATCH only replaces specified associations; [] clears; owner transfer does not grant UML write', async () => {
    const saved = await create('USECASE', { taskIds: [taskId], storyIds: [storyId], ...usecase() })
    const patch = await clients.pm.patch(detail(saved.id)).send({ title: '新标题', taskIds: [], ownerUserId: viewer })
    expect(patch.status).toBe(200)
    expect(patch.body).toMatchObject({ title: '新标题', taskRefs: [], ownerUserId: viewer, storyCount: 1 })
    expect(patch.body.nodes).toEqual(saved.nodes)
    expect((await clients.viewer.put(`${detail(saved.id)}/content`).send({ nodes: [], edges: [] })).status).toBe(403)
  })
  it('rejects unknown PATCH fields and changing kind; metadata cannot masquerade as content replacement', async () => {
    const saved = await create()
    for (const patch of [{ kind: 'SEQUENCE' }, { projectId: 'other' }, { nodes: [] }, { isSensitive: false }]) {
      expect((await clients.pm.patch(detail(saved.id)).send(patch)).status).toBe(422)
    }
    expect((await clients.pm.get(detail(saved.id))).body).toEqual(saved)
  })
  it('PUT accepts an empty document and removes previous content atomically', async () => {
    const saved = await create('USECASE', usecase())
    const put = await clients.pm.put(`${detail(saved.id)}/content`).send({ nodes: [], edges: [] })
    expect(put.status).toBe(200)
    expect(put.body.nodes).toEqual([])
    expect(put.body.edges).toEqual([])
    expect((await clients.pm.get(detail(saved.id))).body).toEqual(put.body)
  })
  it('deletes diagram and subsequent GET/PATCH/PUT/DELETE all return the same nonexistent response', async () => {
    const saved = await create('USECASE', { ...usecase(), goalIds: [goalId], activityIds: [activityId], storyIds: [storyId], taskIds: [taskId] })
    const deleted = await clients.pm.delete(detail(saved.id))
    expect(deleted.status).toBe(204)
    expect(deleted.text).toBe('')
    const responses = [await clients.pm.get(detail(saved.id)), await clients.pm.patch(detail(saved.id)).send({ title: '无' }),
      await clients.pm.put(`${detail(saved.id)}/content`).send({ nodes: [], edges: [] }), await clients.pm.delete(detail(saved.id))]
    for (const response of responses) { expect(response.status).toBe(404); expect(response.body).toEqual(responses[0]!.body) }
    expect((await clients.pm.get(collection())).body).toMatchObject({ items: [], total: 0, truncated: false })
  })
  it('list has no diagram content/ref titles and kind filter and total use the same where', async () => {
    await create('USECASE', { ...usecase(), taskIds: [taskId] })
    await create('SEQUENCE', sequence())
    const all = await clients.pm.get(collection())
    expect(all.status).toBe(200)
    expect(all.body).toMatchObject({ total: 2, truncated: false })
    expect(all.body.items).toHaveLength(2)
    for (const row of all.body.items) for (const key of ['nodes', 'edges', 'taskRefs', 'storyRefs', 'tasks']) expect(row).not.toHaveProperty(key)
    const filtered = await clients.pm.get(`${collection()}?kind=SEQUENCE`)
    expect(filtered.body).toMatchObject({ total: 1, truncated: false })
    expect(filtered.body.items.map((x: { kind: string }) => x.kind)).toEqual(['SEQUENCE'])
    expect((await clients.pm.get(`${collection()}?kind=CLASS`)).status).toBe(422)
  })
  it('reports exact total when list is truncated, not length-derived total', async () => {
    await ctx.db.umlDiagram.createMany({ data: Array.from({ length: 201 }, (_, i) => ({ projectId, ownerUserId: pm, kind: 'USECASE', title: `图${i}` })) })
    const res = await clients.pm.get(collection())
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 201, truncated: true })
    expect(res.body.items).toHaveLength(200)
  })
  it('concurrent whole-content replacement yields complete winner, never a mixed graph or 500', async () => {
    const saved = await create('SEQUENCE', sequence())
    const a = sequence(), b = sequence()
    a.nodes.forEach(n => { n.name = `A-${n.name}` })
    b.nodes.forEach(n => { n.name = `B-${n.name}` })
    const responses = await Promise.all([clients.pm.put(`${detail(saved.id)}/content`).send(a), clients.pm.put(`${detail(saved.id)}/content`).send(b)])
    for (const response of responses) expect([200, 409], JSON.stringify(response.body)).toContain(response.status)
    expect(responses.some(r => r.status === 200)).toBe(true)
    const loaded = await clients.pm.get(detail(saved.id))
    expect(loaded.status).toBe(200)
    const prefix = loaded.body.nodes[0].name.slice(0, 1)
    expect(['A', 'B']).toContain(prefix)
    expect(loaded.body.nodes.every((n: { name: string }) => n.name.startsWith(prefix))).toBe(true)
    expect(loaded.body.edges.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3])
  })
})

describe('US-15 rejected writes leave the prior saved graph intact', () => {
  it.each([
    ['unsupported kind', { kind: 'CLASS' }], ['blank title', { title: ' ' }], ['oversized title', { title: 'x'.repeat(101) }],
    ['oversized description', { description: 'x'.repeat(201) }],
    ['too many nodes', { nodes: Array.from({ length: 201 }, () => ({ nodeType: 'ACTOR', name: 'a' })) }],
    ['too many edges', { edges: Array.from({ length: 501 }, () => ({ edgeType: 'ASSOCIATION', sourceNodeId: 'a', targetNodeId: 'b' })) }],
    ['oversized refs', { goalIds: Array.from({ length: 51 }, () => 'missing') }],
    ['unknown create field', { x: 1 }],
  ])('rejects %s without creating a diagram', async (_name, input) => {
    expect((await clients.pm.post(collection()).send({ kind: 'USECASE', title: '图', ...input })).status).toBe(422)
    expect((await clients.pm.get(collection())).body.total).toBe(0)
  })
  it.each([
    ['wrong node kind', { nodes: [{ id: 'a', nodeType: 'LIFELINE', name: 'n' }], edges: [] }, 422],
    ['blank node', { nodes: [{ id: 'a', nodeType: 'ACTOR', name: ' ' }], edges: [] }, 422],
    ['unsupported enum', { nodes: [{ id: 'a', nodeType: 'CLASS', name: 'n' }], edges: [] }, 422],
    ['duplicate node ids', { nodes: [{ id: 'a', nodeType: 'ACTOR', name: 'a' }, { id: 'a', nodeType: 'USECASE', name: 'b' }], edges: [] }, 422],
    ['missing source', { ...usecase(), edges: [{ edgeType: 'INCLUDE', sourceNodeId: 'absent', targetNodeId: 'case' }] }, 422],
    ['self include', { ...usecase(), edges: [{ edgeType: 'INCLUDE', sourceNodeId: 'case', targetNodeId: 'case' }] }, 422],
    ['case-case association', { ...usecase(), edges: [{ edgeType: 'ASSOCIATION', sourceNodeId: 'case', targetNodeId: 'case2' }] }, 422],
    ['actor include', { ...usecase(), edges: [{ edgeType: 'INCLUDE', sourceNodeId: 'actor', targetNodeId: 'case' }] }, 422],
    ['wrong edge kind', { ...usecase(), edges: [{ edgeType: 'SYNC', sourceNodeId: 'actor', targetNodeId: 'case' }] }, 422],
    ['usecase seq', { ...usecase(), edges: [{ ...usecase().edges[0], seq: 1 }] }, 422],
    ['duplicate relationship', { ...usecase(), edges: [usecase().edges[0], usecase().edges[0]] }, 409],
    ['oversized name', { nodes: [{ nodeType: 'ACTOR', name: 'x'.repeat(101) }], edges: [] }, 422],
    ['oversized edge label', { ...usecase(), edges: [{ ...usecase().edges[0], label: 'x'.repeat(101) }] }, 422],
    ['client coordinates', { nodes: [{ nodeType: 'ACTOR', name: 'a', x: 20 }], edges: [] }, 422],
  ])('rejects %s on PUT and preserves content', async (_name, input, status) => {
    const saved = await create('USECASE', usecase())
    const res = await clients.pm.put(`${detail(saved.id)}/content`).send(input)
    expect(res.status, JSON.stringify(res.body)).toBe(status)
    expect(res.body.error.code).toBe(status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED')
    expect((await clients.pm.get(detail(saved.id))).body).toEqual(saved)
  })
  it.each(['goalIds', 'activityIds', 'storyIds', 'taskIds'] as const)('cross-project and missing %s return identical 422; failed PATCH rolls back metadata/refs', async field => {
    const other = (await makeProject(outsider)).projectId
    const g = await makeGoal(other), a = await makeActivity(g), s = await makeStory(a), t = await makeTask(s, outsider, pm)
    const otherIds = { goalIds: g, activityIds: a, storyIds: s, taskIds: t }
    const saved = await create('USECASE', { goalIds: [goalId], taskIds: [taskId] })
    const cross = await clients.pm.patch(detail(saved.id)).send({ title: '不能留下此改名', goalIds: [], [field]: [otherIds[field]] })
    const missing = await clients.pm.patch(detail(saved.id)).send({ title: '不能留下此改名', goalIds: [], [field]: ['missing'] })
    expect(cross.status).toBe(422)
    expect(missing.body).toEqual(cross.body)
    expect(cross.body.error.details).toEqual([{ field, code: 'CROSS_PROJECT_REF' }])
    expect((await clients.pm.get(detail(saved.id))).body).toEqual(saved)
  })
  it('rejects owner outside project and leaves metadata unchanged', async () => {
    const saved = await create()
    const res = await clients.pm.patch(detail(saved.id)).send({ ownerUserId: outsider })
    expect(res.status).toBe(422)
    expect(res.body.error.details).toEqual([{ field: 'ownerUserId', code: 'NOT_PROJECT_MEMBER' }])
    expect((await clients.pm.get(detail(saved.id))).body).toEqual(saved)
  })
})

describe('US-15 real authorization seam; pending reader policy explicitly fail-closed', () => {
  it.each(['member', 'viewer', 'outsider', 'anonymous'] as const)('%s cannot write through any UML endpoint', async identity => {
    const saved = await create('USECASE', usecase())
    const c = clients[identity]
    const expected = identity === 'anonymous' ? 401 : identity === 'outsider' ? 404 : 403
    const responses = [await c.post(collection()).send({ title: '越权', kind: 'USECASE' }),
      await c.patch(detail(saved.id)).send({ title: '越权' }), await c.put(`${detail(saved.id)}/content`).send({ nodes: [], edges: [] }), await c.delete(detail(saved.id))]
    for (const response of responses) expect(response.status, JSON.stringify(response.body)).toBe(expected)
    expect((await clients.pm.get(detail(saved.id))).body).toEqual(saved)
  })
  it('anonymous cannot list/detail; outsider existing id and missing id have identical 404 envelopes', async () => {
    const saved = await create()
    expect((await clients.anonymous.get(collection())).status).toBe(401)
    expect((await clients.anonymous.get(detail(saved.id))).status).toBe(401)
    for (const identity of ['outsider', 'member', 'viewer'] as const) {
      const hidden = await clients[identity].get(detail(saved.id)), missing = await clients[identity].get(detail('missing'))
      expect(hidden.status).toBe(404)
      expect(hidden.body).toEqual(missing.body)
    }
    expect((await clients.outsider.get(collection())).status).toBe(404)
    const existingWrites = [await clients.outsider.patch(detail(saved.id)).send({ title: 'x' }),
      await clients.outsider.put(`${detail(saved.id)}/content`).send({ nodes: [], edges: [] }), await clients.outsider.delete(detail(saved.id))]
    const absentWrites = [await clients.outsider.patch(detail('missing')).send({ title: 'x' }),
      await clients.outsider.put(`${detail('missing')}/content`).send({ nodes: [], edges: [] }), await clients.outsider.delete(detail('missing'))]
    existingWrites.forEach((res, i) => { expect(res.status).toBe(404); expect(res.body).toEqual(absentWrites[i]!.body) })
  })
  it('TEMPORARY fail-closed reader scope is empty with total=0 even for ordinary/unassociated diagrams', async () => {
    await create()
    for (const identity of ['member', 'viewer'] as const) {
      const res = await clients[identity].get(collection())
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ items: [], total: 0, truncated: false })
    }
  })
  it('does not automatically disclose old sensitive diagram text after real task delete Cascade or unlink', async () => {
    const secretTask = await makeTask(storyId, pm, member, { isSensitive: true, title: '测试敏感任务' })
    const saved = await create('USECASE', { title: '保留敏感内容', taskIds: [secretTask] })
    expect((await clients.viewer.get(detail(saved.id))).status).toBe(404)
    const deleted = await clients.pm.delete(`/tasks/${secretTask}`)
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(204)
    expect((await clients.pm.get(detail(saved.id))).body.taskRefs).toEqual([])
    expect((await clients.viewer.get(detail(saved.id))).status).toBe(404)
    expect((await clients.member.get(detail(saved.id))).status).toBe(404)
    const saved2 = await create('USECASE', { taskIds: [taskId] })
    expect((await clients.pm.patch(detail(saved2.id)).send({ taskIds: [] })).status).toBe(200)
    expect((await clients.viewer.get(detail(saved2.id))).status).toBe(404)
  })
  it.todo('AC5 MEMBER/VIEWER may read ordinary visible diagrams (blocked by durable guard design, not accepted)')
  it.todo('AC5 whitelist member can read sensitive-associated diagrams, intersection rejects any hidden ref')
  it.todo('AC5 preserve durable historical restrictions after Cascade/unlink while ordinary diagrams remain readable')
})
