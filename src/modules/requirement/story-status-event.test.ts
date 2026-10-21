/**
 * 端点 21 —— 用户故事**状态变更事件**生产回归（#37 接线）
 *
 * 依据：`DECISIONS.md` `legacy.requirement-status-audit-authorization`（C13 授权审计 + 事件提交点）
 *   与 `events.business-domain-production`（同事务追加 / 确定性幂等键 / 敏感规则）。
 *
 * 本文件钉住的口径：
 *   ① `status` 真实变化 → **恰好一条** `requirement.story.status-changed` 事件，且与审计行同事务；
 *   ② `status` 传相同值 → 更新照旧 200，但**不新增**事件；
 *   ③ 只改非状态字段 → **不新增**事件；
 *   ④ 空补丁 `{}` → **不新增**事件；
 *   ⑤ 敏感故事 → 敏感事件（载荷只有 references）；MEMBER 查询层查不到、PM 查得到；
 *   ⑥ 非敏感故事 → MEMBER 也能查到（过滤不误伤）；
 *   ⑦ 组装：两端口缺失时插件会在注册期 fail-fast，故 `buildApp()` 成功即可证明注入存在。
 *
 * 测试约定：走 HTTP seam（supertest）；事件可见性用**真实** `PrismaEventRepository.query`
 * 验证（查询层 `json_each` 过滤，契约 I-6）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { PrismaEventRepository } from '../../db/event-repository.js'
import { makeActivity, makeGoal, makeSensitive, makeStory } from './test-fixtures.js'

let ctx: HttpTestContext
let pmId: string
let pmToken: string
let memberId: string
let memberToken: string
let projectId: string
let activityId: string
let storyId: string

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

const URL_STORY = (id: string) => `/stories/${id}`
const EVENT_NAME = 'requirement.story.status-changed'

/** 读该故事的领域事件行（按 storedAt 升序）。 */
async function eventsOf(storyIdToRead: string) {
  return ctx.db.domainEvent.findMany({
    where: { eventName: EVENT_NAME, objectId: storyIdToRead },
    orderBy: { storedAt: 'asc' },
  })
}

beforeAll(async () => {
  ctx = await createHttpTestContext()
  // 不手动 register 插件：buildApp() → registerRoutes() 已注册（含事件端口注入）。
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pmId = await makeUser(ctx.db, 'ev-pm', '项目经理')
  memberId = await makeUser(ctx.db, 'ev-member', '项目成员')

  projectId = await makeProject(ctx.db, pmId, '事件项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')

  const goalId = await makeGoal(ctx.db, projectId, '事件目标')
  activityId = await makeActivity(ctx.db, projectId, goalId, '事件活动')
  // 表默认 status = 'DRAFT'（决策 I-7）
  storyId = await makeStory(ctx.db, projectId, activityId)

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
})

describe('状态真实变化 → 恰好一条事件（与审计同事务）', () => {
  it('DRAFT → PLANNING：事件名字 / object / payload / actor / occurredAt / 幂等键正确', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'PLANNING' })
    expect(res.status).toBe(200)

    const events = await eventsOf(storyId)
    expect(events).toHaveLength(1)
    const event = events[0]!

    expect(event).toMatchObject({
      schemaVersion: 1,
      eventName: EVENT_NAME,
      projectId,
      objectType: 'story',
      objectId: storyId,
      actorKind: 'USER',
      actorUserId: pmId,
      sensitive: false,
      payload: { from: 'DRAFT', to: 'PLANNING' },
    })
    // 非敏感载荷只含状态，不含故事正文
    expect(Object.keys(event.payload as object).sort()).toEqual(['from', 'to'])
    expect(event.occurredAt.toISOString()).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(event.storedAt.toISOString()).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    // 确定性幂等键（更新类：带 occurredAt）
    expect(event.idempotencyKey).toBe(
      `${EVENT_NAME}:${storyId}:${event.occurredAt.toISOString()}`,
    )

    // 与审计同事务、同时机：恰好一条审计行
    expect(
      await ctx.db.auditLog.count({ where: { objectType: 'story', objectId: storyId } }),
    ).toBe(1)
  })

  it('连续两次变更 → 两条事件，前后值首尾相接（DRAFT→PLANNING→DONE）', async () => {
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'PLANNING' })
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })

    const events = await eventsOf(storyId)
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.payload)).toEqual([
      { from: 'DRAFT', to: 'PLANNING' },
      { from: 'PLANNING', to: 'DONE' },
    ])
  })
})

describe('不该发事件的情形', () => {
  it('status 传相同值（DRAFT → DRAFT）→ 200，但不新增事件', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'DRAFT' })
    expect(res.status).toBe(200)
    expect(await eventsOf(storyId)).toHaveLength(0)
  })

  it('只改非状态字段（title）→ 200，但不新增事件', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ title: '只改标题' })
    expect(res.status).toBe(200)
    expect(await eventsOf(storyId)).toHaveLength(0)
  })

  it('空补丁 {} → 200 只读分支，不新增事件', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({})
    expect(res.status).toBe(200)
    expect(await eventsOf(storyId)).toHaveLength(0)
  })

  it('越权改状态（MEMBER 403）→ 不新增事件（服务端才是权威）', async () => {
    const before = await ctx.db.domainEvent.count({ where: { projectId } })
    const res = await ctx.asUser(memberToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(await ctx.db.domainEvent.count({ where: { projectId } })).toBe(before)
  })
})

describe('敏感故事 / 查询层可见性（契约 I-6）', () => {
  it('敏感故事状态变更 → 敏感事件（载荷只有 references）；MEMBER 查不到、PM 查得到', async () => {
    const sensitiveStoryId = await makeStory(ctx.db, projectId, activityId, {
      isSensitive: true,
    })
    // 白名单为空 → 仅 PM（scope all）可见该故事
    await makeSensitive(ctx.db, projectId, 'story', sensitiveStoryId, [])

    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(sensitiveStoryId))
      .send({ status: 'PLANNING' })
    expect(res.status).toBe(200)

    const events = await eventsOf(sensitiveStoryId)
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.sensitive).toBe(true)
    // 敏感事件载荷只能是 references；before/after 已在审计行，不重复入载荷
    expect(event.payload).toEqual({
      references: [{ objectType: 'story', objectId: sensitiveStoryId }],
    })

    const repo = new PrismaEventRepository(ctx.db)
    const memberView = await repo.query({
      projectId,
      eventName: EVENT_NAME,
      actorUserId: memberId,
    })
    expect(memberView).toHaveLength(0)
    const pmView = await repo.query({ projectId, eventName: EVENT_NAME, actorUserId: pmId })
    expect(pmView.map((item) => item.id)).toEqual([event.id])
  })

  it('非敏感故事状态变更 → MEMBER 也能查到（过滤不误伤）', async () => {
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'PLANNING' })

    const repo = new PrismaEventRepository(ctx.db)
    const memberView = await repo.query({
      projectId,
      eventName: EVENT_NAME,
      actorUserId: memberId,
    })
    expect(memberView.map((item) => item.object.objectId)).toEqual([storyId])
  })
})

describe('组装注入存在性', () => {
  it('buildApp() 成功即证明两个域事件端口已注入（缺失时插件注册期 fail-fast）', () => {
    // 若 RouteContext.ganttEvents / requirementEvents 缺失，registerGanttRoutes /
    // registerRequirementRoutes 会在 buildApp() 内抛组装缺失错误，测试上下文根本建不起来。
    expect(
      ctx.app.hasRoute({ method: 'POST', url: '/projects/:projectId/milestones' }),
    ).toBe(true)
    expect(ctx.app.hasRoute({ method: 'PATCH', url: '/stories/:storyId' })).toBe(true)
  })
})
