import type {
  AppendNotificationResult,
  NotificationAccessMetadata,
  NotificationRecord,
  NotificationRepositoryPort,
} from './contracts.js'

function copy(record: NotificationRecord): NotificationRecord {
  return structuredClone(record)
}

export class InMemoryNotificationRepository implements NotificationRepositoryPort {
  private readonly records = new Map<string, NotificationRecord>()
  private readonly idsByDedupeKey = new Map<string, string>()

  async appendIfAbsent(record: NotificationRecord): Promise<AppendNotificationResult> {
    const existingId = this.idsByDedupeKey.get(record.dedupeKey)
    if (existingId) {
      const existing = this.records.get(existingId)
      if (!existing) throw new Error('通知仓储幂等索引损坏')
      return { kind: 'DUPLICATE', record: copy(existing) }
    }
    this.records.set(record.id, copy(record))
    this.idsByDedupeKey.set(record.dedupeKey, record.id)
    return { kind: 'APPENDED', record: copy(record) }
  }

  async listByRecipient(
    recipientUserId: string,
    unreadOnly: boolean,
  ): Promise<NotificationRecord[]> {
    return [...this.records.values()]
      .filter((row) => row.recipientUserId === recipientUserId && (!unreadOnly || !row.isRead))
      .sort((left, right) => right.storedAt.localeCompare(left.storedAt) || right.id.localeCompare(left.id))
      .map(copy)
  }

  async findAccessMetadata(id: string): Promise<NotificationAccessMetadata | null> {
    const record = this.records.get(id)
    return record ? { id: record.id, recipientUserId: record.recipientUserId } : null
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const record = this.records.get(id)
    return record ? copy(record) : null
  }

  async markRead(id: string, readAt: string): Promise<NotificationRecord | null> {
    const record = this.records.get(id)
    if (!record) return null
    if (!record.isRead) {
      record.isRead = true
      record.readAt = readAt
    }
    return copy(record)
  }
}
