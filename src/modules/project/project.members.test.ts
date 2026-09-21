/**
 * US-01 / T1.3–T1.6：成员增删改查（端点 6/7/8/9）
 *
 * 覆盖：加成员与重复拦截、成员列表、改角色（LAST_PM）、移除成员（SELF_REMOVAL）。
 * 越权与不存在统一经 can() → 404 / 403。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
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

async function createProjectAs(token: string, name = '项目'): Promise<string> {
  const res = await ctx.asUser(token).post('/projects').send({ name })
  expect(res.status).toBe(201)
  return res.body.id as string
}

async function addMember(
  pmToken: string,
  projectId: string,
  account: string,
  role: string,
): Promise<string> {
  const res = await ctx
    .asUser(pmToken)
    .post(`/projects/${projectId}/members`)
    .send({ account, role })
  expect(res.status).toBe(201)
  return res.body.userId as string
}

describe('T1.3 端点 6：POST /projects/:projectId/members', () => {
  it('PM 添加已有用户为成员，返回 ProjectMemberView', async () => {
    const pmId = await makeUser(ctx.db, 'pm-1', '项目经理')
    const devId = await makeUser(ctx.db, 'dev-1', '开发者')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'dev-1', role: 'MEMBER' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      userId: devId,
      role: 'MEMBER',
      user: { id: devId, account: 'dev-1', displayName: '开发者' },
    })
    expect(new Date(res.body.joinedAt).toISOString()).toBe(res.body.joinedAt)

    const persisted = await ctx.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: devId } },
    })
    expect(persisted?.role).toBe('MEMBER')
  })

  it('可以指定 VIEWER 角色', async () => {
    const pmId = await makeUser(ctx.db, 'pm-2', '项目经理')
    await makeUser(ctx.db, 'viewer-1', '管理者')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'viewer-1', role: 'VIEWER' })

    expect(res.status).toBe(201)
    expect(res.body.role).toBe('VIEWER')
  })

  it('重复添加 → 409 CONFLICT / account DUPLICATE', async () => {
    const pmId = await makeUser(ctx.db, 'pm-3', '项目经理')
    await makeUser(ctx.db, 'dup-1', '重复用户')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)
    await addMember(token, projectId, 'dup-1', 'MEMBER')

    const res = await ctx
      .asUser(token)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'dup-1', role: 'MEMBER' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toContainEqual({ field: 'account', code: 'DUPLICATE' })
  })

  it('账号对应不存在 → 422 / account USER_NOT_FOUND', async () => {
    const pmId = await makeUser(ctx.db, 'pm-4', '项目经理')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'nobody', role: 'MEMBER' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({ field: 'account', code: 'USER_NOT_FOUND' })
  })

  it('缺少账号 → 422 account REQUIRED', async () => {
    const pmId = await makeUser(ctx.db, 'pm-5', '项目经理')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .post(`/projects/${projectId}/members`)
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'account', code: 'REQUIRED' })
  })

  it('角色取值非法 → 422 role INVALID_VALUE', async () => {
    const pmId = await makeUser(ctx.db, 'pm-6', '项目经理')
    await makeUser(ctx.db, 'any-1', '某人')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .post(`/projects/${projectId}/members`)
      .send({ account: 'any-1', role: 'OWNER' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'role', code: 'INVALID_VALUE' })
  })

  it('MEMBER 调用 → 403 FORBIDDEN', async () => {
    const pmId = await makeUser(ctx.db, 'pm-7', '项目经理')
    const memberId = await makeUser(ctx.db, 'member-7', '普通成员')
    const pmToken = ctx.loginAs(pmId)
    const projectId = await createProjectAs(pmToken)
    await addMember(pmToken, projectId, 'member-7', 'MEMBER')

    const res = await ctx
      .asUser(ctx.loginAs(memberId))
      .post(`/projects/${projectId}/members`)
      .send({ account: 'pm-7', role: 'MEMBER' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('非项目成员调用 → 404 NOT_FOUND，且不泄漏项目信息', async () => {
    const pmId = await makeUser(ctx.db, 'pm-8', '项目经理')
    const outsiderId = await makeUser(ctx.db, 'outsider-8', '局外人')
    const projectId = await createProjectAs(ctx.loginAs(pmId), '机密项目')

    const res = await ctx
      .asUser(ctx.loginAs(outsiderId))
      .post(`/projects/${projectId}/members`)
      .send({ account: 'pm-8', role: 'MEMBER' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('机密项目')
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx
      .asUser(null)
      .post('/projects/whatever/members')
      .send({ account: 'x', role: 'MEMBER' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('T1.4 端点 7：GET /projects/:projectId/members', () => {
  it('返回成员列表，含创建者与新增成员，字段齐全且按 joinedAt 升序', async () => {
    const pmId = await makeUser(ctx.db, 'pm-1', '项目经理')
    await makeUser(ctx.db, 'dev-1', '开发者')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)
    await addMember(token, projectId, 'dev-1', 'MEMBER')

    const res = await ctx.asUser(token).get(`/projects/${projectId}/members`)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    const accounts = res.body.items.map((i: { user: { account: string } }) => i.user.account)
    expect(accounts).toContain('pm-1')
    expect(accounts).toContain('dev-1')

    const joinedAt = res.body.items.map((i: { joinedAt: string }) => Date.parse(i.joinedAt))
    expect(joinedAt).toEqual([...joinedAt].sort((a: number, b: number) => a - b))

    const pmRow = res.body.items.find(
      (i: { user: { account: string } }) => i.user.account === 'pm-1',
    )
    expect(pmRow).toMatchObject({ role: 'PM', user: { displayName: '项目经理' } })
  })

  it('普通 MEMBER 也能读取成员列表（project.read）', async () => {
    const pmId = await makeUser(ctx.db, 'pm-2', '项目经理')
    const memberId = await makeUser(ctx.db, 'member-2', '普通成员')
    const pmToken = ctx.loginAs(pmId)
    const projectId = await createProjectAs(pmToken)
    await addMember(pmToken, projectId, 'member-2', 'MEMBER')

    const res = await ctx.asUser(ctx.loginAs(memberId)).get(`/projects/${projectId}/members`)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
  })

  it('非项目成员 → 404 NOT_FOUND', async () => {
    const pmId = await makeUser(ctx.db, 'pm-3', '项目经理')
    const outsiderId = await makeUser(ctx.db, 'outsider-3', '局外人')
    const projectId = await createProjectAs(ctx.loginAs(pmId))

    const res = await ctx.asUser(ctx.loginAs(outsiderId)).get(`/projects/${projectId}/members`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser(null).get('/projects/whatever/members')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('T1.5 端点 8：PATCH /projects/:projectId/members/:userId', () => {
  it('PM 修改成员角色 MEMBER → VIEWER，返回更新后的成员', async () => {
    const pmId = await makeUser(ctx.db, 'pm-1', '项目经理')
    const devId = await makeUser(ctx.db, 'dev-1', '开发者')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)
    await addMember(token, projectId, 'dev-1', 'MEMBER')

    const res = await ctx
      .asUser(token)
      .patch(`/projects/${projectId}/members/${devId}`)
      .send({ role: 'VIEWER' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ userId: devId, role: 'VIEWER', user: { account: 'dev-1' } })
  })

  it('可以把成员提升为 PM', async () => {
    const pmId = await makeUser(ctx.db, 'pm-2', '项目经理')
    const devId = await makeUser(ctx.db, 'dev-2', '开发者')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)
    await addMember(token, projectId, 'dev-2', 'MEMBER')

    const res = await ctx
      .asUser(token)
      .patch(`/projects/${projectId}/members/${devId}`)
      .send({ role: 'PM' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('PM')
  })

  it('把最后一个 PM 降级 → 422 / userId LAST_PM', async () => {
    const pmId = await makeUser(ctx.db, 'pm-3', '项目经理')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .patch(`/projects/${projectId}/members/${pmId}`)
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({ field: 'userId', code: 'LAST_PM' })
  })

  it('项目存在第二个 PM 时，降级其中一个成功', async () => {
    const pmId = await makeUser(ctx.db, 'pm-4', '项目经理')
    await makeUser(ctx.db, 'dev-4', '开发者')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)
    await addMember(token, projectId, 'dev-4', 'PM')

    const res = await ctx
      .asUser(token)
      .patch(`/projects/${projectId}/members/${pmId}`)
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('MEMBER')
  })

  it('目标 userId 不是本项目成员 → 404 NOT_FOUND', async () => {
    const pmId = await makeUser(ctx.db, 'pm-5', '项目经理')
    const outsiderId = await makeUser(ctx.db, 'outsider-5', '局外人')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .patch(`/projects/${projectId}/members/${outsiderId}`)
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('角色取值非法 → 422 role INVALID_VALUE', async () => {
    const pmId = await makeUser(ctx.db, 'pm-6', '项目经理')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx
      .asUser(token)
      .patch(`/projects/${projectId}/members/${pmId}`)
      .send({ role: 'OWNER' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'role', code: 'INVALID_VALUE' })
  })

  it('MEMBER 调用 → 403 FORBIDDEN', async () => {
    const pmId = await makeUser(ctx.db, 'pm-7', '项目经理')
    const memberId = await makeUser(ctx.db, 'member-7', '普通成员')
    const pmToken = ctx.loginAs(pmId)
    const projectId = await createProjectAs(pmToken)
    await addMember(pmToken, projectId, 'member-7', 'MEMBER')

    const res = await ctx
      .asUser(ctx.loginAs(memberId))
      .patch(`/projects/${projectId}/members/${pmId}`)
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('非项目成员调用 → 404 NOT_FOUND', async () => {
    const pmId = await makeUser(ctx.db, 'pm-8', '项目经理')
    const outsiderId = await makeUser(ctx.db, 'outsider-8', '局外人')
    const projectId = await createProjectAs(ctx.loginAs(pmId))

    const res = await ctx
      .asUser(ctx.loginAs(outsiderId))
      .patch(`/projects/${projectId}/members/${pmId}`)
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx
      .asUser(null)
      .patch('/projects/whatever/members/someone')
      .send({ role: 'MEMBER' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('T1.6 端点 9：DELETE /projects/:projectId/members/:userId', () => {
  it('PM 移除成员 → 204，且被移除者立即失去访问权', async () => {
    const pmId = await makeUser(ctx.db, 'pm-1', '项目经理')
    const devId = await makeUser(ctx.db, 'dev-1', '开发者')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)
    await addMember(token, projectId, 'dev-1', 'MEMBER')

    const del = await ctx.asUser(token).delete(`/projects/${projectId}/members/${devId}`)
    expect(del.status).toBe(204)

    const gone = await ctx.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: devId } },
    })
    expect(gone).toBeNull()

    // 移除即时生效：无需重新登录，下一次请求即被拒（决策 I-10）
    const devToken = ctx.loginAs(devId)
    expect((await ctx.asUser(devToken).get(`/projects/${projectId}`)).status).toBe(404)
    const list = await ctx.asUser(devToken).get('/projects')
    expect(list.body.items).toHaveLength(0)
  })

  it('移除自己 → 422 / userId SELF_REMOVAL_FORBIDDEN', async () => {
    const pmId = await makeUser(ctx.db, 'pm-2', '项目经理')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx.asUser(token).delete(`/projects/${projectId}/members/${pmId}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({
      field: 'userId',
      code: 'SELF_REMOVAL_FORBIDDEN',
    })
  })

  it('目标 userId 不是本项目成员 → 404 NOT_FOUND', async () => {
    const pmId = await makeUser(ctx.db, 'pm-3', '项目经理')
    const outsiderId = await makeUser(ctx.db, 'outsider-3', '局外人')
    const token = ctx.loginAs(pmId)
    const projectId = await createProjectAs(token)

    const res = await ctx.asUser(token).delete(`/projects/${projectId}/members/${outsiderId}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('MEMBER 调用 → 403 FORBIDDEN', async () => {
    const pmId = await makeUser(ctx.db, 'pm-4', '项目经理')
    const memberId = await makeUser(ctx.db, 'member-4', '普通成员')
    const pmToken = ctx.loginAs(pmId)
    const projectId = await createProjectAs(pmToken)
    await addMember(pmToken, projectId, 'member-4', 'MEMBER')

    const res = await ctx
      .asUser(ctx.loginAs(memberId))
      .delete(`/projects/${projectId}/members/${pmId}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('非项目成员调用 → 404 NOT_FOUND', async () => {
    const pmId = await makeUser(ctx.db, 'pm-5', '项目经理')
    const outsiderId = await makeUser(ctx.db, 'outsider-5', '局外人')
    const projectId = await createProjectAs(ctx.loginAs(pmId))

    const res = await ctx
      .asUser(ctx.loginAs(outsiderId))
      .delete(`/projects/${projectId}/members/${pmId}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser(null).delete('/projects/whatever/members/someone')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

