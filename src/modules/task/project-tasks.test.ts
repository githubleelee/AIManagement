/**
 * T5-06 接口测试 —— 端点 26（`GET /projects/:projectId/tasks`，查询参数 `ownerUserId?`）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-8 端点 26：200 `ListResponse<TaskView>`；`ownerUserId?` 按负责人附加过滤；
 *     404 `NOT_FOUND`（非项目成员 / 项目不存在）；422 `VALIDATION_FAILED`
 *     （`ownerUserId: NOT_PROJECT_MEMBER`）；按 `planStart` 升序
 *   - 决策 I-6：列表必须在**查询层**过滤，`visibilityScope()` 返回 id 子集后以
 *     `id IN (...)` 过滤；端点 26 是敏感任务的**第四条**独立查询路径
 *   - 决策 I-3：不可见 / 不存在对象返回一致的 404，且响应体不含对象任何字段
 *   - 决策 I-5：唯一鉴权入口 `can()`
 *   - 决策 I-10：列表不分页
 *
 * 验收标准：工单 T5-06 六条；基线 AC-US-05-07（可选做按负责人过滤的最小视图）。
 *
 * 唯一 seam 是 HTTP 接口层。标记敏感走端点 30（真实路径），其余造数用 harness 工厂。
 *
 * 覆盖：
 *   - 正例：不传 ownerUserId → 项目全部可见任务；传 ownerUserId → 只返回该负责人任务
 *   - 排序：planStart 升序；相同则 createdAt 升序（过滤后仍保持）
 *   - ★ 泄漏反例：未授权成员不带 / 带 ownerUserId，都看不到敏感任务；带敏感任务
 *     负责人的 ownerUserId 时结果必须为空；敏感任务负责人自己（不在名单）也看不到
 *   - 正例：名单内成员与 PM 能看到敏感任务
 *   - 反例：ownerUserId 为项目外用户 / 别的项目成员 / 不存在用户 → 422 NOT_PROJECT_MEMBER
 *   - 权限：非项目成员 → 404 且无任务字段；未登录 → 401；非成员优先级高于 ownerUserId 校验
 *   - 跨项目隔离：项目 A 成员查项目 B → 404；项目 A 结果不含项目 B 的任务
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  viewer = await makeUser('viewer@example.com', '只读成员')
  outsider = await makeUser('outsider@example.com', '项目外用户')
  otherPm = await makeUser('other-pm@example.com', '另一项目PM')
  otherMember = await makeUser('other-member@example.com', '另一项目成员')

  // 项目 A：pm 为 PM，memberA / memberB 为 MEMBER，viewer 为 VIEWER。
  const projectA = await createProjectWithStory(ctx.db, pm.id)
  projectId = projectA.projectId
  storyId = projectA.storyId
  await makeMember(projectId, memberA.id, 'MEMBER')
  await makeMember(projectId, memberB.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')

  // 项目 B：anotherPm 为 PM，otherMember 为 MEMBER。
  const projectB = await createProjectWithStory(ctx.db, otherPm.id, {
    projectName: '另一个项目',
    storyTitle: '另一个故事',
  })
  otherProjectId = projectB.projectId
  otherStoryId = projectB.storyId
  await makeMember(otherProjectId, otherMember.id, 'MEMBER')
})

// ---------------------------------------------------------------------------
// 本地辅助（不改动共享测试基建）
// ---------------------------------------------------------------------------

/** 发起端点 26 请求；query 里的值会被序列化为查询参数。 */
function listProjectTasks(
  actorUserId: string,
  targetProjectId: string = projectId,
  query: Record<string, string> = {},
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .get(`/projects/${targetProjectId}/tasks`)
    .query(query)
}

/** 通过端点 30 把任务标记为敏感并指定可见名单（PM 权限）。 */
function putSensitivity(
  targetTaskId: string,
  body: Record<string, unknown>,
  actorUserId: string = pm.id,
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .put(`/tasks/${targetTaskId}/sensitivity`)
    .send(body)
}

function expectFieldError(body: ErrorBody, field: string, code: string): void {
  expect(body.error.code).toBe('VALIDATION_FAILED')
  expect(body.error.details ?? []).toContainEqual({ field, code })
}

/** 断言响应体不含任务的任何字段（契约 I-3）。 */
function expectNoTaskLeak(body: unknown, forbidden: string[] = []): void {
  const serialized = JSON.stringify(body)
  expect(body).not.toHaveProperty('items')
  expect(body).not.toHaveProperty('id')
  expect(body).not.toHaveProperty('title')
  expect(body).not.toHaveProperty('owner')
  expect(body).not.toHaveProperty('acceptor')
  for (const value of forbidden) {
    expect(serialized).not.toContain(value)
  }
}

/** 造一条普通任务（owner 默认 memberA，acceptor 默认 pm，project/story 默认项目 A）。 */
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

// ---------------------------------------------------------------------------
// 正例：按项目列任务 + 可选负责人过滤
// ---------------------------------------------------------------------------

describe('端点 26 正例：按项目列任务', () => {
  it('不传 ownerUserId → 200 返回项目全部可见任务，内嵌 owner / acceptor 的 UserBrief', async () => {
    const task = await makeTask({ title: '实现列表' })

    const response = await listProjectTasks(pm.id)

    expect(response.status).toBe(200)
    const items = (response.body as { items: TaskView[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe(task.id)
    expect(items[0]?.projectId).toBe(projectId)
    expect(items[0]?.owner).toEqual({
      id: memberA.id,
      account: 'member-a@example.com',
      displayName: '成员A',
    })
    expect(items[0]?.acceptor).toEqual({
      id: pm.id,
      account: 'pm@example.com',
      displayName: '项目经理',
    })
  })

  it('传 ownerUserId → 只返回该负责人的任务（不同负责人被排除）', async () => {
    const ownByA = await makeTask({ title: 'A 的任务' })
    const ownByB = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: memberB.id,
      acceptorUserId: pm.id,
      title: 'B 的任务',
    })

    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: memberA.id })

    expect(response.status).toBe(200)
    const ids = (response.body as { items: TaskView[] }).items.map((task) => task.id)
    expect(ids).toEqual([ownByA.id])
    expect(ids).not.toContain(ownByB.id)
  })

  it('ownerUserId 是合法项目成员但当前没有任务 → 200 空数组', async () => {
    await makeTask({ title: 'A 的任务' })

    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: memberB.id })

    expect(response.status).toBe(200)
    expect((response.body as { items: TaskView[] }).items).toEqual([])
  })

  it('MEMBER / VIEWER 都可访问（project.read 允许）', async () => {
    await makeTask({ title: '普通任务' })

    expect((await listProjectTasks(memberA.id)).status).toBe(200)
    expect((await listProjectTasks(viewer.id)).status).toBe(200)
  })

  it('空项目任务列表 → 200 { items: [] }（列表不分页，无 total 等额外字段）', async () => {
    const response = await listProjectTasks(pm.id)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [] })
  })
})

// ---------------------------------------------------------------------------
// 排序：planStart 升序，相同按 createdAt 升序
// ---------------------------------------------------------------------------

describe('端点 26 排序', () => {
  it('按 planStart 升序；planStart 相同按 createdAt 升序', async () => {
    await makeTask({
      title: '晚开始',
      planStart: '2026-03-01',
      planEnd: '2026-03-10',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    await makeTask({
      title: '早开始',
      planStart: '2026-01-01',
      planEnd: '2026-01-10',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    })
    await makeTask({
      title: '同开始-后创建',
      planStart: '2026-02-01',
      planEnd: '2026-02-10',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await makeTask({
      title: '同开始-先创建',
      planStart: '2026-02-01',
      planEnd: '2026-02-10',
      createdAt: new Date('2025-12-31T00:00:00.000Z'),
    })

    const response = await listProjectTasks(pm.id)
    const titles = (response.body as { items: TaskView[] }).items.map((task) => task.title)

    expect(titles).toEqual(['早开始', '同开始-先创建', '同开始-后创建', '晚开始'])
  })

  it('ownerUserId 过滤后仍保持 planStart / createdAt 排序', async () => {
    await makeTask({
      title: 'A 晚',
      planStart: '2026-05-01',
      planEnd: '2026-05-10',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await makeTask({
      title: 'A 早',
      planStart: '2026-04-01',
      planEnd: '2026-04-10',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: memberA.id })
    const titles = (response.body as { items: TaskView[] }).items.map((task) => task.title)

    expect(titles).toEqual(['A 早', 'A 晚'])
  })
})

// ---------------------------------------------------------------------------
// ★ 泄漏反例：端点 26 是敏感任务的第四条查询路径
// ---------------------------------------------------------------------------

describe('端点 26 可见性：敏感任务不泄漏（第四条查询路径）', () => {
  /**
   * 两条任务：一条普通（owner=memberA），一条敏感（owner=memberA，白名单只放 memberB）。
   * 返回 [ordinary, sensitive]。
   */
  async function setupSensitiveTask() {
    // 普通任务的负责人是 pm（不是 memberA），这样按 memberA 过滤时若出现结果
    // 就只可能是那条敏感任务 —— 泄漏与否一眼可判。
    const ordinary = await makeTask({
      title: '普通任务',
      ownerUserId: pm.id,
      acceptorUserId: memberA.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-10',
    })
    const sensitive = await makeTask({
      title: '机密任务',
      description: '机密描述',
      planStart: '2026-02-01',
      planEnd: '2026-02-10',
    })
    const marked = await putSensitivity(sensitive.id, {
      isSensitive: true,
      visibleMemberIds: [memberB.id],
    })
    expect(marked.status).toBe(200)
    return { ordinary, sensitive }
  }

  // T2.5 已合入：敏感对象白名单判定与 visibilityScope 查询层过滤均已落地，本用例前提成立
  it('未授权成员不带 ownerUserId → 列表中不含敏感任务，items 长度不计入它（计数不泄漏）', async () => {
    const { ordinary } = await setupSensitiveTask()

    // 数据库里确有两条任务，但 viewer 的列表只看到一条。
    expect(await ctx.db.task.count({ where: { projectId } })).toBe(2)
    const response = await listProjectTasks(viewer.id)

    expect(response.status).toBe(200)
    const ids = (response.body as { items: TaskView[] }).items.map((task) => task.id)
    expect(ids).toEqual([ordinary.id])
  })

  // T2.5 已合入：敏感对象白名单判定与 visibilityScope 查询层过滤均已落地，本用例前提成立
  it('★ 未授权成员带敏感任务负责人的 ownerUserId 过滤 → 结果必须为空（最易漏的泄漏路径）', async () => {
    const { sensitive } = await setupSensitiveTask()

    const response = await listProjectTasks(viewer.id, projectId, { ownerUserId: memberA.id })

    expect(response.status).toBe(200)
    const serialized = JSON.stringify(response.body)
    expect((response.body as { items: TaskView[] }).items).toEqual([])
    // 响应体连敏感任务的标题 / 描述都不出现。
    expect(serialized).not.toContain('机密任务')
    expect(serialized).not.toContain('机密描述')
    expect(serialized).not.toContain(sensitive.id)
  })

  // T2.5 已合入：敏感对象白名单判定与 visibilityScope 查询层过滤均已落地，本用例前提成立
  it('敏感任务负责人自己不在白名单 → 带自己的 ownerUserId 也看不到它', async () => {
    await setupSensitiveTask()

    const response = await listProjectTasks(memberA.id, projectId, { ownerUserId: memberA.id })

    expect(response.status).toBe(200)
    // memberA 名下只有那条敏感任务，且自己不在白名单，因此被作用域过滤为空。
    expect((response.body as { items: TaskView[] }).items).toEqual([])
  })
})

describe('端点 26 可见性正例：授权成员能看到敏感任务', () => {
  async function setupSensitiveTask() {
    const sensitive = await makeTask({
      title: '机密任务',
      planStart: '2026-02-01',
      planEnd: '2026-02-10',
    })
    await putSensitivity(sensitive.id, { isSensitive: true, visibleMemberIds: [memberB.id] })
    return sensitive
  }

  it('名单内成员不带 ownerUserId → 能看到敏感任务', async () => {
    const sensitive = await setupSensitiveTask()

    const response = await listProjectTasks(memberB.id)

    expect(response.status).toBe(200)
    const ids = (response.body as { items: TaskView[] }).items.map((task) => task.id)
    expect(ids).toContain(sensitive.id)
  })

  it('名单内成员带该负责人 ownerUserId → 能看到敏感任务（授权后过滤也保留）', async () => {
    const sensitive = await setupSensitiveTask()

    const response = await listProjectTasks(memberB.id, projectId, { ownerUserId: memberA.id })

    expect(response.status).toBe(200)
    const ids = (response.body as { items: TaskView[] }).items.map((task) => task.id)
    expect(ids).toEqual([sensitive.id])
  })

  it('PM 始终可见敏感任务，且可带负责人过滤', async () => {
    const sensitive = await setupSensitiveTask()

    const all = await listProjectTasks(pm.id)
    expect((all.body as { items: TaskView[] }).items.map((task) => task.id)).toContain(sensitive.id)

    const filtered = await listProjectTasks(pm.id, projectId, { ownerUserId: memberA.id })
    expect((filtered.body as { items: TaskView[] }).items.map((task) => task.id)).toEqual([
      sensitive.id,
    ])
  })
})

// ---------------------------------------------------------------------------
// ownerUserId 校验反例
// ---------------------------------------------------------------------------

describe('端点 26 ownerUserId 校验反例', () => {
  it('ownerUserId 不是本项目成员 → 422 NOT_PROJECT_MEMBER', async () => {
    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: outsider.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('ownerUserId 是别的项目的成员 → 同样 422 NOT_PROJECT_MEMBER（最易漏的变体）', async () => {
    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: otherMember.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('ownerUserId 是不存在的用户 → 422 NOT_PROJECT_MEMBER', async () => {
    const response = await listProjectTasks(pm.id, projectId, {
      ownerUserId: 'does-not-exist-user',
    })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('校验失败时不返回任何任务（避免在校验错误的响应里泄漏数据）', async () => {
    await makeTask({ title: '普通任务' })

    const response = await listProjectTasks(pm.id, projectId, { ownerUserId: outsider.id })
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(422)
    expect(serialized).not.toContain('普通任务')
    expect(response.body).not.toHaveProperty('items')
  })
})

// ---------------------------------------------------------------------------
// 权限与跨项目隔离
// ---------------------------------------------------------------------------

describe('端点 26 权限反例', () => {
  it('非项目成员访问 → 404 NOT_FOUND 且响应体不含任务任何字段', async () => {
    await makeTask({ title: '普通任务' })

    const response = await listProjectTasks(outsider.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoTaskLeak(response.body, ['普通任务', projectId])
  })

  it('非项目成员即使带合法 ownerUserId 也先判 404（鉴权先于业务校验）', async () => {
    const response = await listProjectTasks(outsider.id, projectId, { ownerUserId: memberA.id })

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录（缺少 Actor）→ 401 UNAUTHENTICATED', async () => {
    const response = await ctx.asUser(null).get(`/projects/${projectId}/tasks`)

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('项目不存在 → 404，且与非成员访问的响应体完全一致', async () => {
    const missing = await listProjectTasks(pm.id, 'does-not-exist-project')
    const nonMember = await listProjectTasks(outsider.id)

    expect(missing.status).toBe(404)
    expect(missing.body).toEqual(nonMember.body)
  })
})

describe('端点 26 跨项目隔离', () => {
  it('项目 A 的成员查项目 B → 404 NOT_FOUND', async () => {
    const response = await listProjectTasks(pm.id, otherProjectId)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('项目 A 的查询结果不含项目 B 的任务', async () => {
    await makeTask({ title: 'A 的任务' })
    const bTask = await createTaskRow(ctx.db, {
      projectId: otherProjectId,
      storyId: otherStoryId,
      ownerUserId: otherMember.id,
      acceptorUserId: otherPm.id,
      title: 'B 的任务',
    })

    const response = await listProjectTasks(pm.id, projectId)
    const ids = (response.body as { items: TaskView[] }).items.map((task) => task.id)

    expect(response.status).toBe(200)
    expect(ids).not.toContain(bTask.id)
    expect((response.body as { items: TaskView[] }).items).toHaveLength(1)
  })
})
