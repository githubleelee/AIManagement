import type {
  NotificationEventSubscriptionPort,
  NotificationRecipientResolverPort,
  NotificationRepositoryPort,
  NotificationSourceHealth,
} from './contracts.js'
import { NOTIFICATION_EVENT_NAMES } from './contracts.js'
import { NotificationService } from './service.js'

export type NotificationModuleOptions = {
  repository: NotificationRepositoryPort
  recipientResolver: NotificationRecipientResolverPort
  eventSource?: NotificationEventSubscriptionPort
  now?: () => Date
  createId?: () => string
}

export function createNotificationModule(options: NotificationModuleOptions) {
  let started = false
  let failureNote = '公共事件端口尚未启动或接入。'
  let unsubscribe: Array<() => void> = []
  function sourceState(): NotificationSourceHealth {
    try {
      const health = options.eventSource?.health()
      const sourceCapabilities = NOTIFICATION_EVENT_NAMES.map(eventName =>
        health?.sourceCapabilities.find(item => item.eventName === eventName) ?? {
          eventName, state: 'UNAVAILABLE' as const, note: '真实生产方尚未接入',
        })
      if (!started || !health) return { state: 'UNAVAILABLE', note: failureNote, sourceCapabilities }
      return { ...health, sourceCapabilities }
    } catch {
      return { state: 'UNAVAILABLE', note: '通知事件源健康检查失败',
        sourceCapabilities: NOTIFICATION_EVENT_NAMES.map(eventName => ({
          eventName, state: 'UNAVAILABLE', note: '事件源状态不可查询',
        })) }
    }
  }
  function disposeAll(): void {
    const callbacks = unsubscribe
    unsubscribe = []
    for (const dispose of callbacks) {
      try { dispose() } catch { failureNote = '通知订阅释放失败，事件源需检查' }
    }
  }
  const service = new NotificationService({
    repository: options.repository,
    recipientResolver: options.recipientResolver,
    sourceState,
    now: options.now,
    createId: options.createId,
  })

  return {
    service,
    sourceState,
    start(): NotificationSourceHealth {
      if (started || !options.eventSource) return sourceState()
      try {
        for (const eventName of NOTIFICATION_EVENT_NAMES) {
          unsubscribe.push(options.eventSource.subscribe(eventName, `notification:${eventName}`,
            async event => {
              const health = sourceState()
              if (health.state === 'UNAVAILABLE') return {
                state: 'UNAVAILABLE', created: 0, duplicate: 0, notifications: [], note: health.note,
              }
              return service.consume(event)
            }))
        }
        started = true
      } catch {
        failureNote = '通知事件订阅注册失败'
        disposeAll()
      }
      return sourceState()
    },
    stop(): void {
      started = false
      failureNote = '通知事件订阅已停止，当前数据源不可用。'
      disposeAll()
    },
  }
}

export type NotificationModule = ReturnType<typeof createNotificationModule>
