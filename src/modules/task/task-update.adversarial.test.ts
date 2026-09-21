/**
 * T5-03 对抗性验证测试 —— 端点 27（任务详情）/ 端点 28（部分更新）契约契约探针
 *
 * 独立于 `task-update.test.ts`（新增文件，减少与其它分支的 merge 冲突），
 * 唯一 seam 仍是 HTTP 接口层（契约 Testing Decisions）。权威来源：
 *   - `docs/sprint1-spec-interface-contract.md` 端点 27/28、决策 I-2b、I-3、I-4、I-10，
 *     以及文末「三个人最容易忽略的接口细节」第 1 条
 *   - `docs/tickets-t5-task-management.md` T5-03（含「三条路径都要测」）
 *   - `docs/sprint1-baseline.md` AC-US-05-02 第二条（编辑不得绕过）
 *
 * 本文件按对抗性探针分组，命名与探针编号对应：
 *   A. 合并语义（★ 核心，含反事实）
 *   B. 字段面
 *   C. 权限与不泄漏
 *   D. 回归（全量跑由报告给出；本文件补端点 24/25 未被破坏的交叉断言）
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
let taskId: string

beforeAll(async () => {
  // 反事实探针需要在大量用例里逐个断言，超时上限放宽。
  ctx = await createTestContext()
}, 60_000)

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

  const task = await createTaskRow(ctx.db, {
    projectId,
    storyId,
    ownerUserId: member.id,
    acceptorUserId: pm.id,
    title: '对抗基线任务',
    description: '对抗基线描述',
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

/** TaskView 中除 owner/acceptor 展开外的全部标量字段，用于「其余字段逐字不变」断言。 */
const SCALAR_FIELDS: Array<keyof TaskView> = [
  'id',
  'projectId',
  'storyId',
  'title',
  'description',
  'ownerUserId',
  'acceptorUserId',
  'planStart',
  'planEnd',
  'status',
  'isSensitive',
  'createdAt',
]

/** 断言除 overridden 列出的字段外，after 与 before 逐字段相同（含内嵌 owner/acceptor）。 */
function expectOthersUnchanged(
  before: TaskView,
  after: TaskView,
  overridden: Array<keyof TaskView>,
): void {
  for (const field of SCALAR_FIELDS) {
    if (overridden.includes(field)) continue
    expect({ field, value: after[field] }).toEqual({ field, value: before[field] })
  }
  if (!overridden.includes('ownerUserId')) {
    expect(after.owner).toEqual(before.owner)
  }
  if (!overridden.includes('acceptorUserId')) {
    expect(after.acceptor).toEqual(before.acceptor)
  }
}

// ===========================================================================
// A. ★ 合并语义（本工单核心）
// ===========================================================================

describe('探针 A1：ACCEPTOR_EQUALS_OWNER 三条绕过路径（反事实核心）', () => {
  it('① 只改 ownerUserId 使其等于【现有】acceptorUserId → 422 ACCEPTOR_EQUALS_OWNER', async () => {
    // 现有 owner=member、acceptor=pm；请求体里只出现 owner，且值 = 现有 acceptor。
    const response = await patchTask({ ownerUserId: pm.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('② 只改 acceptorUserId 使其等于【现有】ownerUserId → 422 ACCEPTOR_EQUALS_OWNER', async () => {
    const response = await patchTask({ acceptorUserId: member.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('③ 同时改两者使其相等 → 422 ACCEPTOR_EQUALS_OWNER', async () => {
    const response = await patchTask({ ownerUserId: viewer.id, acceptorUserId: viewer.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('三条路径被拒后，库中行保持完全原值（未被部分写坏）', async () => {
    await patchTask({ ownerUserId: pm.id })
    await patchTask({ acceptorUserId: member.id })
    await patchTask({ ownerUserId: viewer.id, acceptorUserId: viewer.id })

    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.ownerUserId).toBe(member.id)
    expect(persisted?.acceptorUserId).toBe(pm.id)
    expect(persisted?.title).toBe('对抗基线任务')
  })
})

describe('探针 A2：只改 planStart 使现有 planEnd 倒挂', () => {
  it('只改 planStart（2026-09-20）使现有 planEnd（2026-09-10）倒挂 → 422 END_BEFORE_START', async () => {
    const response = await patchTask({ planStart: '2026-09-20' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'END_BEFORE_START')
  })

  it('只改 planEnd 使其早于现有 planStart → 422 END_BEFORE_START', async () => {
    const response = await patchTask({ planEnd: '2026-08-01' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'END_BEFORE_START')
  })

  it('被拒后库中日期保持原值', async () => {
    await patchTask({ planStart: '2026-09-20' })
    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.planStart).toBe('2026-09-01')
    expect(persisted?.planEnd).toBe('2026-09-10')
  })
})

describe('探针 A3：合并语义的其余面（旧非法数据不得被静默固化 / 成员归属）', () => {
  it('库中 acceptor = owner，只改 title → 422（合并结果仍非法）', async () => {
    const invalid = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: member.id,
      title: '非法分配',
    })

    const response = await patchTask({ title: '改名' }, pm.id, invalid.id)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
    expect((await ctx.db.task.findUnique({ where: { id: invalid.id } }))?.title).toBe('非法分配')
  })

  it('库中 planEnd < planStart，只改 title → 422', async () => {
    const invalid = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '非法日期',
      planStart: '2026-09-10',
      planEnd: '2026-09-01',
    })

    const response = await patchTask({ title: '改名' }, pm.id, invalid.id)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'END_BEFORE_START')
  })

  it('库中 owner 非本项目成员，只改 title → 422 ownerUserId: NOT_PROJECT_MEMBER', async () => {
    const invalid = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: outsider.id,
      acceptorUserId: pm.id,
      title: '非法负责人',
    })

    const response = await patchTask({ title: '改名' }, pm.id, invalid.id)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('只改 ownerUserId 为项目外用户 → 422 ownerUserId: NOT_PROJECT_MEMBER', async () => {
    const response = await patchTask({ ownerUserId: outsider.id })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('库中成员数 < 2（另一项目），只改 title → 422 INSUFFICIENT_MEMBERS', async () => {
    const soloPm = await makeUser('solo@example.com', '独苗')
    const solo = await createProjectWithStory(ctx.db, soloPm.id)
    const invalid = await createTaskRow(ctx.db, {
      projectId: solo.projectId,
      storyId: solo.storyId,
      ownerUserId: soloPm.id,
      acceptorUserId: soloPm.id,
      title: '独苗任务',
    })

    const response = await patchTask({ title: '改名' }, soloPm.id, invalid.id)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, '', 'INSUFFICIENT_MEMBERS')
  })
})

describe('探针 A4：部分更新正例 —— 只改一字段，其余字段逐字不变', () => {
  it('只改 title → 200，其余标量字段与 owner/acceptor 全部不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ title: '只改标题' })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.title).toBe('只改标题')
    expectOthersUnchanged(before, after, ['title'])
  })

  it('只改 status → 200，其余字段全部不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ status: 'DOING' })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.status).toBe('DOING')
    expectOthersUnchanged(before, after, ['status'])
  })

  it('只改 description → 200，其余字段全部不变', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({ description: '只改描述' })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.description).toBe('只改描述')
    expectOthersUnchanged(before, after, ['description'])
  })

  it('空请求体 {} → 200 且整条 TaskView 逐字不变（边界）', async () => {
    const before = (await getTask()).body as TaskView
    const response = await patchTask({})

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    for (const field of SCALAR_FIELDS) {
      expect({ field, value: after[field] }).toEqual({ field, value: before[field] })
    }
    expect(after).toEqual(before)
  })
})

// ===========================================================================
// B. 字段面探针
// ===========================================================================

describe('探针 B5：status 三态正例与 Sprint 1 之外三态反例', () => {
  it.each(['TODO', 'DOING', 'DONE'] as const)('status → %s 正例 200', async (status) => {
    const response = await patchTask({ status })

    expect(response.status).toBe(200)
    expect((response.body as TaskView).status).toBe(status)
  })

  it.each(['BLOCKED', 'SUSPENDED', 'CLOSED'])(
    'status → %s（Sprint 1 Out of Scope）→ 422 status: INVALID_VALUE',
    async (status) => {
      const response = await patchTask({ status })

      expect(response.status).toBe(422)
      expectFieldError(response.body as ErrorBody, 'status', 'INVALID_VALUE')
    },
  )
})

describe('探针 B6：isSensitive / visibleMemberIds 注入不生效，敏感状态不被顺带清空', () => {
  it('PATCH 传 isSensitive: true 对非敏感任务不生效', async () => {
    const response = await patchTask({ title: '改名', isSensitive: true })

    expect(response.status).toBe(200)
    expect((response.body as TaskView).isSensitive).toBe(false)
    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.isSensitive).toBe(false)
  })

  it('PATCH 传 visibleMemberIds 不产生 ObjectVisibility 记录', async () => {
    await patchTask({ title: '改名', visibleMemberIds: [member.id, viewer.id] })

    const rows = await ctx.db.objectVisibility.count({ where: { objectType: 'task', objectId: taskId } })
    expect(rows).toBe(0)
  })

  it('已是敏感的任务 PATCH 其它字段：isSensitive 保持 true，可见名单不被清空', async () => {
    const sensitive = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '敏感任务',
      isSensitive: true,
    })
    await ctx.db.objectVisibility.createMany({
      data: [
        { projectId, objectType: 'task', objectId: sensitive.id, userId: member.id },
        { projectId, objectType: 'task', objectId: sensitive.id, userId: viewer.id },
      ],
    })

    const response = await patchTask(
      { title: '敏感任务改名', isSensitive: false, visibleMemberIds: [] },
      pm.id,
      sensitive.id,
    )

    expect(response.status).toBe(200)
    expect((response.body as TaskView).isSensitive).toBe(true)

    const persisted = await ctx.db.task.findUnique({ where: { id: sensitive.id } })
    expect(persisted?.isSensitive).toBe(true)

    const rows = await ctx.db.objectVisibility.findMany({
      where: { objectType: 'task', objectId: sensitive.id },
      select: { userId: true },
    })
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set([member.id, viewer.id]))
  })
})

describe('探针 B7：跨项目注入被忽略', () => {
  it('PATCH 传 projectId / storyId 指向别的项目 → 被忽略，库中不变', async () => {
    const other = await createProjectWithStory(ctx.db, pm.id, { projectName: '另一个项目' })
    const before = (await getTask()).body as TaskView

    const response = await patchTask({
      title: '改名',
      projectId: other.projectId,
      storyId: other.storyId,
    })

    expect(response.status).toBe(200)
    const after = response.body as TaskView
    expect(after.projectId).toBe(projectId)
    expect(after.storyId).toBe(storyId)

    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.projectId).toBe(projectId)
    expect(persisted?.storyId).toBe(storyId)
    expectOthersUnchanged(before, after, ['title'])
  })
})

describe('探针 B8：形状校验', () => {
  it('title 空串 → 422 REQUIRED', async () => {
    const response = await patchTask({ title: '' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'REQUIRED')
  })

  it('title 纯空格 → 422 REQUIRED', async () => {
    const response = await patchTask({ title: '     ' })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'REQUIRED')
  })

  it('title 超长（201） → 422 TOO_LONG', async () => {
    const response = await patchTask({ title: '任'.repeat(201) })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'TOO_LONG')
  })

  it('planStart / planEnd 日期格式非法 → 422 INVALID_FORMAT', async () => {
    const badStart = await patchTask({ planStart: '2026/09/01' })
    expect(badStart.status).toBe(422)
    expectFieldError(badStart.body as ErrorBody, 'planStart', 'INVALID_FORMAT')

    const badEnd = await patchTask({ planEnd: '09-10-2026' })
    expect(badEnd.status).toBe(422)
    expectFieldError(badEnd.body as ErrorBody, 'planEnd', 'INVALID_FORMAT')
  })

  it('ownerUserId / acceptorUserId 空串 → 422 REQUIRED', async () => {
    const ownerRes = await patchTask({ ownerUserId: '' })
    expect(ownerRes.status).toBe(422)
    expectFieldError(ownerRes.body as ErrorBody, 'ownerUserId', 'REQUIRED')

    const acceptorRes = await patchTask({ acceptorUserId: '' })
    expect(acceptorRes.status).toBe(422)
    expectFieldError(acceptorRes.body as ErrorBody, 'acceptorUserId', 'REQUIRED')
  })
})

describe('探针 B9：description 的 null 与空串行为差异（观察项，契约未明示）', () => {
  it('description: null → 清空为 null；description: "" → 存为空串（两者行为不同）', async () => {
    // 观察到的实现行为（记录，不作为缺陷）：schema 为 z.string().nullable().optional()，
    // 因此 null 与 "" 都被接受，分别持久化为 null 与 ""。
    const nullRes = await patchTask({ description: null })
    expect(nullRes.status).toBe(200)
    expect((nullRes.body as TaskView).description).toBeNull()

    const emptyRes = await patchTask({ description: '' })
    expect(emptyRes.status).toBe(200)
    expect((emptyRes.body as TaskView).description).toBe('')

    const persisted = await ctx.db.task.findUnique({ where: { id: taskId } })
    expect(persisted?.description).toBe('')
  })
})

// ===========================================================================
// C. 权限与不泄漏
// ===========================================================================

describe('探针 C10：权限矩阵', () => {
  it('MEMBER PATCH → 403 FORBIDDEN', async () => {
    const response = await patchTask({ title: '成员改名' }, member.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER PATCH → 403 FORBIDDEN', async () => {
    const response = await patchTask({ title: '管理者改名' }, viewer.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员 PATCH → 404 且响应体不含任务任何字段', async () => {
    const response = await patchTask({ title: '外部改名' }, outsider.id)
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('title')
    expect(serialized).not.toContain('对抗基线任务')
    expect(serialized).not.toContain(projectId)
    expect(serialized).not.toContain(storyId)
  })

  it('非项目成员 GET → 404 且响应体不含任务任何字段', async () => {
    const response = await getTask(outsider.id)
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('title')
    expect(serialized).not.toContain('对抗基线任务')
    expect(serialized).not.toContain('对抗基线描述')
  })

  it('未登录 PATCH / GET → 401 UNAUTHENTICATED', async () => {
    const patchRes = await ctx.asUser(null).patch(`/tasks/${taskId}`).send({ title: '匿名' })
    expect(patchRes.status).toBe(401)
    expect((patchRes.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')

    const getRes = await ctx.asUser(null).get(`/tasks/${taskId}`)
    expect(getRes.status).toBe(401)
    expect((getRes.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })
})

describe('探针 C11：GET /tasks/:taskId 形状', () => {
  it('不存在 → 404 NOT_FOUND', async () => {
    const response = await getTask(pm.id, 'no-such-task')

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('响应为 TaskView，内嵌 owner / acceptor 恰为 { id, account, displayName } 三项', async () => {
    const response = await getTask()
    const body = response.body as TaskView

    expect(response.status).toBe(200)
    // 必需标量字段齐全
    for (const field of SCALAR_FIELDS) {
      expect(body).toHaveProperty(field)
    }
    expect(Object.keys(body.owner).sort()).toEqual(['account', 'displayName', 'id'])
    expect(Object.keys(body.acceptor).sort()).toEqual(['account', 'displayName', 'id'])
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
})

describe('探针 C12：任何响应不得泄漏 passwordHash', () => {
  it('GET / PATCH 响应与库中未出现 passwordHash / 哈希值', async () => {
    const getRes = await getTask()
    const patchRes = await patchTask({ title: '改名' })
    for (const res of [getRes, patchRes]) {
      const serialized = JSON.stringify(res.body)
      expect(serialized).not.toContain('passwordHash')
      expect(serialized).not.toContain('test-password-hash')
    }
  })
})

describe('探针 C13：敏感任务详情不得泄漏存在性', () => {
  it('未授权成员 GET 敏感任务 → 404，message 与「任务不存在」逐字一致且不含敏感/无权限字样', async () => {
    const sensitive = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '绝密任务标题',
      description: '绝密任务描述',
      isSensitive: true,
    })
    // 直接造 ObjectVisibility：只授权给 viewer，不授权给 member。
    await ctx.db.objectVisibility.create({
      data: { projectId, objectType: 'task', objectId: sensitive.id, userId: viewer.id },
    })

    const missRes = await getTask(member.id, 'definitely-not-exist')
    const sensitiveRes = await getTask(member.id, sensitive.id)

    expect(missRes.status).toBe(404)
    expect(sensitiveRes.status).toBe(404)
    expect((sensitiveRes.body as ErrorBody).error.code).toBe('NOT_FOUND')
    // message 逐字一致：不得因对象真实存在而改变文案
    expect((sensitiveRes.body as ErrorBody).error.message).toBe(
      (missRes.body as ErrorBody).error.message,
    )
    // 文案不得出现「无权限」「敏感」
    expect((sensitiveRes.body as ErrorBody).error.message).not.toMatch(/无权限|敏感/)
    // 响应体不含该敏感对象任何字段
    const serialized = JSON.stringify(sensitiveRes.body)
    expect(serialized).not.toContain('绝密任务标题')
    expect(serialized).not.toContain('绝密任务描述')
    expect(serialized).not.toContain(sensitive.id)
  })

  it('PATCH 敏感任务而未授权 → 404（task.write 同样先过可见性）', async () => {
    const sensitive = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '绝密任务标题',
      isSensitive: true,
    })

    const response = await patchTask({ title: '窥探改名' }, member.id, sensitive.id)

    // member 写类动作为 403（对象可见？）——敏感未授权时 can() 顺序为敏感检查先于写动作。
    // 契约判定顺序：非成员 404 → PM allow → 敏感未授权 404 → 写动作 403。
    // member 是项目成员、目标敏感且不在名单 → 404。
    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(response.body)).not.toContain('绝密任务标题')
  })
})

// ===========================================================================
// D. 回归交叉断言：端点 24/25 既有行为不被 PATCH 破坏
// ===========================================================================

describe('探针 D15：端点 24/25 回归交叉断言', () => {
  it('端点 25 创建（合法）仍 201，且新任务随后可 GET 详情', async () => {
    const createRes = await ctx.asUser(ctx.loginAs(pm.id))
      .post(`/stories/${storyId}/tasks`)
      .send({
        title: '回归新任务',
        ownerUserId: member.id,
        acceptorUserId: pm.id,
        planStart: '2026-10-01',
        planEnd: '2026-10-10',
      })

    expect(createRes.status).toBe(201)
    const created = createRes.body as TaskView

    const detail = await getTask(pm.id, created.id)
    expect(detail.status).toBe(200)
    expect((detail.body as TaskView).title).toBe('回归新任务')
  })

  it('端点 25 创建时 acceptor = owner 仍 422 ACCEPTOR_EQUALS_OWNER', async () => {
    const response = await ctx.asUser(ctx.loginAs(pm.id))
      .post(`/stories/${storyId}/tasks`)
      .send({
        title: '回归非法',
        ownerUserId: member.id,
        acceptorUserId: member.id,
        planStart: '2026-10-01',
        planEnd: '2026-10-10',
      })

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'ACCEPTOR_EQUALS_OWNER')
  })

  it('端点 24 列表仍返回本轮 PATCH 后的最新状态', async () => {
    await patchTask({ status: 'DONE', title: '改后标题' })

    const response = await ctx.asUser(ctx.loginAs(pm.id))
      .get(`/stories/${storyId}/tasks`)
    const items = (response.body as { items: TaskView[] }).items
    const target = items.find((task) => task.id === taskId)

    expect(response.status).toBe(200)
    expect(target?.status).toBe('DONE')
    expect(target?.title).toBe('改后标题')
  })
})
