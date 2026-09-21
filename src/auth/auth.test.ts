/**
 * M1 / T0-04：登录与当前用户会话（端点 1/2）
 *
 * 登录成功换取令牌；账号或密码错误不区分；受保护端点无令牌 / 篡改令牌 → 401。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeUser,
  TEST_PASSWORD,
  type HttpTestContext,
} from '../../test/http-support.js'

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

describe('端点 1：POST /auth/login', () => {
  it('登录成功返回 token 与 UserBrief，且令牌可用于受保护端点', async () => {
    const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')

    const login = await ctx
      .asUser(null)
      .post('/auth/login')
      .send({ account: 'alice', password: TEST_PASSWORD })

    expect(login.status).toBe(200)
    expect(login.body.user).toEqual({ id: aliceId, account: 'alice', displayName: '爱丽丝' })
    expect(typeof login.body.token).toBe('string')

    const me = await ctx.asUser(login.body.token).get('/auth/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ id: aliceId, account: 'alice', displayName: '爱丽丝' })
  })

  it('密码错误 → 401 UNAUTHENTICATED', async () => {
    await makeUser(ctx.db, 'alice', '爱丽丝')

    const res = await ctx
      .asUser(null)
      .post('/auth/login')
      .send({ account: 'alice', password: 'wrong-password' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('账号不存在与密码错误的响应完全一致（不区分是哪一个）', async () => {
    await makeUser(ctx.db, 'alice', '爱丽丝')

    const wrongPassword = await ctx
      .asUser(null)
      .post('/auth/login')
      .send({ account: 'alice', password: 'wrong-password' })
    const unknownAccount = await ctx
      .asUser(null)
      .post('/auth/login')
      .send({ account: 'ghost', password: TEST_PASSWORD })

    expect(wrongPassword.status).toBe(401)
    expect(unknownAccount.status).toBe(401)
    expect(wrongPassword.body).toEqual(unknownAccount.body)
  })

  it('缺少账号 → 422 account REQUIRED', async () => {
    const res = await ctx
      .asUser(null)
      .post('/auth/login')
      .send({ password: TEST_PASSWORD })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({ field: 'account', code: 'REQUIRED' })
  })

  it('缺少密码 → 422 password REQUIRED', async () => {
    await makeUser(ctx.db, 'alice', '爱丽丝')

    const res = await ctx.asUser(null).post('/auth/login').send({ account: 'alice' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'password', code: 'REQUIRED' })
  })

  it('账号纯空白 → 422 account REQUIRED', async () => {
    const res = await ctx
      .asUser(null)
      .post('/auth/login')
      .send({ account: '   ', password: TEST_PASSWORD })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'account', code: 'REQUIRED' })
  })
})

describe('端点 2：GET /auth/me', () => {
  it('无令牌 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser(null).get('/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('令牌被篡改 → 401', async () => {
    const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')
    const res = await ctx.asUser(`${ctx.loginAs(aliceId)}x`).get('/auth/me')
    expect(res.status).toBe(401)
  })

  it('有效令牌 → 返回当前用户', async () => {
    const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')
    const res = await ctx.asUser(ctx.loginAs(aliceId)).get('/auth/me')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: aliceId, account: 'alice', displayName: '爱丽丝' })
  })
})

