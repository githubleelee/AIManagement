import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { closeTestApp, getApp, getPrisma, resetDatabase } from '../../../test/helpers'
import { makeUser } from '../../../test/factories'

// T1.3：端点 6 POST /projects/:projectId/members
// 正例：PM 添加已有用户为成员（含角色）
// 反例：重复添加 / 账号不存在 / 字段缺失 / 角色非法 / MEMBER 越权 / 非成员 / 未登录

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

async function createProjectAs(token: string, name = '项目'): Promise<string> {
  const app = await getApp()
  const res = await request(app.server).post('/projects').set(bearer(token)).send({ name })
  expect(res.status).toBe(201)
  return res.body.id as string
}

describe('T1.3 端点 6：POST /projects/:projectId/members', () => {
  it('PM 添加已有用户为成员，返回 ProjectMemberView', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-1', '项目经理')
    const target = await makeUser('dev-1', '开发者')
    const projectId = await createProjectAs(pm.token)

    const res = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'dev-1', role: 'MEMBER' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      userId: target.id,
      role: 'MEMBER',
      user: { id: target.id, account: 'dev-1', displayName: '开发者' },
    })
    expect(new Date(res.body.joinedAt).toISOString()).toBe(res.body.joinedAt)

    const prisma = await getPrisma()
    const persisted = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: target.id } },
    })
    expect(persisted?.role).toBe('MEMBER')
  })

  it('可以指定 VIEWER 角色', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-2', '项目经理')
    await makeUser('viewer-1', '管理者')
    const projectId = await createProjectAs(pm.token)

    const res = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'viewer-1', role: 'VIEWER' })

    expect(res.status).toBe(201)
    expect(res.body.role).toBe('VIEWER')
  })

  it('重复添加 → 409 CONFLICT / account DUPLICATE', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-3', '项目经理')
    await makeUser('dup-1', '重复用户')
    const projectId = await createProjectAs(pm.token)

    const first = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'dup-1', role: 'MEMBER' })
    expect(first.status).toBe(201)

    const second = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'dup-1', role: 'MEMBER' })

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('CONFLICT')
    expect(second.body.error.details).toContainEqual({ field: 'account', code: 'DUPLICATE' })
  })

  it('账号对应不存在 → 422 / account USER_NOT_FOUND', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-4', '项目经理')
    const projectId = await createProjectAs(pm.token)

    const res = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'nobody', role: 'MEMBER' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({ field: 'account', code: 'USER_NOT_FOUND' })
  })

  it('缺少账号 → 422 account REQUIRED', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-5', '项目经理')
    const projectId = await createProjectAs(pm.token)

    const res = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'account', code: 'REQUIRED' })
  })

  it('角色取值非法 → 422 role INVALID_VALUE', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-6', '项目经理')
    await makeUser('any-1', '某人')
    const projectId = await createProjectAs(pm.token)

    const res = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'any-1', role: 'OWNER' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'role', code: 'INVALID_VALUE' })
  })

  it('MEMBER 调用 → 403 FORBIDDEN', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-7', '项目经理')
    const member = await makeUser('member-7', '普通成员')
    const projectId = await createProjectAs(pm.token)
    await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'member-7', role: 'MEMBER' })

    const res = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(member.token))
      .send({ account: 'pm-7', role: 'MEMBER' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('非项目成员调用 → 404 NOT_FOUND，且不泄漏项目信息', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-8', '项目经理')
    const outsider = await makeUser('outsider-8', '局外人')
    const projectId = await createProjectAs(pm.token, '机密项目')

    const res = await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(outsider.token))
      .send({ account: 'pm-8', role: 'MEMBER' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('机密项目')
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const app = await getApp()
    const res = await request(app.server)
      .post('/projects/whatever/members')
      .send({ account: 'x', role: 'MEMBER' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

// T1.4：端点 7 GET /projects/:projectId/members
// 成员列表按 joinedAt 升序；成员可读，非成员 404。
describe('T1.4 端点 7：GET /projects/:projectId/members', () => {
  it('返回成员列表，含创建者与新增成员，字段齐全且按 joinedAt 升序', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-1', '项目经理')
    await makeUser('dev-1', '开发者')
    const projectId = await createProjectAs(pm.token)
    await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'dev-1', role: 'MEMBER' })

    const res = await request(app.server)
      .get(`/projects/${projectId}/members`)
      .set(bearer(pm.token))

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    const accounts = res.body.items.map((i: { user: { account: string } }) => i.user.account)
    expect(accounts).toContain('pm-1')
    expect(accounts).toContain('dev-1')

    const joinedAt = res.body.items.map((i: { joinedAt: string }) => Date.parse(i.joinedAt))
    expect(joinedAt).toEqual([...joinedAt].sort((a: number, b: number) => a - b))

    const pmRow = res.body.items.find((i: { user: { account: string } }) => i.user.account === 'pm-1')
    expect(pmRow).toMatchObject({ role: 'PM', user: { displayName: '项目经理' } })
  })

  it('普通 MEMBER 也能读取成员列表（project.read）', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-2', '项目经理')
    const member = await makeUser('member-2', '普通成员')
    const projectId = await createProjectAs(pm.token)
    await request(app.server)
      .post(`/projects/${projectId}/members`)
      .set(bearer(pm.token))
      .send({ account: 'member-2', role: 'MEMBER' })

    const res = await request(app.server)
      .get(`/projects/${projectId}/members`)
      .set(bearer(member.token))

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
  })

  it('非项目成员 → 404 NOT_FOUND', async () => {
    const app = await getApp()
    const pm = await makeUser('pm-3', '项目经理')
    const outsider = await makeUser('outsider-3', '局外人')
    const projectId = await createProjectAs(pm.token)

    const res = await request(app.server)
      .get(`/projects/${projectId}/members`)
      .set(bearer(outsider.token))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const app = await getApp()
    const res = await request(app.server).get('/projects/whatever/members')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})
