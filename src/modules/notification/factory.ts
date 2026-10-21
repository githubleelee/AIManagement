import type {
  NotificationEventSubscriptionPort,
  NotificationRecipientResolverPort,
  NotificationRepositoryPort,
  NotificationSourceState,
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
  let sourceState: NotificationSourceState = {
    state: 'UNAVAILABLE',
    note: '公共事件端口尚未接入，不能用 0 或空列表表示没有通知。',
  }
  let unsubscribe: Array<() => void> = []
  const service = new NotificationService({
    repository: options.repository,
    recipientResolver: options.recipientResolver,
    sourceState: () => sourceState,
    now: options.now,
    createId: options.createId,
  })

  return {
    service,
    sourceState: () => sourceState,
    start(): NotificationSourceState {
      if (sourceState.state === 'AVAILABLE') return sourceState
      if (!options.eventSource) return sourceState
      unsubscribe = NOTIFICATION_EVENT_NAMES.map((eventName) =>
        options.eventSource!.subscribe(eventName, `notification:${eventName}`, async (event) => {
          await service.consume(event)
        }),
      )
      sourceState = { state: 'AVAILABLE', note: null }
      return sourceState
    },
    stop(): void {
      unsubscribe.forEach((dispose) => dispose())
      unsubscribe = []
      sourceState = {
        state: 'UNAVAILABLE',
        note: '通知事件订阅已停止，当前数据源不可用。',
      }
    },
  }
}

export type NotificationModule = ReturnType<typeof createNotificationModule>
