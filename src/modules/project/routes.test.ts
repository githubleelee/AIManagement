import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { closeTestApp, getApp, getPrisma, resetDatabase } from '../../../test/helpers'
import { makeUser } from '../../../test/factories'

// T1.1：端点 3 POST /projects
// 正例：创建成功 + 创建者自动成为 PM
// 反例：空名 / 纯空白 / 超长名 / 未登录

describe('T1.1 端点 3：POST /projects', () => {
  beforeEach(async () => {
    await getApp()
    await resetDatabase()
  })

  afterAll(async () => {
    await closeTestApp()
  })

  it('创建项目，创建者自动成为该项目 PM', async () => {
    const app = await getApp()
    const me = await makeUser('pm-1', '王项目经理')

    const res = await request(app.server)
      .post('/projects')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '爱管理', description: '课程项目' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: '爱管理',
      description: '课程项目',
      ownerUserId: me.id,
    })
    expect(typeof res.body.id).toBe('string')
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt)

    const prisma = await getPrisma()
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: res.body.id, userId: me.id } },
    })
    expect(membership?.role).toBe('PM')
  })

  it('描述可省略，落库为 null', async () => {
    const app = await getApp()
    const me = await makeUser('pm-2', '李经理')

    const res = await request(app.server)
      .post('/projects')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '只有名称' })

    expect(res.status).toBe(201)
    expect(res.body.description).toBeNull()
  })

  it('名称首尾空白被裁剪后保存', async () => {
    const app = await getApp()
    const me = await makeUser('pm-3', '赵经理')

    const res = await request(app.server)
      .post('/projects')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '  带空白  ' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('带空白')
  })

  it('名称为空 → 422 VALIDATION_FAILED / name REQUIRED', async () => {
    const app = await getApp()
    const me = await makeUser('pm-4', '空名经理')

    const res = await request(app.server)
      .post('/projects')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('名称纯空白 → 422 name REQUIRED', async () => {
    const app = await getApp()
    const me = await makeUser('pm-5', '空白经理')

    const res = await request(app.server)
      .post('/projects')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: '     ' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('名称超过 50 字 → 422 name TOO_LONG', async () => {
    const app = await getApp()
    const me = await makeUser('pm-6', '超长经理')

    const res = await request(app.server)
      .post('/projects')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ name: 'x'.repeat(51) })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'TOO_LONG' })
  })

  it('缺少名称字段 → 422 name REQUIRED', async () => {
    const app = await getApp()
    const me = await makeUser('pm-7', '缺名经理')

    const res = await request(app.server)
      .post('/projects')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ description: '没有名字' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const app = await getApp()

    const res = await request(app.server).post('/projects').send({ name: '匿名项目' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})
