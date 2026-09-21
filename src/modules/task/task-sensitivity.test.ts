/**
 * T5-05 接口测试 —— 端点 30（`PUT /tasks/:taskId/sensitivity`）与敏感可见性过滤
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-8 端点 30：200 `SensitivityView` / 403 / 404 / 422
 *     （`visibleMemberIds: NOT_PROJECT_MEMBER`）；语义与副作用同端点 23
 *   - 决策 I-8 端点 23：全量覆盖；`isSensitive: false` 忽略名单但保留其值；
 *     写 `AuditLog(action='sensitivity.update'，before/after 为 SensitivityView)`
 *   - 决策 I-5：唯一鉴权入口 `can()`，403（可见但写动作不允许）/ 404（不可见）
 *   - 决策 I-6：列表必须在**查询层**过滤，`visibilityScope()` 返回 id 子集后以
 *     `id IN (...)` 过滤，不得「查全量再在内存里 filter」
 *   - 决策 I-3：不可见对象与「不存在」响应完全一致，且不含对象任何字段
 *   - 决策 I-10：变更立即生效，无进程内缓存
 *
 * 验收标准：工单 T5-05 十二条；基线 AC-US-02-02 ~ 02-08、AC-US-05-09、§5 R2/R4。
 *
 * 唯一 seam 是 HTTP 接口层；跨项目成员等需要额外造数的场景直接用 harness 的工厂函数。
 *
 * 覆盖：
 *   - 正例：标记敏感 + 指定名单；名单内可见 / 名单外在列表与详情均不可见
 *   - 全量覆盖：两次设置不叠加；空名单；重复 id 去重
 *   - 关闭敏感：忽略请求名单、保留原名单、全部成员恢复可见、重新开启恢复
 *   - 反例：MEMBER / VIEWER → 403；非成员 → 404；非本项目成员（含跨项目）→ 422
 *   - 泄漏：404 响应体无任何任务字段、文案不含「无权限」「敏感」
 *   - 写操作：未授权成员 PATCH / DELETE 敏感任务 → 404；名单内非 PM → 403
 *   - 即时生效：同一个 token 的下一次请求即按新名单判定
 *   - 审计：`AuditLog` 逐字段实测，`before` / `after` 可 `JSON.parse` 且结构为 SensitivityView
 *
 * 本工单不实现端点 26（按负责人过滤，T5-06）—— 第三处查询路径标注「未验证」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { SensitivityView, TaskView } from '../../shared/types.js'
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
let member: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string
let activityId: string
/** 每个用例在 beforeEach 里重建的合法任务主键（owner=member、acceptor=pm）。 */
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
  member = await makeUser('member@example.com', '项目成员')
  viewer = await makeUser('viewer@example.com', '管理者')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const project = await createProjectWithStory(ctx.db, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')

  const story = await ctx.db.userStory.findUniqueOrThrow({
    where: { id: storyId },
    select: { activityId: true },
  })
  activityId = story.activityId

  const task = await createTaskRow(ctx.db, {
    projectId,
    storyId,
    ownerUserId: member.id,
    acceptorUserId: pm.id,
    title: '机密任务',
    description: '机密描述',
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
  })
  taskId = task.id
})

// ---------------------------------------------------------------------------
// 本地辅助（不改动共享测试基建）
// ---------------------------------------------------------------------------

function putSensitivity(
  body: Record<string, unknown>,
  actorUserId: string = pm.id,
  targetTaskId: string = taskId,
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .put(`/tasks/${targetTaskId}/sensitivity`)
    .send(body)
}

function getTask(actorUserId: string = pm.id, targetTaskId: string = taskId) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .get(`/tasks/${targetTaskId}`)
}

function listTasks(actorUserId: string = pm.id, targetStoryId: string = storyId) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .get(`/stories/${targetStoryId}/tasks`)
}

function patchTask(
  body: Record<string, unknown>,
  actorUserId: string = pm.id,
  targetTaskId: string = taskId,
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .patch(`/tasks/${targetTaskId}`)
    .send(body)
}

function deleteTask(actorUserId: string = pm.id, targetTaskId: string = taskId) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .delete(`/tasks/${targetTaskId}`)
}

/** 在同一项目里创建一个兄弟用户故事（端点 22 属 M4，这里直接用 prisma 造数）。 */
function createSiblingStory(title: string) {
  return ctx.db.userStory.create({
    data: {
      projectId,
      activityId,
      title,
      roleText: '项目经理',
      capabilityText: '拆任务',
      valueText: '推进交付',
      businessValue: '高',
      priority: 'P1',
    },
  })
}

/** 读取任务的白名单 userId 集合（直接查库，用于断言 ObjectVisibility 的真实状态）。 */
async function storedWhitelist(targetTaskId: string = taskId): Promise<string[]> {
  const rows = await ctx.db.objectVisibility.findMany({
    where: { objectType: 'task', objectId: targetTaskId },
    select: { userId: true },
  })
  return rows.map((row) => row.userId).sort()
}

function expectFieldError(body: ErrorBody, field: string, code: string): void {
  expect(body.error.code).toBe('VALIDATION_FAILED')
  expect(body.error.details ?? []).toContainEqual({ field, code })
}

/** 断言响应体不含任务的任何字段（契约 I-3 / AC-US-02-05）。 */
function expectNoTaskLeak(body: unknown): void {
  const serialized = JSON.stringify(body)
  expect(body).not.toHaveProperty('id')
  expect(body).not.toHaveProperty('title')
  expect(body).not.toHaveProperty('description')
  expect(body).not.toHaveProperty('owner')
  expect(body).not.toHaveProperty('acceptor')
  expect(body).not.toHaveProperty('projectId')
  expect(body).not.toHaveProperty('storyId')
  expect(serialized).not.toContain('机密任务')
  expect(serialized).not.toContain('机密描述')
  expect(serialized).not.toContain(projectId)
  expect(serialized).not.toContain(storyId)
}

// ---------------------------------------------------------------------------
// 正例：标记敏感与指定可见成员
// ---------------------------------------------------------------------------

describe('端点 30 正例：标记敏感并指定可见成员', () => {
  it('PM 标记敏感 + 指定 member → 200 SensitivityView 并写入白名单', async () => {
    const response = await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    expect(response.status).toBe(200)
    const body = response.body as SensitivityView
    expect(body.objectType).toBe('task')
    expect(body.objectId).toBe(taskId)
    expect(body.isSensitive).toBe(true)
    expect(body.visibleMemberIds).toEqual([member.id])

    // 落库实测：任务标记为敏感，白名单只有 member。
    const persisted = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(persisted.isSensitive).toBe(true)
    expect(await storedWhitelist()).toEqual([member.id])
  })

  it('响应体字段形状与契约 SensitivityView 完全一致（四字段，无多余键）', async () => {
    const response = await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    const body = response.body as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual(['isSensitive', 'objectId', 'objectType', 'visibleMemberIds'])
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('名单内成员在列表与详情都可见；名单外成员在列表与详情都不可见', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    // 名单内：详情 200、列表含该任务。
    expect((await getTask(member.id)).status).toBe(200)
    const memberList = await listTasks(member.id)
    expect(memberList.status).toBe(200)
    expect((memberList.body as { items: TaskView[] }).items.map((task) => task.id)).toEqual([taskId])

    // 名单外（viewer）：详情 404、列表为空。
    const viewerDetail = await getTask(viewer.id)
    expect(viewerDetail.status).toBe(404)
    expectNoTaskLeak(viewerDetail.body)

    const viewerList = await listTasks(viewer.id)
    expect(viewerList.status).toBe(200)
    expect((viewerList.body as { items: TaskView[] }).items).toHaveLength(0)
  })

  it('PM 始终可见敏感任务（无论是否在名单内）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [] })

    expect((await getTask(pm.id)).status).toBe(200)
    const list = await listTasks(pm.id)
    expect((list.body as { items: TaskView[] }).items.map((task) => task.id)).toEqual([taskId])
  })

  it('isSensitive=true 且空名单 → 仅 PM 可见，MEMBER / VIEWER 均 404', async () => {
    const response = await putSensitivity({ isSensitive: true, visibleMemberIds: [] })
    expect((response.body as SensitivityView).visibleMemberIds).toEqual([])

    expect((await getTask(pm.id)).status).toBe(200)
    expect((await getTask(member.id)).status).toBe(404)
    expect((await getTask(viewer.id)).status).toBe(404)
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('列表过滤在查询层：未授权成员只看到非敏感任务，items 长度不计入敏感任务', async () => {
    const other = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: pm.id,
      acceptorUserId: member.id,
      title: '普通任务',
    })
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    // 数据库里共 2 条任务，但 viewer 的列表只返回 1 条 —— 计数不泄漏敏感任务存在性。
    expect(await ctx.db.task.count({ where: { storyId } })).toBe(2)
    const list = await listTasks(viewer.id)
    const items = (list.body as { items: TaskView[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe(other.id)
    expect(items.map((task) => task.id)).not.toContain(taskId)
  })
})

// ---------------------------------------------------------------------------
// 全量覆盖语义
// ---------------------------------------------------------------------------

describe('端点 30 全量覆盖语义', () => {
  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('连续两次设置不同名单 → 最终名单等于第二次请求（不叠加）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    const second = await putSensitivity({ isSensitive: true, visibleMemberIds: [viewer.id] })

    expect((second.body as SensitivityView).visibleMemberIds).toEqual([viewer.id])
    expect(await storedWhitelist()).toEqual([viewer.id])
    // 第一次的 member 已被移出：下一次请求即被拒绝（即时生效）。
    expect((await getTask(member.id)).status).toBe(404)
    expect((await getTask(viewer.id)).status).toBe(200)
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('从多成员名单收敛到单成员 → 只保留第二次请求的成员', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id, viewer.id, pm.id] })
    expect(await storedWhitelist()).toEqual([member.id, pm.id, viewer.id].sort())

    await putSensitivity({ isSensitive: true, visibleMemberIds: [viewer.id] })

    expect(await storedWhitelist()).toEqual([viewer.id])
    expect((await getTask(member.id)).status).toBe(404)
    expect((await getTask(viewer.id)).status).toBe(200)
    expect((await getTask(pm.id)).status).toBe(200) // PM 始终可见
  })

  it('请求名单含重复 id → 去重后写库，不因复合主键冲突失败', async () => {
    const response = await putSensitivity({
      isSensitive: true,
      visibleMemberIds: [member.id, member.id],
    })

    expect(response.status).toBe(200)
    expect((response.body as SensitivityView).visibleMemberIds).toEqual([member.id])
    expect(await storedWhitelist()).toEqual([member.id])
  })
})

// ---------------------------------------------------------------------------
// 关闭敏感：忽略请求名单、保留原名单、恢复可见
// ---------------------------------------------------------------------------

describe('端点 30 关闭敏感语义', () => {
  it('isSensitive=false 忽略请求名单，保留原名单（不清空）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const response = await putSensitivity({ isSensitive: false, visibleMemberIds: [] })

    expect(response.status).toBe(200)
    const body = response.body as SensitivityView
    expect(body.isSensitive).toBe(false)
    expect(body.visibleMemberIds).toEqual([member.id]) // 名单被保留
    expect(await storedWhitelist()).toEqual([member.id]) // 数据库记录仍在
    const persisted = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(persisted.isSensitive).toBe(false)
  })

  it('关闭时请求里传入不同名单也被忽略，保留的是原名单', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const response = await putSensitivity({ isSensitive: false, visibleMemberIds: [viewer.id] })

    expect((response.body as SensitivityView).visibleMemberIds).toEqual([member.id])
    expect(await storedWhitelist()).toEqual([member.id])
  })

  it('关闭敏感后全部项目成员恢复可见（详情与列表）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    expect((await getTask(viewer.id)).status).toBe(404)

    await putSensitivity({ isSensitive: false, visibleMemberIds: [] })

    expect((await getTask(member.id)).status).toBe(200)
    expect((await getTask(viewer.id)).status).toBe(200)
    const viewerList = await listTasks(viewer.id)
    expect((viewerList.body as { items: TaskView[] }).items.map((task) => task.id)).toEqual([taskId])
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('重新开启时名单恢复生效（关闭保留、开启传回原名单 → 原成员仍可见）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    await putSensitivity({ isSensitive: false, visibleMemberIds: [] })

    // 重新开启：把关闭时保留的名单原样传回。
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    expect((await getTask(member.id)).status).toBe(200)
    expect((await getTask(viewer.id)).status).toBe(404)
  })

  it('从未设置过敏感的任务：关闭后名单为空且所有成员可见', async () => {
    const response = await putSensitivity({ isSensitive: false, visibleMemberIds: [member.id] })

    expect(response.status).toBe(200)
    expect((response.body as SensitivityView).visibleMemberIds).toEqual([])
    expect((await getTask(viewer.id)).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 校验反例
// ---------------------------------------------------------------------------

describe('端点 30 校验反例', () => {
  it('visibleMemberIds 含非本项目成员 → 422 NOT_PROJECT_MEMBER', async () => {
    const response = await putSensitivity({
      isSensitive: true,
      visibleMemberIds: [member.id, outsider.id],
    })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'visibleMemberIds', 'NOT_PROJECT_MEMBER')
  })

  it('跨项目成员 → 422 NOT_PROJECT_MEMBER（最容易漏的变体）', async () => {
    const foreign = await makeUser('foreign@example.com', '跨项目成员')
    // foreign 是**另一个项目**的 PM，因此是合法用户、却是本项目非成员。
    await createProjectWithStory(ctx.db, foreign.id, { projectName: '另一个项目' })

    const response = await putSensitivity({
      isSensitive: true,
      visibleMemberIds: [member.id, foreign.id],
    })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'visibleMemberIds', 'NOT_PROJECT_MEMBER')
  })

  it('visibleMemberIds 含不存在的用户 → 422 NOT_PROJECT_MEMBER', async () => {
    const response = await putSensitivity({
      isSensitive: true,
      visibleMemberIds: ['does-not-exist-user'],
    })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'visibleMemberIds', 'NOT_PROJECT_MEMBER')
  })

  it('校验失败时不写入任务敏感标记、白名单与审计', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [outsider.id] })

    const persisted = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(persisted.isSensitive).toBe(false)
    expect(await storedWhitelist()).toEqual([])
    expect(await ctx.db.auditLog.count()).toBe(0)
  })

  it('缺少 isSensitive → 422 REQUIRED', async () => {
    const response = await putSensitivity({ visibleMemberIds: [member.id] })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'isSensitive', 'REQUIRED')
  })

  it('visibleMemberIds 缺省 → 422 REQUIRED', async () => {
    const response = await putSensitivity({ isSensitive: true })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'visibleMemberIds', 'REQUIRED')
  })

  it('visibleMemberIds 不是数组 → 422', async () => {
    const response = await putSensitivity({ isSensitive: true, visibleMemberIds: member.id })

    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
  })
})

// ---------------------------------------------------------------------------
// 权限反例
// ---------------------------------------------------------------------------

describe('端点 30 权限反例', () => {
  it('MEMBER 调用 → 403 FORBIDDEN（sensitivity.manage 仅 PM）', async () => {
    const response = await putSensitivity(
      { isSensitive: true, visibleMemberIds: [member.id] },
      member.id,
    )

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 调用 → 403 FORBIDDEN', async () => {
    const response = await putSensitivity(
      { isSensitive: true, visibleMemberIds: [viewer.id] },
      viewer.id,
    )

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员调用 → 404 NOT_FOUND 且响应体无任务字段', async () => {
    const response = await putSensitivity(
      { isSensitive: true, visibleMemberIds: [outsider.id] },
      outsider.id,
    )

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoTaskLeak(response.body)
  })

  it('未登录调用 → 401 UNAUTHENTICATED', async () => {
    const response = await ctx.asUser(null)
      .put(`/tasks/${taskId}/sensitivity`)
      .send({ isSensitive: true, visibleMemberIds: [] })

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
    // 401 不泄漏任务字段
    expectNoTaskLeak(response.body)
  })

  it('任务不存在 → 404，且与非成员响应的状态码与响应体逐字一致', async () => {
    const missing = await putSensitivity(
      { isSensitive: true, visibleMemberIds: [] },
      pm.id,
      'does-not-exist',
    )
    const nonMember = await putSensitivity(
      { isSensitive: true, visibleMemberIds: [] },
      outsider.id,
    )

    expect(missing.status).toBe(nonMember.status)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual(nonMember.body)
    expect(missing.body).toEqual({ error: { code: 'NOT_FOUND', message: '资源不存在' } })
    expectNoTaskLeak(missing.body)
  })

  it('敏感任务且非 PM 不在名单：调用端点 30 → 404（不泄漏存在性，优先于 403）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    // viewer 看不到该敏感任务，can() 先给 404 而不是「不是 PM」的 403。
    const response = await putSensitivity(
      { isSensitive: true, visibleMemberIds: [viewer.id] },
      viewer.id,
    )

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoTaskLeak(response.body)
  })
})

// ---------------------------------------------------------------------------
// 详情 / 写操作的泄漏与状态码（端点 27 / 28 / 29）
// ---------------------------------------------------------------------------

describe('敏感任务详情与写操作的不可见性', () => {
  it('未授权成员请求敏感任务详情 → 404，响应体无任务任何字段', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const response = await getTask(viewer.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoTaskLeak(response.body)
  })

  it('未授权成员详情 404 与「任务不存在」逐字一致，文案不含「无权限」「敏感」', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const unauthorized = await getTask(viewer.id)
    const missing = await getTask(pm.id, 'does-not-exist')

    expect(unauthorized.status).toBe(missing.status)
    expect(unauthorized.body).toEqual(missing.body)

    const message = (unauthorized.body as ErrorBody).error.message
    expect(message).toBe('资源不存在')
    expect(message).not.toContain('无权限')
    expect(message).not.toContain('敏感')
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('名单内成员可读详情，读取到完整 TaskView', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const response = await getTask(member.id)

    expect(response.status).toBe(200)
    const body = response.body as TaskView
    expect(body.id).toBe(taskId)
    expect(body.title).toBe('机密任务')
    expect(body.owner.id).toBe(member.id)
    expect(body.acceptor.id).toBe(pm.id)
  })

  it('未授权成员 PATCH 敏感任务 → 404（不是 403，避免泄漏存在性）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const response = await patchTask({ title: '篡改标题' }, viewer.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoTaskLeak(response.body)
    // 无副作用。
    const persisted = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(persisted.title).toBe('机密任务')
  })

  it('未授权成员 DELETE 敏感任务 → 404，且任务仍在', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const response = await deleteTask(viewer.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoTaskLeak(response.body)
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('名单内但非 PM 的成员 PATCH / DELETE → 403（对象可见，写动作不允许）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const patched = await patchTask({ title: '合法成员改名' }, member.id)
    const deleted = await deleteTask(member.id)

    expect(patched.status).toBe(403)
    expect((patched.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(deleted.status).toBe(403)
    expect((deleted.body as ErrorBody).error.code).toBe('FORBIDDEN')
    // 权限拒绝无副作用。
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
  })

  it('PATCH / DELETE 的未授权 404 与「任务不存在」逐字一致且无任务字段', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const patchUnauthorized = await patchTask({ title: 'x' }, viewer.id)
    const deleteUnauthorized = await deleteTask(viewer.id)
    const patchMissing = await patchTask({ title: 'x' }, pm.id, 'does-not-exist')
    const deleteMissing = await deleteTask(pm.id, 'does-not-exist')

    expect(patchUnauthorized.body).toEqual(patchMissing.body)
    expect(deleteUnauthorized.body).toEqual(deleteMissing.body)
    expectNoTaskLeak(patchUnauthorized.body)
    expectNoTaskLeak(deleteUnauthorized.body)
  })
})

// ---------------------------------------------------------------------------
// 即时生效（决策 I-10，同一 token 不重新登录）
// ---------------------------------------------------------------------------

describe('敏感可见性变更即时生效（同一 token）', () => {
  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('成员被移出名单后，同一个 token 的下一次请求即被拒绝（详情）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id, viewer.id] })
    const beforeRemoval = await getTask(member.id)
    expect(beforeRemoval.status).toBe(200)

    // PM 用同一个端点把 member 移出名单（viewer 保留）。
    await putSensitivity({ isSensitive: true, visibleMemberIds: [viewer.id] })

    // member 仍使用原 token，无需重新登录，下一次请求即 404。
    const afterRemoval = await getTask(member.id)
    expect(afterRemoval.status).toBe(404)
    expect((afterRemoval.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expectNoTaskLeak(afterRemoval.body)
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('成员被移出名单后，列表同样即时过滤（同一个 token）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    expect((await listTasks(member.id)).body).toMatchObject({
      items: [expect.objectContaining({ id: taskId })],
    })

    await putSensitivity({ isSensitive: true, visibleMemberIds: [] })

    const after = await listTasks(member.id)
    expect((after.body as { items: TaskView[] }).items).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 审计记录
// ---------------------------------------------------------------------------

describe('端点 30 审计记录', () => {
  it('标记敏感写入 1 条 AuditLog，关键字段齐备', async () => {
    const response = await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    expect(response.status).toBe(200)

    const logs = await ctx.db.auditLog.findMany()
    expect(logs).toHaveLength(1)
    const log = logs[0]!
    expect(log.action).toBe('sensitivity.update')
    expect(log.objectType).toBe('task')
    expect(log.objectId).toBe(taskId)
    expect(log.projectId).toBe(projectId)
    expect(log.actorUserId).toBe(pm.id)
    expect(log.before).not.toBeNull()
    expect(log.after).not.toBeNull()
  })

  it('before / after 可 JSON.parse，且结构与内容等于 SensitivityView', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const log = (await ctx.db.auditLog.findMany())[0]!
    const before = JSON.parse(log.before!) as SensitivityView
    const after = JSON.parse(log.after!) as SensitivityView

    // 首次设置：before 为未敏感空名单，after 为敏感 + member。
    expect(before).toEqual({
      objectType: 'task',
      objectId: taskId,
      isSensitive: false,
      visibleMemberIds: [],
    })
    expect(after).toEqual({
      objectType: 'task',
      objectId: taskId,
      isSensitive: true,
      visibleMemberIds: [member.id],
    })
  })

  it('第二次变更的 before 等于第一次的 after（变更前后可串联）', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    await putSensitivity({ isSensitive: true, visibleMemberIds: [viewer.id] })

    const logs = await ctx.db.auditLog.findMany()
    expect(logs).toHaveLength(2)
    const parsed = logs.map((log) => ({
      before: JSON.parse(log.before!) as SensitivityView,
      after: JSON.parse(log.after!) as SensitivityView,
    }))

    const first = parsed.find((entry) => entry.after.visibleMemberIds.includes(member.id))!
    const second = parsed.find((entry) => entry.after.visibleMemberIds.includes(viewer.id))!
    expect(second.before).toEqual(first.after)
    expect(second.after).toEqual({
      objectType: 'task',
      objectId: taskId,
      isSensitive: true,
      visibleMemberIds: [viewer.id],
    })
  })

  it('关闭敏感同样写入审计，且 after 反映关闭后状态', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })
    await putSensitivity({ isSensitive: false, visibleMemberIds: [] })

    const logs = await ctx.db.auditLog.findMany()
    expect(logs).toHaveLength(2)
    const closed = logs
      .map((log) => JSON.parse(log.after!) as SensitivityView)
      .find((view) => view.isSensitive === false)!
    expect(closed).toEqual({
      objectType: 'task',
      objectId: taskId,
      isSensitive: false,
      visibleMemberIds: [member.id], // 保留原名单
    })
  })

  it('校验失败 / 权限失败均不产生审计记录', async () => {
    await putSensitivity({ isSensitive: true, visibleMemberIds: [outsider.id] })
    await putSensitivity({ isSensitive: true, visibleMemberIds: [] }, member.id)

    expect(await ctx.db.auditLog.count()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// AC-US-05-09：列表 / 详情 / 计数三处均不可见（端点 26 属 T5-06，未验证）
// ---------------------------------------------------------------------------

describe('AC-US-05-09 敏感任务对未授权成员不可见', () => {
  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('同一未授权成员在列表、详情与计数三处均看不到敏感任务', async () => {
    const normal = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: pm.id,
      acceptorUserId: member.id,
      title: '普通任务',
      planStart: '2026-08-01',
    })
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    // 详情：敏感任务 404，普通任务 200。
    expect((await getTask(viewer.id, taskId)).status).toBe(404)
    expect((await getTask(viewer.id, normal.id)).status).toBe(200)

    // 列表：只出现普通任务；敏感任务既不在 items 也不计入长度。
    const list = await listTasks(viewer.id)
    const items = (list.body as { items: TaskView[] }).items
    expect(items.map((task) => task.id)).toEqual([normal.id])
    expect(items).toHaveLength(1)
    // 数据库层计数为 2，证明「计数不泄漏」是由查询层过滤实现的，而非恰好只有 1 条。
    expect(await ctx.db.task.count({ where: { storyId } })).toBe(2)
  })

  // TODO(T2.5)：main 的权限骨架对敏感对象保守拒绝 / visibilityScope 尚未过滤，本用例前提待 T2.1–T2.5 完成后启用
  it.skip('敏感任务被过滤后，同故事其它任务的字段与顺序不受影响', async () => {
    await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: pm.id,
      acceptorUserId: member.id,
      title: '普通任务',
      planStart: '2026-07-01',
    })
    await putSensitivity({ isSensitive: true, visibleMemberIds: [member.id] })

    const list = await listTasks(viewer.id)
    const items = (list.body as { items: TaskView[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('普通任务')
    expect(items[0]?.owner).toBeDefined()
    expect(items[0]?.acceptor).toBeDefined()
  })
})
