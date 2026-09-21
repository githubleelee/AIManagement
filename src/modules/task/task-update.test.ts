/**
 * T5-03 接口测试 —— 端点 27（任务详情）与端点 28（任务编辑 / 状态推进）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md` 决策 I-8 端点 27/28、
 * 决策 I-10「部分更新语义」、决策 I-4 字段级错误码；验收标准见工单 T5-03
 * 与基线 §2.4.2 的 AC-US-05-02 第二条（编辑绕过）。
 *
 * 唯一 seam 是 HTTP 接口层：全部通过 supertest 发起请求、断言状态码、错误码与
 * 响应体字段，不断言内部实现。
 *
 * 本文件重点覆盖「部分更新合并语义」这一核心风险：
 *   - ACCEPTOR_EQUALS_OWNER 的三条合并路径（只改 owner / 只改 acceptor / 同时改）
 *   - 只改 planStart 使**现有** planEnd 落在其之前 → END_BEFORE_START
 *   - 只改 title 时，若库中已有非法数据（acceptor = owner、planEnd < planStart、
 *     owner 非成员）→ 仍按合并结果拒绝，不得静默固化
 *   - 库中数据合法时只改 title → 通过
 * plus：未出现字段保持原值、空 PATCH、status 三态与三种非法状态、权限矩阵。
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
let member: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string
/** 每个用例在 beforeEach 里重建的合法任务主键。 */
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

  // 合法基线任务：owner=member、acceptor=pm、日期合法、非敏感。
  const task = await createTaskRow(ctx.db, {
    projectId,
    storyId,
    ownerUserId: member.id,
    acceptorUserId: pm.id,
    title: '原任务标题',
    description: '原任务描述',
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
  })
  taskId = task.id
})

function patchTask(
  body: Record<string, unknown>,
  actorUserId: string = pm.id,
  targetTaskId: string = taskId,
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .patch(`/tasks/${targetTaskId}`)
    .send(body)
}

function getTask(actorUserId: string = pm.id, targetTaskId: string = taskId) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .get(`/tasks/${targetTaskId}`)
}

function expectFieldError(body: ErrorBody, field: string, code: string): void {
  expect(body.error.code).toBe('VALIDATION_FAILED')
  expect(body.error.details ?? []).toContainEqual({ field, code })
}

// ---------------------------------------------------------------------------
// 端点 27：任务详情
// ---------------------------------------------------------------------------

describe('端点 27 任务详情', () => {
  it('返回 200 TaskView，内嵌 owner / acceptor 的 UserBrief', async () => {
    const response = await getTask()

    expect(response.status).toBe(200)
    const body = response.body as TaskView
    expect(body.id).toBe(taskId)
    expect(body.projectId).toBe(projectId)
    expect(body.storyId).toBe(storyId)
    expect(body.title).toBe('原任务标题')
    expect(body.description).toBe('原任务描述')
    expect(body.ownerUserId).toBe(member.id)
    expect(body.acceptorUserId).toBe(pm.id)
    expect(body.planStart).toBe('2026-09-01')
    expect(body.planEnd).toBe('2026-09-10')
    expect(body.status).toBe('TODO')
    expect(body.isSensitive).toBe(false)
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(body.owner).toEqual({
      id: member.id,
      account: 'member@example.com',
      displayName: '项目成员',
    })
    expect(body.acceptor).toEqual({
      id: pm.id,
      account: 'pm@example.com',
      displayName: '项目经理',
    })
  })

  it('MEMBER 也可读取任务详情（project.read 允许）', async () => {
    const response = await getTask(member.id)

    expect(response.status).toBe(200)
    expect((response.body as TaskView).id).toBe(taskId)
  })

  it('任务不存在 → 404 NOT_FOUND，响应体不含 items / 任务字段', async () => {
    const response = await getTask(pm.id, 'does-not-exist')
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('items')
    expect(response.body).not.toHaveProperty('title')
    expect(serialized).not.toContain('原任务标题')
    expect(serialized).not.toContain(projectId)
  })

  it('非项目成员读取任务详情 → 404 NOT_FOUND，响应体不含任务任何字段', async () => {
    const response = await getTask(outsider.id)
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('title')
    expect(serialized).not.toContain('原任务标题')
    expect(serialized).not.toContain('原任务描述')
  })

  it('未登录读取任务详情 → 401 UNAUTHENTICATED', async () => {
    const response = await ctx.asUser(null).get(`/tasks/${taskId}`)

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })
})

// ---------------------------------------------------------------------------
// 端点 28：部分更新正例 —— 未出现的字段保持原值
// ---------------------------------------------------------------------------

describe('端点 28 部分更新：只改单个字段，其余字段逐字不变', () => {
  it('只改 title → 200，description / owner / acceptor / 日期 / status / createdAt 等全部不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ title: '新标题' })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.title).toBe('新标题')
    // 把改动字段还原后，整个对象必须与更新前深等（含 createdAt / isSensitive / projectId / owner / acceptor）
    expect({ ...after, title: before.title }).toEqual(before)
  })

  it('只改 description → 200，其余字段逐字不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ description: '新描述' })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.description).toBe('新描述')
    expect({ ...after, description: before.description }).toEqual(before)
  })

  it('只改 description 为 null → 200，表示清空描述，其余字段逐字不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ description: null })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.description).toBeNull()
    expect({ ...after, description: before.description }).toEqual(before)
  })

  it('只改 status → 200，其余字段逐字不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ status: 'DOING' })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.status).toBe('DOING')
    expect({ ...after, status: before.status }).toEqual(before)
  })

  it('只改 ownerUserId / acceptorUserId 为合法成员 → 200，其余字段逐字不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ ownerUserId: pm.id, acceptorUserId: member.id })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.ownerUserId).toBe(pm.id)
    expect(after.acceptorUserId).toBe(member.id)
    expect(after.owner.id).toBe(pm.id)
    expect(after.acceptor.id).toBe(member.id)
    expect({
      ...after,
      ownerUserId: before.ownerUserId,
      acceptorUserId: before.acceptorUserId,
      owner: before.owner,
      acceptor: before.acceptor,
    }).toEqual(before)
  })

  it('只改计划日期（合法范围）→ 200，其余字段逐字不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ planStart: '2026-10-01', planEnd: '2026-10-31' })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.planStart).toBe('2026-10-01')
    expect(after.planEnd).toBe('2026-10-31')
    expect({ ...after, planStart: before.planStart, planEnd: before.planEnd }).toEqual(before)
  })

  it('空请求体 {} → 200，所有字段逐字不变（部分更新的边界）', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({})

    expect(response.status).toBe(200)
    expect(response.body as TaskView).toEqual(before)
  })

  it('请求体中的 projectId / storyId / isSensitive 被忽略，不可跨项目挂载、不可改敏感标记', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({
      title: '换标题',
      projectId: 'forged-project-id',
      storyId: 'forged-story-id',
      isSensitive: true,
    })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.projectId).toBe(projectId)
    expect(after.storyId).toBe(storyId)
    // 非敏感任务不能被 PATCH 改成敏感（只能走端点 30）
    expect(after.isSensitive).toBe(false)

    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.projectId).toBe(projectId)
    expect(persisted?.storyId).toBe(storyId)
    expect(persisted?.isSensitive).toBe(false)
    expect({ ...after, title: before.title }).toEqual(before)
  })

  it('敏感任务的 isSensitive 不会被 PATCH 改写（只能通过端点 30）', async () => {
    const sensitive = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '敏感任务',
      isSensitive: true,
    })
    const response = await patchTask({ title: '敏感任务改名' }, pm.id, sensitive.id)

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.isSensitive).toBe(true)
    expect(after.title).toBe('敏感任务改名')
  })
})

// ---------------------------------------------------------------------------
// ★ 核心：ACCEPTOR_EQUALS_OWNER 的合并语义（三条路径）
// ---------------------------------------------------------------------------

describe('端点 28 合并语义：ACCEPTOR_EQUALS_OWNER 三条路径', () => {
  it('① 只改 ownerUserId 使其等于现有 acceptorUserId → 422 acceptorUserId: ACCEPTOR_EQUALS_OWNER', async () => {
    // 现有 owner=member、acceptor=pm；只把 owner 改成 pm。
    const response = await patchTask({ ownerUserId: pm.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('② 只改 acceptorUserId 使其等于现有 ownerUserId → 422 acceptorUserId: ACCEPTOR_EQUALS_OWNER', async () => {
    // 现有 owner=member、acceptor=pm；只把 acceptor 改成 member。
    const response = await patchTask({ acceptorUserId: member.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('③ 同时改两者使其相等 → 422 acceptorUserId: ACCEPTOR_EQUALS_OWNER', async () => {
    const response = await patchTask({ ownerUserId: viewer.id, acceptorUserId: viewer.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('被拒时任务行保持原值，不被部分写坏', async () => {
    await patchTask({ ownerUserId: pm.id })

    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.ownerUserId).toBe(member.id)
    expect(persisted?.acceptorUserId).toBe(pm.id)
  })
})

// ---------------------------------------------------------------------------
// 合并语义：日期先后不得只看请求体
// ---------------------------------------------------------------------------

describe('端点 28 合并语义：日期先后', () => {
  it('只改 planStart 使现有 planEnd 落在其之前 → 422 planEnd: END_BEFORE_START', async () => {
    // 现有 planEnd=2026-09-10；把 planStart 改到它之后。
    const response = await patchTask({ planStart: '2026-09-20' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'END_BEFORE_START')
  })

  it('只改 planEnd 使其早于现有 planStart → 422 planEnd: END_BEFORE_START', async () => {
    const response = await patchTask({ planEnd: '2026-08-01' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'END_BEFORE_START')
  })

  it('只改 planStart 与现有 planEnd 同一天 → 200（结束 ≥ 开始，允许同一天）', async () => {
    const response = await patchTask({ planStart: '2026-09-10' })

    expect(response.status).toBe(200)
    expect((response.body as TaskView).planStart).toBe('2026-09-10')
    expect((response.body as TaskView).planEnd).toBe('2026-09-10')
  })
})

// ---------------------------------------------------------------------------
// 合并语义：已存在的非法数据不得因只改 title 被静默固化
// ---------------------------------------------------------------------------

describe('端点 28 合并语义：非法旧数据不得被静默固化', () => {
  it('库中 acceptor = owner（绕过创建校验写入），只改 title → 422 ACCEPTOR_EQUALS_OWNER', async () => {
    const invalid = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: member.id,
      title: '非法分配任务',
    })

    const response = await patchTask({ title: '只改标题' }, pm.id, invalid.id)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
    const persisted = await ctx.db.task.findUnique({ where: { id: invalid.id } })
    expect(persisted?.title).toBe('非法分配任务')
  })

  it('库中 planEnd < planStart，只改 title → 422 END_BEFORE_START', async () => {
    const invalid = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '非法日期任务',
      planStart: '2026-09-10',
      planEnd: '2026-09-01',
    })

    const response = await patchTask({ title: '只改标题' }, pm.id, invalid.id)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'END_BEFORE_START')
    const persisted = await ctx.db.task.findUnique({ where: { id: invalid.id } })
    expect(persisted?.title).toBe('非法日期任务')
  })

  it('库中 owner 非本项目成员，只改 title → 422 ownerUserId: NOT_PROJECT_MEMBER', async () => {
    const invalid = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: outsider.id,
      acceptorUserId: pm.id,
      title: '非法负责人任务',
    })

    const response = await patchTask({ title: '只改标题' }, pm.id, invalid.id)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('库中数据合法，只改 title → 200（合法合并结果放行）', async () => {
    const response = await patchTask({ title: '合法改名' })

    expect(response.status).toBe(200)
    expect((response.body as TaskView).title).toBe('合法改名')
  })

  it('只改 ownerUserId 为项目外用户 → 422 ownerUserId: NOT_PROJECT_MEMBER', async () => {
    const response = await patchTask({ ownerUserId: outsider.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })
})

// ---------------------------------------------------------------------------
// status 三态正例与非法状态反例
// ---------------------------------------------------------------------------

describe('端点 28 状态推进：三态正例', () => {
  it('status → TODO 成功', async () => {
    const response = await patchTask({ status: 'TODO' })

    expect(response.status).toBe(200)
    expect((response.body as TaskView).status).toBe('TODO')
  })

  it('status → DOING 成功', async () => {
    const response = await patchTask({ status: 'DOING' })

    expect(response.status).toBe(200)
    expect((response.body as TaskView).status).toBe('DOING')
  })

  it('status → DONE 成功', async () => {
    const response = await patchTask({ status: 'DONE' })

    expect(response.status).toBe(200)
    expect((response.body as TaskView).status).toBe('DONE')
  })

  it('状态推进后再次 GET 详情与列表口径一致', async () => {
    await patchTask({ status: 'DOING' })
    const detail = (await getTask()).body as TaskView

    expect(detail.status).toBe('DOING')
    const list = await ctx.asUser(ctx.loginAs(pm.id))
      .get(`/stories/${storyId}/tasks`)
    const listed = (list.body as { items: TaskView[] }).items.find((task) => task.id === taskId)
    expect(listed?.status).toBe('DOING')
  })
})

describe('端点 28 状态推进：非法状态反例', () => {
  it.each(['BLOCKED', 'SUSPENDED', 'CLOSED'])('status → %s → 422 status: INVALID_VALUE', async (status) => {
    const response = await patchTask({ status })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'status', 'INVALID_VALUE')
  })
})

// ---------------------------------------------------------------------------
// 形状校验（Zod 产出字段级错误码；业务规则不塞进 Zod）
// ---------------------------------------------------------------------------

describe('端点 28 形状校验', () => {
  it('title 为纯空白 → 422 REQUIRED', async () => {
    const response = await patchTask({ title: '   ' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'REQUIRED')
  })

  it('title 超出长度上限 → 422 TOO_LONG', async () => {
    const response = await patchTask({ title: '任'.repeat(201) })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'TOO_LONG')
  })

  it('ownerUserId 为空字符串 → 422 REQUIRED', async () => {
    const response = await patchTask({ ownerUserId: '' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'REQUIRED')
  })

  it('planStart 格式非法 → 422 INVALID_FORMAT', async () => {
    const response = await patchTask({ planStart: '2026/09/01' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planStart', 'INVALID_FORMAT')
  })

  it('形状校验失败时不写入任何改动', async () => {
    const before = await ctx.db.task.findUnique({ where: { id: taskId } })
    await patchTask({ planEnd: 'not-a-date' })

    const after = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(after?.planEnd).toBe(before?.planEnd)
    expect(after?.title).toBe(before?.title)
  })
})

// ---------------------------------------------------------------------------
// 权限矩阵
// ---------------------------------------------------------------------------

describe('端点 28 权限', () => {
  it('MEMBER 编辑非敏感任务 → 403 FORBIDDEN', async () => {
    const response = await patchTask({ title: '成员改名' }, member.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 编辑非敏感任务 → 403 FORBIDDEN', async () => {
    const response = await patchTask({ title: '管理者改名' }, viewer.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员编辑任务 → 404 NOT_FOUND 且响应体不含任务任何字段', async () => {
    const response = await patchTask({ title: '外部改名' }, outsider.id)
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('title')
    expect(serialized).not.toContain('原任务标题')
    expect(serialized).not.toContain(projectId)
  })

  it('未登录编辑任务 → 401 UNAUTHENTICATED', async () => {
    const response = await ctx.asUser(null)
      .patch(`/tasks/${taskId}`)
      .send({ title: '匿名改名' })

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('编辑不存在的任务 → 404 NOT_FOUND', async () => {
    const response = await patchTask({ title: '不存在' }, pm.id, 'does-not-exist')

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('被拒绝的 MEMBER 请求不写入任何改动', async () => {
    await patchTask({ title: '成员改名' }, member.id)

    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.title).toBe('原任务标题')
  })
})
