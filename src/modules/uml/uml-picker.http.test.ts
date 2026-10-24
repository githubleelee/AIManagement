/** Existing authenticated HTTP lists are the picker seam; no mocked business services. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHttpTestContext, setActiveDatabase, type HttpTestContext } from '../../../test/helpers.js'
import { makeActivity, makeGoal, makeMember, makeProject, makeStory, makeTask, makeUser } from '../../../test/factories.js'
import { parseReferenceOptions } from '../../../web/src/pages/uml/reference-options.js'
let ctx: HttpTestContext
let pm: string, viewer: string, outsider: string, projectId: string
let goal: string, activity: string, story: string, task: string, secretStory: string, secretTask: string
beforeAll(async () => { ctx = await createHttpTestContext(); setActiveDatabase(ctx.db); await ctx.app.ready() })
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => {
  await ctx.reset()
  pm = (await makeUser('picker-pm@example.invalid')).id
  viewer = (await makeUser('picker-viewer@example.invalid')).id
  outsider = (await makeUser('picker-outsider@example.invalid')).id
  projectId = (await makeProject(pm)).projectId
  await makeMember(projectId, viewer, 'VIEWER')
  goal = await makeGoal(projectId, '同名目标')
  activity = await makeActivity(goal, '真实活动')
  story = await makeStory(activity, { title: '普通故事' })
  task = await makeTask(story, viewer, pm, { title: '普通任务' })
  secretStory = await makeStory(activity, { title: '合成敏感故事', isSensitive: true })
  secretTask = await makeTask(story, pm, viewer, { title: '合成敏感任务', isSensitive: true })
})
async function lists(user: string | null, project = projectId) {
  const client = ctx.asUser(user === null ? null : ctx.loginAs(user))
  return Promise.all([client.get(`/projects/${project}/goals`), client.get(`/projects/${project}/tasks`)])
}
describe('US-15 picker consumes real project-scoped lists', () => {
  it('PM gets all four candidate types, hierarchy labels, unique ids and no other project objects', async () => {
    const other = (await makeProject(outsider)).projectId
    const otherGoal = await makeGoal(other, '另一个项目目标')
    const [goals, tasks] = await lists(pm)
    expect(goals.status).toBe(200); expect(tasks.status).toBe(200)
    const options = parseReferenceOptions(projectId, goals.body, tasks.body)
    expect(options.goalIds.map(x => x.id)).toEqual([goal])
    expect(options.activityIds).toEqual([{ id: activity, label: '同名目标 / 真实活动' }])
    expect(options.storyIds.map(x => x.id)).toEqual(expect.arrayContaining([story, secretStory]))
    expect(options.taskIds.map(x => x.id)).toEqual(expect.arrayContaining([task, secretTask]))
    expect(JSON.stringify(options)).not.toContain(otherGoal)
  })
  it('VIEWER candidates honor story and task visibility at the actual HTTP boundary', async () => {
    const [goals, tasks] = await lists(viewer)
    expect(goals.status).toBe(200); expect(tasks.status).toBe(200)
    const options = parseReferenceOptions(projectId, goals.body, tasks.body)
    expect(options.storyIds.map(x => x.id)).toEqual([story])
    expect(options.taskIds.map(x => x.id)).toEqual([task])
    expect(JSON.stringify(options)).not.toContain('合成敏感')
  })
  it('a real empty project has four empty candidate collections', async () => {
    const empty = (await makeProject(pm)).projectId
    const [goals, tasks] = await lists(pm, empty)
    expect(parseReferenceOptions(empty, goals.body, tasks.body)).toEqual({ goalIds: [], activityIds: [], storyIds: [], taskIds: [] })
  })
  it.each([null, 'outsider'] as const)('%s cannot load candidate objects', async who => {
    const responses = await lists(who === null ? null : outsider)
    for (const response of responses) {
      expect(response.status).toBe(who === null ? 401 : 404)
      expect(response.body).not.toHaveProperty('items')
    }
  })
  it('adapter refuses a successful but wrong-project HTTP projection rather than displaying its names', async () => {
    const [goals, tasks] = await lists(pm)
    expect(() => parseReferenceOptions('different-project', goals.body, tasks.body)).toThrow('不属于当前项目')
  })
})
