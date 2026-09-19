import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { closeTestApp, getApp, getPrisma, resetDatabase } from '../../../test/helpers'
import { makeUser } from '../../../test/factories'
import type { ProjectView } from '../../shared/types'

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

// 清理钩子放在文件级：一个文件只启动一次 app、结束时统一断连删库。
// 若放进各 describe，前一个 describe 的 afterAll 会在后一个 describe 之前删库。
beforeEach(async () => {
  await getApp()
  await resetDatabase()
})

afterAll(async () => {
  await closeTestApp()
})

// T1.1：端点 3 POST /projects —— 正例（自动 PM）+ 反例（空/空白/超长/未登录）
describe('T1.1 端点 3：POST /projects', () => {

  it('创建项目，创建者自动成为该项目 PM', async () => {
    const app = await getApp()
    const me = await makeUser('pm-1', '王项目经理')

    const res = await request(app.server)
      .post('/projects')
      .set(bearer(me.token))
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
      .set(bearer(me.token))
      .send({ name: '只有名称' })

    expect(res.status).toBe(201)
    expect(res.body.description).toBeNull()
  })

  it('名称首尾空白被裁剪后保存', async () => {
    const app = await getApp()
    const me = await makeUser('pm-3', '赵经理')

    const res = await request(app.server)
      .post('/projects')
      .set(bearer(me.token))
      .send({ name: '  带空白  ' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('带空白')
  })

  it('名称为空 → 422 VALIDATION_FAILED / name REQUIRED', async () => {
    const app = await getApp()
    const me = await makeUser('pm-4', '空名经理')

    const res = await request(app.server)
      .post('/projects')
      .set(bearer(me.token))
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
      .set(bearer(me.token))
      .send({ name: '     ' })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('名称超过 50 字 → 422 name TOO_LONG', async () => {
    const app = await getApp()
    const me = await makeUser('pm-6', '超长经理')

    const res = await request(app.server)
      .post('/projects')
      .set(bearer(me.token))
      .send({ name: 'x'.repeat(51) })

    expect(res.status).toBe(422)
    expect(res.body.error.details).toContainEqual({ field: 'name', code: 'TOO_LONG' })
  })

  it('缺少名称字段 → 422 name REQUIRED', async () => {
    const app = await getApp()
    const me = await makeUser('pm-7', '缺名经理')

    const res = await request(app.server)
      .post('/projects')
      .set(bearer(me.token))
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

// T1.2：端点 4 GET /projects、端点 5 GET /projects/:projectId
// 核心是项目隔离：只返回我参与的项目；非成员与非存在返回完全一致的 404。
describe('T1.2 端点 4/5：我的项目列表与项目详情', () => {

  async function createProject(token: string, name: string): Promise<string> {
    const app = await getApp()
    const res = await request(app.server).post('/projects').set(bearer(token)).send({ name })
    expect(res.status).toBe(201)
    return res.body.id as string
  }

  it('端点 4：只返回我参与的项目，且带 myRole', async () => {
    const app = await getApp()
    const alice = await makeUser('alice', '爱丽丝')
    const bob = await makeUser('bob', '鲍勃')
    await createProject(alice.token, 'A 的项目一')
    await createProject(alice.token, 'A 的项目二')
    const bobProjectId = await createProject(bob.token, 'B 的项目')

    const res = await request(app.server).get('/projects').set(bearer(alice.token))

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
    const app = await getApp()
    const alice = await makeUser('alice', '爱丽丝')
    const projectId = await createProject(alice.token, '可见项目')

    const res = await request(app.server).get(`/projects/${projectId}`).set(bearer(alice.token))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: projectId,
      name: '可见项目',
      myRole: 'PM',
      ownerUserId: alice.id,
    })
  })

  it('端点 5：非成员访问 → 404，响应体不含项目任何字段', async () => {
    const app = await getApp()
    const alice = await makeUser('alice', '爱丽丝')
    const bob = await makeUser('bob', '鲍勃')
    const projectId = await createProject(alice.token, '机密项目名')

    const res = await request(app.server).get(`/projects/${projectId}`).set(bearer(bob.token))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('机密项目名')
    expect(JSON.stringify(res.body)).not.toContain(projectId)
  })

  it('端点 5：项目不存在与无权限的响应完全一致', async () => {
    const app = await getApp()
    const alice = await makeUser('alice', '爱丽丝')
    const bob = await makeUser('bob', '鲍勃')
    const projectId = await createProject(alice.token, '某项目')

    const noPermission = await request(app.server)
      .get(`/projects/${projectId}`)
      .set(bearer(bob.token))
    const notExist = await request(app.server)
      .get('/projects/does-not-exist')
      .set(bearer(bob.token))

    expect(noPermission.status).toBe(404)
    expect(notExist.status).toBe(404)
    expect(noPermission.body).toEqual(notExist.body)
  })

  it('未登录访问端点 4/5 → 401', async () => {
    const app = await getApp()
    const list = await request(app.server).get('/projects')
    const detail = await request(app.server).get('/projects/whatever')
    expect(list.status).toBe(401)
    expect(detail.status).toBe(401)
  })
})
