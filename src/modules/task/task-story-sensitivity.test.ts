/**
 * 统一验收任务 04 —— M3「故事级敏感」与 M5 任务端点（24 / 25 / 26 / 27）的交叉链路
 *
 * 背景：T5-05 / T5-06 已覆盖「任务级敏感」（端点 30 + 任务列表/详情/负责人过滤），
 * 以及 authz 侧 `can()` 对敏感故事的单元级矩阵。但**没有**任何 HTTP 用例验证：
 * 当敏感标在**用户故事**上（而非任务上）时，任务端点各自的行为。
 *
 * 这是真实存在的调用路径：任务端点的鉴权对象不同 ——
 *   端点 24（故事任务列表）/ 25（创建任务）以 `{ kind: 'story', objectId: storyId }`
 *       调 `can()`，因此继承故事级敏感（未授权成员 → 404）；
 *   端点 26（项目任务表）/ 27（任务详情）以 `{ kind: 'task', ... }` 调 `can()`，
 *       只按**任务自身**的 `isSensitive` 判定，不继承故事敏感。
 * 二者的组合行为此前无回归保护，本文件补齐。
 *
 * 端点 26 / 27 与 24 / 25 的口径差异（见最后一组用例）：故事敏感、但其下任务
 *    未单独标敏感时，未授权成员经 26 / 27 仍可见该任务，而 24 / 25 因鉴权对象是
 *    故事返回 404。经团队确认（2026-09-24），故事与任务的敏感是两个独立对象
 *    （`ObjectVisibility.objectType = story | task`），故此为**契约内行为**，
 *    本文件最后一组用例将其钉住为回归基线。
 *
 * 唯一 seam 是 HTTP 接口层：断言打在状态码、错误码与响应体外泄上。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../shared/types.js'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import { makeUser, makeProject, makeGoal, makeActivity, makeStory, makeMember } from '../../../test/factories.js'

// 数据前置：项目 + 目标 + 活动 + 故事（组合 test/factories.js 的真实工厂）。
async function createProjectWithStory(
  _db: unknown,
  ownerUserId: string,
): Promise<{ projectId: string; storyId: string }> {
  const { projectId } = await makeProject(ownerUserId, '测试项目')
  const goalId = await makeGoal(projectId, '测试目标')
  const activityId = await makeActivity(goalId, '测试活动')
  const storyId = await makeStory(activityId, {
    title: '秘密需求',
    capabilityText: '拆任务',
    valueText: '推进交付',
    businessValue: '高',
    priority: 'P0',
  })
  return { projectId, storyId }
}

// 直接插入任务行（工厂 makeTask 不允许指定 createdAt 或构造非法数据；故走 ctx.db）。
async function createTaskRow(
  params: {
    projectId: string
    storyId: string
    ownerUserId: string
    acceptorUserId: string
    title?: string
    isSensitive?: boolean
  },
) {
  return ctx.db.task.create({
    data: {
      projectId: params.projectId,
      storyId: params.storyId,
      title: params.title ?? '普通任务',
      ownerUserId: params.ownerUserId,
      acceptorUserId: params.acceptorUserId,
      planStart: '2026-09-01',
      planEnd: '2026-09-10',
      isSensitive: params.isSensitive ?? false,
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
let allowed: { id: string }
let blocked: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string
let taskId: string

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser('pm@example.com', '项目经理')
  allowed = await makeUser('allowed@example.com', '名单内成员')
  blocked = await makeUser('blocked@example.com', '名单外成员')
  viewer = await makeUser('viewer@example.com', '管理者')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const project = await createProjectWithStory(ctx.db, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await makeMember(projectId, allowed.id, 'MEMBER')
  await makeMember(projectId, blocked.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')

  // 非敏感基线任务：owner=allowed、acceptor=pm。
  const task = await createTaskRow({
    projectId,
    storyId,
    ownerUserId: allowed.id,
    acceptorUserId: pm.id,
    title: '普通任务',
  })
  taskId = task.id
})

// ---------------------------------------------------------------------------
// 本地辅助（不改动共享测试基建）
// ---------------------------------------------------------------------------

/** 端点 23：把故事标记为敏感并指定可见成员（仅 PM）。 */
function putStorySensitivity(
  body: Record<string, unknown>,
  actorUserId: string = pm.id,
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .put(`/stories/${storyId}/sensitivity`)
    .send(body)
}

/** 端点 24：故事任务列表。 */
function listStoryTasks(actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/stories/${storyId}/tasks`)
}

/** 端点 25：在故事下创建任务。 */
function createTaskInStory(body: Record<string, unknown>, actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).post(`/stories/${storyId}/tasks`).send(body)
}

/** 端点 26：项目任务表。 */
function listProjectTasks(actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${projectId}/tasks`)
}

/** 端点 27：任务详情。 */
function getTask(actorUserId: string, targetTaskId: string = taskId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/tasks/${targetTaskId}`)
}

function validTaskBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '敏感故事下的新任务',
    ownerUserId: allowed.id,
    acceptorUserId: pm.id,
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
    ...overrides,
  }
}

/** 断言响应体不含任务/故事的任何字段（契约 I-3）。 */
function expectNoObjectLeak(body: unknown): void {
  const serialized = JSON.stringify(body)
  expect(body).not.toHaveProperty('items')
  expect(body).not.toHaveProperty('id')
  expect(body).not.toHaveProperty('title')
  expect(serialized).not.toContain('普通任务')
  expect(serialized).not.toContain('秘密需求')
  expect(serialized).not.toContain(storyId)
}

// ---------------------------------------------------------------------------
// 端点 24 / 25：以故事为鉴权对象，继承故事级敏感
// ---------------------------------------------------------------------------

describe('敏感故事对端点 24（故事任务列表）的门禁', () => {
  it('未授权 MEMBER → 404，且响应体与「故事不存在」逐字一致、不含任务字段', async () => {
    expect((await putStorySensitivity({ isSensitive: true, visibleMemberIds: [allowed.id] })).status).toBe(200)

    const hidden = await listStoryTasks(blocked.id)
    const missing = await ctx.asUser(ctx.loginAs(pm.id)).get('/stories/does-not-exist/tasks')

    expect(hidden.status).toBe(404)
    expect(hidden.body).toEqual(missing.body)
    expect((hidden.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoObjectLeak(hidden.body)
  })

  it('名单内 MEMBER 与 PM 均可读，非敏感任务列表照常返回', async () => {
    await putStorySensitivity({ isSensitive: true, visibleMemberIds: [allowed.id] })

    for (const actor of [allowed.id, pm.id]) {
      const response = await listStoryTasks(actor)
      expect(response.status).toBe(200)
      expect((response.body as { items: TaskView[] }).items.map((task) => task.id)).toEqual([taskId])
    }
  })

  it('关闭敏感后，同一个 token 的端点 24 立即恢复 200（无进程内缓存）', async () => {
    const token = ctx.loginAs(blocked.id)
    await putStorySensitivity({ isSensitive: true, visibleMemberIds: [allowed.id] })
    expect((await ctx.asUser(token).get(`/stories/${storyId}/tasks`)).status).toBe(404)

    await putStorySensitivity({ isSensitive: false, visibleMemberIds: [] })
    expect((await ctx.asUser(token).get(`/stories/${storyId}/tasks`)).status).toBe(200)
  })
})

describe('敏感故事对端点 25（创建任务）的门禁', () => {
  it('未授权 MEMBER → 404，且任务表行数不变（写入被拒）', async () => {
    await putStorySensitivity({ isSensitive: true, visibleMemberIds: [allowed.id] })
    const before = await ctx.db.task.count()

    const response = await createTaskInStory(validTaskBody(), blocked.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await ctx.db.task.count()).toBe(before)
  })

  it('名单内 MEMBER → 403（对象可见，但 task.write 仅 PM），且任务表行数不变', async () => {
    await putStorySensitivity({ isSensitive: true, visibleMemberIds: [allowed.id] })
    const before = await ctx.db.task.count()

    const response = await createTaskInStory(validTaskBody(), allowed.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(await ctx.db.task.count()).toBe(before)
  })

  it('PM 可正常创建（敏感不影响 PM 写路径）', async () => {
    await putStorySensitivity({ isSensitive: true, visibleMemberIds: [] })

    const response = await createTaskInStory(validTaskBody(), pm.id)

    expect(response.status).toBe(201)
    expect((response.body as TaskView).title).toBe('敏感故事下的新任务')
  })
})

// ---------------------------------------------------------------------------
// 端点 26 / 27：以任务为鉴权对象，只按任务级敏感判定
//
// 与端点 24 / 25 的口径差异：故事本身敏感、但其下任务未标敏感时，未授权成员
//    仍能经 26 / 27 看到该任务。经团队确认（2026-09-24），故事敏感与任务敏感是
//    两个独立对象，契约端点 26 的 `说明` 只冻结任务级 `visibilityScope`，故此为
//    契约内行为，此处钉住为回归基线（见 docs/sprint1-current-status.md §6.1）。
// ---------------------------------------------------------------------------

describe('端点 26 / 27 只按任务级敏感判定（已确认为契约内行为）', () => {
  it('故事敏感但任务非敏感时：未授权成员仍能经端点 26 列出、经端点 27 读取该任务', async () => {
    await putStorySensitivity({ isSensitive: true, visibleMemberIds: [allowed.id] })

    // 端点 24 对同一成员是 404（继承故事敏感）……
    expect((await listStoryTasks(blocked.id)).status).toBe(404)

    // ……但端点 26 / 27 不继承，仍可见该非敏感任务。
    const projectList = await listProjectTasks(blocked.id)
    expect(projectList.status).toBe(200)
    expect((projectList.body as { items: TaskView[] }).items.map((task) => task.id)).toContain(taskId)

    const detail = await getTask(blocked.id)
    expect(detail.status).toBe(200)
    expect((detail.body as TaskView).id).toBe(taskId)
  })

  it('任务本身也敏感、且成员未授权时：端点 27 与端点 26 都不泄漏（与任务级规则一致）', async () => {
    // 只把**任务**标敏感（故事保持非敏感）。
    const marked = await ctx.asUser(ctx.loginAs(pm.id))
      .put(`/tasks/${taskId}/sensitivity`)
      .send({ isSensitive: true, visibleMemberIds: [allowed.id] })
    expect(marked.status).toBe(200)

    const detail = await getTask(blocked.id)
    expect(detail.status).toBe(404)
    expect((detail.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoObjectLeak(detail.body)

    const projectList = await listProjectTasks(blocked.id)
    expect(projectList.status).toBe(200)
    expect((projectList.body as { items: TaskView[] }).items).toHaveLength(0)
  })
})
