/**
 * T5-07 对抗性验证 —— 迁移真实性 + 真实鉴权（Bearer）端到端
 *
 * 本文件是 T5-07 收口工单的**独立对抗性验证**，不是实现方自测的重复。
 * 它只打 HTTP 接口层（契约「唯一 seam」），所有断言都经 `buildApp({ prisma })`
 * 走**生产注册路径**（`registerRoutes` → `registerTaskRoutes`），不自行注册模块。
 *
 * 覆盖：
 *   A. 7 个任务端点全部挂 `{ preHandler: requireAuth }`（无 Authorization → 401）
 *   D1. 有效令牌 → 200；无头 / 畸形 / 伪造令牌 → 401
 *   D2. 令牌失效语义：把成员移出项目后，同一令牌下一次请求即 404（can() 现查库）
 *   D3. 删除用户后旧令牌 → 401（registerActorResolver 现查用户存在性）
 *   D4. 越权矩阵抽样：MEMBER / VIEWER 对端点 25/28/29/30 → 403（非敏感）；非成员 → 404
 *   D5. 响应体不得泄漏 passwordHash（详情 / 列表 / 创建）
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../shared/types.js'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeUser,
  makeProject,
  makeGoal,
  makeActivity,
  makeStory,
  makeTask,
  makeMember,
} from '../../../test/factories.js'

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
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser('pm@example.com', '项目经理')
  member = await makeUser('member@example.com', '项目成员')
  viewer = await makeUser('viewer@example.com', '只读观察者')
  outsider = await makeUser('outsider@example.com', '项目外用户')

  const project = await makeProject(pm.id, '对抗验证项目')
  projectId = project.projectId
  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')

  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '对抗验证故事',
    capabilityText: '拆任务',
    valueText: '验证迁移',
    businessValue: '高',
    priority: 'P0',
  })
  // 非敏感任务：owner = member，acceptor = pm（满足「验收人 ≠ 负责人」）
  taskId = await makeTask(storyId, member.id, pm.id, { title: '对抗验证任务' })
})

// ---------------------------------------------------------------------------
// A. 7 个端点全部挂 requireAuth：无 Authorization 一律 401
// ---------------------------------------------------------------------------

describe('A T5-07 迁移真实性：7 个任务端点全部要求登录', () => {
  it('无 Authorization 头逐一访问 7 个端点 → 全部 401 UNAUTHENTICATED', async () => {
    const anon = ctx.asUser(null)
    const responses = [
      await anon.get(`/stories/${storyId}/tasks`),
      await anon.post(`/stories/${storyId}/tasks`).send({}),
      await anon.get(`/projects/${projectId}/tasks`),
      await anon.get(`/tasks/${taskId}`),
      await anon.patch(`/tasks/${taskId}`).send({ title: 'x' }),
      await anon.delete(`/tasks/${taskId}`),
      await anon.put(`/tasks/${taskId}/sensitivity`).send({ isSensitive: true, visibleMemberIds: [] }),
    ]
    for (const res of responses) {
      expect(res.status).toBe(401)
      expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
    }
  })

  it('7 条路由都由 buildApp（生产注册路径）注册，测试未自行 app.register 模块', () => {
    const expected: Array<[string, string]> = [
      ['GET', '/stories/:storyId/tasks'],
      ['POST', '/stories/:storyId/tasks'],
      ['GET', '/projects/:projectId/tasks'],
      ['GET', '/tasks/:taskId'],
      ['PATCH', '/tasks/:taskId'],
      ['DELETE', '/tasks/:taskId'],
      ['PUT', '/tasks/:taskId/sensitivity'],
    ]
    const missing = expected
      .filter(([method, url]) => !ctx.app.hasRoute({ method: method as 'GET', url }))
      .map(([method, url]) => `${method} ${url}`)
    expect(missing).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// D1. Bearer 令牌：有效 / 无头 / 畸形 / 伪造
// ---------------------------------------------------------------------------

describe('D1 真实鉴权：令牌有效性与 401', () => {
  it('有效 Bearer 令牌 → 200，且读到完整 TaskView', async () => {
    const res = await ctx.asUser(ctx.loginAs(pm.id)).get(`/tasks/${taskId}`)
    expect(res.status).toBe(200)
    expect((res.body as TaskView).id).toBe(taskId)
  })

  it('无 Authorization 头 → 401', async () => {
    const res = await ctx.asUser(null).get(`/tasks/${taskId}`)
    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('畸形令牌（无点号 / 结构错误）→ 401', async () => {
    for (const malformed of ['not-a-token', 'abc.def', 'a.b.c']) {
      const res = await ctx.asUser(malformed).get(`/tasks/${taskId}`)
      expect(res.status).toBe(401)
    }
  })

  it('伪造令牌（篡改签名）→ 401', async () => {
    const valid = ctx.loginAs(pm.id)
    const [payload, signature] = valid.split('.') as [string, string]
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
    const forged = `${payload}.${flipped}`
    expect(forged).not.toBe(valid)

    const res = await ctx.asUser(forged).get(`/tasks/${taskId}`)
    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })
})

// ---------------------------------------------------------------------------
// D2. 令牌失效语义：成员被移出项目后，旧令牌下一次请求即 404
// ---------------------------------------------------------------------------

describe('D2 移除项目成员后，同一令牌立即失去访问（无进程内缓存）', () => {
  it('成员被移出项目 → 同 token 访问项目任务列表与任务详情都变 404', async () => {
    const memberToken = ctx.loginAs(member.id)

    const before = await ctx.asUser(memberToken).get(`/projects/${projectId}/tasks`)
    expect(before.status).toBe(200)
    expect((before.body as { items: TaskView[] }).items.map((t) => t.id)).toContain(taskId)

    await ctx.db.projectMember.delete({
      where: { projectId_userId: { projectId, userId: member.id } },
    })

    const listAfter = await ctx.asUser(memberToken).get(`/projects/${projectId}/tasks`)
    expect(listAfter.status).toBe(404)
    expect((listAfter.body as ErrorBody).error.code).toBe('NOT_FOUND')

    const detailAfter = await ctx.asUser(memberToken).get(`/tasks/${taskId}`)
    expect(detailAfter.status).toBe(404)

    // 令牌本身没有被吊销（无状态），但 can() 现查库得出非成员 → 404。
    const stillValidForPm = await ctx.asUser(ctx.loginAs(pm.id)).get(`/tasks/${taskId}`)
    expect(stillValidForPm.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// D3. 删除用户后旧令牌 → 401
// ---------------------------------------------------------------------------

describe('D3 删除用户后旧令牌失效（actor 解析现查用户存在性）', () => {
  it('删除用户（先清成员关系满足外键）→ 旧 token 变 401', async () => {
    const viewerToken = ctx.loginAs(viewer.id)
    expect((await ctx.asUser(viewerToken).get(`/tasks/${taskId}`)).status).toBe(200)

    await ctx.db.projectMember.delete({
      where: { projectId_userId: { projectId, userId: viewer.id } },
    })
    await ctx.db.user.delete({ where: { id: viewer.id } })

    const after = await ctx.asUser(viewerToken).get(`/tasks/${taskId}`)
    expect(after.status).toBe(401)
    expect((after.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })
})

// ---------------------------------------------------------------------------
// D4. 越权矩阵抽样：端点 25 / 28 / 29 / 30
// ---------------------------------------------------------------------------

describe('D4 越权矩阵：非敏感任务上 MEMBER / VIEWER → 403，非成员 → 404', () => {
  it('MEMBER 对端点 25 / 28 / 29 / 30 → 全部 403 FORBIDDEN', async () => {
    const as = ctx.asUser(ctx.loginAs(member.id))
    const created = await as.post(`/stories/${storyId}/tasks`).send({
      title: 'member 越权创建',
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
    })
    const patched = await as.patch(`/tasks/${taskId}`).send({ title: 'member 越权改' })
    const deleted = await as.delete(`/tasks/${taskId}`)
    const sensitivity = await as.put(`/tasks/${taskId}/sensitivity`).send({
      isSensitive: true,
      visibleMemberIds: [],
    })

    for (const res of [created, patched, deleted, sensitivity]) {
      expect(res.status).toBe(403)
      expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
    }
  })

  it('VIEWER 对端点 25 / 28 / 29 / 30 → 全部 403 FORBIDDEN', async () => {
    const as = ctx.asUser(ctx.loginAs(viewer.id))
    const created = await as.post(`/stories/${storyId}/tasks`).send({
      title: 'viewer 越权创建',
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
    })
    const patched = await as.patch(`/tasks/${taskId}`).send({ title: 'viewer 越权改' })
    const deleted = await as.delete(`/tasks/${taskId}`)
    const sensitivity = await as.put(`/tasks/${taskId}/sensitivity`).send({
      isSensitive: true,
      visibleMemberIds: [],
    })

    for (const res of [created, patched, deleted, sensitivity]) {
      expect(res.status).toBe(403)
      expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
    }
  })

  it('非项目成员对端点 25 / 28 / 29 / 30 → 全部 404 NOT_FOUND，且响应体不泄漏对象字段', async () => {
    const as = ctx.asUser(ctx.loginAs(outsider.id))
    const created = await as.post(`/stories/${storyId}/tasks`).send({
      title: 'outsider 越权创建',
      ownerUserId: outsider.id,
      acceptorUserId: pm.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
    })
    const patched = await as.patch(`/tasks/${taskId}`).send({ title: 'outsider 越权改' })
    const deleted = await as.delete(`/tasks/${taskId}`)
    const sensitivity = await as.put(`/tasks/${taskId}/sensitivity`).send({
      isSensitive: true,
      visibleMemberIds: [],
    })

    for (const res of [created, patched, deleted, sensitivity]) {
      expect(res.status).toBe(404)
      expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
      const serialized = JSON.stringify(res.body)
      expect(serialized).not.toContain(taskId)
      expect(serialized).not.toContain('对抗验证任务')
    }
  })
})

// ---------------------------------------------------------------------------
// D5. 响应体不得泄漏 passwordHash
// ---------------------------------------------------------------------------

describe('D5 任何任务响应不得含 passwordHash', () => {
  it('详情 / 列表 / 创建响应的序列化内容都不含 passwordHash', async () => {
    const as = ctx.asUser(ctx.loginAs(pm.id))
    const detail = await as.get(`/tasks/${taskId}`)
    const list = await as.get(`/stories/${storyId}/tasks`)
    const created = await as.post(`/stories/${storyId}/tasks`).send({
      title: '新任务',
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      planStart: '2026-02-01',
      planEnd: '2026-02-02',
    })

    expect(detail.status).toBe(200)
    expect(list.status).toBe(200)
    expect(created.status).toBe(201)

    for (const res of [detail, list, created]) {
      const serialized = JSON.stringify(res.body)
      expect(serialized).not.toContain('passwordHash')
      expect(serialized).not.toContain('$2b$')
      expect(serialized).not.toContain('scrypt')
    }

    // 内嵌 UserBrief 只暴露 id / account / displayName 三字段
    const body = detail.body as TaskView
    expect(Object.keys(body.owner).sort()).toEqual(['account', 'displayName', 'id'])
    expect(Object.keys(body.acceptor).sort()).toEqual(['account', 'displayName', 'id'])
  })
})
