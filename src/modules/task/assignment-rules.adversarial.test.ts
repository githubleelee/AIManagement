/**
 * T5-02 对抗性验证测试（测试智能体-T5-02）—— 端点 25 任务分配业务规则
 *
 * 与 `assignment-rules.test.ts`（编码体自测）分工：本文件不重复其正例，而是
 * 针对「校验顺序 / 单成员项目 / 跨项目成员 / 边界 / 职责边界（业务规则不走 Zod）/
 * 共用入口直测」逐条设计攻击面，全部经 HTTP 接口层；「共用入口」一项例外，
 * 直接调用 `assertTaskAssignment` 以证明 T5-03 接入前规则与顺序已收敛到该函数。
 *
 * 数据自建、互不污染；造数组合 `test/factories.js` 的真实工厂，单成员项目由既有
 * `createProjectWithStory`（只把 owner 加为 PM）直接构造，不改动共享工厂。
 *
 * 未验证：编辑路径（端点 28 / PATCH）本分支不存在，T5-03 才落地 —— 见报告
 * 「编辑路径未验证」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../shared/types.js'
import { AppError } from '../../shared/errors.js'
import { assertTaskAssignment, type TaskAssignmentInput } from './rules.js'
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

  const project = await createProjectWithStory(ctx.db, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '对抗性分配校验',
    description: '由测试智能体-T5-02 构造',
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

/** 指定的字段级错误码列表（同字段可能多条）。 */
function detailCodes(body: ErrorBody, field: string): string[] {
  return (body.error.details ?? []).filter((detail) => detail.field === field).map((d) => d.code)
}

function firstDetail(body: ErrorBody): { field: string; code: string } | undefined {
  return body.error.details?.[0]
}

/** 直接调用共用校验入口，返回 AppError（或 null）。 */
async function directError(
  project: string,
  input: TaskAssignmentInput,
): Promise<AppError | null> {
  return assertTaskAssignment(ctx.db, project, input).then(
    () => null,
    (thrown: unknown) => {
      if (thrown instanceof AppError) return thrown
      throw thrown
    },
  )
}

function directFieldCode(error: AppError | null, field: string): string | undefined {
  return error?.details?.find((detail) => detail.field === field)?.code
}

// ===========================================================================
// P1. 校验顺序（契约端点 25 明文：形状 → 成员归属 → 成员数 → 相等比较）
// ===========================================================================
describe('P1 校验顺序', () => {
  it('P1a acceptorUserId 缺失（形状）且省略相等判断 → REQUIRED，不得报 ACCEPTOR_EQUALS_OWNER', async () => {
    const { acceptorUserId: _acceptor, ...withoutAcceptor } = validBody()
    const response = await postTask(withoutAcceptor)
    const body = response.body as ErrorBody

    expect(response.status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(detailCodes(body, 'acceptorUserId')).toContain('REQUIRED')
    expect(detailCodes(body, 'acceptorUserId')).not.toContain('ACCEPTOR_EQUALS_OWNER')
    // 形状被拒时连业务规则都不应触发（owner 是合法成员也不会被比较）
    expect(await ctx.db.task.count()).toBe(0)
  })

  it('P1b owner 非成员 + owner === acceptor → 归属先报 ownerUserId: NOT_PROJECT_MEMBER', async () => {
    const response = await postTask(
      validBody({ ownerUserId: outsider.id, acceptorUserId: outsider.id }),
    )
    const body = response.body as ErrorBody

    expect(response.status).toBe(422)
    expect(detailCodes(body, 'ownerUserId')).toContain('NOT_PROJECT_MEMBER')
    expect(detailCodes(body, 'acceptorUserId')).not.toContain('ACCEPTOR_EQUALS_OWNER')
  })

  it('P1c owner 与 acceptor 都是非本项目成员且相同 → 仍以 owner 归属优先', async () => {
    const other = await makeUser('other@example.com', '另一外部用户')
    const response = await postTask(
      validBody({ ownerUserId: outsider.id, acceptorUserId: other.id }),
    )
    const body = response.body as ErrorBody

    // owner 归属先于 acceptor 归属，也先于相等比较
    expect(response.status).toBe(422)
    expect(firstDetail(body)).toEqual({ field: 'ownerUserId', code: 'NOT_PROJECT_MEMBER' })
  })
})

// ===========================================================================
// P2. INSUFFICIENT_MEMBERS：必须真的只有 1 名成员
// ===========================================================================
describe('P2 单成员项目', () => {
  it('只有 1 名成员的项目创建任务（owner = acceptor = 该成员）→ INSUFFICIENT_MEMBERS，不退化为 ACCEPTOR_EQUALS_OWNER', async () => {
    const solePm = await makeUser('sole-pm@example.com', '唯一成员')
    const solo = await createProjectWithStory(ctx.db, solePm.id)
    // 证据：该项目确实只有 1 名成员（工厂只把 owner 以 PM 身份加入）
    expect(await ctx.db.projectMember.count({ where: { projectId: solo.projectId } })).toBe(1)

    const response = await postTask(
      validBody({ ownerUserId: solePm.id, acceptorUserId: solePm.id }),
      solePm.id,
      solo.storyId,
    )
    const body = response.body as ErrorBody

    expect(response.status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(firstDetail(body)).toEqual({ field: '', code: 'INSUFFICIENT_MEMBERS' })
    expect(detailCodes(body, 'acceptorUserId')).not.toContain('ACCEPTOR_EQUALS_OWNER')
    expect(await ctx.db.task.count()).toBe(0)
  })
})

// ===========================================================================
// P3. 跨项目成员（伪造 / 串项目）
// ===========================================================================
describe('P3 跨项目成员', () => {
  it('P3a owner 是另一个项目的成员、acceptor 是本项目成员 → ownerUserId: NOT_PROJECT_MEMBER', async () => {
    // outsider 在自己项目里是 PM，但绝不是本项目成员
    await createProjectWithStory(ctx.db, outsider.id, { projectName: '外部项目' })

    const response = await postTask(
      validBody({ ownerUserId: outsider.id, acceptorUserId: pm.id }),
    )
    const body = response.body as ErrorBody

    expect(response.status).toBe(422)
    expect(detailCodes(body, 'ownerUserId')).toContain('NOT_PROJECT_MEMBER')
  })

  it('P3b owner 是本项目成员、acceptor 是另一个项目的成员 → acceptorUserId: NOT_PROJECT_MEMBER', async () => {
    const cross = await makeUser('cross@example.com', '跨项目用户')
    await createProjectWithStory(ctx.db, cross.id, { projectName: '第二个外部项目' })

    const response = await postTask(
      validBody({ ownerUserId: member.id, acceptorUserId: cross.id }),
    )
    const body = response.body as ErrorBody

    expect(response.status).toBe(422)
    expect(detailCodes(body, 'acceptorUserId')).toContain('NOT_PROJECT_MEMBER')
  })
})

// ===========================================================================
// P4. 边界：结束 = 开始
// ===========================================================================
describe('P4 日期边界', () => {
  it('planEnd === planStart → 201 通过（结束 ≥ 开始）', async () => {
    const response = await postTask(
      validBody({ planStart: '2026-09-10', planEnd: '2026-09-10' }),
    )
    const body = response.body as TaskView

    expect(response.status).toBe(201)
    expect(body.planStart).toBe('2026-09-10')
    expect(body.planEnd).toBe('2026-09-10')
  })
})

// ===========================================================================
// P5. 规则不在 Zod 里（契约 I-2b 职责边界）
// ===========================================================================
describe('P5 业务规则由 AppError 承载字段级 details，而非被 Zod 形状码顶掉', () => {
  const SHAPE_CODES = ['REQUIRED', 'TOO_LONG', 'INVALID_FORMAT', 'INVALID_VALUE']

  it('P5a owner 非成员 → field=ownerUserId, code=NOT_PROJECT_MEMBER（非形状码）', async () => {
    const response = await postTask(validBody({ ownerUserId: outsider.id }))
    const body = response.body as ErrorBody
    const detail = firstDetail(body)

    expect(response.status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(detail).toEqual({ field: 'ownerUserId', code: 'NOT_PROJECT_MEMBER' })
    expect(SHAPE_CODES).not.toContain(detail?.code)
  })

  it('P5b acceptor 非成员 → field=acceptorUserId, code=NOT_PROJECT_MEMBER（非形状码）', async () => {
    const response = await postTask(validBody({ acceptorUserId: outsider.id }))
    const body = response.body as ErrorBody
    const detail = firstDetail(body)

    expect(response.status).toBe(422)
    expect(detail).toEqual({ field: 'acceptorUserId', code: 'NOT_PROJECT_MEMBER' })
    expect(SHAPE_CODES).not.toContain(detail?.code)
  })

  it('P5c planEnd < planStart → field=planEnd, code=END_BEFORE_START（非形状码）', async () => {
    const response = await postTask(
      validBody({ planStart: '2026-09-10', planEnd: '2026-09-01' }),
    )
    const body = response.body as ErrorBody
    const detail = firstDetail(body)

    expect(response.status).toBe(422)
    expect(detail).toEqual({ field: 'planEnd', code: 'END_BEFORE_START' })
    expect(SHAPE_CODES).not.toContain(detail?.code)
  })

  it('P5d 对照组：日期形状非法仍走 Zod 的 INVALID_FORMAT（职责边界未串线）', async () => {
    const response = await postTask(validBody({ planStart: '2026/09/01' }))
    const body = response.body as ErrorBody

    expect(response.status).toBe(422)
    expect(detailCodes(body, 'planStart')).toContain('INVALID_FORMAT')
  })
})

// ===========================================================================
// P6. 共用入口 assertTaskAssignment 逐规则直测（T5-03 PATCH 侧接入前）
// ===========================================================================
describe('P6 共用入口直测：规则与顺序收敛到 assertTaskAssignment', () => {
  const base: TaskAssignmentInput = {
    ownerUserId: '',
    acceptorUserId: '',
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
  }

  it('P6a owner 非成员 → ownerUserId: NOT_PROJECT_MEMBER', async () => {
    const error = await directError(projectId, { ...base, ownerUserId: outsider.id, acceptorUserId: pm.id })
    expect(directFieldCode(error, 'ownerUserId')).toBe('NOT_PROJECT_MEMBER')
  })

  it('P6b acceptor 非成员 → acceptorUserId: NOT_PROJECT_MEMBER', async () => {
    const error = await directError(projectId, { ...base, ownerUserId: member.id, acceptorUserId: outsider.id })
    expect(directFieldCode(error, 'acceptorUserId')).toBe('NOT_PROJECT_MEMBER')
  })

  it('P6c acceptor === owner → acceptorUserId: ACCEPTOR_EQUALS_OWNER', async () => {
    const error = await directError(projectId, { ...base, ownerUserId: member.id, acceptorUserId: member.id })
    expect(directFieldCode(error, 'acceptorUserId')).toBe('ACCEPTOR_EQUALS_OWNER')
  })

  it('P6d planEnd < planStart → planEnd: END_BEFORE_START', async () => {
    const error = await directError(projectId, {
      ...base,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      planStart: '2026-09-10',
      planEnd: '2026-09-01',
    })
    expect(directFieldCode(error, 'planEnd')).toBe('END_BEFORE_START')
  })

  it('P6e 顺序：owner 非成员 + owner === acceptor → owner 归属先于相等比较', async () => {
    const error = await directError(projectId, {
      ...base,
      ownerUserId: outsider.id,
      acceptorUserId: outsider.id,
    })
    expect(directFieldCode(error, 'ownerUserId')).toBe('NOT_PROJECT_MEMBER')
    expect(directFieldCode(error, 'acceptorUserId')).not.toBe('ACCEPTOR_EQUALS_OWNER')
  })
})
