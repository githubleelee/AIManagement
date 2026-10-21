export const NOTIFICATION_EVENT_NAMES = [
  'task.assigned',
  'task.mentioned',
  'task.overdue',
  'acceptance.submitted',
  'acceptance.approved',
  'acceptance.rejected',
  'risk.created',
  'risk.level-raised',
  'milestone.due',
] as const

export type NotificationEventName = (typeof NOTIFICATION_EVENT_NAMES)[number]

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'MENTIONED'
  | 'TASK_OVERDUE'
  | 'ACCEPTANCE'
  | 'RISK_ALERT'
  | 'MILESTONE_REMINDER'

export type EventObjectReference = {
  objectType: string
  objectId: string
}

/** #37 事件信封中通知模块真正消费的最小只读子集。 */
export type NotificationSourceEvent = {
  id: string
  eventName: NotificationEventName
  projectId: string
  object: EventObjectReference
  occurredAt: string
  sensitive: boolean
  payload: unknown
}

export type NotificationContent =
  | { kind: 'TEXT'; title: string; summary: string | null }
  | { kind: 'REFERENCE_ONLY'; title: null; summary: null }

export type NotificationRecord = {
  id: string
  projectId: string
  recipientUserId: string
  type: NotificationType
  sourceEventId: string
  sourceEventName: NotificationEventName
  dedupeKey: string
  reference: EventObjectReference
  content: NotificationContent
  sensitive: boolean
  occurredAt: string
  storedAt: string
  latencyMs: number
  withinDeliveryTarget: boolean
  isRead: boolean
  readAt: string | null
}

export type NotificationRecipient = {
  userId: string
  /** 只能由服务端的权威解析器生成；不得直接信任事件 payload。 */
  content?: Extract<NotificationContent, { kind: 'TEXT' }>
}

export type RecipientResolution =
  | {
      state: 'AVAILABLE'
      recipients: NotificationRecipient[]
      /** 逾期通知必须使用 planEnd，保证“任务 + 截止日期 + 接收者”去重。 */
      dedupeDiscriminator?: string
    }
  | { state: 'UNAVAILABLE'; note: string }

export type NotificationSourceState =
  | { state: 'AVAILABLE'; note: null }
  | { state: 'UNAVAILABLE'; note: string }

export type NotificationListResult =
  | {
      state: 'AVAILABLE'
      total: number
      unreadCount: number
      items: NotificationRecord[]
      note: null
    }
  | {
      state: 'UNAVAILABLE'
      total: null
      unreadCount: null
      items: []
      note: string
    }

export type ConsumeNotificationEventResult =
  | {
      state: 'DELIVERED'
      created: number
      duplicate: number
      notifications: NotificationRecord[]
    }
  | { state: 'UNAVAILABLE'; created: 0; duplicate: 0; notifications: []; note: string }

export type AppendNotificationResult =
  | { kind: 'APPENDED'; record: NotificationRecord }
  | { kind: 'DUPLICATE'; record: NotificationRecord }

export type NotificationAccessMetadata = {
  id: string
  recipientUserId: string
}

export interface NotificationRepositoryPort {
  appendIfAbsent(record: NotificationRecord): Promise<AppendNotificationResult>
  listByRecipient(recipientUserId: string, unreadOnly: boolean): Promise<NotificationRecord[]>
  findAccessMetadata(id: string): Promise<NotificationAccessMetadata | null>
  findById(id: string): Promise<NotificationRecord | null>
  markRead(id: string, readAt: string): Promise<NotificationRecord | null>
}

export interface NotificationRecipientResolverPort {
  /**
   * 从权威业务数据解析接收者与安全文案；敏感事件正文随后仍会被服务强制丢弃。
   * 数据源尚未就绪时必须返回 UNAVAILABLE，不能返回空数组冒充“无人接收”。
   */
  resolve(
    event: NotificationSourceEvent,
    type: NotificationType,
  ): Promise<RecipientResolution>
}

export type NotificationEventHandler = (event: NotificationSourceEvent) => Promise<void>

/** 与 #37 `subscribe(eventName, subscriberId, handler)` 的最小兼容端口。 */
export interface NotificationEventSubscriptionPort {
  subscribe(
    eventName: NotificationEventName,
    subscriberId: string,
    handler: NotificationEventHandler,
  ): () => void
}
