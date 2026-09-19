/**
 * US-01 / T1.1–T1.2：创建项目、我的项目列表与项目详情（端点 3/4/5）
 *
 * seam = HTTP 接口层：工厂自建数据 → 打接口 → 断言状态码与响应体。
 * 正例证明主路径可用，反例证明字段校验与项目隔离真的生效。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import type { ProjectView } from '../../shared/types.js'
import { PROJECT_NAME_MAX_LENGTH } from './schemas.js'

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

describe('T1.1 端点 3：POST /projects', () => {
  it('创建项目，创建者自动成为该项目 PM', async () => {
    const pmId = await makeUser(ctx.db, 'pm-1', '王项目经理')

    const res = await ctx
      .asUser(ctx.loginAs(pmId))
      .post('/projects')
      .send({ name: '爱管理', description: '课程项目' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: '爱管理',
      description: '课程项目',
      ownerUserId: pmId,
    })
    expect(typeof res.body.id).toBe('string')
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt)

    const membership = await ctx.db.projectMember.findUnique({
      where: { projectId_userId: { projectId: res.body.id, userId: pmId } },
    })
    expect(membership?.role).toBe('PM')
  })

  it('描述可省略，落库为 null', async () => {
    const pmId = await makeUser(ctx.db, 'pm-2', '李经理')

    const res = await ctx.asUser(ctx.loginAs(pmId)).post('/projects').send({ name: '只有名称' })

    expect(res.status).toBe(201)
    expect(res.body.description).toBeNull()
  })

  it('名称首尾空白被裁剪后保存', async () => {
    const pmId = await makeUser(ctx.db, 'pm-3', '赵经理')

    const res = await ctx.asUser(ctx.loginAs(pmId)).post('/projects').send({ name: '  带空白  ' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('带空白')
  })

  it('名称为空 → 422 name REQUIRED', async () => {
    const pmId = await makeUser(ctx.db, 'pm-4', '空名经理')

    const res = await ctx.asUser(ctx.loginAs(pmId)).post('/projects').send({ name: '' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('名称纯空白 → 422 name REQUIRED', async () => {
    const pmId = await makeUser(ctx.db, 'pm-5', '空白经理')

    const res = await ctx.asUser(ctx.loginAs(pmId)).post('/projects').send({ name: '     ' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('名称超过 50 字 → 422 name TOO_LONG', async () => {
    const pmId = await makeUser(ctx.db, 'pm-6', '超长经理')

    const res = await ctx
      .asUser(ctx.loginAs(pmId))
      .post('/projects')
      .send({ name: 'x'.repeat(PROJECT_NAME_MAX_LENGTH + 1) })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'TOO_LONG' })
  })

  it('缺少名称字段 → 422 name REQUIRED', async () => {
    const pmId = await makeUser(ctx.db, 'pm-7', '缺名经理')

    const res = await ctx
      .asUser(ctx.loginAs(pmId))
      .post('/projects')
      .send({ description: '没有名字' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser(null).post('/projects').send({ name: '匿名项目' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('T1.2 端点 4/5：我的项目列表与项目详情', () => {
  it('端点 4：只返回我参与的项目，且带 myRole', async () => {
    const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')
    const bobId = await makeUser(ctx.db, 'bob', '鲍勃')
    await makeProject(ctx.db, aliceId, 'A 的项目一')
    await makeProject(ctx.db, aliceId, 'A 的项目二')
    const bobProjectId = await makeProject(ctx.db, bobId, 'B 的项目')

    const res = await ctx.asUser(ctx.loginAs(aliceId)).get('/projects')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    expect(res.body.items.map((i: ProjectView) => i.name).sort()).toEqual([
      'A 的项目一',
      'A 的项目二',
    ])
    expect(res.body.items.every((i: ProjectView) => i.myRole === 'PM')).toBe(true)
    expect(res.body.items.map((i: ProjectView) => i.id)).not.toContain(bobProjectId)
  })

  it('端点 5：成员可见，返回项目与 myRole', async () => {
    const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')
    const projectId = await makeProject(ctx.db, aliceId, '可见项目')

    const res = await ctx.asUser(ctx.loginAs(aliceId)).get(`/projects/${projectId}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: projectId,
      name: '可见项目',
      myRole: 'PM',
      ownerUserId: aliceId,
    })
  })

  it('端点 5：非成员访问 → 404，响应体不含项目任何字段', async () => {
    const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')
    const bobId = await makeUser(ctx.db, 'bob', '鲍勃')
    const projectId = await makeProject(ctx.db, aliceId, '机密项目名')

    const res = await ctx.asUser(ctx.loginAs(bobId)).get(`/projects/${projectId}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('机密项目名')
    expect(JSON.stringify(res.body)).not.toContain(projectId)
  })

  it('端点 5：项目不存在与无权限的响应完全一致', async () => {
    const aliceId = await makeUser(ctx.db, 'alice', '爱丽丝')
    const bobId = await makeUser(ctx.db, 'bob', '鲍勃')
    const projectId = await makeProject(ctx.db, aliceId, '某项目')
    const bob = ctx.loginAs(bobId)

    const noPermission = await ctx.asUser(bob).get(`/projects/${projectId}`)
    const notExist = await ctx.asUser(bob).get('/projects/does-not-exist')

    expect(noPermission.status).toBe(404)
    expect(notExist.status).toBe(404)
    expect(noPermission.body).toEqual(notExist.body)
  })

  it('未登录访问端点 4/5 → 401', async () => {
    const list = await ctx.asUser(null).get('/projects')
    const detail = await ctx.asUser(null).get('/projects/whatever')
    expect(list.status).toBe(401)
    expect(detail.status).toBe(401)
  })
})
