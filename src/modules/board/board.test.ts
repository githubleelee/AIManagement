/**
 * US-04 故事看板（GitHub #25，本地 #17）—— 只读聚合端点模块测试。
 *
 * 唯一 seam 是 HTTP 接口层（契约 Testing Decisions）：全部通过 supertest 发请求、
 * 断言状态码与响应体，不断言内部实现。造数用 `test/factories.ts`（直接写库）与
 * 局部 seed 辅助（`createdAt` / 任意状态，工厂不覆盖），验证一律走 HTTP。
 *
 * 覆盖（对应主代理下发的用例清单）：
 *   - PM 三列（DRAFT/PLANNING/DONE）与精确计数，列序固定；
 *   - 列内排序 `createdAt asc, id asc`；
 *   - MEMBER 只看到可见故事：未授权敏感故事不出现、不计数；
 *   - 被指名的敏感故事对该成员可见并计数；
 *   - VIEWER 与 MEMBER 同口径；
 *   - outsider / 外项目 / 不存在项目 → 404，与「项目不存在」逐字一致；
 *   - 空项目三列都在且 `count=0`；
 *   - 响应卡片不含 `isSensitive`；
 *   - 未截断时 `count === items.length`；
 *   - 超出 200 行上限置 `truncated=true`，`count` 仍为精确值。
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
import type { StoryStatus, UserBrief } from '../../shared/types.js'
import { registerBoardRoutes } from './plugin.js'
import { BOARD_COLUMN_ROW_LIMIT, type BoardCardItem, type BoardView } from './types.js'

let ctx: HttpTestContext
let pm: UserBrief
let member: UserBrief
let viewer: UserBrief
let outsider: UserBrief
let projectId: string
let goalId: string
let activityId: string

beforeAll(async () => {
  ctx = await createHttpTestContext()
  setActiveDatabase(ctx.db)
  if (!ctx.app.hasRoute({ method: 'GET', url: '/projects/:projectId/board' })) {
    registerBoardRoutes(ctx.app, { prisma: ctx.db })
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

  const created = await makeProject(pm.id, '故事看板测试项目')
  projectId = created.projectId
  goalId = await makeGoal(projectId, '业务目标')
  activityId = await makeActivity(goalId, '用户活动')

  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

// ---------------------------------------------------------------------------
// 造数辅助（直接写库；工厂不覆盖 createdAt / 任意状态）
// ---------------------------------------------------------------------------

type SeedStoryInput = {
  title?: string
  status?: StoryStatus
  priority?: string
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
      priority: input.priority ?? 'P0',
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.isSensitive === undefined ? {} : { isSensitive: input.isSensitive }),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  })
  return row.id
}

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

function getBoard(actorUserId: string, project = projectId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${project}/board`)
}

async function fetchBoard(actorUserId: string): Promise<BoardView> {
  const res = await getBoard(actorUserId)
  expect(res.status).toBe(200)
  return res.body as BoardView
}

function columnOf(view: BoardView, status: StoryStatus) {
  const column = view.columns.find((c) => c.status === status)
  if (!column) throw new Error(`响应里缺少列 ${status}`)
  return column
}

function itemIds(view: BoardView, status: StoryStatus): string[] {
  return columnOf(view, status).items.map((item) => item.id)
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('GET /projects/:projectId/board —— PM 三列与计数', () => {
  it('PM 得到固定三列与精确计数，basis=全项目', async () => {
    await seedStory({ title: 'D1', status: 'DRAFT' })
    await seedStory({ title: 'D2', status: 'DRAFT' })
    await seedStory({ title: 'P1', status: 'PLANNING' })
    await seedStory({ title: 'N1', status: 'DONE' })
    await seedStory({ title: 'N2', status: 'DONE' })
    await seedStory({ title: 'N3', status: 'DONE' })

    const view = await fetchBoard(pm.id)

    expect(view.projectId).toBe(projectId)
    expect(view.basis.scopeLabel).toBe('全项目')
    // 列序固定：DRAFT, PLANNING, DONE
    expect(view.columns.map((c) => c.status)).toEqual(['DRAFT', 'PLANNING', 'DONE'])
    expect(columnOf(view, 'DRAFT').count).toBe(2)
    expect(columnOf(view, 'PLANNING').count).toBe(1)
    expect(columnOf(view, 'DONE').count).toBe(3)
    // 未截断时 count === items.length
    for (const column of view.columns) {
      expect(column.truncated).toBe(false)
      expect(column.count).toBe(column.items.length)
    }
    // 卡片副标题取活动名 / 目标名
    const card = columnOf(view, 'DRAFT').items[0] as BoardCardItem
    expect(card.activityName).toBe('用户活动')
    expect(card.goalName).toBe('业务目标')
    expect(card.priority).toBe('P0')
    // 响应卡片只含契约列出的 7 个字段，**不含 isSensitive**
    expect(Object.keys(card).sort()).toEqual([
      'activityName',
      'goalName',
      'id',
      'priority',
      'status',
      'title',
    ])
    expect(JSON.stringify(view)).not.toContain('isSensitive')
  })

  it('列内排序 createdAt asc, id asc', async () => {
    const t1 = new Date('2026-01-01T00:00:00Z')
    const t2 = new Date('2026-01-02T00:00:00Z')
    // 同 createdAt：以 id 升序破平局（不依赖插入顺序）
    const sameA = await seedStory({ title: 'same-a', status: 'DRAFT', createdAt: t1 })
    const sameB = await seedStory({ title: 'same-b', status: 'DRAFT', createdAt: t1 })
    const later = await seedStory({ title: 'later', status: 'DRAFT', createdAt: t2 })

    const view = await fetchBoard(pm.id)
    const expected = [sameA, sameB].sort().concat(later)
    expect(itemIds(view, 'DRAFT')).toEqual(expected)
  })

  it('空项目三列都在，count=0 且 items 为空', async () => {
    const view = await fetchBoard(pm.id)
    expect(view.columns.map((c) => c.status)).toEqual(['DRAFT', 'PLANNING', 'DONE'])
    for (const column of view.columns) {
      expect(column.count).toBe(0)
      expect(column.items).toEqual([])
      expect(column.truncated).toBe(false)
    }
  })
})

describe('GET /projects/:projectId/board —— MEMBER / VIEWER 可见范围', () => {
  it('MEMBER 只看到可见故事：未授权敏感故事不出现也不计数', async () => {
    const visibleDraft = await seedStory({ title: '可见 D', status: 'DRAFT' })
    const secretDraft = await seedStory({ title: '敏感 D', status: 'DRAFT' })
    const visibleDone = await seedStory({ title: '可见 N', status: 'DONE' })
    await makeSensitive('story', secretDraft, []) // 除 PM 外无人可见

    const view = await fetchBoard(member.id)

    expect(view.basis.scopeLabel).toBe('可见范围')
    expect(columnOf(view, 'DRAFT').count).toBe(1)
    expect(itemIds(view, 'DRAFT')).toEqual([visibleDraft])
    expect(columnOf(view, 'DONE').count).toBe(1)
    expect(itemIds(view, 'DONE')).toEqual([visibleDone])
    // 敏感故事 id 不经任何集合泄漏
    expect(JSON.stringify(view)).not.toContain(secretDraft)
    // 未截断时 count 与 items 一致
    for (const column of view.columns) expect(column.count).toBe(column.items.length)
  })

  it('被指名的敏感故事对该成员可见并计数', async () => {
    const secret = await seedStory({ title: '共享敏感', status: 'PLANNING' })
    await makeSensitive('story', secret, [member.id])

    const view = await fetchBoard(member.id)
    expect(columnOf(view, 'PLANNING').count).toBe(1)
    expect(itemIds(view, 'PLANNING')).toEqual([secret])
  })

  it('VIEWER 与 MEMBER 同口径（未授权敏感不可见，被指名可见）', async () => {
    const normal = await seedStory({ title: '普通', status: 'DRAFT' })
    const secretHidden = await seedStory({ title: '隐藏', status: 'DRAFT' })
    const secretNamed = await seedStory({ title: '指名', status: 'DRAFT' })
    await makeSensitive('story', secretHidden, [])
    await makeSensitive('story', secretNamed, [viewer.id])

    const view = await fetchBoard(viewer.id)
    expect(view.basis.scopeLabel).toBe('可见范围')
    expect(itemIds(view, 'DRAFT').sort()).toEqual([normal, secretNamed].sort())
    expect(columnOf(view, 'DRAFT').count).toBe(2)
  })
})

describe('GET /projects/:projectId/board —— 上限截断', () => {
  it('单列超过 200 行：items 截断至 200，truncated=true，count 仍精确', async () => {
    const total = BOARD_COLUMN_ROW_LIMIT + 5
    await ctx.db.userStory.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        projectId,
        activityId,
        title: `批量故事 ${String(i).padStart(3, '0')}`,
        roleText: 'r',
        capabilityText: 'c',
        valueText: 'v',
        businessValue: 'bv',
        priority: 'P0',
        status: 'DRAFT',
      })),
    })

    const view = await fetchBoard(pm.id)
    const draft = columnOf(view, 'DRAFT')
    expect(draft.count).toBe(total)
    expect(draft.items).toHaveLength(BOARD_COLUMN_ROW_LIMIT)
    expect(draft.truncated).toBe(true)
    // 空列不受影响
    expect(columnOf(view, 'PLANNING')).toMatchObject({ count: 0, truncated: false, items: [] })
  })
})

describe('GET /projects/:projectId/board —— 隔离与 404', () => {
  async function notFoundBody(fetch: () => Promise<{ status: number; body: unknown }>) {
    const res = await fetch()
    expect(res.status).toBe(404)
    return res.body
  }

  it('outsider / 外项目成员 / 不存在的项目 → 404，且与「项目不存在」逐字一致', async () => {
    const baseline = await notFoundBody(() => getBoard(pm.id, 'no-such-project'))

    const byOutsider = await notFoundBody(() => getBoard(outsider.id))
    expect(byOutsider).toEqual(baseline)

    // 外项目：另一个项目的 PM，即便也是成员，对本项目仍 404
    const pm2 = await makeUser('pm2@example.com', 'Eve')
    await makeProject(pm2.id, '另一个项目')
    const byForeign = await notFoundBody(() => getBoard(pm2.id))
    expect(byForeign).toEqual(baseline)

    expect(baseline).toMatchObject({ error: { code: 'NOT_FOUND', message: '项目不存在' } })
  })

  it('未登录 → 401', async () => {
    const res = await ctx.asUser(null).get(`/projects/${projectId}/board`)
    expect(res.status).toBe(401)
  })

  it('不混入他项目故事', async () => {
    const pm2 = await makeUser('pm2@example.com', 'Eve')
    const other = await makeProject(pm2.id, '另一个项目')
    const otherGoal = await makeGoal(other.projectId, '别的目标')
    const otherActivity = await makeActivity(otherGoal, '别的活动')
    const otherStory = await seedStory({
      projectId: other.projectId,
      activityId: otherActivity,
      title: '别的故事',
      status: 'DRAFT',
    })

    const view = await fetchBoard(pm.id)
    expect(JSON.stringify(view)).not.toContain(otherStory)
    expect(itemIds(view, 'DRAFT')).not.toContain(otherStory)
  })
})
