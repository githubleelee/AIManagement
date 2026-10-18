/**
 * US-07 成员任务图与负载（GitHub #27）—— 模块测试。
 *
 * 唯一 seam 是 HTTP 接口层（契约 Testing Decisions）：全部通过 supertest 发请求、
 * 断言状态码与响应体，不断言内部实现。造数用 `test/factories.ts`（直接写库）、
 * 验证一律走 HTTP。
 *
 * 覆盖（对应工单要求）：
 *   - PM 全项目标签 + 各成员非 CLOSED 计数（含 DONE、排除 CLOSED）；
 *   - MEMBER 标签「可见范围」，未授权敏感任务不计入 / 不出现；
 *   - 被指名的敏感任务可见并计入；
 *   - VIEWER 只读同口径；
 *   - outsider / 外项目 / 不存在项目 → 404（响应逐字一致）；
 *   - 零任务成员 openTaskCount=0；
 *   - 跨项目任务不混入；
 *   - 详情端点 total 精确、CLOSED 被排除、排序、非成员 404、超出上限 truncated。
 *
 * ⚠️ 公共挂载由主代理另批完成（本地 #07）：`src/routes.ts` 尚未注册本插件，
 *    因此本测试在 `createHttpTestContext()` 之后自行注册，并保留 `hasRoute` 守卫，
 *    待 #07 挂载后不会重复注册（Fastify 重复注册会抛 FST_ERR_DUPLICATED_ROUTE）。
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
  makeStory,
  makeUser,
} from '../../../test/factories.js'
import type { TaskStatus, UserBrief } from '../../shared/types.js'
import { registerWorkloadRoutes } from './plugin.js'
import { MEMBER_TASK_ROWS_LIMIT } from './service.js'
import type { MemberWorkloadDetailView, ProjectWorkloadView } from './types.js'

let ctx: HttpTestContext
let pm: UserBrief
let memberA: UserBrief
let memberB: UserBrief
let viewer: UserBrief
let outsider: UserBrief
let projectId: string
let storyId: string

beforeAll(async () => {
  ctx = await createHttpTestContext()
  setActiveDatabase(ctx.db)
  if (!ctx.app.hasRoute({ method: 'GET', url: '/projects/:projectId/workload' })) {
    registerWorkloadRoutes(ctx.app, { prisma: ctx.db })
  }
  await ctx.app.ready()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pm = await makeUser('pm@example.com', 'Dave')
  memberA = await makeUser('a@example.com', 'Alice')
  memberB = await makeUser('b@example.com', 'Bob')
  viewer = await makeUser('v@example.com', 'Carol')
  outsider = await makeUser('outsider@example.com', 'Outsider')

  const created = await makeProject(pm.id, '成员负载测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, { title: '故事' })

  await makeMember(projectId, memberA.id, 'MEMBER')
  await makeMember(projectId, memberB.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

type SeedTaskInput = {
  ownerUserId: string
  acceptorUserId: string
  title?: string
  status?: TaskStatus
  planStart?: string
  planEnd?: string
  progress?: number | null
  isSensitive?: boolean
  createdAt?: Date
  projectId?: string
  storyId?: string
}

/** 直接插任务行（工厂不允许任意状态 / 日期组合，故走 ctx.db）。 */
async function seedTask(input: SeedTaskInput): Promise<string> {
  const row = await ctx.db.task.create({
    data: {
      projectId: input.projectId ?? projectId,
      storyId: input.storyId ?? storyId,
      title: input.title ?? '任务',
      description: null,
      ownerUserId: input.ownerUserId,
      acceptorUserId: input.acceptorUserId,
      planStart: input.planStart ?? '2026-01-01',
      planEnd: input.planEnd ?? '2026-01-02',
      status: input.status ?? 'TODO',
      progress: input.progress ?? null,
      isSensitive: input.isSensitive ?? false,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  })
  return row.id
}

function getWorkload(actorUserId: string, project = projectId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${project}/workload`)
}

function getMemberDetail(actorUserId: string, userId: string, project = projectId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${project}/workload/${userId}`)
}

async function fetchWorkload(actorUserId: string): Promise<ProjectWorkloadView> {
  const res = await getWorkload(actorUserId)
  expect(res.status).toBe(200)
  return res.body as ProjectWorkloadView
}

async function fetchMemberDetail(
  actorUserId: string,
  userId: string,
): Promise<MemberWorkloadDetailView> {
  const res = await getMemberDetail(actorUserId, userId)
  expect(res.status).toBe(200)
  return res.body as MemberWorkloadDetailView
}

function countOf(view: ProjectWorkloadView, userId: string): number {
  const row = view.members.find((m) => m.userId === userId)
  if (!row) throw new Error(`响应里缺少成员 ${userId}`)
  return row.openTaskCount
}

describe('GET /projects/:projectId/workload —— PM 全项目口径', () => {
  it('PM 得到「全项目」标签；计数为非 CLOSED（含 DONE、排除 CLOSED）；零任务成员为 0', async () => {
    await seedTask({ ownerUserId: pm.id, acceptorUserId: memberA.id, status: 'TODO' })
    await seedTask({ ownerUserId: memberA.id, acceptorUserId: pm.id, status: 'TODO' })
    await seedTask({ ownerUserId: memberA.id, acceptorUserId: pm.id, status: 'DONE' })
    await seedTask({ ownerUserId: memberA.id, acceptorUserId: pm.id, status: 'CLOSED' })
    await seedTask({ ownerUserId: memberB.id, acceptorUserId: pm.id, status: 'DOING' })
    // viewer 不造任务 → 期望 0

    const view = await fetchWorkload(pm.id)
    expect(view.projectId).toBe(projectId)
    expect(view.basis.scopeLabel).toBe('全项目')
    expect(countOf(view, pm.id)).toBe(1)
    expect(countOf(view, memberA.id)).toBe(2) // TODO + DONE；CLOSED 不计
    expect(countOf(view, memberB.id)).toBe(1)
    expect(countOf(view, viewer.id)).toBe(0) // 零任务成员仍出现
  })

  it('成员按 displayName 稳定排序，行字段形状固定（不泄漏多余字段）', async () => {
    const view = await fetchWorkload(pm.id)
    expect(view.members.map((m) => m.displayName)).toEqual(['Alice', 'Bob', 'Carol', 'Dave'])
    for (const row of view.members) {
      expect(Object.keys(row).sort()).toEqual([
        'account',
        'displayName',
        'joinedAt',
        'openTaskCount',
        'role',
        'userId',
      ])
      expect(typeof row.joinedAt).toBe('string')
      expect(row.role).toMatch(/^(PM|MEMBER|VIEWER)$/)
    }
    expect(view.members.find((m) => m.userId === pm.id)?.role).toBe('PM')
  })

  it('未登录 → 401', async () => {
    const res = await ctx.asUser(null).get(`/projects/${projectId}/workload`)
    expect(res.status).toBe(401)
  })
})

describe('GET /projects/:projectId/workload —— MEMBER 可见范围与敏感', () => {
  it('MEMBER 标签为「可见范围」；未授权敏感任务不计入且不出现在明细里', async () => {
    await seedTask({ ownerUserId: memberA.id, acceptorUserId: pm.id, title: '普通A' })
    await seedTask({
      ownerUserId: memberA.id,
      acceptorUserId: pm.id,
      title: '机密A',
      isSensitive: true,
    })
    await seedTask({
      ownerUserId: memberB.id,
      acceptorUserId: pm.id,
      title: '机密B',
      status: 'DOING',
      isSensitive: true,
    })

    const view = await fetchWorkload(memberA.id)
    expect(view.basis.scopeLabel).toBe('可见范围')
    expect(countOf(view, memberA.id)).toBe(1) // 仅普通A
    expect(countOf(view, memberB.id)).toBe(0) // 机密B 不可见 → 既不加计数也不出现

    const detail = await fetchMemberDetail(memberA.id, memberA.id)
    expect(detail.basis.scopeLabel).toBe('可见范围')
    expect(detail.total).toBe(1)
    expect(detail.items.map((i) => i.title)).toEqual(['普通A'])
    // 明细行不带敏感标记
    expect(Object.keys(detail.items[0] ?? {}).sort()).toEqual([
      'id',
      'planEnd',
      'planStart',
      'progress',
      'status',
      'title',
    ])
  })

  it('被指名的敏感任务对该成员可见并计入', async () => {
    const secretId = await seedTask({
      ownerUserId: memberB.id,
      acceptorUserId: pm.id,
      title: '共享机密',
      status: 'DOING',
      isSensitive: true,
    })
    await makeSensitive('task', secretId, [memberA.id])

    const view = await fetchWorkload(memberA.id)
    expect(countOf(view, memberB.id)).toBe(1)

    const detail = await fetchMemberDetail(memberA.id, memberB.id)
    expect(detail.total).toBe(1)
    expect(detail.items[0]?.id).toBe(secretId)
  })
})

describe('GET /projects/:projectId/workload —— VIEWER 只读同口径', () => {
  it('VIEWER 标签为「可见范围」，只统计授权可见任务，可调用详情', async () => {
    await seedTask({ ownerUserId: memberA.id, acceptorUserId: pm.id, title: '普通A' })
    await seedTask({
      ownerUserId: memberA.id,
      acceptorUserId: pm.id,
      title: '机密A',
      isSensitive: true,
    })
    const sharedId = await seedTask({
      ownerUserId: memberB.id,
      acceptorUserId: pm.id,
      title: '共享机密B',
      status: 'DOING',
      isSensitive: true,
    })
    await makeSensitive('task', sharedId, [viewer.id])

    const view = await fetchWorkload(viewer.id)
    expect(view.basis.scopeLabel).toBe('可见范围')
    expect(countOf(view, memberA.id)).toBe(1)
    expect(countOf(view, memberB.id)).toBe(1)

    const detailA = await fetchMemberDetail(viewer.id, memberA.id)
    expect(detailA.total).toBe(1)

    const detailB = await fetchMemberDetail(viewer.id, memberB.id)
    expect(detailB.items[0]?.id).toBe(sharedId)
  })
})

describe('GET /projects/:projectId/workload —— 隔离与 404', () => {
  async function notFoundBody(fetch: () => Promise<{ status: number; body: unknown }>) {
    const res = await fetch()
    expect(res.status).toBe(404)
    return res.body
  }

  it('outsider / 外项目成员 / 不存在的项目 → 404，且与「项目不存在」逐字一致', async () => {
    const baseline = await notFoundBody(() => getWorkload(pm.id, 'no-such-project'))

    const byOutsider = await notFoundBody(() => getWorkload(outsider.id))
    expect(byOutsider).toEqual(baseline)

    // 外项目：另一个项目的 PM，即便也是成员，对本项目仍 404
    const pm2 = await makeUser('pm2@example.com', 'Eve')
    await makeProject(pm2.id, '另一个项目')
    const byForeign = await notFoundBody(() => getWorkload(pm2.id))
    expect(byForeign).toEqual(baseline)

    expect(baseline).toMatchObject({ error: { code: 'NOT_FOUND', message: '项目不存在' } })
  })

  it('详情：目标 userId 非本项目成员 → 与项目不存在逐字一致的 404', async () => {
    const baseline = await notFoundBody(() => getWorkload(pm.id, 'no-such-project'))
    const byTarget = await notFoundBody(() => getMemberDetail(pm.id, outsider.id))
    expect(byTarget).toEqual(baseline)

    const byProject = await notFoundBody(() => getMemberDetail(pm.id, memberA.id, 'no-such-project'))
    expect(byProject).toEqual(baseline)
  })
})

describe('GET /projects/:projectId/workload —— 跨项目不混入', () => {
  it('只统计当前项目：他项目的成员与任务都不出现', async () => {
    await seedTask({ ownerUserId: memberA.id, acceptorUserId: pm.id, title: '本项目任务' })

    const pm2 = await makeUser('pm2@example.com', 'Eve')
    const other = await makeProject(pm2.id, '另一个项目')
    const otherGoal = await makeGoal(other.projectId, '别的目标')
    const otherActivity = await makeActivity(otherGoal, '别的活动')
    const otherStory = await makeStory(otherActivity, { title: '别的故事' })
    // memberA 同时是两个项目的成员，但另一项目里的任务不得计入本项目
    await makeMember(other.projectId, memberA.id, 'MEMBER')
    await seedTask({
      ownerUserId: memberA.id,
      acceptorUserId: pm2.id,
      title: '他项目任务',
      projectId: other.projectId,
      storyId: otherStory,
    })

    const view = await fetchWorkload(pm.id)
    expect(countOf(view, memberA.id)).toBe(1)
    expect(view.members.map((m) => m.userId)).not.toContain(pm2.id)
  })
})

describe('GET /projects/:projectId/workload/:userId —— 明细口径', () => {
  it('total 精确、CLOSED 被排除、按 planEnd 升序 + createdAt 升序', async () => {
    const early = await seedTask({
      ownerUserId: memberA.id,
      acceptorUserId: pm.id,
      title: '早建',
      status: 'DOING',
      planEnd: '2026-03-01',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const late = await seedTask({
      ownerUserId: memberA.id,
      acceptorUserId: pm.id,
      title: '晚建',
      status: 'TODO',
      planEnd: '2026-03-01',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    const last = await seedTask({
      ownerUserId: memberA.id,
      acceptorUserId: pm.id,
      title: '最晚',
      status: 'DONE',
      planEnd: '2026-03-10',
    })
    await seedTask({
      ownerUserId: memberA.id,
      acceptorUserId: pm.id,
      title: '已关闭',
      status: 'CLOSED',
      planEnd: '2026-02-01',
    })

    const detail = await fetchMemberDetail(pm.id, memberA.id)
    expect(detail.total).toBe(3) // CLOSED 排除，但仍计 DONE
    expect(detail.truncated).toBe(false)
    expect(detail.items.map((i) => i.id)).toEqual([early, late, last])
    expect(detail.items.some((i) => i.status === 'CLOSED')).toBe(false)
  })

  it('超过明细上限：items 截断、truncated=true，total 仍为精确总数', async () => {
    const data = Array.from({ length: MEMBER_TASK_ROWS_LIMIT + 5 }, (_, i) => ({
      projectId,
      storyId,
      title: `批量任务 ${String(i).padStart(3, '0')}`,
      ownerUserId: memberA.id,
      acceptorUserId: pm.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
    }))
    await ctx.db.task.createMany({ data })

    const res = await getMemberDetail(pm.id, memberA.id)
    expect(res.status).toBe(200)
    const detail = res.body as MemberWorkloadDetailView
    expect(detail.total).toBe(MEMBER_TASK_ROWS_LIMIT + 5)
    expect(detail.items).toHaveLength(MEMBER_TASK_ROWS_LIMIT)
    expect(detail.truncated).toBe(true)
  })
})
