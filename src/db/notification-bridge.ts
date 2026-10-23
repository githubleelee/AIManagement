/**
 * #34 通知运行时 —— 提交后已提交事件消费桥接（ROLE-B 单写）。
 *
 * 为什么需要（`DECISIONS.md` `notifications.committed-consumption-and-query-contract`）：
 * 域内事件在业务事务里 `repository.appendIfAbsent(event, tx)` 落库、**不派发订阅者**，
 * 也没有 outbox / 外部队列。因此通知投递必须补一个「已提交事件」专用消费者：
 *   - 只读**已提交**的 `DomainEvent`（不在业务事务内调用订阅者）；
 *   - 内部扫描限定支持事件名并**分批**读取（不复用带 `projectId` / actor 限制的用户 query 端口）；
 *   - 复用 `factory.start()` 注册的**同一**处理器（经 `NotificationEventSubscriptionPort` 适配器）；
 *   - 以持久 `(consumerId,eventId)` 账本判定完成：**仅 DELIVERED 落账本**；
 *     UNAVAILABLE / 异常不落、可重试；单条失败不阻塞后续（属于至少一次尝试 + 幂等）。
 *
 * 不改变 `publish` 对 DUPLICATE 不自动派发的语义（本桥接只读存储，不调 `publish`）。
 */
import type {
  NotificationEventHandler,
  NotificationSourceEvent,
} from '../modules/notification/contracts.js'
import type { PendingNotificationEvent, PrismaNotificationConsumerStore } from './notification-consumer-store.js'
import type { NotificationCommittedEventSource } from './notification-event-source.js'

export type NotificationBridgeOptions = {
  store: Pick<PrismaNotificationConsumerStore, 'readPending' | 'markDelivered'>
  eventSource: Pick<
    NotificationCommittedEventSource,
    'handlerFor' | 'noteSourceFault' | 'noteSourceRecovered'
  >
  consumerId: string
  batchSize?: number
  intervalMs?: number
  onError?: (error: unknown) => void
}

export type NotificationBridge = {
  runOnce: () => Promise<void>
  start: () => void
  stop: () => void
}

export function createNotificationBridge(options: NotificationBridgeOptions): NotificationBridge {
  const batchSize = options.batchSize ?? 50
  const intervalMs = options.intervalMs ?? 2_000
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false

  async function runOnce(): Promise<void> {
    // 同实例不重叠：上一轮未结束时直接跳过本轮。
    if (running) return
    running = true
    try {
      const pending = await options.store.readPending(options.consumerId, batchSize)
      // 成功读到事件源：恢复健康（读源故障时列表会诚实降级为 UNAVAILABLE）。
      options.eventSource.noteSourceRecovered()
      for (const event of pending) {
        const handler = options.eventSource.handlerFor(event.eventName)
        if (!handler) continue
        await deliver(event, handler)
      }
    } catch (error) {
      options.eventSource.noteSourceFault('通知事件源读取失败，请稍后重试')
      options.onError?.(error)
    } finally {
      running = false
    }
  }

  async function deliver(
    event: PendingNotificationEvent,
    handler: NotificationEventHandler,
  ): Promise<void> {
    try {
      const result = await handler(event as NotificationSourceEvent)
      if (result.state === 'DELIVERED') {
        await options.store.markDelivered(options.consumerId, event.id)
      }
      // UNAVAILABLE：不确认、保留诊断、可重试；不阻塞后续事件（循环继续）。
    } catch (error) {
      // 单条异常不得阻塞后续事件；也不落账本，留给下一轮重试。
      options.onError?.(error)
    }
  }

  return {
    runOnce,
    start(): void {
      if (timer) return
      timer = setInterval(() => {
        void runOnce()
      }, intervalMs)
      // 不因后台定时器阻止进程退出（测试 / CLI 收尾友好）。
      timer.unref?.()
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
