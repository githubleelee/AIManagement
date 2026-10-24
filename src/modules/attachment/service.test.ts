import { describe, expect, it } from 'vitest'
import type {
  AttachmentAccessOperation,
  AttachmentRecord,
  AttachmentStoragePort,
} from './contracts.js'
import { ATTACHMENT_MIME_BY_EXTENSION, MAX_ATTACHMENT_BYTES } from './contracts.js'
import { InMemoryAttachmentRepository } from './in-memory-repository.js'
import { AttachmentService } from './service.js'

class MemoryStorage implements AttachmentStoragePort {
  readonly files = new Map<string, Buffer>()
  failDelete = false

  async write(key: string, content: Buffer): Promise<void> {
    if (this.files.has(key)) throw new Error('duplicate storage key')
    this.files.set(key, Buffer.from(content))
  }

  async read(key: string): Promise<Buffer> {
    const content = this.files.get(key)
    if (!content) throw new Error('missing file')
    return Buffer.from(content)
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error('disk unavailable')
    this.files.delete(key)
  }
}

function createHarness() {
  const repository = new InMemoryAttachmentRepository()
  const storage = new MemoryStorage()
  let sequence = 0
  const service = new AttachmentService({
    repository,
    storage,
    authorization: {
      async decide(actorUserId: string, _taskId: string, operation: AttachmentAccessOperation) {
        if (actorUserId === 'outsider' || actorUserId === 'hidden-member') {
          return { allow: false as const, status: 404 as const, code: 'NOT_FOUND' as const }
        }
        if ((actorUserId === 'viewer' || actorUserId === 'other-member') && operation === 'WRITE') {
          return { allow: false as const, status: 403 as const, code: 'FORBIDDEN' as const }
        }
        return { allow: true as const, projectId: 'project-1' }
      },
    },
    now: () => new Date('2026-10-21T08:00:00.000Z'),
    createId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  })
  return { repository, service, storage }
}

async function uploadPdf(h: ReturnType<typeof createHarness>, actorUserId = 'member') {
  return h.service.upload({
    actorUserId,
    taskId: 'task-1',
    originalName: '验收材料.pdf',
    mimeType: 'application/pdf',
    content: Buffer.from('%PDF-test'),
  })
}

describe('ATTACH #36 白名单、大小与元数据', () => {
  for (const [extension, mimeType] of Object.entries(ATTACHMENT_MIME_BY_EXTENSION)) {
    it(`允许 .${extension} + ${mimeType}`, async () => {
      const h = createHarness()
      const result = await h.service.upload({
        actorUserId: 'member',
        taskId: 'task-1',
        originalName: `文件.${extension}`,
        mimeType,
        content: Buffer.from('safe-demo'),
      })
      expect(result).toMatchObject({
        taskId: 'task-1',
        projectId: 'project-1',
        extension,
        mimeType,
        sizeBytes: 9,
        uploaderUserId: 'member',
        state: 'ACTIVE',
      })
      expect(result).not.toHaveProperty('storageKey')
    })
  }

  it('严格 SI 10,000,000 B 可以上传', async () => {
    const h = createHarness()
    const result = await h.service.upload({
      actorUserId: 'member',
      taskId: 'task-1',
      originalName: 'limit.zip',
      mimeType: 'application/zip',
      content: Buffer.alloc(MAX_ATTACHMENT_BYTES),
    })
    expect(result.sizeBytes).toBe(10_000_000)
  })

  it('10,000,001 B 被拒绝且不写文件和元数据', async () => {
    const h = createHarness()
    await expect(
      h.service.upload({
        actorUserId: 'member',
        taskId: 'task-1',
        originalName: 'too-large.zip',
        mimeType: 'application/zip',
        content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
      }),
    ).rejects.toMatchObject({ status: 422, details: [{ code: 'TOO_LONG' }] })
    expect(h.storage.files.size).toBe(0)
    expect(await h.repository.listAllByTask('task-1')).toEqual([])
  })

  it('扩展名不在白名单中时拒绝', async () => {
    const h = createHarness()
    await expect(
      h.service.upload({
        actorUserId: 'member',
        taskId: 'task-1',
        originalName: 'run.svg',
        mimeType: 'image/svg+xml',
        content: Buffer.from('<svg/>'),
      }),
    ).rejects.toMatchObject({ status: 422, details: [{ code: 'INVALID_VALUE' }] })
  })

  it('扩展名与 MIME 不匹配时拒绝', async () => {
    const h = createHarness()
    await expect(
      h.service.upload({
        actorUserId: 'member',
        taskId: 'task-1',
        originalName: 'fake.pdf',
        mimeType: 'image/png',
        content: Buffer.from('not-pdf'),
      }),
    ).rejects.toMatchObject({ status: 422, details: [{ code: 'INVALID_VALUE' }] })
  })

  it('拒绝目录分隔符，原文件名不能控制实体路径', async () => {
    const h = createHarness()
    await expect(
      h.service.upload({
        actorUserId: 'member',
        taskId: 'task-1',
        originalName: '../escape.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('ATTACH #36 权限、列表、下载与删除', () => {
  it('任务负责人可写，VIEWER/其他成员只读，outsider 与敏感未授权成员 404', async () => {
    const h = createHarness()
    const item = await uploadPdf(h, 'member')
    expect((await h.service.list('viewer', 'task-1')).total).toBe(1)
    expect((await h.service.download('viewer', item.id)).content.toString()).toBe('%PDF-test')
    await expect(uploadPdf(h, 'viewer')).rejects.toMatchObject({ status: 403, kind: 'FORBIDDEN' })
    await expect(h.service.delete('viewer', item.id)).rejects.toMatchObject({ status: 403 })
    await expect(uploadPdf(h, 'other-member')).rejects.toMatchObject({ status: 403 })
    await expect(h.service.delete('other-member', item.id)).rejects.toMatchObject({ status: 403 })
    await expect(h.service.list('outsider', 'task-1')).rejects.toMatchObject({ status: 404 })
    await expect(h.service.list('hidden-member', 'task-1')).rejects.toMatchObject({ status: 404 })
  })

  it('列表只返回指定任务的 ACTIVE 记录并返回真实计数', async () => {
    const h = createHarness()
    await uploadPdf(h)
    await h.service.upload({
      actorUserId: 'member',
      taskId: 'task-2',
      originalName: 'other.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('other'),
    })
    const result = await h.service.list('member', 'task-1')
    expect(result.total).toBe(1)
    expect(result.items.map((row) => row.taskId)).toEqual(['task-1'])
  })

  it('删除先登记 DELETING，再删除实体和元数据', async () => {
    const h = createHarness()
    const item = await uploadPdf(h)
    expect(h.storage.files.size).toBe(1)
    await h.service.delete('member', item.id)
    expect(h.storage.files.size).toBe(0)
    expect(await h.repository.findById(item.id)).toBeNull()
  })

  it('实体清理失败时保留可追踪 CLEANUP_FAILED 记录', async () => {
    const h = createHarness()
    const item = await uploadPdf(h)
    h.storage.failDelete = true
    await expect(h.service.delete('member', item.id)).rejects.toMatchObject({
      status: 409,
      kind: 'CONFLICT',
    })
    expect(await h.repository.findById(item.id)).toMatchObject({
      state: 'CLEANUP_FAILED',
      cleanupAttempts: 1,
      cleanupError: 'FILE_DELETE_FAILED',
    })
  })
})

describe('ATTACH #36 单附件删除的失败恢复', () => {
  it('单附件清理失败保留重试记录', async () => {
    const h = createHarness()
    const item = await uploadPdf(h)
    h.storage.failDelete = true
    await expect(h.service.delete('member', item.id)).rejects.toMatchObject({ status: 409 })
    expect(await h.repository.findById(item.id)).toMatchObject({ state: 'CLEANUP_FAILED' })
    h.storage.failDelete = false
    await expect(h.service.retryCleanup(item.id)).resolves.toBe(true)
    expect(await h.repository.findById(item.id)).toBeNull()
  })

  it('不可见与不存在的下载/删除返回完全一致的404错误', async () => {
    const h = createHarness()
    const item = await uploadPdf(h)
    for (const operation of ['download', 'delete'] as const) {
      const hidden = await h.service[operation]('hidden-member', item.id).catch(error => error)
      const missing = await h.service[operation]('hidden-member', 'missing').catch(error => error)
      expect([hidden.status, hidden.kind, hidden.message, hidden.details])
        .toEqual([missing.status, missing.kind, missing.message, missing.details])
    }
  })

  it('完整列表250条不截断或虚报总数', async () => {
    const h = createHarness()
    for (let i = 0; i < 250; i++) await uploadPdf(h)
    const result = await h.service.list('member', 'task-1')
    expect(result.total).toBe(250)
    expect(result.items).toHaveLength(250)
  })

  it('记录中的存储细节不暴露给 API 视图', async () => {
    const h = createHarness()
    const item = await uploadPdf(h)
    const stored = (await h.repository.findById(item.id)) as AttachmentRecord
    expect(stored.storageKey).toMatch(/\.pdf$/)
    expect(item).not.toHaveProperty('storageKey')
    expect(item).not.toHaveProperty('cleanupError')
  })
})
