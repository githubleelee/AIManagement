import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api'
import {
  listNotifications,
  markNotificationRead,
  type NotificationListResponse,
  type NotificationType,
  type NotificationView,
} from './api'
import './notification.css'

const TYPE_LABEL: Record<NotificationType, string> = {
  TASK_ASSIGNED: '任务分配',
  MENTIONED: '@ 提及',
  TASK_OVERDUE: '任务逾期',
  ACCEPTANCE: '任务验收',
  RISK_ALERT: '风险提醒',
  MILESTONE_REMINDER: '关键节点',
}

function titleOf(item: NotificationView): string {
  return item.content.kind === 'TEXT' ? item.content.title : `${TYPE_LABEL[item.type]}（受保护）`
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<NotificationListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await listNotifications())
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '通知加载失败')
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 30_000)
    return () => window.clearInterval(timer)
  }, [reload])

  async function markRead(item: NotificationView) {
    if (item.isRead) return
    try {
      await markNotificationRead(item.id)
      await reload()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '更新已读状态失败')
    }
  }

  const unread = data?.state === 'AVAILABLE' ? data.unreadCount : null

  return (
    <div className="notification-bell">
      <button
        type="button"
        className="notification-bell-button"
        aria-expanded={open}
        aria-label={unread === null ? '通知，数据源未接入' : `通知，${unread} 条未读`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">通知</span>
        <span className="notification-count">{unread === null ? '—' : unread}</span>
      </button>

      {open ? (
        <section className="notification-panel" aria-label="站内通知">
          <div className="notification-panel-header">
            <strong>站内通知</strong>
            <button type="button" className="ghost" onClick={() => void reload()}>
              刷新
            </button>
          </div>

          {error ? <p className="error">{error}</p> : null}
          {!data ? <p className="muted">正在加载…</p> : null}
          {data?.state === 'UNAVAILABLE' ? (
            <p className="notification-unavailable">{data.note}</p>
          ) : null}
          {data?.state === 'AVAILABLE' && data.items.length === 0 ? (
            <p className="muted">暂无通知</p>
          ) : null}
          {data?.state === 'AVAILABLE' ? (
            <ul className="notification-list">
              {data.items.map((item) => (
                <li key={item.id} className={item.isRead ? 'is-read' : 'is-unread'}>
                  <button type="button" onClick={() => void markRead(item)}>
                    <span className="notification-type">{TYPE_LABEL[item.type]}</span>
                    <strong>{titleOf(item)}</strong>
                    {item.content.kind === 'TEXT' && item.content.summary ? (
                      <span>{item.content.summary}</span>
                    ) : null}
                    <small>
                      {new Date(item.storedAt).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                      })}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
