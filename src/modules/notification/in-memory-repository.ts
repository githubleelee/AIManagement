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

  /** Test fixture only. Production scope filtering belongs in ROLE-B's DB adapter. */
  constructor(private readonly canView: (actor: string, record: NotificationRecord) => boolean) {
    if (typeof canView !== 'function') throw new TypeError('内存通知夹具必须显式提供可见性检查')
  }

  private visible(actor: string, record: NotificationRecord): boolean {
    return record.recipientUserId === actor && this.canView(actor, copy(record))
  }

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
    limit: number,
  ) {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const visible = [...this.records.values()].filter(row => this.visible(recipientUserId, row))
    const matching = visible.filter(row => !unreadOnly || !row.isRead)
      .sort((left, right) => right.storedAt.localeCompare(left.storedAt) || right.id.localeCompare(left.id))
    return { items: matching.slice(0, boundedLimit).map(copy), total: matching.length,
      unreadCount: visible.filter(row => !row.isRead).length, limit: boundedLimit,
      truncated: matching.length > boundedLimit }
  }

  async findAccessMetadata(id: string, actorUserId: string): Promise<NotificationAccessMetadata | null> {
    const record = this.records.get(id)
    return record && this.visible(actorUserId, record) ? { id: record.id, recipientUserId: record.recipientUserId } : null
  }

  async findById(id: string, actorUserId: string): Promise<NotificationRecord | null> {
    const record = this.records.get(id)
    return record && this.visible(actorUserId, record) ? copy(record) : null
  }

  async markRead(id: string, actorUserId: string, readAt: string): Promise<NotificationRecord | null> {
    const record = this.records.get(id)
    if (!record || !this.visible(actorUserId, record)) return null
    if (!record.isRead) {
      record.isRead = true
      record.readAt = readAt
    }
    return copy(record)
  }
}
