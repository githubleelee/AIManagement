import { randomUUID } from 'node:crypto'
import {
  ATTACHMENT_MIME_BY_EXTENSION,
  MAX_ATTACHMENT_BYTES,
  type AttachmentAuthorizationPort,
  type AttachmentDownload,
  type AttachmentExtension,
  type AttachmentRecord,
  type AttachmentRepositoryPort,
  type AttachmentStoragePort,
  type AttachmentView,
  type UploadAttachmentInput,
} from './contracts.js'
import { AttachmentServiceError } from './errors.js'

export type AttachmentServiceDependencies = {
  repository: AttachmentRepositoryPort
  storage: AttachmentStoragePort
  authorization: AttachmentAuthorizationPort
  now?: () => Date
  createId?: () => string
}

function notFound(): AttachmentServiceError {
  return new AttachmentServiceError(404, 'NOT_FOUND', '附件不存在或不可见')
}

function safeCleanupReason(): string {
  return 'FILE_DELETE_FAILED'
}

function extensionOf(name: string): AttachmentExtension | null {
  const match = /\.([^.]+)$/.exec(name)
  const extension = match?.[1]?.toLowerCase()
  return extension && extension in ATTACHMENT_MIME_BY_EXTENSION
    ? (extension as AttachmentExtension)
    : null
}

function validateName(name: string): AttachmentExtension {
  if (
    name.length === 0 ||
    name.length > 255 ||
    name !== name.trim() ||
    /[\\/\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new AttachmentServiceError(422, 'VALIDATION_FAILED', '附件名称不合法', [
      { field: 'fileName', code: 'INVALID_VALUE' },
    ])
  }
  const extension = extensionOf(name)
  if (!extension) {
    throw new AttachmentServiceError(422, 'VALIDATION_FAILED', '附件扩展名不在白名单中', [
      { field: 'fileName', code: 'INVALID_VALUE' },
    ])
  }
  return extension
}

function toView(record: AttachmentRecord): AttachmentView {
  const { storageKey: _storageKey, cleanupAttempts: _attempts, cleanupError: _error, ...view } = record
  return view
}

export class AttachmentService {
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly deps: AttachmentServiceDependencies) {
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? randomUUID
  }

  async upload(input: UploadAttachmentInput): Promise<AttachmentView> {
    const projectId = await this.authorize(input.actorUserId, input.taskId, 'WRITE')
    const extension = validateName(input.originalName)
    const expectedMime = ATTACHMENT_MIME_BY_EXTENSION[extension]
    if (input.mimeType !== expectedMime) {
      throw new AttachmentServiceError(422, 'VALIDATION_FAILED', '附件扩展名与 MIME 不匹配', [
        { field: 'mimeType', code: 'INVALID_VALUE' },
      ])
    }
    if (input.content.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentServiceError(422, 'VALIDATION_FAILED', '单个附件不能超过 10MB', [
        { field: 'file', code: 'TOO_LONG' },
      ])
    }

    const id = this.createId()
    const record: AttachmentRecord = {
      id,
      taskId: input.taskId,
      projectId,
      originalName: input.originalName,
      extension,
      mimeType: expectedMime,
      sizeBytes: input.content.byteLength,
      storageKey: `${id}.${extension}`,
      uploaderUserId: input.actorUserId,
      uploadedAt: this.now().toISOString(),
      state: 'ACTIVE',
      cleanupAttempts: 0,
      cleanupError: null,
    }

    await this.deps.storage.write(record.storageKey, input.content)
    try {
      return toView(await this.deps.repository.insert(record))
    } catch (error) {
      await this.deps.storage.delete(record.storageKey).catch(() => undefined)
      throw error
    }
  }

  async list(actorUserId: string, taskId: string): Promise<{ total: number; items: AttachmentView[] }> {
    await this.authorize(actorUserId, taskId, 'READ')
    const rows = await this.deps.repository.listActiveByTask(taskId)
    return { total: rows.length, items: rows.map(toView) }
  }

  async download(actorUserId: string, attachmentId: string): Promise<AttachmentDownload> {
    const metadata = await this.deps.repository.findAccessMetadata(attachmentId)
    if (!metadata || metadata.state !== 'ACTIVE') throw notFound()
    await this.authorize(actorUserId, metadata.taskId, 'READ')
    const record = await this.deps.repository.findById(attachmentId)
    if (!record || record.state !== 'ACTIVE') throw notFound()
    return { attachment: toView(record), content: await this.deps.storage.read(record.storageKey) }
  }

  async delete(actorUserId: string, attachmentId: string): Promise<void> {
    const metadata = await this.deps.repository.findAccessMetadata(attachmentId)
    if (!metadata || metadata.state !== 'ACTIVE') throw notFound()
    await this.authorize(actorUserId, metadata.taskId, 'WRITE')
    const record = await this.deps.repository.markDeleting(attachmentId)
    if (!record) throw notFound()
    try {
      await this.deps.storage.delete(record.storageKey)
      await this.deps.repository.remove(record.id)
    } catch {
      await this.deps.repository.markCleanupFailed(record.id, safeCleanupReason())
      throw new AttachmentServiceError(409, 'CONFLICT', '附件清理失败，已登记重试')
    }
  }

  async retryCleanup(attachmentId: string): Promise<boolean> {
    const row = await this.deps.repository.findById(attachmentId)
    if (!row || row.state !== 'CLEANUP_FAILED') return false
    await this.deps.repository.markDeleting(row.id)
    try {
      await this.deps.storage.delete(row.storageKey)
      await this.deps.repository.remove(row.id)
      return true
    } catch {
      await this.deps.repository.markCleanupFailed(row.id, safeCleanupReason())
      return false
    }
  }

  private async authorize(
    actorUserId: string,
    taskId: string,
    operation: 'READ' | 'WRITE',
  ): Promise<string> {
    const decision = await this.deps.authorization.decide(actorUserId, taskId, operation)
    if (!decision.allow) {
      if (decision.status === 404) throw notFound()
      throw new AttachmentServiceError(
        decision.status,
        decision.code,
        '无权执行附件操作',
      )
    }
    return decision.projectId
  }
}
