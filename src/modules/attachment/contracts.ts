export const MAX_ATTACHMENT_BYTES = 10_000_000

export const ATTACHMENT_MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
} as const

export type AttachmentExtension = keyof typeof ATTACHMENT_MIME_BY_EXTENSION
export type AttachmentMime = (typeof ATTACHMENT_MIME_BY_EXTENSION)[AttachmentExtension]
export type AttachmentState = 'ACTIVE' | 'DELETING' | 'CLEANUP_FAILED'

export type AttachmentRecord = {
  id: string
  taskId: string
  projectId: string
  originalName: string
  extension: AttachmentExtension
  mimeType: AttachmentMime
  sizeBytes: number
  storageKey: string
  uploaderUserId: string
  uploadedAt: string
  state: AttachmentState
  cleanupAttempts: number
  cleanupError: string | null
}

export type AttachmentView = Omit<
  AttachmentRecord,
  'storageKey' | 'cleanupAttempts' | 'cleanupError'
>

export type AttachmentAccessOperation = 'READ' | 'WRITE'

export type AttachmentAccessDecision =
  | { allow: true; projectId: string }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

/**
 * 正式适配器必须现查任务、项目成员、角色与敏感白名单。
 * WRITE 复用 task.progress：PM / 具备该能力的任务负责人可写；其他成员只读。
 * 不可见对象和 outsider 返回 404，不在模块内新增 Action 或角色判断。
 */
export interface AttachmentAuthorizationPort {
  decide(
    actorUserId: string,
    taskId: string,
    operation: AttachmentAccessOperation,
  ): Promise<AttachmentAccessDecision>
}

export type AttachmentAccessMetadata = {
  id: string
  taskId: string
  state: AttachmentState
}

export interface AttachmentRepositoryPort {
  insert(record: AttachmentRecord): Promise<AttachmentRecord>
  /** 数据库适配器必须直接使用 WHERE taskId/state，不得取全量后内存过滤。 */
  listActiveByTask(taskId: string): Promise<AttachmentRecord[]>
  listAllByTask(taskId: string): Promise<AttachmentRecord[]>
  findAccessMetadata(id: string): Promise<AttachmentAccessMetadata | null>
  findById(id: string): Promise<AttachmentRecord | null>
  markDeleting(id: string): Promise<AttachmentRecord | null>
  markCleanupFailed(id: string, safeReason: string): Promise<AttachmentRecord | null>
  remove(id: string): Promise<boolean>
}

export interface AttachmentStoragePort {
  write(storageKey: string, content: Buffer): Promise<void>
  read(storageKey: string): Promise<Buffer>
  delete(storageKey: string): Promise<void>
}

export type UploadAttachmentInput = {
  actorUserId: string
  taskId: string
  originalName: string
  mimeType: string
  content: Buffer
}

export type AttachmentDownload = {
  attachment: AttachmentView
  content: Buffer
}

export type TaskAttachmentCleanupResult = {
  taskId: string
  removed: number
  failed: Array<{ attachmentId: string; reason: string }>
}
