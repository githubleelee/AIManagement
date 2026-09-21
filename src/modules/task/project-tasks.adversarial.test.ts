/**
 * T5-06 对抗性验证测试 —— 端点 26（`GET /projects/:projectId/tasks`）
 *
 * 这是对 `project-tasks.test.ts`（编码体自测）的**独立对抗性复核**，面向 issue #13
 * 「[T5-06] 按负责人查看任务（P1，可降级）」的验收，重点验证工单特别强调的**第四条
 * 独立查询路径**是否真的接入 `visibilityScope()`，以及降级时必须「整体移除端点、
 * 不得保留未过滤版本」这一约束在**当前未降级**的实现中是否成立。
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 端点 26：200 `ListResponse<TaskView>`；`ownerUserId?`；按 `planStart` 升序；
 *     404 非项目成员；422 `ownerUserId: NOT_PROJECT_MEMBER`
 *   - 决策 I-6：查询层过滤，禁止内存 `.filter()`
 *   - 决策 I-5：唯一鉴权入口 `can()`
 *   - 决策 I-3：不可见对象与不存在返回一致 404，响应体不含对象字段
 *
 * 对抗性对照场景（工单 A 组）：
 *   PM + 成员 A（**敏感任务名单内**，且是敏感任务负责人）+ 成员 B（名单外）
 *   + 一个敏感任务（owner=A）+ 若干非敏感任务。
 *
 * 探针编号与最终报告一一对应。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { TaskView } from '../../shared/types.js'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import { makeUser, makeProject, makeGoal, makeActivity, makeStory, makeMember } from '../../../test/factories.js'

// 数据前置：项目 + 目标 + 活动 + 故事（组合 test/factories.js 的真实工厂）。
async function createProjectWithStory(
  _db: unknown,
  ownerUserId: string,
  options: { projectName?: string; storyTitle?: string } = {},
): Promise<{ projectId: string; storyId: string }> {
  const { projectId } = await makeProject(ownerUserId, options.projectName ?? '测试项目')
  const goalId = await makeGoal(projectId, '测试目标')
  const activityId = await makeActivity(goalId, '测试活动')
  const storyId = await makeStory(activityId, {
    title: options.storyTitle ?? '测试用户故事',
    capabilityText: '拆任务',
    valueText: '推进交付',
    businessValue: '高',
    priority: 'P0',
  })
  return { projectId, storyId }
}

// 直接插入任务行（工厂 makeTask 不允许指定 createdAt 或构造非法数据；故走 ctx.db）。
async function createTaskRow(
  _db: unknown,
  params: {
    projectId: string
    storyId: string
    ownerUserId: string
    acceptorUserId: string
    title?: string
    description?: string | null
    planStart?: string
    planEnd?: string
    status?: 'TODO' | 'DOING' | 'DONE'
    isSensitive?: boolean
    createdAt?: Date
  },
) {
  return ctx.db.task.create({
    data: {
      projectId: params.projectId,
      storyId: params.storyId,
      title: params.title ?? '任务',
      description: params.description ?? null,
      ownerUserId: params.ownerUserId,
      acceptorUserId: params.acceptorUserId,
      planStart: params.planStart ?? '2026-01-01',
      planEnd: params.planEnd ?? '2026-01-31',
      status: params.status ?? 'TODO',
      isSensitive: params.isSensitive ?? false,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  })
}

type ErrorBody = {
  error: {
    code: string
    message: string
    details?: Array<{ field: string; code: string }>
  }
}

type ListBody = { items: TaskView[] }

let ctx: HttpTestContext
let pm: { id: string }
let memberA: { id: string }
let memberB: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let otherPm: { id: string }
let otherMember: { id: string }
let projectId: string
let storyId: string
let otherProjectId: string
let otherStoryId: string

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser('pm@example.com', '项目经理')
  memberA = await makeUser('member-a@example.com', '成员A')
  memberB = await makeUser('member-b@example.com', '成员B')
  viewer = await makeUser('viewer@example.com', '管理者')
  outsider = await makeUser('outsider@example.com', '项目外用户')
  otherPm = await makeUser('other-pm@example.com', '另一项目PM')
  otherMember = await makeUser('other-member@example.com', '另一项目成员')

  const projectA = await createProjectWithStory(ctx.db, pm.id)
  projectId = projectA.projectId
  storyId = projectA.storyId
  await makeMember(projectId, memberA.id, 'MEMBER')
  await makeMember(projectId, memberB.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')

  const projectB = await createProjectWithStory(ctx.db, otherPm.id, {
    projectName: '另一个项目',
    storyTitle: '另一个故事',
  })
  otherProjectId = projectB.projectId
  otherStoryId = projectB.storyId
  await makeMember(otherProjectId, otherMember.id, 'MEMBER')
})

// ---------------------------------------------------------------------------
// 本地辅助（不修改共享 harness / test 目录）
// ---------------------------------------------------------------------------

function listProjectTasks(
  actorUserId: string,
  targetProjectId: string = projectId,
  query?: Record<string, string | string[]>,
) {
  let req = ctx.asUser(ctx.loginAs(actorUserId))
    .get(`/projects/${targetProjectId}/tasks`)
  if (query) req = req.query(query)
  return req
}

function listWithoutActor(targetProjectId: string = projectId) {
  return ctx.asUser(null).get(`/projects/${targetProjectId}/tasks`)
}

function putSensitivity(
  targetTaskId: string,
  body: Record<string, unknown>,
  actorUserId: string = pm.id,
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .put(`/tasks/${targetTaskId}/sensitivity`)
    .send(body)
}

type TaskRowParams = Parameters<typeof createTaskRow>[1]
function makeTask(overrides: Partial<TaskRowParams> & { title: string }) {
  return createTaskRow(ctx.db, {
    projectId,
    storyId,
    ownerUserId: memberA.id,
    acceptorUserId: pm.id,
    ...overrides,
  })
}

/** 屏幕外检查：序列化后的响应体不得含被禁字符串（敏感任务标识）。 */
function expectNoLeak(body: unknown, forbidden: string[]): void {
  const serialized = JSON.stringify(body)
  for (const value of forbidden) {
    expect(serialized).not.toContain(value)
  }
}

/**
 * 对抗性对照场景构造：
 *   - 敏感任务（owner = memberA，可见名单 = [memberA]）
 *   - 非敏感任务 N1 / N2（均 owner = memberB）
 * 关键点：memberA 名下**只有**那条敏感任务，因此名单外成员 B 按 owner=memberA
 * 过滤时，若过滤路径漏掉可见性作用域，就必然把敏感任务捞出来 —— 一眼可判。
 * PM 不显式列入名单也始终可见（契约 I-5）。
 * 返回给 A 组探针使用。
 */
async function setupParityFixture() {
  const sensitive = await makeTask({
    title: '机密任务',
    description: '机密描述',
    ownerUserId: memberA.id,
    planStart: '2026-02-01',
    planEnd: '2026-02-10',
  })
  const nonSensitiveB = await makeTask({
    title: 'B 的普通任务',
    ownerUserId: memberB.id,
    planStart: '2026-03-01',
    planEnd: '2026-03-10',
  })
  const nonSensitiveB2 = await makeTask({
    title: 'B 的普通任务2',
    ownerUserId: memberB.id,
    planStart: '2026-01-01',
    planEnd: '2026-01-10',
  })

  const marked = await putSensitivity(sensitive.id, {
    isSensitive: true,
    visibleMemberIds: [memberA.id],
  })
  expect(marked.status).toBe(200)

  return { sensitive, nonSensitiveB, nonSensitiveB2 }
}

// ===========================================================================
// A. 第四条泄漏路径（核心）
// ===========================================================================

describe('A. 端点 26 是敏感任务的第四条查询路径', () => {
  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('A1：名单外成员 B 不带 ownerUserId → 敏感任务不出现，items 长度不计入其存在', async () => {
    const { sensitive, nonSensitiveB, nonSensitiveB2 } = await setupParityFixture()

    // 库中真实存在 3 条任务（1 敏感 + 2 非敏感）。
    expect(await ctx.db.task.count({ where: { projectId } })).toBe(3)

    const response = await listProjectTasks(memberB.id)

    expect(response.status).toBe(200)
    const items = (response.body as ListBody).items
    // 不泄漏计数：长度 = 非敏感任务数，而不是 3。
    expect(items).toHaveLength(2)
    expect(items.map((t) => t.id)).not.toContain(sensitive.id)
    expect(new Set(items.map((t) => t.id))).toEqual(
      new Set([nonSensitiveB.id, nonSensitiveB2.id]),
    )
    expectNoLeak(response.body, ['机密任务', '机密描述', sensitive.id])
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('A2：★ B 带敏感任务负责人 A 的 ownerUserId → 结果必须为空数组（最易漏路径）', async () => {
    const { sensitive } = await setupParityFixture()

    const response = await listProjectTasks(memberB.id, projectId, {
      ownerUserId: memberA.id,
    })

    expect(response.status).toBe(200)
    expect((response.body as ListBody).items).toEqual([])
    expectNoLeak(response.body, ['机密任务', '机密描述', sensitive.id])
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('A3：不带参数 vs 带参数的结果数一致性 —— B 的总数 = 库中非敏感任务数', async () => {
    const { nonSensitiveB, nonSensitiveB2 } = await setupParityFixture()

    const nonSensitiveCount = await ctx.db.task.count({
      where: { projectId, isSensitive: false },
    })
    const sensitiveCount = await ctx.db.task.count({
      where: { projectId, isSensitive: true },
    })
    // 真实数字断言（1 条敏感、2 条非敏感）。
    expect(sensitiveCount).toBe(1)
    expect(nonSensitiveCount).toBe(2)

    const all = await listProjectTasks(memberB.id)
    const byOwnerA = await listProjectTasks(memberB.id, projectId, { ownerUserId: memberA.id })
    const byOwnerB = await listProjectTasks(memberB.id, projectId, { ownerUserId: memberB.id })

    expect((all.body as ListBody).items).toHaveLength(nonSensitiveCount)
    // 按敏感任务负责人过滤：必须为空（敏感任务被作用域滤掉，A 名下没有非敏感任务）。
    expect((byOwnerA.body as ListBody).items).toEqual([])
    // 两个 owner 过滤结果并集 = 不带参数结果（集合相等，且不重不漏）。
    const union = new Set([
      ...(byOwnerA.body as ListBody).items.map((t) => t.id),
      ...(byOwnerB.body as ListBody).items.map((t) => t.id),
    ])
    expect(union).toEqual(new Set((all.body as ListBody).items.map((t) => t.id)))
    expect(union).toEqual(new Set([nonSensitiveB.id, nonSensitiveB2.id]))
  })

  it('A4：名单内成员 A（敏感任务负责人）与 PM 都能看到敏感任务；A 带自己 ownerUserId 也能看到', async () => {
    const { sensitive } = await setupParityFixture()

    // A 是负责人且被列入白名单。
    const asA = await listProjectTasks(memberA.id)
    expect(asA.status).toBe(200)
    expect((asA.body as ListBody).items.map((t) => t.id)).toContain(sensitive.id)

    // A 名下只有那条敏感任务，带自己过滤应只看到它。
    const asAFiltered = await listProjectTasks(memberA.id, projectId, {
      ownerUserId: memberA.id,
    })
    expect((asAFiltered.body as ListBody).items.map((t) => t.id)).toEqual([sensitive.id])

    // PM：scope = all，不传/传 owner 都能看到敏感任务。
    const asPm = await listProjectTasks(pm.id)
    expect((asPm.body as ListBody).items.map((t) => t.id)).toContain(sensitive.id)
    const asPmFiltered = await listProjectTasks(pm.id, projectId, { ownerUserId: memberA.id })
    expect((asPmFiltered.body as ListBody).items.map((t) => t.id)).toEqual([sensitive.id])
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('A4b：敏感任务负责人不在白名单时，本人带自己 ownerUserId 也看不到（反事实对照）', async () => {
    // 这份 fixture 故意不放任何白名单成员：只有 PM 可见。
    const sensitive = await makeTask({
      title: '仅 PM 可见任务',
      ownerUserId: memberA.id,
      planStart: '2026-02-01',
      planEnd: '2026-02-10',
    })
    const marked = await putSensitivity(sensitive.id, {
      isSensitive: true,
      visibleMemberIds: [],
    })
    expect(marked.status).toBe(200)

    const response = await listProjectTasks(memberA.id, projectId, { ownerUserId: memberA.id })

    expect(response.status).toBe(200)
    expect((response.body as ListBody).items).toEqual([])
    expectNoLeak(response.body, ['仅 PM 可见任务', sensitive.id])
  })
})

// ===========================================================================
// B. 过滤与排序
// ===========================================================================

describe('B. 过滤与排序', () => {
  it('B7a：planStart 升序', async () => {
    await makeTask({ title: '晚', planStart: '2026-03-01', planEnd: '2026-03-10' })
    await makeTask({ title: '早', planStart: '2026-01-01', planEnd: '2026-01-10' })
    await makeTask({ title: '中', planStart: '2026-02-01', planEnd: '2026-02-10' })

    const response = await listProjectTasks(pm.id)

    expect((response.body as ListBody).items.map((t) => t.title)).toEqual(['早', '中', '晚'])
  })

  it('B7b：两条 planStart 相同 → 退化为 createdAt 升序（过滤后仍保持）', async () => {
    // 同一负责人、同一 planStart，仅 createdAt 不同。
    await makeTask({
      title: '同开始-后创建',
      ownerUserId: memberA.id,
      planStart: '2026-02-01',
      planEnd: '2026-02-10',
      createdAt: new Date('2026-01-05T00:00:00.000Z'),
    })
    await makeTask({
      title: '同开始-先创建',
      ownerUserId: memberA.id,
      planStart: '2026-02-01',
      planEnd: '2026-02-10',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const unfiltered = await listProjectTasks(pm.id)
    expect((unfiltered.body as ListBody).items.map((t) => t.title)).toEqual([
      '同开始-先创建',
      '同开始-后创建',
    ])

    // 过滤后仍保持同样的 tie-break。
    const filtered = await listProjectTasks(pm.id, projectId, { ownerUserId: memberA.id })
    expect((filtered.body as ListBody).items.map((t) => t.title)).toEqual([
      '同开始-先创建',
      '同开始-后创建',
    ])
  })

  it('B8：ownerUserId 过滤结果与「全量结果里按该人筛选」集合相等（两种取法交叉验证）', async () => {
    await makeTask({ title: 'A-1', ownerUserId: memberA.id })
    await makeTask({ title: 'A-2', ownerUserId: memberA.id })
    await makeTask({ title: 'B-1', ownerUserId: memberB.id })

    const full = await listProjectTasks(pm.id)
    const filtered = await listProjectTasks(pm.id, projectId, { ownerUserId: memberA.id })

    const inMemoryFiltered = (full.body as ListBody).items.filter(
      (t) => t.ownerUserId === memberA.id,
    )
    expect(new Set((filtered.body as ListBody).items.map((t) => t.id))).toEqual(
      new Set(inMemoryFiltered.map((t) => t.id)),
    )
    expect((filtered.body as ListBody).items).toHaveLength(inMemoryFiltered.length)
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('B8b：B 视角下「过滤结果」与「全量可见结果里按该人筛选」同样相等', async () => {
    await setupParityFixture()

    const full = await listProjectTasks(memberB.id)
    const filtered = await listProjectTasks(memberB.id, projectId, { ownerUserId: memberA.id })

    const inMemoryFiltered = (full.body as ListBody).items.filter(
      (t) => t.ownerUserId === memberA.id,
    )
    expect(new Set((filtered.body as ListBody).items.map((t) => t.id))).toEqual(
      new Set(inMemoryFiltered.map((t) => t.id)),
    )
    // B 的全量可见结果里本就不含 A 名下的敏感任务，因此两者都为空。
    expect(filtered.body).toEqual({ items: [] })
  })
})

// ===========================================================================
// C. 契约与权限
// ===========================================================================

describe('C. 契约与权限', () => {
  it('C9a：ownerUserId 不是本项目成员（User 存在）→ 422 NOT_PROJECT_MEMBER', async () => {
    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: outsider.id })

    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    expect((response.body as ErrorBody).error.details ?? []).toContainEqual({
      field: 'ownerUserId',
      code: 'NOT_PROJECT_MEMBER',
    })
    expect(response.body).not.toHaveProperty('items')
  })

  it('C9b：ownerUserId 是别的项目的成员 → 同样 422 NOT_PROJECT_MEMBER（跨项目变体）', async () => {
    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: otherMember.id })

    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.details ?? []).toContainEqual({
      field: 'ownerUserId',
      code: 'NOT_PROJECT_MEMBER',
    })
  })

  it('C10：ownerUserId 传不存在的用户 id → 记录实现行为（契约冻结为 NOT_PROJECT_MEMBER）', async () => {
    const response = await listProjectTasks(pm.id, projectId, {
      ownerUserId: '00000000-0000-0000-0000-000000000000',
    })

    // 契约只冻结了 NOT_PROJECT_MEMBER；实现把「不存在用户」也归入该项目成员校验的 422。
    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    expect((response.body as ErrorBody).error.details ?? []).toContainEqual({
      field: 'ownerUserId',
      code: 'NOT_PROJECT_MEMBER',
    })
  })

  it('C11a：非项目成员 → 404 NOT_FOUND 且响应体不含任何任务字段', async () => {
    await makeTask({ title: '普通任务' })

    const response = await listProjectTasks(outsider.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('items')
    expect(response.body).not.toHaveProperty('id')
    expect(response.body).not.toHaveProperty('title')
    expectNoLeak(response.body, ['普通任务', projectId])
  })

  it('C11b：未登录 → 401 UNAUTHENTICATED', async () => {
    const response = await listWithoutActor()

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('C11c：★ 鉴权先于业务校验 —— 非成员 + 非法 ownerUserId → 404（而非 422）', async () => {
    const response = await listProjectTasks(outsider.id, projectId, {
      ownerUserId: outsider.id, // 非本项目成员，若先做业务校验会是 422
    })

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('C11d：★ 未登录 + 非法 ownerUserId → 401（而非 422）', async () => {
    const response = await ctx.asUser(null)
      .get(`/projects/${projectId}/tasks`)
      .query({ ownerUserId: outsider.id })

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('C12a：项目 A 的成员查项目 B → 404 NOT_FOUND', async () => {
    const response = await listProjectTasks(pm.id, otherProjectId)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('C12b：项目 A 的查询结果不含项目 B 的任务（即使同一 ownerUserId）', async () => {
    // 项目 B 里造一条 owner=otherMember 的任务；项目 A 的 owner 过滤不应带出它。
    const bTask = await createTaskRow(ctx.db, {
      projectId: otherProjectId,
      storyId: otherStoryId,
      ownerUserId: otherMember.id,
      acceptorUserId: otherPm.id,
      title: 'B 的任务',
    })
    await makeTask({ title: 'A 的任务', ownerUserId: memberA.id })

    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: memberA.id })

    expect(response.status).toBe(200)
    const ids = (response.body as ListBody).items.map((t) => t.id)
    expect(ids).not.toContain(bTask.id)
    expect(ids).toHaveLength(1)
  })

  it('C13a：项目内无任务 → 200 { items: [] }（不是 404）', async () => {
    const response = await listProjectTasks(pm.id)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [] })
  })

  it('C13b：ownerUserId 指向本项目成员但该人无任务 → 200 { items: [] }', async () => {
    await makeTask({ title: 'A 的任务', ownerUserId: memberA.id })

    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: memberB.id })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [] })
  })

  it('C14：重复查询参数 ?ownerUserId=a&ownerUserId=b → 记录行为，且不产生 500', async () => {
    await makeTask({ title: 'A 的任务', ownerUserId: memberA.id })

    // 两个都合法的成员 id：若把数组透传给 Prisma 会造成 500；实现须显式拒绝。
    const response = await ctx.asUser(ctx.loginAs(pm.id))
      .get(`/projects/${projectId}/tasks?ownerUserId=${memberA.id}&ownerUserId=${memberB.id}`)

    // 编码体自报为 422 INVALID_VALUE（契约空白），这里验证「真如此且不是 500」。
    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    expect((response.body as ErrorBody).error.details ?? []).toContainEqual({
      field: 'ownerUserId',
      code: 'INVALID_VALUE',
    })
    expect(response.body).not.toHaveProperty('items')
  })

  it('C14b：重复参数在非成员访问时仍先返回 404', async () => {
    const response = await ctx.asUser(ctx.loginAs(outsider.id))
      .get(`/projects/${projectId}/tasks?ownerUserId=${memberA.id}&ownerUserId=${memberB.id}`)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })
})
