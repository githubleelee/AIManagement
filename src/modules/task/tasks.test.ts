/**
 * T5-01 接口测试 —— 端点 24 / 25（任务能建出来，并从用户故事里看见它）
 *
 * 唯一 seam 是 HTTP 接口层（契约 Testing Decisions）：全部通过 supertest
 * 发起请求、断言状态码、错误码与响应体；不断言内部实现。
 *
 * 覆盖：
 *   - 形状校验反例：必填缺失 / 标题超长 / 日期格式非法（Zod 产出的字段级错误码）
 *   - 权限反例：MEMBER / VIEWER 调 POST → 403；非项目成员调 GET / POST → 404 且无任务字段
 *   - 正例：201 TaskView（内嵌 owner/acceptor）、列表排序、status/isSensitive 默认值、
 *           projectId 由故事推导、createdAt ISO 8601、planStart 原样进出
 *
 * 明确不测（属 T5-02 及以后）：成员归属校验、ACCEPTOR_EQUALS_OWNER、END_BEFORE_START、
 * INSUFFICIENT_MEMBERS、编辑、删除、敏感过滤、按负责人过滤。
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

function postTask(body: Record<string, unknown>, actorUserId: string = pm.id) {
  return request(ctx.app.server)
    .post(`/stories/${storyId}/tasks`)
    .set('x-actor-user-id', actorUserId)
    .send(body)
}

function getTasks(actorUserId: string = pm.id) {
  return request(ctx.app.server)
    .get(`/stories/${storyId}/tasks`)
    .set('x-actor-user-id', actorUserId)
}

function expectFieldError(body: ErrorBody, field: string, code: string): void {
  expect(body.error.code).toBe('VALIDATION_FAILED')
  expect(body.error.details ?? []).toContainEqual({ field, code })
}

describe('端点 25 形状校验（Zod 产出字段级错误码）', () => {
  it('缺少必填字段 title → 422 REQUIRED', async () => {
    const { title: _title, ...withoutTitle } = validBody()
    const response = await postTask(withoutTitle)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'REQUIRED')
  })

  it('缺少必填字段 acceptorUserId → 422 REQUIRED', async () => {
    const { acceptorUserId: _acceptor, ...withoutAcceptor } = validBody()
    const response = await postTask(withoutAcceptor)

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'acceptorUserId', 'REQUIRED')
  })

  it('title 为纯空白 → 422 REQUIRED（契约 I-4：纯空白视同缺失）', async () => {
    const response = await postTask(validBody({ title: '   ' }))

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'REQUIRED')
  })

  it('title 超出长度上限 → 422 TOO_LONG', async () => {
    const response = await postTask(validBody({ title: '任'.repeat(201) }))

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'title', 'TOO_LONG')
  })

  it('planStart 格式非法 → 422 INVALID_FORMAT', async () => {
    const response = await postTask(validBody({ planStart: '2026/09/01' }))

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planStart', 'INVALID_FORMAT')
  })

  it('planEnd 格式非法 → 422 INVALID_FORMAT', async () => {
    const response = await postTask(validBody({ planEnd: '09-10-2026' }))

    expect(response.status).toBe(422)
    expectFieldError(response.body as ErrorBody, 'planEnd', 'INVALID_FORMAT')
  })

  it('形状校验被拒时不写入任何任务行', async () => {
    await postTask(validBody({ planStart: 'not-a-date' }))

    expect(await ctx.prisma.task.count()).toBe(0)
  })
})

describe('端点 25 权限', () => {
  it('MEMBER 创建任务 → 403 FORBIDDEN', async () => {
    const response = await postTask(validBody(), member.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 创建任务 → 403 FORBIDDEN', async () => {
    const response = await postTask(validBody(), viewer.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员创建任务 → 404 NOT_FOUND 且响应体不含任务字段', async () => {
    const response = await postTask(validBody(), outsider.id)
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('id')
    expect(response.body).not.toHaveProperty('title')
    expect(serialized).not.toContain('实现任务列表')
    expect(serialized).not.toContain('测试用户故事')
  })

  it('未登录（缺少 Actor）创建任务 → 401 UNAUTHENTICATED', async () => {
    const response = await request(ctx.app.server)
      .post(`/stories/${storyId}/tasks`)
      .send(validBody())

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })
})

describe('端点 24 权限与可见性', () => {
  it('非项目成员查看任务列表 → 404 NOT_FOUND 且响应体不含任务字段', async () => {
    await postTask(validBody())
    const response = await getTasks(outsider.id)
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('items')
    expect(serialized).not.toContain('实现任务列表')
  })

  it('故事不存在 → 404 NOT_FOUND', async () => {
    const response = await request(ctx.app.server)
      .get('/stories/does-not-exist/tasks')
      .set('x-actor-user-id', pm.id)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('MEMBER 可读取非敏感任务列表（project.read 允许）', async () => {
    await postTask(validBody())
    const response = await getTasks(member.id)

    expect(response.status).toBe(200)
    expect((response.body as { items: TaskView[] }).items).toHaveLength(1)
  })
})

describe('端点 25 正例：任务能建出来', () => {
  it('创建成功返回 201 TaskView，内嵌 owner / acceptor 的 UserBrief', async () => {
    const response = await postTask(validBody())

    expect(response.status).toBe(201)
    const body = response.body as TaskView
    expect(body.title).toBe('实现任务列表')
    expect(body.description).toBe('把故事拆成可执行工作')
    expect(body.storyId).toBe(storyId)
    expect(body.projectId).toBe(projectId)
    expect(body.ownerUserId).toBe(member.id)
    expect(body.acceptorUserId).toBe(pm.id)
    expect(body.planStart).toBe('2026-09-01')
    expect(body.planEnd).toBe('2026-09-10')
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

  it('status 默认为 TODO、isSensitive 默认为 false', async () => {
    const response = await postTask(validBody())
    const body = response.body as TaskView

    expect(body.status).toBe('TODO')
    expect(body.isSensitive).toBe(false)
  })

  it('createdAt 为 ISO 8601 UTC 字符串', async () => {
    const response = await postTask(validBody())
    const body = response.body as TaskView

    expect(typeof body.createdAt).toBe('string')
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt)
  })

  it('projectId 从 storyId 所属故事推导，请求体传入被忽略', async () => {
    const response = await postTask(validBody({ projectId: 'forged-project-id' }))
    const body = response.body as TaskView

    expect(response.status).toBe(201)
    expect(body.projectId).toBe(projectId)
    const persisted = await ctx.prisma.task.findUnique({ where: { id: body.id } })
    expect(persisted?.projectId).toBe(projectId)
  })

  it('description 可选，不传时返回 null', async () => {
    const { description: _description, ...withoutDescription } = validBody()
    const response = await postTask(withoutDescription)
    const body = response.body as TaskView

    expect(response.status).toBe(201)
    expect(body.description).toBeNull()
  })

  it('planStart / planEnd 以 YYYY-MM-DD 原样进出，不被时区转换', async () => {
    const response = await postTask(validBody({ planStart: '2026-01-01', planEnd: '2026-01-31' }))
    const body = response.body as TaskView

    expect(body.planStart).toBe('2026-01-01')
    expect(body.planEnd).toBe('2026-01-31')

    const list = await getTasks()
    const listed = (list.body as { items: TaskView[] }).items[0]
    expect(listed?.planStart).toBe('2026-01-01')
    expect(listed?.planEnd).toBe('2026-01-31')
  })
})

describe('端点 24 正例：从用户故事里看见任务', () => {
  it('创建后任务出现在列表里，刷新（再次请求）仍在', async () => {
    await postTask(validBody())

    const first = await getTasks()
    const second = await getTasks()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((first.body as { items: TaskView[] }).items).toHaveLength(1)
    expect((second.body as { items: TaskView[] }).items).toHaveLength(1)
    expect((second.body as { items: TaskView[] }).items[0]?.title).toBe('实现任务列表')
  })

  it('一个用户故事下可建多个任务，各自字段互不影响', async () => {
    await postTask(validBody({ title: '任务A', planStart: '2026-02-02' }))
    await postTask(validBody({ title: '任务B', ownerUserId: pm.id, acceptorUserId: member.id }))

    const response = await getTasks()
    const items = (response.body as { items: TaskView[] }).items

    expect(items).toHaveLength(2)
    expect(new Set(items.map((task) => task.title))).toEqual(new Set(['任务A', '任务B']))
  })

  it('列表按 planStart 升序返回', async () => {
    await postTask(validBody({ title: '晚', planStart: '2026-03-01' }))
    await postTask(validBody({ title: '早', planStart: '2026-01-01' }))
    await postTask(validBody({ title: '中', planStart: '2026-02-01' }))

    const response = await getTasks()
    const items = (response.body as { items: TaskView[] }).items

    expect(items.map((task) => task.planStart)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
    expect(items.map((task) => task.title)).toEqual(['早', '中', '晚'])
  })

  it('planStart 相同时按 createdAt 升序返回', async () => {
    // 直接插入并显式指定 createdAt，避免同毫秒导致排序不确定
    await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '晚创建',
      planStart: '2026-05-01',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '早创建',
      planStart: '2026-05-01',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '最早开始',
      planStart: '2026-04-01',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    })

    const response = await getTasks()
    const items = (response.body as { items: TaskView[] }).items

    expect(items.map((task) => task.title)).toEqual(['最早开始', '早创建', '晚创建'])
  })

  it('列表元素与创建响应字段形状一致（TaskView）', async () => {
    const created = (await postTask(validBody())).body as TaskView
    const response = await getTasks()
    const listed = (response.body as { items: TaskView[] }).items[0]

    expect(listed).toBeDefined()
    expect(Object.keys(listed ?? {}).sort()).toEqual(Object.keys(created).sort())
    expect(listed?.owner).toEqual(created.owner)
    expect(listed?.acceptor).toEqual(created.acceptor)
  })
})
