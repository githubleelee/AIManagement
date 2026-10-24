/** Real sensitivity HTTP + UML reader integration. B owns the setter; C owns these read-side regressions. */
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { createHttpTestContext, setActiveDatabase, type HttpTestContext } from '../../../test/helpers.js'
import { makeUser, makeProject, makeMember, makeGoal, makeActivity, makeStory, makeTask } from '../../../test/factories.js'
import { registerUmlRoutes } from './plugin.js'
let ctx: HttpTestContext
let pm: string, member: string, viewer: string, projectId: string, activityId: string
beforeAll(async () => {
  ctx = await createHttpTestContext(); setActiveDatabase(ctx.db)
  if (!ctx.app.hasRoute({ method: 'POST', url: '/projects/:projectId/uml-diagrams' })) registerUmlRoutes(ctx.app, { prisma: ctx.db })
  await ctx.app.ready()
})
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => {
  await ctx.reset()
  pm = (await makeUser('late-pm@example.invalid')).id
  member = (await makeUser('late-member@example.invalid')).id
  viewer = (await makeUser('late-viewer@example.invalid')).id
  projectId = (await makeProject(pm)).projectId
  await makeMember(projectId, member, 'MEMBER'); await makeMember(projectId, viewer, 'VIEWER')
  activityId = await makeActivity(await makeGoal(projectId))
})
describe('US-15 write-side sticky propagation consumed by actual UML readers', () => {
  it.each([
    ['task', false], ['task', true], ['story', false], ['story', true],
  ] as const)('%s sensitivity before-link=%s stays hidden through whitelist, ordinary transition, unlink and Cascade', async (kind, beforeLink) => {
    const client = ctx.asUser(ctx.loginAs(pm))
    const storyId = await makeStory(activityId)
    const id = kind === 'task' ? await makeTask(storyId, member, pm) : storyId
    const refField = kind === 'task' ? 'taskIds' : 'storyIds'
    const target = `/${kind === 'task' ? 'tasks' : 'stories'}/${id}`
    const mark = async (isSensitive: boolean) => {
      const response = await client.put(`${target}/sensitivity`).send({ isSensitive, visibleMemberIds: [member, viewer] })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
    }
    if (beforeLink) await mark(true)
    const diagrams: string[] = []
    for (let i = 0; i < 2; i++) {
      const created = await client.post(`/projects/${projectId}/uml-diagrams`).send({ title: '合成历史保护图', kind: 'USECASE', [refField]: [id] })
      expect(created.status).toBe(201); diagrams.push(created.body.id)
      if (!beforeLink) expect((await ctx.asUser(ctx.loginAs(viewer)).get(`/uml-diagrams/${created.body.id}`)).status).toBe(200)
    }
    if (!beforeLink) await mark(true)
    async function assertHidden() {
      for (const actor of [member, viewer]) {
        const reader = ctx.asUser(ctx.loginAs(actor))
        const missing = await reader.get('/uml-diagrams/nonexistent')
        for (const diagram of diagrams) {
          const result = await reader.get(`/uml-diagrams/${diagram}`)
          expect(result.status).toBe(404); expect(result.body).toEqual(missing.body)
          expect((await client.get(`/uml-diagrams/${diagram}`)).status).toBe(200)
        }
        expect((await reader.get(`/projects/${projectId}/uml-diagrams`)).body).toEqual({ items: [], total: 0, truncated: false })
      }
    }
    await assertHidden()
    await mark(false); await assertHidden()
    await mark(true)
    expect((await client.patch(`/uml-diagrams/${diagrams[0]}`).send({ [refField]: [], title: '解绑后仍保护', ownerUserId: viewer })).status).toBe(200)
    expect((await client.put(`/uml-diagrams/${diagrams[0]}/content`).send({ nodes: [], edges: [] })).status).toBe(200)
    expect((await client.delete(target)).status).toBe(204)
    await assertHidden()
    const ordinary = await client.post(`/projects/${projectId}/uml-diagrams`).send({ title: '真正新建空图', kind: 'USECASE' })
    expect(ordinary.status).toBe(201)
    expect((await ctx.asUser(ctx.loginAs(viewer)).get(`/uml-diagrams/${ordinary.body.id}`)).status).toBe(200)
  })
})
