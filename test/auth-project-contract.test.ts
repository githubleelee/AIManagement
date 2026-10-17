/**
 * 任务 02 —— 认证、项目隔离与成员权限链路：契约层回归验收
 *
 * 依据：
 *   - `docs/tickets/sprint1-unification/02-auth-project-contract.md`
 *   - `docs/sprint1-spec-interface-contract.md` 决策 I-4 / I-5 / I-8（端点 1–9）
 *
 * seam = HTTP 接口层（契约「Testing Decisions」）。本文件只**补充**既有测试未覆盖的
 * 契约分支，不改动任何既有断言：
 *   ① 认证头形态（非 Bearer / 空 Bearer / 篡改）→ 401；
 *   ② 写权限矩阵：MEMBER 与 VIEWER 在端点 6/8/9 一律 403；
 *   ③ 端点 6 的 `role: REQUIRED` 与「直接以 PM 角色添加成员」；
 *   ④ MEMBER / VIEWER 对端点 4/5/7 的只读权限与 myRole；
 *   ⑤ 成员生命周期主链：建项目 → 加成员 → 改角色 → 移除 → 权限即时生效。
 *
 * 项目隔离（非成员在端点 5–9 一律 404 且不泄漏）已由
 * `src/modules/project/project.isolation.test.ts` 覆盖，本文件不重复。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, TEST_PASSWORD, type HttpTestContext } from './helpers.js'
import { makeMember, makeProject, makeUser } from './factories.js'

let ctx: HttpTestContext

beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

/** 经端点 1 真实登录换取令牌（不绕过认证链路）。 */
async function loginAsAccount(account: string): Promise<string> {
  const res = await ctx.asUser(null).post('/auth/login').send({ account, password: TEST_PASSWORD })
  expect(res.status).toBe(200)
  return res.body.token as string
}

describe('任务 02 / 认证链路（端点 1、2）', () => {
  it('真实登录换取令牌 → 令牌可读 /auth/me；非法 Authorization 头一律 401', async () => {
    const alice = await makeUser('alice', '爱丽丝')
    const token = await loginAsAccount('alice')

    const me = await ctx.asUser(token).get('/auth/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ id: alice.id, account: 'alice', displayName: '爱丽丝' })

    const wrongScheme = await ctx
      .asUser(null)
      .get('/auth/me')
      .set('Authorization', `Token ${token}`)
    const emptyBearer = await ctx.asUser(null).get('/auth/me').set('Authorization', 'Bearer ')
    const tampered = await ctx
      .asUser(null)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}x`)

    for (const res of [wrongScheme, emptyBearer, tampered]) {
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
    }
  })
})

describe('任务 02 / 成员管理写权限矩阵（端点 6、8、9）', () => {
  type WriteCall = {
    token: string
    method: 'post' | 'patch' | 'delete'
    url: string
    body?: Record<string, unknown>
  }

  it('MEMBER 与 VIEWER 调用写端点一律 403 FORBIDDEN', async () => {
    const pm = await makeUser('pm', '项目经理')
    const member = await makeUser('member', '普通成员')
    const viewer = await makeUser('viewer', '管理者')
    await makeUser('anyone', '待加入')
    const { projectId } = await makeProject(pm.id, '权限矩阵项目')
    await makeMember(projectId, member.id, 'MEMBER')
    await makeMember(projectId, viewer.id, 'VIEWER')

    const memberToken = ctx.loginAs(member.id)
    const viewerToken = ctx.loginAs(viewer.id)

    const calls: WriteCall[] = [
      {
        token: memberToken,
        method: 'post',
        url: `/projects/${projectId}/members`,
        body: { account: 'anyone', role: 'MEMBER' },
      },
      {
        token: viewerToken,
        method: 'post',
        url: `/projects/${projectId}/members`,
        body: { account: 'anyone', role: 'MEMBER' },
      },
      {
        token: memberToken,
        method: 'patch',
        url: `/projects/${projectId}/members/${member.id}`,
        body: { role: 'VIEWER' },
      },
      {
        token: viewerToken,
        method: 'patch',
        url: `/projects/${projectId}/members/${member.id}`,
        body: { role: 'VIEWER' },
      },
      { token: memberToken, method: 'delete', url: `/projects/${projectId}/members/${viewer.id}` },
      { token: viewerToken, method: 'delete', url: `/projects/${projectId}/members/${member.id}` },
    ]

    for (const call of calls) {
      const req = ctx.asUser(call.token)[call.method](call.url)
      const res = call.body ? await req.send(call.body) : await req
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }

    // 越权请求不得改变成员构成
    const members = await ctx.asUser(ctx.loginAs(pm.id)).get(`/projects/${projectId}/members`)
    expect(members.body.items).toHaveLength(3)
  })

  it('未登录调用写端点 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx
      .asUser(null)
      .post('/projects/whatever/members')
      .send({ account: 'x', role: 'MEMBER' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('任务 02 / 端点 6 字段校验与 PM 角色', () => {
  it('缺少 role → 422 role REQUIRED', async () => {
    const pm = await makeUser('pm', '项目经理')
    await makeUser('candidate', '候选成员')
    const { projectId } = await makeProject(pm.id, '校验项目')

    const res = await ctx
      .asUser(ctx.loginAs(pm.id))
      .post(`/projects/${projectId}/members`)
      .send({ account: 'candidate' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({ field: 'role', code: 'REQUIRED' })
  })

  it('允许直接以 PM 角色添加成员（角色枚举含 PM，不绕过 LAST_PM 语义）', async () => {
    const pm = await makeUser('pm', '项目经理')
    const second = await makeUser('pm2', '第二经理')
    const token = ctx.loginAs(pm.id)
    const { projectId } = await makeProject(pm.id, '双 PM 项目')

    const res = await ctx
      .asUser(token)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'pm2', role: 'PM' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ userId: second.id, role: 'PM' })

    const list = await ctx.asUser(token).get(`/projects/${projectId}/members`)
    expect(list.body.items.filter((m: { role: string }) => m.role === 'PM')).toHaveLength(2)
  })
})

describe('任务 02 / 项目读权限（端点 4、5、7）', () => {
  it('MEMBER 与 VIEWER 可读取项目、成员列表且 myRole 正确', async () => {
    const pm = await makeUser('pm', '项目经理')
    const member = await makeUser('member', '普通成员')
    const viewer = await makeUser('viewer', '管理者')
    const { projectId } = await makeProject(pm.id, '只读项目')
    await makeMember(projectId, member.id, 'MEMBER')
    await makeMember(projectId, viewer.id, 'VIEWER')

    const who: ReadonlyArray<readonly [string, 'MEMBER' | 'VIEWER']> = [
      [ctx.loginAs(member.id), 'MEMBER'],
      [ctx.loginAs(viewer.id), 'VIEWER'],
    ]

    for (const [token, role] of who) {
      const list = await ctx.asUser(token).get('/projects')
      expect(list.status).toBe(200)
      expect(list.body.items).toHaveLength(1)
      expect(list.body.items[0]).toMatchObject({ id: projectId, myRole: role })

      const detail = await ctx.asUser(token).get(`/projects/${projectId}`)
      expect(detail.status).toBe(200)
      expect(detail.body.myRole).toBe(role)

      const members = await ctx.asUser(token).get(`/projects/${projectId}/members`)
      expect(members.status).toBe(200)
      expect(members.body.items).toHaveLength(3)
    }
  })
})

describe('任务 02 / 成员生命周期主链（端点 1→3→6→8→9）', () => {
  it('建项目 → 加成员 → 改角色 → 移除 → 被移除者立即失去访问权', async () => {
    await makeUser('pm', '项目经理')
    await makeUser('dev', '开发者')
    const pmToken = await loginAsAccount('pm')

    // 端点 3：建项目，创建者自动成为 PM
    const created = await ctx.asUser(pmToken).post('/projects').send({ name: '生命周期项目' })
    expect(created.status).toBe(201)
    const projectId = created.body.id as string

    // 端点 6：加成员
    const added = await ctx
      .asUser(pmToken)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'dev', role: 'MEMBER' })
    expect(added.status).toBe(201)
    const devId = added.body.userId as string

    // 端点 8：改角色 MEMBER → VIEWER
    const changed = await ctx
      .asUser(pmToken)
      .patch(`/projects/${projectId}/members/${devId}`)
      .send({ role: 'VIEWER' })
    expect(changed.status).toBe(200)
    expect(changed.body.role).toBe('VIEWER')

    // VIEWER 仍可读、写被拒
    const devToken = await loginAsAccount('dev')
    expect((await ctx.asUser(devToken).get(`/projects/${projectId}`)).status).toBe(200)
    const forbidden = await ctx
      .asUser(devToken)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'pm', role: 'MEMBER' })
    expect(forbidden.status).toBe(403)

    // 端点 9：移除成员
    const removed = await ctx.asUser(pmToken).delete(`/projects/${projectId}/members/${devId}`)
    expect(removed.status).toBe(204)

    // 权限即时生效：无需重新登录（决策 I-10）
    expect((await ctx.asUser(devToken).get(`/projects/${projectId}`)).status).toBe(404)
    expect((await ctx.asUser(devToken).get('/projects')).body.items).toHaveLength(0)
  }, 30_000)
})
