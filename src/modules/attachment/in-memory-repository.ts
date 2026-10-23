import type {
  AttachmentAccessMetadata,
  AttachmentRecord,
  AttachmentRepositoryPort,
} from './contracts.js'

function copy(record: AttachmentRecord): AttachmentRecord {
  return structuredClone(record)
}

export class InMemoryAttachmentRepository implements AttachmentRepositoryPort {
  private readonly records = new Map<string, AttachmentRecord>()

  async insert(record: AttachmentRecord): Promise<AttachmentRecord> {
    if (this.records.has(record.id)) throw new Error('附件 id 已存在')
    this.records.set(record.id, copy(record))
    return copy(record)
  }

  async listActiveByTask(taskId: string): Promise<AttachmentRecord[]> {
    return [...this.records.values()]
      .filter((row) => row.taskId === taskId && row.state === 'ACTIVE')
      .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt) || left.id.localeCompare(right.id))
      .map(copy)
  }

  async listAllByTask(taskId: string): Promise<AttachmentRecord[]> {
    return [...this.records.values()].filter((row) => row.taskId === taskId).map(copy)
  }

  async findAccessMetadata(id: string): Promise<AttachmentAccessMetadata | null> {
    const row = this.records.get(id)
    return row ? { id: row.id, taskId: row.taskId, state: row.state } : null
  }

  async findById(id: string): Promise<AttachmentRecord | null> {
    const row = this.records.get(id)
    return row ? copy(row) : null
  }

  async markDeleting(id: string): Promise<AttachmentRecord | null> {
    const row = this.records.get(id)
    if (!row) return null
    row.state = 'DELETING'
    row.cleanupAttempts += 1
    row.cleanupError = null
    return copy(row)
  }

  async markCleanupFailed(id: string, safeReason: string): Promise<AttachmentRecord | null> {
    const row = this.records.get(id)
    if (!row) return null
    row.state = 'CLEANUP_FAILED'
    row.cleanupError = safeReason
    return copy(row)
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id)
  }
}
