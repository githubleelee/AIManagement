/**
 * US-01 / T1.7：项目隔离矩阵（AC-US-01-06 ★核心）
 *
 * 端点 5/6/7/8/9 全部经 can() 判定；非项目成员访问一律 404 NOT_FOUND，
 * 且响应体不含项目名 / 项目 id / 账号。有项目但非成员 与 项目不存在 的 404 必须完全一致。
 * 越权用例必须直接打接口，不能用「前端不显示按钮」代替。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'

let ctx: HttpTestContext

beforeAll(async () => {
  ctx = await createHttpTestContext()
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'
type Ctx = { projectId: string; aliceId: string }
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
    path: (c) => `/projects/${c.projectId}/members/${c.aliceId}`,
    body: { role: 'MEMBER' },
  },
  {
    name: '端点 9 移除成员',
    method: 'delete',
    path: (c) => `/projects/${c.projectId}/members/${c.aliceId}`,
  },
]

async function setup(): Promise<Ctx> {
  const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')
  const projectId = await makeProject(ctx.db, aliceId, '机密项目')
  return { projectId, aliceId }
}

describe('T1.7 项目隔离：非项目成员一律 404 且不泄漏项目数据', () => {
  it.each(cases)('$name → 404 NOT_FOUND，响应体无项目字段', async ({ method, path, body }) => {
    const seeded = await setup()
    const bobId = await makeUser(ctx.db, 'bob', '鲍勃')
    const user = ctx.asUser(ctx.loginAs(bobId))

    const req = user[method](path(seeded))
    const res = body ? await req.send(body as object) : await req

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    const text = JSON.stringify(res.body)
    expect(text).not.toContain('机密项目')
    expect(text).not.toContain(seeded.projectId)
    expect(text).not.toContain('alice')
  })

  it('不泄漏存在性：有项目但非成员 与 项目不存在 的 404 完全一致', async () => {
    const seeded = await setup()
    const bobId = await makeUser(ctx.db, 'bob', '鲍勃')
    const bob = ctx.asUser(ctx.loginAs(bobId))

    const existing = await bob.get(`/projects/${seeded.projectId}`)
    const missing = await bob.get('/projects/no-such-project')

    expect(existing.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(existing.body).toEqual(missing.body)
  })

  it('端点 4 GET /projects 不返回他人项目', async () => {
    await setup()
    const bobId = await makeUser(ctx.db, 'bob', '鲍勃')

    const res = await ctx.asUser(ctx.loginAs(bobId)).get('/projects')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(0)
  })
})

