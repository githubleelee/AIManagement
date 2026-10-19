/**
 * US-06 甘特图（GitHub #26，本地 #11）—— 聚合读端点模块测试。
 *
 * 唯一 seam 是 HTTP 接口层（契约 Testing Decisions）：全部通过 supertest 发请求、
 * 断言状态码与响应体，不断言内部实现。造数用 `test/factories.ts`（直接写库）与
 * 局部 seed 辅助（里程碑 / 依赖 / 任意状态任务，工厂不覆盖），验证一律走 HTTP。
 *
 * 覆盖（对应主代理下发的用例清单）：
 *   - PM 看到全项目故事 / 任务 / 里程碑 / 依赖，`basis='全项目'`；
 *   - MEMBER 只看可见范围：敏感任务、「仅由隐藏任务关联的里程碑」、
 *     「含隐藏任务端点的依赖边」都不出现；
 *   - 未授权敏感故事不出现（含其下任务不泄漏）；被指名的敏感故事可见；
 *   - 空项目返回空数组而非报错；
 *   - `aggregation='candidate-minmax'`（日期仍为候选）；故事进度按 C10 口径计算
 *     （DECISIONS `analytics.story-progress-aggregation`）：`progressState='computed'`，
 *     `progress = { closed, total, ratio }`，`DONE` 不计入分子，无任务 → `null`；
 *   - `dependencies.state === 'ok'`（本批数据源始终可用，不造假 unavailable）；
 *   - 故事日期 = 可见任务的 min/max；无任务 → null；排序符合契约；
 *   - 截断：任务 500 / 里程碑 200 / 依赖 500 上限置 `truncated` 标记；
 *   - outsider / 外项目 / 不存在项目 → 404，响应逐字一致（`项目不存在`）。
 *
 * ⚠️ 公共挂载由主代理另批完成：`src/routes.ts` 尚未注册本插件，因此本测试在
 *    `createHttpTestContext()` 之后自行注册，并保留 `hasRoute` 守卫，
 *    待挂载后不会重复注册（Fastify 重复注册会抛 FST_ERR_DUPLICATED_ROUTE）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  setActiveDatabase,
  type HttpTestContext,
} from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeSensitive,
  makeUser,
} from '../../../test/factories.js'
import type { StoryStatus, TaskStatus, UserBrief } from '../../shared/types.js'
import { registerGanttRoutes } from './plugin.js'
import {
  GANTT_DEPENDENCY_LIMIT,
  GANTT_MILESTONE_LIMIT,
  GANTT_TASK_LIMIT,
} from './service.js'
import type { GanttStoryItem, GanttView } from './types.js'

let ctx: HttpTestContext
let pm: UserBrief
let member: UserBrief
let viewer: UserBrief
let outsider: UserBrief
let projectId: string
let activityId: string

beforeAll(async () => {
  ctx = await createHttpTestContext()
  setActiveDatabase(ctx.db)
  if (!ctx.app.hasRoute({ method: 'GET', url: '/projects/:projectId/gantt' })) {
    registerGanttRoutes(ctx.app, { prisma: ctx.db })
  }
  await ctx.app.ready()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pm = await makeUser('pm@example.com', 'Dave')
  member = await makeUser('member@example.com', 'Alice')
  viewer = await makeUser('viewer@example.com', 'Carol')
  outsider = await makeUser('outsider@example.com', 'Outsider')

  const created = await makeProject(pm.id, '甘特聚合测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  activityId = await makeActivity(goalId, '活动')

  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

// ---------------------------------------------------------------------------
// 造数辅助（直接写库；工厂不覆盖任意状态 / 日期 / 里程碑 / 依赖）
// ---------------------------------------------------------------------------

type SeedStoryInput = {
  title?: string
  status?: StoryStatus
  isSensitive?: boolean
  createdAt?: Date
  projectId?: string
  activityId?: string
}

async function seedStory(input: SeedStoryInput = {}): Promise<string> {
  const row = await ctx.db.userStory.create({
    data: {
      projectId: input.projectId ?? projectId,
      activityId: input.activityId ?? activityId,
      title: input.title ?? '故事',
      roleText: '角色',
      capabilityText: '能力',
      valueText: '价值',
      businessValue: '业务价值',
      priority: 'P0',
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.isSensitive === undefined ? {} : { isSensitive: input.isSensitive }),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  })
  return row.id
}

type SeedTaskInput = {
  storyId: string
  ownerUserId: string
  title?: string
  status?: TaskStatus
  planStart?: string
  planEnd?: string
  isSensitive?: boolean
  createdAt?: Date
}

async function seedTask(input: SeedTaskInput): Promise<string> {
  const row = await ctx.db.task.create({
    data: {
      projectId,
      storyId: input.storyId,
      title: input.title ?? '任务',
      description: null,
      ownerUserId: input.ownerUserId,
      acceptorUserId: input.ownerUserId === pm.id ? member.id : pm.id,
      planStart: input.planStart ?? '2026-01-01',
      planEnd: input.planEnd ?? '2026-01-02',
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.isSensitive === undefined ? {} : { isSensitive: input.isSensitive }),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  })
  return row.id
}

async function seedMilestone(input: {
  name: string
  dueDate: string
  ownerUserId?: string | null
}): Promise<string> {
  const row = await ctx.db.milestone.create({
    data: {
      projectId,
      name: input.name,
      dueDate: input.dueDate,
      ...(input.ownerUserId === undefined ? {} : { ownerUserId: input.ownerUserId }),
    },
    select: { id: true },
  })
  return row.id
}

async function linkTaskMilestone(taskId: string, milestoneId: string): Promise<void> {
  await ctx.db.taskMilestone.create({ data: { taskId, milestoneId } })
}

async function seedDependency(predecessorTaskId: string, successorTaskId: string): Promise<string> {
  const row = await ctx.db.taskDependency.create({
    data: { projectId, predecessorTaskId, successorTaskId },
    select: { id: true },
  })
  return row.id
}

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

function getGantt(actorUserId: string, project = projectId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${project}/gantt`)
}

async function fetchGantt(actorUserId: string): Promise<GanttView> {
  const res = await getGantt(actorUserId)
  expect(res.status).toBe(200)
  return res.body as GanttView
}

function storyById(view: GanttView, id: string): GanttStoryItem {
  const story = view.stories.find((s) => s.id === id)
  if (!story) throw new Error(`响应里缺少故事 ${id}`)
  return story
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('GET /projects/:projectId/gantt —— PM 全项目口径', () => {
  it('PM 看到全项目故事 / 任务 / 里程碑 / 依赖，basis=全项目', async () => {
    const s1 = await seedStory({ title: '故事一', createdAt: new Date('2026-01-01T00:00:00Z') })
    const s2 = await seedStory({ title: '故事二', createdAt: new Date('2026-01-02T00:00:00Z') })
    const t1 = await seedTask({
      storyId: s1,
      ownerUserId: member.id,
      title: '任务一',
      planStart: '2026-01-01',
      planEnd: '2026-01-05',
    })
    const t2 = await seedTask({
      storyId: s1,
      ownerUserId: pm.id,
      title: '任务二',
      planStart: '2026-01-10',
      planEnd: '2026-01-20',
    })
    const t3 = await seedTask({
      storyId: s2,
      ownerUserId: member.id,
      title: '任务三',
      planStart: '2026-02-01',
      planEnd: '2026-02-03',
    })
    const m1 = await seedMilestone({ name: '里程碑一', dueDate: '2026-02-01', ownerUserId: null })
    const m2 = await seedMilestone({ name: '里程碑二', dueDate: '2026-01-15', ownerUserId: member.id })
    const m3 = await seedMilestone({ name: '无关联里程碑', dueDate: '2026-03-01' })
    await linkTaskMilestone(t1, m1)
    await linkTaskMilestone(t2, m2)
    const depId = await seedDependency(t1, t2)

    const view = await fetchGantt(pm.id)

    expect(view.projectId).toBe(projectId)
    expect(view.basis.scopeLabel).toBe('全项目')

    // 故事按 createdAt asc, id asc
    expect(view.stories.map((s) => s.id)).toEqual([s1, s2])

    // 故事日期 = 可见任务 min/max；日期仍是候选口径，进度已按 C10 口径计算
    const story1 = storyById(view, s1)
    expect(story1.planStart).toBe('2026-01-01')
    expect(story1.planEnd).toBe('2026-01-20')
    expect(story1.aggregation).toBe('candidate-minmax')
    expect(story1.progressState).toBe('computed')
    // 该故事 2 个任务均未关闭（默认 TODO）→ closed 0 / total 2 / ratio 0
    expect(story1.progress).toEqual({ closed: 0, total: 2, ratio: 0 })
    // 故事内任务按 planStart asc
    expect(story1.tasks.map((t) => t.id)).toEqual([t1, t2])
    expect(story1.tasks.map((t) => t.ownerDisplayName)).toEqual(['Alice', 'Dave'])
    expect(story1.tasks[0]?.milestoneIds).toEqual([m1])
    expect(story1.tasks[1]?.milestoneIds).toEqual([m2])
    // 任务行不含 isSensitive；字段形状固定
    expect(Object.keys(story1.tasks[0] ?? {}).sort()).toEqual([
      'id',
      'milestoneIds',
      'ownerDisplayName',
      'ownerUserId',
      'planEnd',
      'planStart',
      'status',
      'title',
    ])
    expect(storyById(view, s2).planStart).toBe('2026-02-01')

    // 里程碑按 dueDate asc：m2(01-15) → m1(02-01) → m3(03-01)
    expect(view.milestones.map((m) => m.id)).toEqual([m2, m1, m3])
    expect(view.milestones.map((m) => m.name)).toEqual(['里程碑二', '里程碑一', '无关联里程碑'])
    expect(view.milestones[0]?.ownerDisplayName).toBe('Alice')
    expect(view.milestones[0]?.taskIds).toEqual([t2])

    // 依赖：ok + 边数据
    expect(view.dependencies.state).toBe('ok')
    if (view.dependencies.state !== 'ok') throw new Error('unreachable')
    expect(view.dependencies.items).toEqual([
      { id: depId, predecessorTaskId: t1, successorTaskId: t2, type: 'FS' },
    ])

    expect(view.truncated).toEqual({ tasks: false, milestones: false, dependencies: false })
  })
})

describe('GET /projects/:projectId/gantt —— MEMBER 可见范围', () => {
  it('敏感任务、仅由隐藏任务关联的里程碑、含隐藏端点的依赖边都不出现', async () => {
    const s1 = await seedStory({ title: '可见故事' })
    const normal1 = await seedTask({
      storyId: s1,
      ownerUserId: member.id,
      title: '可见任务一',
      planStart: '2026-01-02',
      planEnd: '2026-01-06',
    })
    const normal2 = await seedTask({
      storyId: s1,
      ownerUserId: member.id,
      title: '可见任务二',
      planStart: '2026-01-03',
      planEnd: '2026-01-09',
    })
    const secret = await seedTask({
      storyId: s1,
      ownerUserId: member.id,
      title: '机密任务',
      // 极端日期：若被错误计入，故事 min/max 会变化，从而暴露
      planStart: '2020-01-01',
      planEnd: '2030-12-31',
      isSensitive: true,
    })
    await makeSensitive('task', secret, []) // 除 PM 外无人可见

    const mVisible = await seedMilestone({ name: '可见里程碑', dueDate: '2026-02-01' })
    const mHidden = await seedMilestone({ name: '隐藏里程碑', dueDate: '2026-02-02' })
    await linkTaskMilestone(normal1, mVisible)
    await linkTaskMilestone(secret, mHidden)

    const depVisible = await seedDependency(normal1, normal2)
    await seedDependency(normal2, secret) // 后继隐藏 → 不返回
    await seedDependency(secret, normal1) // 前驱隐藏 → 不返回

    const view = await fetchGantt(member.id)

    expect(view.basis.scopeLabel).toBe('可见范围')
    expect(view.stories.map((s) => s.id)).toEqual([s1])

    const story = storyById(view, s1)
    expect(story.tasks.map((t) => t.id)).toEqual([normal1, normal2])
    expect(story.tasks.map((t) => t.title)).not.toContain('机密任务')
    // 故事日期只由可见任务决定（机密任务的 2020–2030 不得泄漏）
    expect(story.planStart).toBe('2026-01-02')
    expect(story.planEnd).toBe('2026-01-09')

    expect(view.milestones.map((m) => m.id)).toEqual([mVisible])
    expect(view.milestones[0]?.taskIds).toEqual([normal1])

    expect(view.dependencies.state).toBe('ok')
    if (view.dependencies.state !== 'ok') throw new Error('unreachable')
    expect(view.dependencies.items.map((d) => d.id)).toEqual([depVisible])
  })

  it('未授权敏感故事不出现，其下任务也不经任何集合泄漏', async () => {
    const visibleStory = await seedStory({ title: '可见故事' })
    const visibleTask = await seedTask({ storyId: visibleStory, ownerUserId: member.id, title: '可见任务' })

    const secretStory = await seedStory({ title: '敏感故事' })
    // 任务本身不敏感，但所属故事不可见 → 冻结形状无安全落点，整体不返回
    const orphan = await seedTask({ storyId: secretStory, ownerUserId: member.id, title: '隐藏故事下任务' })
    await makeSensitive('story', secretStory, [])
    const orphanMilestone = await seedMilestone({ name: '隐藏里程碑', dueDate: '2026-02-01' })
    await linkTaskMilestone(orphan, orphanMilestone)
    await seedDependency(visibleTask, orphan)

    const view = await fetchGantt(member.id)

    expect(view.stories.map((s) => s.id)).toEqual([visibleStory])
    const allTaskIds = view.stories.flatMap((s) => s.tasks.map((t) => t.id))
    expect(allTaskIds).toEqual([visibleTask])
    expect(view.milestones).toEqual([])
    if (view.dependencies.state !== 'ok') throw new Error('unreachable')
    expect(view.dependencies.items).toEqual([])
  })

  it('被指名的敏感故事对该成员可见', async () => {
    const secretStory = await seedStory({ title: '共享敏感故事' })
    const task = await seedTask({ storyId: secretStory, ownerUserId: member.id, title: '任务' })
    await makeSensitive('story', secretStory, [member.id])

    const view = await fetchGantt(member.id)
    expect(view.stories.map((s) => s.id)).toEqual([secretStory])
    expect(storyById(view, secretStory).tasks.map((t) => t.id)).toEqual([task])
  })
})

describe('GET /projects/:projectId/gantt —— VIEWER 只读同口径', () => {
  it('VIEWER 得到「可见范围」，只含授权可见任务', async () => {
    const story = await seedStory({ title: '故事' })
    const normal = await seedTask({ storyId: story, ownerUserId: member.id, title: '普通' })
    const secret = await seedTask({
      storyId: story,
      ownerUserId: member.id,
      title: '机密',
      isSensitive: true,
    })
    await makeSensitive('task', secret, [viewer.id]) // 被指名 → 可见

    const view = await fetchGantt(viewer.id)
    expect(view.basis.scopeLabel).toBe('可见范围')
    const tasks = storyById(view, story).tasks
    expect(tasks.map((t) => t.id).sort()).toEqual([normal, secret].sort())
  })
})

describe('GET /projects/:projectId/gantt —— 故事进度（C10 口径）', () => {
  it('部分 CLOSED：closed / total / ratio 正确，且 DONE 只进分母不进分子', async () => {
    const story = await seedStory({ title: '混合状态故事' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'CLOSED', title: '已关闭' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'DONE', title: '待验收' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'DOING', title: '进行中' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'TODO', title: '未开始' })

    const s = storyById(await fetchGantt(pm.id), story)
    expect(s.progressState).toBe('computed')
    // 1 个 CLOSED ÷ 4 个任务；DONE 不进分子
    expect(s.progress).toEqual({ closed: 1, total: 4, ratio: 0.25 })
  })

  it('全部 CLOSED → ratio = 1', async () => {
    const story = await seedStory({ title: '全部关闭故事' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'CLOSED', title: 'A' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'CLOSED', title: 'B' })

    const s = storyById(await fetchGantt(pm.id), story)
    expect(s.progress).toEqual({ closed: 2, total: 2, ratio: 1 })
  })

  it('ratio 保留 4 位小数（与仪表盘同一取整）', async () => {
    const story = await seedStory({ title: '三分之一故事' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'CLOSED', title: 'A' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'TODO', title: 'B' })
    await seedTask({ storyId: story, ownerUserId: member.id, status: 'TODO', title: 'C' })

    const s = storyById(await fetchGantt(pm.id), story)
    // 1/3 → 0.3333（不是 0.33333333…，也不是 33%）
    expect(s.progress).toEqual({ closed: 1, total: 3, ratio: 0.3333 })
  })

  it('无任务 → progress 为 null（不显示 0%）', async () => {
    const story = await seedStory({ title: '空故事' })
    const s = storyById(await fetchGantt(pm.id), story)
    expect(s.progress).toBeNull()
  })

  it('MEMBER 只按可见任务计算：隐藏任务既不进分子也不进分母', async () => {
    const story = await seedStory({ title: '部分可见故事' })
    // 可见：1 CLOSED + 1 TODO → 1/2
    const visibleClosed = await seedTask({
      storyId: story,
      ownerUserId: member.id,
      status: 'CLOSED',
      title: '可见已关闭',
    })
    const visibleTodo = await seedTask({
      storyId: story,
      ownerUserId: member.id,
      status: 'TODO',
      title: '可见未开始',
    })
    // 隐藏：若被计入，分母会变成 4、ratio 变成 0.25，从而暴露
    const hiddenClosed = await seedTask({
      storyId: story,
      ownerUserId: member.id,
      status: 'CLOSED',
      title: '隐藏已关闭',
      isSensitive: true,
    })
    const hiddenTodo = await seedTask({
      storyId: story,
      ownerUserId: member.id,
      status: 'TODO',
      title: '隐藏未开始',
      isSensitive: true,
    })
    await makeSensitive('task', hiddenClosed, [])
    await makeSensitive('task', hiddenTodo, [])

    const memberView = await fetchGantt(member.id)
    expect(memberView.basis.scopeLabel).toBe('可见范围')
    const memberStory = storyById(memberView, story)
    expect(memberStory.tasks.map((t) => t.id)).toEqual([visibleClosed, visibleTodo])
    expect(memberStory.progress).toEqual({ closed: 1, total: 2, ratio: 0.5 })

    // PM 全项目：4 个任务、2 个 CLOSED → 0.5（分子分母同步变大，仍相等是巧合，故另断言 total）
    const pmStory = storyById(await fetchGantt(pm.id), story)
    expect(pmStory.progress).toEqual({ closed: 2, total: 4, ratio: 0.5 })
  })

  it('同一账号、同一任务集合：故事进度与仪表盘实际进度逐字段一致', async () => {
    // 构造两个故事：故事 A 部分关闭，故事 B 全关闭
    const storyA = await seedStory({ title: 'A' })
    const storyB = await seedStory({ title: 'B' })
    await seedTask({ storyId: storyA, ownerUserId: member.id, status: 'CLOSED' })
    await seedTask({ storyId: storyA, ownerUserId: member.id, status: 'DONE' })
    await seedTask({ storyId: storyA, ownerUserId: member.id, status: 'TODO' })
    await seedTask({ storyId: storyB, ownerUserId: member.id, status: 'CLOSED' })
    // 敏感任务：只对 PM 可见（用来区分 PM 全项目 与 MEMBER 可见范围两个集合）
    const secret = await seedTask({
      storyId: storyB,
      ownerUserId: member.id,
      status: 'TODO',
      isSensitive: true,
    })
    await makeSensitive('task', secret, [])

    for (const actor of [pm.id, member.id]) {
      const gantt = await fetchGantt(actor)
      const res = await ctx.asUser(ctx.loginAs(actor)).get(`/projects/${projectId}/dashboard`)
      expect(res.status).toBe(200)
      const dashboard = res.body as { progress: { closed: number; total: number; ratio: number | null } }

      // 本端点各故事进度之和 = 仪表盘（同一集合，按故事切分后仍相等）
      const closed = gantt.stories.reduce((sum, s) => sum + (s.progress?.closed ?? 0), 0)
      const total = gantt.stories.reduce((sum, s) => sum + (s.progress?.total ?? 0), 0)
      expect({ closed, total }).toEqual({ closed: dashboard.progress.closed, total: dashboard.progress.total })
      expect(total === 0 ? null : Math.round((closed / total) * 10_000) / 10_000).toBe(
        dashboard.progress.ratio,
      )
    }

    // 单故事口径也能对上仪表盘：故事 B（PM 全项目）2 个任务 1 个关闭 → 0.5
    const pmView = await fetchGantt(pm.id)
    expect(storyById(pmView, storyB).progress).toEqual({ closed: 1, total: 2, ratio: 0.5 })
    // MEMBER 看不到敏感任务：故事 B 只有 1 个任务、1 个关闭 → 1
    expect(storyById(await fetchGantt(member.id), storyB).progress).toEqual({
      closed: 1,
      total: 1,
      ratio: 1,
    })
  })
})

describe('GET /projects/:projectId/gantt —— 空态与字段口径', () => {
  it('空项目返回空数组而非报错；dependencies 恒为 ok', async () => {
    const view = await fetchGantt(pm.id)
    expect(view).toEqual({
      projectId,
      basis: { scopeLabel: '全项目' },
      stories: [],
      milestones: [],
      dependencies: { state: 'ok', items: [] },
      truncated: { tasks: false, milestones: false, dependencies: false },
    })
  })

  it('故事无可见任务 → 日期 null，进度 null（不是 0%）', async () => {
    const story = await seedStory({ title: '无任务故事' })
    const view = await fetchGantt(pm.id)
    const s = storyById(view, story)
    expect(s.planStart).toBeNull()
    expect(s.planEnd).toBeNull()
    expect(s.tasks).toEqual([])
    expect(s.aggregation).toBe('candidate-minmax')
    // 算不出来就不编数字：null，不是 { closed: 0, total: 0, ratio: 0 }
    expect(s.progress).toBeNull()
    expect(s.progressState).toBe('computed')
  })
})

describe('GET /projects/:projectId/gantt —— 上限截断', () => {
  it('任务超过 500 行：tasks 截断、truncated.tasks=true', async () => {
    const story = await seedStory({ title: '批量故事' })
    await ctx.db.task.createMany({
      data: Array.from({ length: GANTT_TASK_LIMIT + 5 }, (_, i) => ({
        projectId,
        storyId: story,
        title: `批量任务 ${String(i).padStart(3, '0')}`,
        ownerUserId: member.id,
        acceptorUserId: pm.id,
        planStart: '2026-01-01',
        planEnd: '2026-01-02',
      })),
    })

    const view = await fetchGantt(pm.id)
    expect(view.truncated.tasks).toBe(true)
    expect(storyById(view, story).tasks).toHaveLength(GANTT_TASK_LIMIT)
  })

  it('里程碑超过 200 行：milestones 截断、truncated.milestones=true', async () => {
    await ctx.db.milestone.createMany({
      data: Array.from({ length: GANTT_MILESTONE_LIMIT + 5 }, (_, i) => ({
        projectId,
        name: `里程碑 ${String(i).padStart(3, '0')}`,
        dueDate: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
      })),
    })

    const view = await fetchGantt(pm.id)
    expect(view.truncated.milestones).toBe(true)
    expect(view.milestones).toHaveLength(GANTT_MILESTONE_LIMIT)
    // 仍按 dueDate asc, id asc
    const dueDates = view.milestones.map((m) => m.dueDate)
    expect([...dueDates].sort()).toEqual(dueDates)
  })

  it('依赖超过 500 行：dependencies 截断、truncated.dependencies=true', async () => {
    const story = await seedStory({ title: '链条故事' })
    const total = GANTT_DEPENDENCY_LIMIT + 6
    await ctx.db.task.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        projectId,
        storyId: story,
        title: `链任务 ${String(i).padStart(3, '0')}`,
        ownerUserId: member.id,
        acceptorUserId: pm.id,
        planStart: '2026-01-01',
        planEnd: '2026-01-02',
      })),
    })
    const tasks = await ctx.db.task.findMany({ where: { projectId }, select: { id: true } })
    await ctx.db.taskDependency.createMany({
      data: tasks.slice(0, total - 1).map((task, i) => ({
        projectId,
        predecessorTaskId: task.id,
        successorTaskId: tasks[i + 1]?.id as string,
      })),
    })

    const view = await fetchGantt(pm.id)
    expect(view.truncated.dependencies).toBe(true)
    if (view.dependencies.state !== 'ok') throw new Error('unreachable')
    expect(view.dependencies.items).toHaveLength(GANTT_DEPENDENCY_LIMIT)
    const preds = view.dependencies.items.map((d) => d.predecessorTaskId)
    expect([...preds].sort()).toEqual(preds)
  })
})

describe('GET /projects/:projectId/gantt —— 隔离与 404', () => {
  async function notFoundBody(fetch: () => Promise<{ status: number; body: unknown }>) {
    const res = await fetch()
    expect(res.status).toBe(404)
    return res.body
  }

  it('outsider / 外项目成员 / 不存在的项目 → 404，且与「项目不存在」逐字一致', async () => {
    const baseline = await notFoundBody(() => getGantt(pm.id, 'no-such-project'))

    const byOutsider = await notFoundBody(() => getGantt(outsider.id))
    expect(byOutsider).toEqual(baseline)

    // 外项目：另一个项目的 PM，即便也是成员，对本项目仍 404
    const pm2 = await makeUser('pm2@example.com', 'Eve')
    await makeProject(pm2.id, '另一个项目')
    const byForeign = await notFoundBody(() => getGantt(pm2.id))
    expect(byForeign).toEqual(baseline)

    expect(baseline).toMatchObject({ error: { code: 'NOT_FOUND', message: '项目不存在' } })
  })

  it('未登录 → 401', async () => {
    const res = await ctx.asUser(null).get(`/projects/${projectId}/gantt`)
    expect(res.status).toBe(401)
  })

  it('不混入他项目数据', async () => {
    const pm2 = await makeUser('pm2@example.com', 'Eve')
    const other = await makeProject(pm2.id, '另一个项目')
    const otherGoal = await makeGoal(other.projectId, '别的目标')
    const otherActivity = await makeActivity(otherGoal, '别的活动')
    const otherStory = await ctx.db.userStory.create({
      data: {
        projectId: other.projectId,
        activityId: otherActivity,
        title: '别的故事',
        roleText: 'r',
        capabilityText: 'c',
        valueText: 'v',
        businessValue: 'bv',
        priority: 'P0',
      },
      select: { id: true },
    })

    const view = await fetchGantt(pm.id)
    expect(view.stories.map((s) => s.id)).not.toContain(otherStory.id)
  })
})
