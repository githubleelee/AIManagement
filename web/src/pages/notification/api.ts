import { apiFetch } from '../../api'

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'MENTIONED'
  | 'TASK_OVERDUE'
  | 'ACCEPTANCE'
  | 'RISK_ALERT'
  | 'MILESTONE_REMINDER'

export type NotificationView = {
  id: string
  projectId: string
  type: NotificationType
  reference: { objectType: string; objectId: string }
  content:
    | { kind: 'TEXT'; title: string; summary: string | null }
    | { kind: 'REFERENCE_ONLY'; title: null; summary: null }
  sensitive: boolean
  storedAt: string
  isRead: boolean
  readAt: string | null
}

export type NotificationListResponse =
  | {
      state: 'AVAILABLE'
      total: number
      unreadCount: number
      items: NotificationView[]
      note: null
      limit: number
      truncated: boolean
      sourceCapabilities: NotificationSourceCapability[]
    }
  | {
      state: 'UNAVAILABLE'
      total: null
      unreadCount: null
      items: []
      note: string
      limit: number
      truncated: false
      sourceCapabilities: NotificationSourceCapability[]
    }

export type NotificationSourceCapability = {
  eventName: string
  state: 'AVAILABLE' | 'UNAVAILABLE'
  note: string | null
}

export function listNotifications(): Promise<NotificationListResponse> {
  return apiFetch<NotificationListResponse>('/me/notifications')
}

export function markNotificationRead(notificationId: string): Promise<NotificationView> {
  return apiFetch<NotificationView>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'PATCH', body: '{}' },
  )
}
