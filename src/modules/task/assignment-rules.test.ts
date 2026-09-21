/**
 * T5-02 接口测试 —— 端点 25 任务分配业务规则（负责人 / 验收人 / 计划时间）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md` 决策 I-4、I-8 端点 25、
 * 决策 I-10 部分更新语义；验收标准见基线 §2.4.2 的 AC-US-05-02 / 05-03 / 05-04。
 *
 * 唯一 seam 是 HTTP 接口层：全部通过 supertest 发起请求、断言**字段级错误码**
 * （而不是错误文案）。唯一例外是「共用校验入口」一条：为了让 T5-03 的 PATCH 侧
 * 接入前也能证明创建路径确实走 `assertTaskAssignment`，直接调用同一函数，
 * 断言其错误码与 HTTP 路径完全一致。
 *
 * 覆盖：
 *   - 反例：owner 非成员 / acceptor 非成员 / acceptor = owner / 成员少于 2 人 /
 *           planEnd < planStart，各断言错误码
 *   - 顺序：acceptor 为空（且 owner 也为空）→ REQUIRED，而不是 ACCEPTOR_EQUALS_OWNER；
 *           成员归属先于「验收人 = 负责人」
 *   - 边界：planEnd === planStart → 201 通过
 *   - 共用入口：同一组非法输入，HTTP 与 `assertTaskAssignment` 给出同一错误码
 *   - 正例：owner 与 acceptor 都是本项目成员且不同 → 201
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { TaskView } from '../../shared/types.js'
import { AppError } from '../../shared/errors.js'
import { assertTaskAssignment } from './rules.js'
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

  // 工厂默认只把 owner 加为 PM，这里再补两名成员：
  // 本项目共 3 名成员（pm / member / viewer），满足「成员数 ≥ 2」。
  const project = await createProjectWithStory(ctx.db, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

/** 合法请求体，覆盖测试按需覆盖字段。 */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '实现任务列表',
    description: '把故事拆成可执行工作',
    ownerUserId: member.id,
    acceptorUserId: pm.id,
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
    ...overrides,
  }
}

function postTask(
  body: Record<string, unknown>,
  actorUserId: string = pm.id,
  targetStoryId: string = storyId,
) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .post(`/stories/${targetStoryId}/tasks`)
    .send(body)
}

function expectFieldError(body: ErrorBody, field: string, code: string): void {
  expect(body.error.code).toBe('VALIDATION_FAILED')
  expect(body.error.details ?? []).toContainEqual({ field, code })
}

/** 从 AppError 中取出字段级错误码，便于与 HTTP 响应比对。 */
function fieldCodeOf(error: unknown, field: string): string | undefined {
  if (!(error instanceof AppError)) {
    throw error
  }
  return error.details?.find((detail) => detail.field === field)?.code
}

describe('端点 25 业务规则反例（断言字段级错误码）', () => {
  it('负责人不属于本项目成员 → 422 ownerUserId: NOT_PROJECT_MEMBER', async () => {
    const response = await postTask(validBody({ ownerUserId: outsider.id }))

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('验收人不属于本项目成员 → 422 acceptorUserId: NOT_PROJECT_MEMBER', async () => {
    const response = await postTask(validBody({ acceptorUserId: outsider.id }))

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'NOT_PROJECT_MEMBER')
  })

  it('验收人与负责人为同一人 → 422 acceptorUserId: ACCEPTOR_EQUALS_OWNER', async () => {
    const response = await postTask(
      validBody({ ownerUserId: member.id, acceptorUserId: member.id }),
    )

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('项目成员少于 2 人 → 422 INSUFFICIENT_MEMBERS', async () => {
    // 单独造一个只有 1 名成员（PM 本人）的项目：owner 与 acceptor 都只能是这名成员，
    // 此时应先报成员不足，而不是 ACCEPTOR_EQUALS_OWNER。
    const solePm = await makeUser('sole-pm@example.com', '唯一成员')
    const solo = await createProjectWithStory(ctx.db, solePm.id)

    const response = await postTask(
      validBody({ ownerUserId: solePm.id, acceptorUserId: solePm.id }),
      solePm.id,
      solo.storyId,
    )

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, '', 'INSUFFICIENT_MEMBERS')
  })

  it('计划结束早于计划开始 → 422 planEnd: END_BEFORE_START', async () => {
    const response = await postTask(
      validBody({ planStart: '2026-09-10', planEnd: '2026-09-01' }),
    )

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'END_BEFORE_START')
  })

  it('业务规则被拒时不写入任何任务行', async () => {
    await postTask(validBody({ ownerUserId: outsider.id }))
    await postTask(validBody({ acceptorUserId: member.id, ownerUserId: member.id }))
    await postTask(validBody({ planStart: '2026-09-10', planEnd: '2026-09-01' }))

    expect(await ctx.db.task.count()).toBe(0)
  })
})

describe('端点 25 校验顺序', () => {
  it('acceptor 为空且 owner 也为空 → REQUIRED（形状），而不是 ACCEPTOR_EQUALS_OWNER', async () => {
    const response = await postTask(validBody({ ownerUserId: '', acceptorUserId: '' }))

    expect(response.status).toBe(422)
    const body = response.body as ErrorBody
    expectFieldError(body, 'acceptorUserId', 'REQUIRED')
    expect(body.error.details ?? []).not.toContainEqual({
      field: 'acceptorUserId',
      code: 'ACCEPTOR_EQUALS_OWNER',
    })
  })

  it('acceptor 缺失（undefined）时不得对其做相等判断', async () => {
    const { acceptorUserId: _acceptor, ...withoutAcceptor } = validBody()
    const response = await postTask(withoutAcceptor)

    expect(response.status).toBe(422)
    const body = response.body as ErrorBody
    expectFieldError(body, 'acceptorUserId', 'REQUIRED')
    expect(body.error.details ?? []).not.toContainEqual({
      field: 'acceptorUserId',
      code: 'ACCEPTOR_EQUALS_OWNER',
    })
  })

  it('成员归属先于「验收人 = 负责人」：owner 非成员且 owner = acceptor → NOT_PROJECT_MEMBER', async () => {
    const response = await postTask(
      validBody({ ownerUserId: outsider.id, acceptorUserId: outsider.id }),
    )

    expect(response.status).toBe(422)
    const body = response.body as ErrorBody
    expectFieldError(body, 'ownerUserId', 'NOT_PROJECT_MEMBER')
    expect(body.error.details ?? []).not.toContainEqual({
      field: 'acceptorUserId',
      code: 'ACCEPTOR_EQUALS_OWNER',
    })
  })
})

describe('端点 25 边界', () => {
  it('planEnd === planStart → 通过（结束 ≥ 开始，允许同一天）', async () => {
    const response = await postTask(validBody({ planStart: '2026-09-10', planEnd: '2026-09-10' }))

    expect(response.status).toBe(201)
    const body = response.body as TaskView
    expect(body.planStart).toBe('2026-09-10')
    expect(body.planEnd).toBe('2026-09-10')
  })
})

describe('共用校验入口 assertTaskAssignment（T5-03 PATCH 侧接入前）', () => {
  it('同一组非法输入：HTTP 路径与直接调用返回同一字段级错误码', async () => {
    const input = {
      ownerUserId: member.id,
      acceptorUserId: member.id,
      planStart: '2026-09-01',
      planEnd: '2026-09-10',
    }

    const response = await postTask(validBody(input))
    const httpCode = (response.body as ErrorBody).error.details?.[0]?.code

    const directError = await assertTaskAssignment(ctx.db, projectId, input).then(
      () => null,
      (error: unknown) => error,
    )

    expect(httpCode).toBe('ACCEPTOR_EQUALS_OWNER')
    expect(fieldCodeOf(directError, 'acceptorUserId')).toBe(httpCode)
  })

  it('入参是「合并后的最终值」：直接传入合并结果即可判定（T5-03 的接入方式）', async () => {
    // 模拟 T5-03 的部分更新：只改 owner，acceptor 保留现有值。
    const existing = { acceptorUserId: member.id, planStart: '2026-09-01', planEnd: '2026-09-10' }
    const merged = { ...existing, ownerUserId: member.id }

    const error = await assertTaskAssignment(ctx.db, projectId, merged).then(
      () => null,
      (thrown: unknown) => thrown,
    )

    expect(fieldCodeOf(error, 'acceptorUserId')).toBe('ACCEPTOR_EQUALS_OWNER')
  })
})

describe('端点 25 正例：合法分配', () => {
  it('owner 与 acceptor 都是本项目成员且不同 → 201 TaskView', async () => {
    const response = await postTask(validBody({ ownerUserId: member.id, acceptorUserId: pm.id }))

    expect(response.status).toBe(201)
    const body = response.body as TaskView
    expect(body.ownerUserId).toBe(member.id)
    expect(body.acceptorUserId).toBe(pm.id)
    expect(body.owner.id).toBe(member.id)
    expect(body.acceptor.id).toBe(pm.id)
  })
})
