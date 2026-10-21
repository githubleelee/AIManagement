import { randomUUID } from 'node:crypto'
import type {
  ConsumeNotificationEventResult,
  NotificationContent,
  NotificationListResult,
  NotificationRecord,
  NotificationRecipientResolverPort,
  NotificationRepositoryPort,
  NotificationSourceEvent,
  NotificationSourceState,
  NotificationType,
} from './contracts.js'
import { NotificationServiceError } from './errors.js'

export const DELIVERY_TARGET_MS = 60_000

const EVENT_TYPE: Record<NotificationSourceEvent['eventName'], NotificationType> = {
  'task.assigned': 'TASK_ASSIGNED',
  'task.mentioned': 'MENTIONED',
  'task.overdue': 'TASK_OVERDUE',
  'acceptance.submitted': 'ACCEPTANCE',
  'acceptance.approved': 'ACCEPTANCE',
  'acceptance.rejected': 'ACCEPTANCE',
  'risk.created': 'RISK_ALERT',
  'risk.level-raised': 'RISK_ALERT',
  'milestone.due': 'MILESTONE_REMINDER',
}

export type NotificationServiceDependencies = {
  repository: NotificationRepositoryPort
  recipientResolver: NotificationRecipientResolverPort
  sourceState: () => NotificationSourceState
  now?: () => Date
  createId?: () => string
}

function notFound(): NotificationServiceError {
  return new NotificationServiceError(404, 'NOT_FOUND', '通知不存在或不可见')
}

function validateEvent(event: NotificationSourceEvent): void {
  if (!event.id.trim() || !event.projectId.trim()) {
    throw new NotificationServiceError(422, 'VALIDATION_FAILED', '事件 id 与 projectId 不能为空')
  }
  if (!event.object.objectType.trim() || !event.object.objectId.trim()) {
    throw new NotificationServiceError(422, 'VALIDATION_FAILED', '事件对象引用不能为空')
  }
  if (Number.isNaN(Date.parse(event.occurredAt))) {
    throw new NotificationServiceError(422, 'VALIDATION_FAILED', 'occurredAt 必须是 ISO 8601 时间')
  }
}

function contentFor(
  sensitive: boolean,
  content: Extract<NotificationContent, { kind: 'TEXT' }> | undefined,
): NotificationContent {
  if (sensitive) return { kind: 'REFERENCE_ONLY', title: null, summary: null }
  return content ?? { kind: 'REFERENCE_ONLY', title: null, summary: null }
}

export class NotificationService {
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly deps: NotificationServiceDependencies) {
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? randomUUID
  }

  async consume(event: NotificationSourceEvent): Promise<ConsumeNotificationEventResult> {
    validateEvent(event)
    const type = EVENT_TYPE[event.eventName]
    const resolution = await this.deps.recipientResolver.resolve(event, type)
    if (resolution.state === 'UNAVAILABLE') {
      return {
        state: 'UNAVAILABLE',
        created: 0,
        duplicate: 0,
        notifications: [],
        note: resolution.note,
      }
    }
    if (type === 'TASK_OVERDUE' && !resolution.dedupeDiscriminator?.trim()) {
      throw new NotificationServiceError(
        422,
        'VALIDATION_FAILED',
        '逾期通知必须提供截止日期作为去重依据',
      )
    }

    const recipients = new Map(
      resolution.recipients
        .filter((recipient) => recipient.userId.trim())
        .map((recipient) => [recipient.userId, recipient]),
    )
    const notifications: NotificationRecord[] = []
    let created = 0
    let duplicate = 0

    for (const recipient of recipients.values()) {
      const storedAt = this.now().toISOString()
      const latencyMs = Math.max(0, Date.parse(storedAt) - Date.parse(event.occurredAt))
      const dedupeBasis =
        type === 'TASK_OVERDUE'
          ? `${event.projectId}:${type}:${event.object.objectId}:${resolution.dedupeDiscriminator}`
          : event.id
      const record: NotificationRecord = {
        id: this.createId(),
        projectId: event.projectId,
        recipientUserId: recipient.userId,
        type,
        sourceEventId: event.id,
        sourceEventName: event.eventName,
        dedupeKey: `${dedupeBasis}:${recipient.userId}`,
        reference: structuredClone(event.object),
        content: contentFor(event.sensitive, recipient.content),
        sensitive: event.sensitive,
        occurredAt: event.occurredAt,
        storedAt,
        latencyMs,
        withinDeliveryTarget: latencyMs <= DELIVERY_TARGET_MS,
        isRead: false,
        readAt: null,
      }
      const appended = await this.deps.repository.appendIfAbsent(record)
      notifications.push(appended.record)
      if (appended.kind === 'APPENDED') created += 1
      else duplicate += 1
    }

    return { state: 'DELIVERED', created, duplicate, notifications }
  }

  async list(actorUserId: string, unreadOnly = false): Promise<NotificationListResult> {
    const sourceState = this.deps.sourceState()
    if (sourceState.state === 'UNAVAILABLE') {
      return {
        state: 'UNAVAILABLE',
        total: null,
        unreadCount: null,
        items: [],
        note: sourceState.note,
      }
    }
    const items = await this.deps.repository.listByRecipient(actorUserId, unreadOnly)
    const all = unreadOnly ? await this.deps.repository.listByRecipient(actorUserId, false) : items
    return {
      state: 'AVAILABLE',
      total: items.length,
      unreadCount: all.filter((row) => !row.isRead).length,
      items,
      note: null,
    }
  }

  async get(actorUserId: string, notificationId: string): Promise<NotificationRecord> {
    await this.assertRecipient(actorUserId, notificationId)
    const record = await this.deps.repository.findById(notificationId)
    if (!record) throw notFound()
    return record
  }

  async markRead(actorUserId: string, notificationId: string): Promise<NotificationRecord> {
    await this.assertRecipient(actorUserId, notificationId)
    const record = await this.deps.repository.markRead(notificationId, this.now().toISOString())
    if (!record) throw notFound()
    return record
  }

  private async assertRecipient(actorUserId: string, notificationId: string): Promise<void> {
    const metadata = await this.deps.repository.findAccessMetadata(notificationId)
    if (!metadata || metadata.recipientUserId !== actorUserId) throw notFound()
  }
}
