import { randomUUID } from 'node:crypto'
import type {
  ConsumeNotificationEventResult,
  NotificationContent,
  NotificationListResult,
  NotificationRecord,
  NotificationRecipientResolverPort,
  NotificationRepositoryPort,
  NotificationSourceEvent,
  NotificationSourceHealth,
  NotificationView,
  NotificationType,
} from './contracts.js'
import { NotificationServiceError } from './errors.js'
import { NOTIFICATION_LIST_LIMIT } from './contracts.js'

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
  sourceState: () => NotificationSourceHealth
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

/** Explicit allow-list: delivery/recipient diagnostics never cross the HTTP boundary. */
function toView(record: NotificationRecord): NotificationView {
  const { id, projectId, type, reference, content, sensitive, storedAt, isRead, readAt } = record
  return { id, projectId, type, reference: structuredClone(reference),
    content: structuredClone(content), sensitive, storedAt, isRead, readAt }
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
      const latencyMs = Date.parse(storedAt) - Date.parse(event.occurredAt)
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
        withinDeliveryTarget: latencyMs >= 0 && latencyMs <= DELIVERY_TARGET_MS,
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
        limit: NOTIFICATION_LIST_LIMIT,
        truncated: false,
        sourceCapabilities: sourceState.sourceCapabilities,
        note: sourceState.note,
      }
    }
    let snapshot
    try {
      snapshot = await this.deps.repository.listByRecipient(actorUserId, unreadOnly, NOTIFICATION_LIST_LIMIT)
    } catch {
      return { state: 'UNAVAILABLE', total: null, unreadCount: null, items: [],
        limit: NOTIFICATION_LIST_LIMIT, truncated: false,
        sourceCapabilities: sourceState.sourceCapabilities, note: '通知记录暂不可查询，请稍后重试' }
    }
    return {
      state: 'AVAILABLE',
      total: snapshot.total,
      unreadCount: snapshot.unreadCount,
      items: snapshot.items.map(toView),
      limit: snapshot.limit,
      truncated: snapshot.truncated,
      sourceCapabilities: sourceState.sourceCapabilities,
      note: null,
    }
  }

  async get(actorUserId: string, notificationId: string): Promise<NotificationView> {
    await this.assertRecipient(actorUserId, notificationId)
    const record = await this.deps.repository.findById(notificationId, actorUserId)
    if (!record) throw notFound()
    return toView(record)
  }

  async markRead(actorUserId: string, notificationId: string): Promise<NotificationView> {
    // The conditional write itself checks actor/current scope; no unchecked write after preflight.
    const record = await this.deps.repository.markRead(notificationId, actorUserId, this.now().toISOString())
    if (!record) throw notFound()
    return toView(record)
  }

  private async assertRecipient(actorUserId: string, notificationId: string): Promise<void> {
    const metadata = await this.deps.repository.findAccessMetadata(notificationId, actorUserId)
    if (!metadata || metadata.recipientUserId !== actorUserId) throw notFound()
  }
}
