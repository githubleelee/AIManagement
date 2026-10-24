/**
 * #34 通知运行时 —— #37 事件订阅适配器（ROLE-B 显式适配，`NotificationEventSubscriptionPort`）。
 *
 * D 的消费模块只暴露 `NotificationEventSubscriptionPort`；本适配器把它显式接到 #37 的
 * `DomainEventSubscriberPort`（`src/shared/events.ts` 的 `EventHandler` 是 `void` 返回，
 * 而通知处理器返回 `ConsumeNotificationEventResult`）。**禁止** no-op 订阅或伪造 AVAILABLE。
 *
 * 依据 `DECISIONS.md` `notifications.committed-consumption-and-query-contract`：
 *   - 真实注册九个订阅并返回真实 disposer；中途失败由工厂回收已注册的 disposer；
 *   - `health()` 同步读取动态健康状态与九个事件的 `sourceCapabilities`；未启动 / 停止 /
 *     读源故障 / 订阅注册失败均返回 UNAVAILABLE，部分来源未接入不清空其它已接来源记录；
 *   - live 订阅只是 **bonus 路径**：域内事件在业务事务里 `appendIfAbsent`、不经 `publish`，
 *     因此真正投递由提交后消费桥接（`notification-bridge.ts`）完成；本适配器同时保存
 *     工厂注册的**同一**处理器，供桥接复用（`handlerFor`）。
 */
import type {
  NotificationEventHandler,
  NotificationEventName,
  NotificationSourceCapability,
  NotificationSourceEvent,
  NotificationSourceHealth,
  NotificationEventSubscriptionPort,
} from '../modules/notification/contracts.js'
import type {
  DomainEventEnvelope,
  DomainEventSubscriberPort,
  EventHandler,
} from '../shared/events.js'

export type NotificationEventSourceOptions = {
  /** #37 订阅端口（`app.events.subscriber`）。缺省时 `subscribe` 显式报错，不静默 no-op。 */
  subscriber?: DomainEventSubscriberPort
  /**
   * 每个事件的来源接线清单（由运行时按调度是否运行、生产方是否接入动态给出）。
   * 未列出的名字在 `health()` 里按 UNAVAILABLE 兜底。
   */
  capabilities?: (() => NotificationSourceCapability[]) | undefined
  /** 事件源读取健康探针：桥接读源失败时置故障，读成功后恢复。 */
  initialFaultNote?: string
}

function toSourceEvent(event: DomainEventEnvelope): NotificationSourceEvent {
  return {
    id: event.id,
    eventName: event.eventName as NotificationEventName,
    projectId: event.projectId,
    object: { objectType: event.object.objectType, objectId: event.object.objectId },
    occurredAt: event.occurredAt,
    sensitive: event.sensitive === true,
    payload: event.payload,
  }
}

export class NotificationCommittedEventSource implements NotificationEventSubscriptionPort {
  private readonly handlers = new Map<NotificationEventName, NotificationEventHandler>()
  private readonly disposers = new Map<NotificationEventName, () => void>()
  private sourceFault: string | null

  constructor(private readonly options: NotificationEventSourceOptions) {
    this.sourceFault = options.initialFaultNote ?? '通知事件源尚未启动'
  }

  /** 供提交后消费桥接复用工厂注册的同一处理器。 */
  handlerFor(eventName: string): NotificationEventHandler | undefined {
    return this.handlers.get(eventName as NotificationEventName)
  }

  /** 读源成功：恢复健康（桥接每次成功读到待处理事件后调用）。 */
  noteSourceRecovered(): void {
    this.sourceFault = null
  }

  /** 读源故障：诚实降级，列表返回 UNAVAILABLE（不返回 total=0 冒充无通知）。 */
  noteSourceFault(note: string): void {
    this.sourceFault = note
  }

  health(): NotificationSourceHealth {
    const sourceCapabilities = this.capabilities()
    if (this.handlers.size === 0) {
      return { state: 'UNAVAILABLE', note: '通知事件订阅尚未注册', sourceCapabilities }
    }
    if (this.sourceFault) {
      return { state: 'UNAVAILABLE', note: this.sourceFault, sourceCapabilities }
    }
    return { state: 'AVAILABLE', note: null, sourceCapabilities }
  }

  subscribe(
    eventName: NotificationEventName,
    subscriberId: string,
    handler: NotificationEventHandler,
  ): () => void {
    const subscriber = this.options.subscriber
    if (!subscriber) {
      throw new Error('通知事件源未组装：#37 订阅端口缺失')
    }
    if (this.handlers.has(eventName)) {
      throw new Error(`通知对事件 ${eventName} 重复注册订阅`)
    }

    // 把返回值处理器适配成 #37 的 void 处理器：非 DELIVERED 视为未投递（抛错 → 派发结果 FAILED），
    // 绝不把 UNAVAILABLE 静默当成功。
    const wrapped: EventHandler = async (event) => {
      const result = await handler(toSourceEvent(event))
      if (result.state !== 'DELIVERED') {
        throw new Error(`通知未投递：${result.note}`)
      }
    }

    const disposeReal = subscriber.subscribe(eventName, subscriberId, wrapped)
    this.handlers.set(eventName, handler)
    this.disposers.set(eventName, disposeReal)
    // 订阅已真实注册 → 清除「未启动」故障标记；是否可用仍由 handlers / 读源故障决定。
    this.sourceFault = null

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.handlers.delete(eventName)
      this.disposers.delete(eventName)
      disposeReal()
    }
  }

  /** 测试 / 停机用：释放全部真实订阅。 */
  disposeAll(): void {
    for (const dispose of [...this.disposers.values()]) {
      try {
        dispose()
      } catch {
        // 释放失败：健康检查会因 handlers 清空而回报 UNAVAILABLE，不吞整体异常由调用方处理。
      }
    }
    this.handlers.clear()
    this.disposers.clear()
  }

  private capabilities(): NotificationSourceCapability[] {
    return this.options.capabilities?.() ?? []
  }
}

export function createNotificationEventSource(
  options: NotificationEventSourceOptions,
): NotificationCommittedEventSource {
  return new NotificationCommittedEventSource(options)
}
