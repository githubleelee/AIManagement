/**
 * #34 通知运行时组装（ROLE-B 单写）。
 *
 * 把公共存储仓储、权威接收者解析器、#37 订阅适配器、提交后消费桥接与定时生产点装配成
 * 一个运行时，供唯一组装点 `src/app.ts` 注入：D 的 `createNotificationModule` 消费模块
 * 本身**零改动**（禁止改 `src/modules/notification/**`）。
 *
 * 依据：`DECISIONS.md` `notifications.public-integration-and-scheduling`、
 *   `notifications.committed-consumption-and-query-contract`、`notifications.source-event-provenance`。
 *
 * 生命周期：
 *   - `start()`：注册九个真实订阅 → 首次启用（写激活记录 + 历史事件记 SKIPPED_BASELINE）
 *     → 启动提交后消费桥接与定时扫描（同实例不重叠、可重复 stop）；订阅注册失败即抛错，
 *     **不吞**整体异常。
 *   - `stop()`：停止桥接与定时扫描 → 释放全部真实订阅。可重复调用。
 *
 * `autoStartLoops`：是否自动启动后台定时器（桥接 2s / 定时扫描 10s）。`src/app.ts` 在
 *   测试环境（`NODE_ENV === 'test'`）关闭它，避免后台扫描污染其它模块的事件计数；
 *   生产与真实 HTTP 探测照常启动。关闭时仍会注册订阅与写激活记录，测试可显式调用
 *   `bridge.runOnce()` / `scheduler.runOnce()` 做确定性验证。
 */
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import {
  NOTIFICATION_EVENT_NAMES,
  type NotificationSourceCapability,
} from '../modules/notification/contracts.js'
import { createNotificationModule } from '../modules/notification/factory.js'
import type { DomainEventSubscriberPort } from '../shared/events.js'
import { PrismaNotificationRepository } from './notification-repository.js'
import { PrismaNotificationRecipientResolver } from './notification-recipient-resolver.js'
import { createNotificationEventSource, type NotificationCommittedEventSource } from './notification-event-source.js'
import {
  NOTIFICATION_CONSUMER_ID,
  PrismaNotificationConsumerStore,
} from './notification-consumer-store.js'
import { createNotificationBridge, type NotificationBridge } from './notification-bridge.js'
import { createNotificationScheduler, type NotificationScheduler, type ScheduledEventRepository } from './notification-scheduler.js'

/**
 * 未接入生产方的说明。已接入 = 真实生产方存在且本运行时已端到端验证：
 *   - `task.overdue` / `milestone.due`：B 自己的定时生产（调度未运行时降级 UNAVAILABLE）；
 *   - `risk.created`：A 的风险域真实生产（PR #95，同事务追加），已用真实事件 → 桥接 → 通知行
 *     → 顶栏面板端到端验证，故**不再保守声明**。
 * 其余（task.assigned/mentioned、acceptance.*、risk.level-raised）生产方尚未接入，保持 UNAVAILABLE，
 * 不伪造可用。
 */
const NOT_CONNECTED_NOTES: Record<string, string> = {
  'task.assigned': '任务域分配事件生产方尚未接入通知公共运行时',
  'task.mentioned': '@提及真实来源尚未接入（后置单向联调项）',
  'acceptance.submitted': '验收域事件生产方尚未接入通知公共运行时',
  'acceptance.approved': '验收域事件生产方尚未接入通知公共运行时',
  'acceptance.rejected': '验收域事件生产方尚未接入通知公共运行时',
  'risk.level-raised': '风险等级提升事件生产方尚未接入通知公共运行时',
}

/** 九个事件的来源接线清单（调度未运行时，B 自产的两个降级为 UNAVAILABLE）。 */
export function notificationSourceCapabilities(
  schedulerRunning: boolean,
): NotificationSourceCapability[] {
  return NOTIFICATION_EVENT_NAMES.map((eventName) => {
    if (eventName === 'task.overdue' || eventName === 'milestone.due') {
      return schedulerRunning
        ? { eventName, state: 'AVAILABLE' as const, note: null }
        : { eventName, state: 'UNAVAILABLE' as const, note: '通知定时生产尚未启动' }
    }
    if (eventName === 'risk.created') {
      // 真实生产方已在（A 的风险域，见 `events.notification-catalog-exceptions`）；
      // 本运行时已用真实事件跑通「已提交事件 → 桥接 → 通知行 → 顶栏面板」。
      return { eventName, state: 'AVAILABLE' as const, note: null }
    }
    return {
      eventName,
      state: 'UNAVAILABLE' as const,
      note: NOT_CONNECTED_NOTES[eventName] ?? '通知来源尚未接入',
    }
  })
}

export type NotificationRuntimeOptions = {
  prisma: PrismaClient
  /** #37 订阅端口（`app.events.subscriber`）。 */
  subscriber: DomainEventSubscriberPort
  /** 与 #37 基础设施共用的同一事件仓储实例（避免「查询看不到写入」的裂缝）。 */
  eventRepository: ScheduledEventRepository
  now?: () => Date
  createId?: () => string
  consumerId?: string
  batchSize?: number
  bridgeIntervalMs?: number
  schedulerIntervalMs?: number
  /** 是否自动启动后台定时器；测试环境传 false，改由测试显式 `runOnce()`。 */
  autoStartLoops?: boolean
  onError?: (error: unknown, scope: 'bridge' | 'scheduler') => void
}

export function createNotificationRuntime(options: NotificationRuntimeOptions) {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? randomUUID
  const consumerId = options.consumerId ?? NOTIFICATION_CONSUMER_ID
  const autoStartLoops = options.autoStartLoops ?? true
  let schedulerRunning = false

  const eventSource: NotificationCommittedEventSource = createNotificationEventSource({
    subscriber: options.subscriber,
    capabilities: () => notificationSourceCapabilities(schedulerRunning),
    initialFaultNote: '通知事件源尚未启动',
  })
  const repository = new PrismaNotificationRepository(options.prisma)
  const recipientResolver = new PrismaNotificationRecipientResolver(options.prisma)
  const module = createNotificationModule({
    repository,
    recipientResolver,
    eventSource,
    now,
    createId,
  })
  const store = new PrismaNotificationConsumerStore(options.prisma)
  const bridge: NotificationBridge = createNotificationBridge({
    store,
    eventSource,
    consumerId,
    batchSize: options.batchSize,
    intervalMs: options.bridgeIntervalMs,
    onError: (error) => options.onError?.(error, 'bridge'),
  })
  const scheduler: NotificationScheduler = createNotificationScheduler({
    prisma: options.prisma,
    repository: options.eventRepository,
    getActivatedDay: async () => (await store.getActivation(consumerId))?.activatedDay ?? null,
    now,
    newId: createId,
    intervalMs: options.schedulerIntervalMs,
    onError: (error) => options.onError?.(error, 'scheduler'),
  })

  return {
    module,
    repository,
    recipientResolver,
    eventSource,
    store,
    bridge,
    scheduler,
    async start(): Promise<void> {
      const health = module.start()
      if (health.state !== 'AVAILABLE') {
        // 订阅注册失败：回收已注册回调并显式抛错（不吞整体异常）。
        eventSource.disposeAll()
        throw new Error(`通知运行时启动失败：${health.note}`)
      }
      // 首次启用：写激活记录 + 把既有支持事件记为 SKIPPED_BASELINE（重启不重置）。
      await store.ensureActivated(consumerId, now())
      if (autoStartLoops) {
        schedulerRunning = true
        bridge.start()
        scheduler.start()
      }
    },
    async stop(): Promise<void> {
      scheduler.stop()
      schedulerRunning = false
      bridge.stop()
      module.stop()
      eventSource.disposeAll()
    },
  }
}

export type NotificationRuntime = ReturnType<typeof createNotificationRuntime>
