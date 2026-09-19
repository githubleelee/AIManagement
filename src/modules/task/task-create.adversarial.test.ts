/**
 * T5-01 对抗性验证测试 —— 端点 24 / 25（测试智能体-T5-01）
 *
 * 目的：不复跑编码体的 `tasks.test.ts`，而是从前一个角色没想到的攻击面出发，
 * 绕过界面直接打 HTTP 接口，验证服务端强制校验、请求体注入、输入边界与响应泄漏。
 *
 * 唯一 seam 是 HTTP 接口层。数据自建、每个测试互不污染。
 *
 * 说明：本分支的 Actor 注入是 T0-04 未合入前的临时桩（`_t0-stubs.ts`），
 * 用 `x-actor-user-id` 头而非契约的 `Authorization: Bearer`。因此「Bearer 未认证」
 * 只能验证到桩的边界，真实 requireAuth 路径标注为「未验证」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { TaskView } from '../../shared/types.js'
import {
  addMember,
  createProjectWithStory,
  createTaskRow,
  createUser,
  resetTaskTestDatabase,
  setupTaskTestApp,
  type TaskTestContext,
} from './_test-harness.js'

type ErrorBody = {
  error: {
    code: string
    message: string
    details?: Array<{ field: string; code: string }>
  }
}

let ctx: TaskTestContext
let pm: { id: string }
let member: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string

beforeAll(async () => {
  ctx = await setupTaskTestApp()
})

afterAll(async () => {
  await ctx.app.close()
  await ctx.prisma.$disconnect()
  await ctx.db.dispose()
})

beforeEach(async () => {
  await resetTaskTestDatabase(ctx)
  pm = await createUser(ctx.prisma, 'pm@example.com', '项目经理')
  member = await createUser(ctx.prisma, 'member@example.com', '项目成员')
  viewer = await createUser(ctx.prisma, 'viewer@example.com', '管理者')
  outsider = await createUser(ctx.prisma, 'outsider@example.com', '外部用户')

  const project = await createProjectWithStory(ctx.prisma, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await addMember(ctx.prisma, projectId, member.id, 'MEMBER')
  await addMember(ctx.prisma, projectId, viewer.id, 'VIEWER')
})

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '对抗性任务',
    description: '由测试智能体构造',
    ownerUserId: member.id,
    acceptorUserId: pm.id,
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
    ...overrides,
  }
}

function postTask(body: Record<string, unknown>, actorUserId = pm.id) {
  return request(ctx.app.server)
    .post(`/stories/${storyId}/tasks`)
    .set('x-actor-user-id', actorUserId)
    .send(body)
}

function getTasks(actorUserId = pm.id) {
  return request(ctx.app.server)
    .get(`/stories/${storyId}/tasks`)
    .set('x-actor-user-id', actorUserId)
}

function fieldCode(body: ErrorBody, field: string): string | undefined {
  return (body.error.details ?? []).find((detail) => detail.field === field)?.code
}

// ===========================================================================
// A. 服务端强制校验（★最高优先级，基线风险 R4）
// ===========================================================================
describe('A. 服务端强制校验', () => {
  it('A1a MEMBER / VIEWER 调 POST → 403（服务端而非前端限制）', async () => {
    const asMember = await postTask(validBody(), member.id)
    const asViewer = await postTask(validBody(), viewer.id)

    expect(asMember.status).toBe(403)
    expect((asMember.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(asViewer.status).toBe(403)
    expect((asViewer.body as ErrorBody).error.code).toBe('FORBIDDEN')
    // 越权写入不得落库
    expect(await ctx.prisma.task.count()).toBe(0)
  })

  it('A1b MEMBER / VIEWER 调 GET → 200（只读允许）', async () => {
    await postTask(validBody())

    const asMember = await getTasks(member.id)
    const asViewer = await getTasks(viewer.id)

    expect(asMember.status).toBe(200)
    expect(asViewer.status).toBe(200)
    expect((asMember.body as { items: TaskView[] }).items).toHaveLength(1)
    expect((asViewer.body as { items: TaskView[] }).items).toHaveLength(1)
  })

  it('A2 非项目成员 POST / GET → 404，且不泄漏故事与任务的任何字段', async () => {
    await postTask(validBody())

    const postAsOutsider = await postTask(validBody(), outsider.id)
    const getAsOutsider = await getTasks(outsider.id)

    expect(postAsOutsider.status).toBe(404)
    expect(getAsOutsider.status).toBe(404)
    expect((postAsOutsider.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect((getAsOutsider.body as ErrorBody).error.code).toBe('NOT_FOUND')

    const serialized = JSON.stringify(getAsOutsider.body)
    expect(serialized).not.toContain('对抗性任务')
    expect(serialized).not.toContain('测试用户故事')
    expect(serialized).not.toContain(projectId)
    expect(serialized).not.toContain(storyId)
    // 404 文案不得出现「无权限」「敏感」
    expect(serialized).not.toContain('无权限')
    expect(serialized).not.toContain('敏感')
  })

  it('A2b 非成员 404 与「故事不存在」404 响应结构完全一致', async () => {
    const asOutsider = await getTasks(outsider.id)
    const missing = await request(ctx.app.server)
      .get('/stories/does-not-exist/tasks')
      .set('x-actor-user-id', pm.id)

    expect(asOutsider.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(asOutsider.body).toEqual(missing.body)
  })

  it('A2c 是另一个项目的成员，访问本项目的故事仍 404', async () => {
    // outsider 在 project2 是 PM，但绝不是 project1 成员
    const project2 = await createProjectWithStory(ctx.prisma, outsider.id, {
      projectName: '另一个项目',
      storyTitle: '另一个故事',
    })

    const response = await getTasks(outsider.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    // 不能串到 project2 的数据
    expect(JSON.stringify(response.body)).not.toContain(project2.storyId)
  })

  it('A3 未认证（缺 Actor）→ 401 UNAUTHENTICATED，且不被错误处理器改写', async () => {
    const post = await request(ctx.app.server)
      .post(`/stories/${storyId}/tasks`)
      .send(validBody())
    const get = await request(ctx.app.server).get(`/stories/${storyId}/tasks`)

    expect(post.status).toBe(401)
    expect(get.status).toBe(401)
    expect((post.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
    expect((get.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
    // I-4：401 不得被按状态码区间改写（此处桩直接抛 AppError(401)，断言原样透出）
    expect((post.body as ErrorBody).error.code).not.toBe('VALIDATION_FAILED')
    expect((post.body as ErrorBody).error.code).not.toBe('BAD_REQUEST')
  })

  it('A3b 只带契约的 Authorization: Bearer（无 x-actor 桩头）→ 401（记录：Bearer 尚未接线）', async () => {
    // 观察项：T0-04 的 requireAuth 未合入，T5-01 的桩只认 x-actor-user-id，
    // 因此契约里的 Bearer 头在本分支不被识别。真实鉴权路径「未验证」。
    const response = await request(ctx.app.server)
      .post(`/stories/${storyId}/tasks`)
      .set('Authorization', 'Bearer some-opaque-token')
      .send(validBody())

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })
})

// ===========================================================================
// B. 请求体注入探针（★本工单最可能的真实缺陷）
// ===========================================================================
describe('B. 请求体注入（契约禁止的字段必须被忽略）', () => {
  it("B1 传 status: 'DONE' → 不落库为 DONE，仍为默认 TODO", async () => {
    const response = await postTask(validBody({ status: 'DONE' }))
    const body = response.body as TaskView

    expect(response.status).toBe(201)
    expect(body.status).toBe('TODO')
    const persisted = await ctx.prisma.task.findUnique({ where: { id: body.id } })
    expect(persisted?.status).toBe('TODO')
  })

  it('B2 传 isSensitive: true + visibleMemberIds → 不生效（绕过 sensitivity.manage）', async () => {
    const response = await postTask(
      validBody({ isSensitive: true, visibleMemberIds: [member.id] }),
    )
    const body = response.body as TaskView

    expect(response.status).toBe(201)
    expect(body.isSensitive).toBe(false)
    const persisted = await ctx.prisma.task.findUnique({ where: { id: body.id } })
    expect(persisted?.isSensitive).toBe(false)
    // 不得写出任何可见性白名单记录
    expect(await ctx.prisma.objectVisibility.count()).toBe(0)
  })

  it('B3 传 projectId / storyId → 仍归属故事所在项目与故事', async () => {
    const response = await postTask(
      validBody({ projectId: 'forged-project', storyId: 'forged-story' }),
    )
    const body = response.body as TaskView

    expect(response.status).toBe(201)
    expect(body.projectId).toBe(projectId)
    expect(body.storyId).toBe(storyId)
    const persisted = await ctx.prisma.task.findUnique({ where: { id: body.id } })
    expect(persisted?.projectId).toBe(projectId)
    expect(persisted?.storyId).toBe(storyId)
  })

  it('B4 传响应侧字段 id / createdAt / owner / acceptor → 不影响落库', async () => {
    const response = await postTask(
      validBody({
        id: 'forged-id',
        createdAt: '1999-01-01T00:00:00.000Z',
        owner: { id: 'forged', account: 'x', displayName: 'y' },
        acceptor: { id: 'forged', account: 'x', displayName: 'y' },
      }),
    )
    const body = response.body as TaskView

    expect(response.status).toBe(201)
    expect(body.id).not.toBe('forged-id')
    expect(body.createdAt).not.toBe('1999-01-01T00:00:00.000Z')
    const persisted = await ctx.prisma.task.findUnique({ where: { id: body.id } })
    expect(persisted).not.toBeNull()
    expect(await ctx.prisma.task.count()).toBe(1)
  })

  it('B5 传未知字段 foo → 被忽略且创建成功（契约未定义，记为观察项）', async () => {
    const response = await postTask(validBody({ foo: 1, bar: { nested: true } }))

    expect(response.status).toBe(201)
    expect((response.body as TaskView).title).toBe('对抗性任务')
  })

  it('B6 敌意键 __proto__ / constructor 不得污染原型或落库', async () => {
    const response = await postTask(
      validBody({ __proto__: { isSensitive: true }, constructor: { name: 'x' } }),
    )

    expect(response.status).toBe(201)
    expect((response.body as TaskView).isSensitive).toBe(false)
    expect(({} as { isSensitive?: boolean }).isSensitive).toBeUndefined()
  })
})

// ===========================================================================
// C. 输入边界探针
// ===========================================================================
describe('C. 输入边界', () => {
  it('C1 title 为空串 → 422 REQUIRED', async () => {
    const response = await postTask(validBody({ title: '' }))

    expect(response.status).toBe(422)
    expect(fieldCode(response.body as ErrorBody, 'title')).toBe('REQUIRED')
  })

  it('C1b title 为纯空格 → 422 REQUIRED', async () => {
    const response = await postTask(validBody({ title: ' \t\n ' }))

    expect(response.status).toBe(422)
    expect(fieldCode(response.body as ErrorBody, 'title')).toBe('REQUIRED')
  })

  it('C2 title 恰好等于长度上限 200 → 201；超 1 字符 → TOO_LONG', async () => {
    const exact = await postTask(validBody({ title: '任'.repeat(200) }))
    const over = await postTask(validBody({ title: '任'.repeat(201) }))

    expect(exact.status).toBe(201)
    expect((exact.body as TaskView).title).toHaveLength(200)
    expect(over.status).toBe(422)
    expect(fieldCode(over.body as ErrorBody, 'title')).toBe('TOO_LONG')
  })

  it('C3 日期形状非法（非 YYYY-MM-DD）→ INVALID_FORMAT', async () => {
    const cases = ['2026-1-1', '2026/01/01', '2026-01-01T00:00:00Z', '01-01-2026', '20260101']
    for (const value of cases) {
      const response = await postTask(validBody({ planStart: value }))
      expect(response.status, `planStart=${value}`).toBe(422)
      expect(fieldCode(response.body as ErrorBody, 'planStart'), `planStart=${value}`).toBe(
        'INVALID_FORMAT',
      )
    }
  })

  it('C3b planStart 为空串 → 422（REQUIRED 或 INVALID_FORMAT，契约两者皆列）', async () => {
    const response = await postTask(validBody({ planStart: '' }))
    const code = fieldCode(response.body as ErrorBody, 'planStart')

    expect(response.status).toBe(422)
    expect(['REQUIRED', 'INVALID_FORMAT']).toContain(code)
    // 当前实现（regex）给出 INVALID_FORMAT；纯空白亦同
    expect(code).toBe('INVALID_FORMAT')
  })

  it('C4 planStart / planEnd 缺失 → REQUIRED', async () => {
    const { planStart: _s, ...withoutStart } = validBody()
    const { planEnd: _e, ...withoutEnd } = validBody()
    const a = await postTask(withoutStart)
    const b = await postTask(withoutEnd)

    expect(a.status).toBe(422)
    expect(fieldCode(a.body as ErrorBody, 'planStart')).toBe('REQUIRED')
    expect(b.status).toBe(422)
    expect(fieldCode(b.body as ErrorBody, 'planEnd')).toBe('REQUIRED')
  })

  it('C5 非法日历日期仅被 Zod 正则放行（形状层空白，T5-02 未引入日历校验）', async () => {
    // 正则 /^\d{4}-\d{2}-\d{2}$/ 只保证形状，不保证日历合法性。
    // 注意：T5-02 的 planEnd >= planStart 业务规则会在 planStart 取值较大时先行拒绝，
    // 因此这里把 planEnd 设为同值，隔离出「形状层是否接受」这一点。
    for (const value of ['2026-13-01', '2026-02-30', '2026-00-00', '2026-99-99']) {
      const response = await postTask(validBody({ planStart: value, planEnd: value }))
      expect(response.status, `planStart=${value}`).toBe(201)
      const persisted = await ctx.prisma.task.findFirst({ where: { planStart: value } })
      expect(persisted, `planStart=${value}`).not.toBeNull()
    }
  })

  it('C6 planStart / planEnd 原样进出，不被转成 UTC 或前移一天', async () => {
    const response = await postTask(validBody({ planStart: '2026-12-31', planEnd: '2027-01-01' }))
    const body = response.body as TaskView

    expect(body.planStart).toBe('2026-12-31')
    expect(body.planEnd).toBe('2027-01-01')

    const list = await getTasks()
    const listed = (list.body as { items: TaskView[] }).items[0]
    expect(listed?.planStart).toBe('2026-12-31')
    expect(listed?.planEnd).toBe('2027-01-01')
  })
})

// ===========================================================================
// D. 响应契约探针
// ===========================================================================
describe('D. 响应契约', () => {
  const TASK_VIEW_KEYS = [
    'acceptor',
    'acceptorUserId',
    'createdAt',
    'description',
    'id',
    'isSensitive',
    'owner',
    'ownerUserId',
    'planEnd',
    'planStart',
    'projectId',
    'status',
    'storyId',
    'title',
  ].sort()

  it('D1 POST 201 与 GET 列表元素都是完整 TaskView，字段集合精确', async () => {
    const created = await postTask(validBody())
    const list = await getTasks()
    const listed = (list.body as { items: TaskView[] }).items[0]

    expect(Object.keys(created.body).sort()).toEqual(TASK_VIEW_KEYS)
    expect(Object.keys(listed ?? {}).sort()).toEqual(TASK_VIEW_KEYS)
  })

  it('D2 owner / acceptor 恰好是 { id, account, displayName } 三项', async () => {
    const response = await postTask(validBody())
    const body = response.body as TaskView

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

  it('D3 ★泄漏探针：响应任何位置都不得出现 passwordHash 或 User 表其它字段', async () => {
    // 给用户写入一个可识别的密码哈希，确保泄漏时一定能被检出
    await ctx.prisma.user.update({
      where: { id: member.id },
      data: { passwordHash: 'LEAK-CANARY-HASH-DO-NOT-EXPOSE' },
    })
    const created = await postTask(validBody())
    const list = await getTasks()

    const serialized = JSON.stringify(created.body) + JSON.stringify(list.body)
    expect(serialized).not.toContain('passwordHash')
    expect(serialized).not.toContain('LEAK-CANARY-HASH-DO-NOT-EXPOSE')
    // User 表其它字段同样不应出现
    for (const field of ['memberships', 'ownedProjects', 'ownedTasks', 'acceptedTasks', 'visibility']) {
      expect(serialized, field).not.toContain(field)
    }
  })

  it('D4 createdAt 是 ISO 8601 UTC 字符串，不是 Date / 时间戳', async () => {
    const response = await postTask(validBody())
    const body = response.body as TaskView

    expect(typeof body.createdAt).toBe('string')
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt)
  })

  it('D5 planStart 升序；planStart 相同时退化为 createdAt 升序', async () => {
    await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '同日起-晚',
      planStart: '2026-06-01',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '同日起-早',
      planStart: '2026-06-01',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '更晚',
      planStart: '2026-07-01',
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
    })
    await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '更早',
      planStart: '2026-05-01',
      createdAt: new Date('2027-01-01T00:00:00.000Z'),
    })

    const response = await getTasks()
    const titles = (response.body as { items: TaskView[] }).items.map((task) => task.title)

    expect(titles).toEqual(['更早', '同日起-早', '同日起-晚', '更晚'])
  })

  it('D6 visibilityScope 已接入列表：非 PM 看不到敏感任务（T5-01 已接线，T5-05 才可设置）', async () => {
    const visible = await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '普通任务',
      isSensitive: false,
    })
    const secret = await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '敏感任务',
      isSensitive: true,
    })

    const asPm = await getTasks(pm.id)
    const asMember = await getTasks(member.id)

    expect((asPm.body as { items: TaskView[] }).items).toHaveLength(2)
    const memberIds = (asMember.body as { items: TaskView[] }).items.map((task) => task.id)
    expect(memberIds).toContain(visible.id)
    expect(memberIds).not.toContain(secret.id)
    expect(JSON.stringify(asMember.body)).not.toContain('敏感任务')
  })

  it('D7 列表包装为 ListResponse<TaskView>（{ items: [...] }）', async () => {
    await postTask(validBody())
    const response = await getTasks()

    expect(response.status).toBe(200)
    expect(Object.keys(response.body)).toEqual(['items'])
    expect(Array.isArray((response.body as { items: TaskView[] }).items)).toBe(true)
  })
})

// ===========================================================================
// G. T5-02 业务规则强制（原 T5-01 缺口断言已翻转）
//    T5-01 时这里断言「当前接受」作为缺口留档；合并 T5-02 后改为断言拒绝
//    与字段级错误码，并确认被拒请求不落库。
// ===========================================================================
describe('G. T5-02 业务规则强制（原 T5-01 缺口断言已翻转）', () => {
  it('G1 验收人 = 负责人 → 422 acceptorUserId: ACCEPTOR_EQUALS_OWNER，且不落库', async () => {
    const response = await postTask(validBody({ ownerUserId: member.id, acceptorUserId: member.id }))

    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    expect(fieldCode(response.body as ErrorBody, 'acceptorUserId')).toBe('ACCEPTOR_EQUALS_OWNER')
    expect(await ctx.prisma.task.count()).toBe(0)
  })

  it('G2 负责人非本项目成员但用户存在 → 422 ownerUserId: NOT_PROJECT_MEMBER，且不落库', async () => {
    const response = await postTask(validBody({ ownerUserId: outsider.id }))

    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    expect(fieldCode(response.body as ErrorBody, 'ownerUserId')).toBe('NOT_PROJECT_MEMBER')
    expect(await ctx.prisma.task.count()).toBe(0)
  })

  it('G3 planEnd 早于 planStart → 422 planEnd: END_BEFORE_START，且不落库', async () => {
    const response = await postTask(validBody({ planStart: '2026-09-10', planEnd: '2026-09-01' }))

    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    expect(fieldCode(response.body as ErrorBody, 'planEnd')).toBe('END_BEFORE_START')
    expect(await ctx.prisma.task.count()).toBe(0)
  })

  it('G4 负责人 id 在 User 表不存在 → 422 ownerUserId: NOT_PROJECT_MEMBER（校验先于写库）', async () => {
    const response = await postTask(validBody({ ownerUserId: 'ghost-user-id' }))

    expect(response.status).toBe(422)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    expect(fieldCode(response.body as ErrorBody, 'ownerUserId')).toBe('NOT_PROJECT_MEMBER')
    expect(await ctx.prisma.task.count()).toBe(0)
  })
})
