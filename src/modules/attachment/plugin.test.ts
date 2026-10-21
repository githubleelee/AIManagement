import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import type { AttachmentAccessOperation, AttachmentStoragePort } from './contracts.js'
import { InMemoryAttachmentRepository } from './in-memory-repository.js'
import { registerAttachmentRoutes } from './plugin.js'
import { AttachmentService } from './service.js'

class MemoryStorage implements AttachmentStoragePort {
  readonly files = new Map<string, Buffer>()
  async write(key: string, content: Buffer) { this.files.set(key, Buffer.from(content)) }
  async read(key: string) {
    const content = this.files.get(key)
    if (!content) throw new Error('missing')
    return Buffer.from(content)
  }
  async delete(key: string) { this.files.delete(key) }
}

let ctx: HttpTestContext
let memberId: string
let viewerId: string
let outsiderId: string
let sequence = 0

beforeAll(async () => {
  ctx = await createHttpTestContext()
  const service = new AttachmentService({
    repository: new InMemoryAttachmentRepository(),
    storage: new MemoryStorage(),
    authorization: {
      async decide(actorUserId: string, _taskId: string, operation: AttachmentAccessOperation) {
        if (actorUserId === outsiderId) {
          return { allow: false as const, status: 404 as const, code: 'NOT_FOUND' as const }
        }
        if (actorUserId === viewerId && operation === 'WRITE') {
          return { allow: false as const, status: 403 as const, code: 'FORBIDDEN' as const }
        }
        return { allow: true as const, projectId: 'project-http' }
      },
    },
    now: () => new Date('2026-10-21T08:00:00.000Z'),
    createId: () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  })
  registerAttachmentRoutes(ctx.app, service)
  await ctx.app.ready()
})

afterAll(async () => ctx.dispose())

beforeEach(async () => {
  await ctx.reset()
  memberId = await makeUser(ctx.db, `attach-member-${sequence}`, '附件成员')
  viewerId = await makeUser(ctx.db, `attach-viewer-${sequence}`, '只读成员')
  outsiderId = await makeUser(ctx.db, `attach-outsider-${sequence}`, '外部用户')
})

async function upload(actorId = memberId, fileName = '报告.pdf', mimeType = 'application/pdf') {
  return ctx
    .asUser(ctx.loginAs(actorId))
    .post('/tasks/task-http/attachments')
    .set('Content-Type', mimeType)
    .set('X-File-Name', encodeURIComponent(fileName))
    .send(Buffer.from('%PDF-http'))
}

describe('ATTACH #36 HTTP 插件', () => {
  it('未登录上传返回 401', async () => {
    const response = await ctx
      .asUser(null)
      .post('/tasks/task-http/attachments')
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'a.pdf')
      .send(Buffer.from('x'))
    expect(response.status).toBe(401)
  })

  it('上传、列表、下载、删除形成闭环', async () => {
    const created = await upload()
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ originalName: '报告.pdf', sizeBytes: 9 })

    const list = await ctx
      .asUser(ctx.loginAs(memberId))
      .get('/tasks/task-http/attachments')
    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({ total: 1 })

    const downloaded = await ctx
      .asUser(ctx.loginAs(viewerId))
      .get(`/attachments/${created.body.id}/download`)
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers['content-type']).toContain('application/pdf')
    expect(Buffer.from(downloaded.body).toString()).toBe('%PDF-http')

    const deleted = await ctx
      .asUser(ctx.loginAs(memberId))
      .delete(`/attachments/${created.body.id}`)
    expect(deleted.status).toBe(204)
  })

  it('VIEWER 可列表但上传和删除为 403', async () => {
    const created = await upload()
    const list = await ctx
      .asUser(ctx.loginAs(viewerId))
      .get('/tasks/task-http/attachments')
    expect(list.status).toBe(200)
    expect((await upload(viewerId)).status).toBe(403)
    const deleted = await ctx
      .asUser(ctx.loginAs(viewerId))
      .delete(`/attachments/${created.body.id}`)
    expect(deleted.status).toBe(403)
  })

  it('outsider 列表返回不泄漏的 404', async () => {
    const response = await ctx
      .asUser(ctx.loginAs(outsiderId))
      .get('/tasks/task-http/attachments')
    expect(response.status).toBe(404)
  })

  it('扩展名与 MIME 不匹配返回字段级 422', async () => {
    const response = await upload(memberId, 'fake.pdf', 'image/png')
    expect(response.status).toBe(422)
    expect(response.body.error.details).toEqual([{ field: 'mimeType', code: 'INVALID_VALUE' }])
  })
})
