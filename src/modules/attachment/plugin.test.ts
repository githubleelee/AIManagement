import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../../error-handler.js'
import type { AttachmentStoragePort } from './contracts.js'
import { MAX_ATTACHMENT_BYTES } from './contracts.js'
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

let app: FastifyInstance
let sequence = 0
beforeEach(async () => {
  // Isolated plugin seam: no buildApp, production route or real upload directory.
  app = Fastify({ logger: false })
  registerErrorHandler(app)
  app.decorateRequest('actorUserId', undefined)
  app.addHook('onRequest', async request => {
    const actor = request.headers['x-test-actor']
    request.actorUserId = typeof actor === 'string' ? actor : undefined
  })
  const service = new AttachmentService({
    repository: new InMemoryAttachmentRepository(), storage: new MemoryStorage(),
    authorization: {
      async decide(actor, taskId, operation) {
        if (actor === 'outsider' || taskId === 'hidden-task') {
          return { allow: false, status: 404, code: 'NOT_FOUND' }
        }
        if (operation === 'WRITE' && actor !== 'owner' && actor !== 'pm') {
          return { allow: false, status: 403, code: 'FORBIDDEN' }
        }
        return { allow: true, projectId: 'project-http' }
      },
    },
    createId: () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  })
  registerAttachmentRoutes(app, service)
  await app.ready()
})
afterEach(async () => app.close())

function upload(actor = 'owner', mime = 'application/pdf', name = '报告.pdf', payload = Buffer.from('%PDF-http')) {
  return app.inject({ method: 'POST', url: '/tasks/task-http/attachments',
    headers: { 'x-test-actor': actor, 'content-type': mime, 'x-file-name': encodeURIComponent(name) }, payload })
}
function request(method: 'GET' | 'DELETE', url: string, actor = 'owner') {
  return app.inject({ method, url, headers: { 'x-test-actor': actor } })
}
describe('ATTACH isolated HTTP plugin', () => {
  it('unauthenticated upload remains 401', async () => {
    const response = await app.inject({ method: 'POST', url: '/tasks/task-http/attachments',
      headers: { 'content-type': 'application/pdf', 'x-file-name': 'a.pdf' }, payload: Buffer.from('x') })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('UNAUTHENTICATED')
  })
  it('upload/list/download/delete round trip, viewer read-only', async () => {
    const created = await upload()
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    expect((await request('GET', '/tasks/task-http/attachments', 'viewer')).json().total).toBe(1)
    const downloaded = await request('GET', `/attachments/${id}/download`, 'viewer')
    expect(downloaded.statusCode).toBe(200)
    expect(downloaded.body).toBe('%PDF-http')
    expect((await request('DELETE', `/attachments/${id}`)).statusCode).toBe(204)
  })
  it.each(['viewer', 'other-member'])('%s cannot upload or delete visible attachments', async actor => {
    const id = (await upload()).json().id
    expect((await upload(actor)).statusCode).toBe(403)
    expect((await request('DELETE', `/attachments/${id}`, actor)).statusCode).toBe(403)
    expect((await request('GET', `/attachments/${id}/download`, actor)).statusCode).toBe(200)
  })
  it('outsider and unknown attachment have byte-identical 404 envelopes', async () => {
    const id = (await upload()).json().id
    for (const method of ['GET', 'DELETE'] as const) {
      const suffix = method === 'GET' ? '/download' : ''
      const hidden = await request(method, `/attachments/${id}${suffix}`, 'outsider')
      const missing = await request(method, `/attachments/unknown${suffix}`, 'outsider')
      expect(hidden.statusCode).toBe(404)
      expect(hidden.body).toBe(missing.body)
    }
  })
  it.each(['image/svg+xml', 'application/x-executable', 'application/octet-stream'])(
    'unsupported MIME %s preserves framework 415', async mime => {
      const response = await upload('owner', mime)
      expect(response.statusCode).toBe(415)
    })
  it('extension/MIME mismatch returns 422', async () => {
    expect((await upload('owner', 'image/png')).statusCode).toBe(422)
  })
  it('oversize parser failure preserves framework 413', async () => {
    const response = await upload('owner', 'application/zip', 'a.zip', Buffer.alloc(MAX_ATTACHMENT_BYTES + 2))
    expect(response.statusCode).toBe(413)
  })
  it('parsed content one byte above the business limit remains 422', async () => {
    const response = await upload('owner', 'application/pdf', 'a.pdf', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('VALIDATION_FAILED')
  })
  it('the exact business size limit is accepted', async () => {
    const response = await upload('owner', 'application/pdf', 'a.pdf', Buffer.alloc(MAX_ATTACHMENT_BYTES))
    expect(response.statusCode).toBe(201)
    expect(response.json().sizeBytes).toBe(MAX_ATTACHMENT_BYTES)
  })
})
