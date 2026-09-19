import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { FastifyInstance } from 'fastify'
import { closeTestApp, getApp, resetDatabase } from '../../../test/helpers'
import { makeUser, type TestUser } from '../../../test/factories'

// T1.7：项目隔离（AC-US-01-06 ★核心）
// 端点 3–9 全部经 can() 判定；非项目成员访问一律 404，且响应体不含项目任何字段。
// 越权用例必须直接打接口，不能用「前端不显示按钮」代替。

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

beforeEach(async () => {
  await getApp()
  await resetDatabase()
})

afterAll(async () => {
  await closeTestApp()
})

type Method = 'get' | 'post' | 'patch' | 'delete'
type Ctx = { app: FastifyInstance; alice: TestUser; bob: TestUser; projectId: string }
type Case = { name: string; method: Method; path: (c: Ctx) => string; body?: unknown }

const cases: Case[] = [
  { name: '端点 5 项目详情', method: 'get', path: (c) => `/projects/${c.projectId}` },
  {
    name: '端点 6 添加成员',
    method: 'post',
    path: (c) => `/projects/${c.projectId}/members`,
    body: { account: 'alice', role: 'MEMBER' },
  },
  { name: '端点 7 成员列表', method: 'get', path: (c) => `/projects/${c.projectId}/members` },
  {
    name: '端点 8 修改角色',
    method: 'patch',
    path: (c) => `/projects/${c.projectId}/members/${c.alice.id}`,
    body: { role: 'MEMBER' },
  },
  {
    name: '端点 9 移除成员',
    method: 'delete',
    path: (c) => `/projects/${c.projectId}/members/${c.alice.id}`,
  },
]

async function setup(): Promise<Ctx> {
  const app = await getApp()
  const alice = await makeUser('alice', '爱丽丝')
  const bob = await makeUser('bob', '鲍勃')
  const created = await request(app.server)
    .post('/projects')
    .set(bearer(alice.token))
    .send({ name: '机密项目' })
  expect(created.status).toBe(201)
  return { app, alice, bob, projectId: created.body.id as string }
}

describe('T1.7 项目隔离：非项目成员一律 404 且不泄漏项目数据', () => {
  it.each(cases)('$name → 404 NOT_FOUND，响应体无项目字段', async ({ method, path, body }) => {
    const ctx = await setup()

    const agent = request(ctx.app.server) as unknown as Record<Method, (p: string) => any>
    const base = agent[method](path(ctx)).set(bearer(ctx.bob.token))
    const res = body ? await base.send(body as object) : await base

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    const text = JSON.stringify(res.body)
    expect(text).not.toContain('机密项目')
    expect(text).not.toContain(ctx.projectId)
    expect(text).not.toContain('alice')
  })

  it('不泄漏存在性：有项目但非成员 与 项目不存在 的 404 完全一致', async () => {
    const ctx = await setup()

    const existing = await request(ctx.app.server)
      .get(`/projects/${ctx.projectId}`)
      .set(bearer(ctx.bob.token))
    const missing = await request(ctx.app.server)
      .get('/projects/no-such-project')
      .set(bearer(ctx.bob.token))

    expect(existing.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(existing.body).toEqual(missing.body)
  })

  it('端点 4 GET /projects 不返回他人项目', async () => {
    const ctx = await setup()

    const res = await request(ctx.app.server).get('/projects').set(bearer(ctx.bob.token))

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(0)
  })
})
