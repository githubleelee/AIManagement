/**
 * #34 通知运行时 —— 消费激活记录与持久消费账本（ROLE-B 单写）。
 *
 * 依据 `DECISIONS.md` `notifications.committed-consumption-and-query-contract`：
 *   - **首次启用**在同一事务写激活记录（`NotificationConsumer`），并把当时已存在的
 *     支持事件在账本里记为 `SKIPPED_BASELINE`（不群发旧通知、重启不重置基线）；
 *   - 以 `(consumerId, eventId)` 的**持久账本**判断是否完成，而不是靠 `storedAt` / `id` 水位；
 *   - 只有处理器返回 `DELIVERED` 才落账本；`UNAVAILABLE` / 异常**不落**，因此可重试
 *     （至少一次尝试 + 幂等，无 outbox / 不外部队列）。
 *
 * 内部扫描（`readPending`）**不复用**带 `projectId` / actor 限制的用户 query 端口：
 * 它是系统消费者，按支持事件名分批读取已提交事件，可见性在通知写入与查询层另行处理。
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { NOTIFICATION_EVENT_NAMES } from '../modules/notification/contracts.js'
import type { EventObjectRef, JsonObject } from '../shared/events.js'
import { shanghaiDay } from './notification-time.js'

/** 通知已在 root 组装里使用的唯一消费者标识。 */
export const NOTIFICATION_CONSUMER_ID = 'notification-committed-events'

export type NotificationConsumerActivation = {
  consumerId: string
  activatedAt: string
  /** 启用日 `'YYYY-MM-DD'`（Asia/Shanghai），兼作里程碑补扫下界。 */
  activatedDay: string
}

type PendingEventRow = {
  id: string
  eventName: string
  projectId: string
  objectType: string
  objectId: string
  occurredAt: Date | string
  sensitive: boolean
  payload: unknown
}

/** 系统读取器交给通知处理器的只读事件（与 `NotificationSourceEvent` 结构一致）。 */
export type PendingNotificationEvent = {
  id: string
  eventName: string
  projectId: string
  object: EventObjectRef
  occurredAt: string
  sensitive: boolean
  payload: unknown
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toPayload(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null
}

export class PrismaNotificationConsumerStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 首次启用：事务内写激活记录 + 把已存在的支持事件登记为 `SKIPPED_BASELINE`。
   * 已激活则原样返回既有记录（重启不重置基线、不重复写）。
   */
  async ensureActivated(
    consumerId: string,
    activatedAt: Date,
  ): Promise<NotificationConsumerActivation> {
    const activatedDay = shanghaiDay(activatedAt)
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.notificationConsumer.findUnique({ where: { consumerId } })
      if (existing) {
        return {
          consumerId,
          activatedAt: existing.activatedAt.toISOString(),
          activatedDay: existing.activatedDay,
        }
      }
      await tx.notificationConsumer.create({ data: { consumerId, activatedAt, activatedDay } })

      // 基线：当时**已存在**的支持事件全部记为 SKIPPED_BASELINE（不自动群发旧通知）。
      const existingEvents = await tx.domainEvent.findMany({
        where: { eventName: { in: [...NOTIFICATION_EVENT_NAMES] } },
        select: { id: true },
      })
      if (existingEvents.length > 0) {
        await tx.notificationConsumption.createMany({
          data: existingEvents.map((event) => ({
            consumerId,
            eventId: event.id,
            status: 'SKIPPED_BASELINE',
          })),
        })
      }
      return { consumerId, activatedAt: activatedAt.toISOString(), activatedDay }
    })
  }

  async getActivation(consumerId: string): Promise<NotificationConsumerActivation | null> {
    const row = await this.prisma.notificationConsumer.findUnique({ where: { consumerId } })
    if (!row) return null
    return {
      consumerId: row.consumerId,
      activatedAt: row.activatedAt.toISOString(),
      activatedDay: row.activatedDay,
    }
  }

  /**
   * 分批读取**已提交且尚未入账本**的支持事件（最早优先）。
   * 单次一条 SQL；不按 `projectId` / actor 过滤（系统消费者）。
   */
  async readPending(consumerId: string, limit: number): Promise<PendingNotificationEvent[]> {
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)))
    const rows = await this.prisma.$queryRaw<PendingEventRow[]>(Prisma.sql`
      SELECT e."id", e."eventName", e."projectId", e."objectType", e."objectId",
             e."occurredAt", e."sensitive", e."payload"
      FROM "DomainEvent" e
      WHERE e."eventName" IN (${Prisma.join([...NOTIFICATION_EVENT_NAMES])})
        AND NOT EXISTS (
          SELECT 1 FROM "NotificationConsumption" l
          WHERE l."consumerId" = ${consumerId} AND l."eventId" = e."id"
        )
      ORDER BY e."storedAt" ASC, e."id" ASC
      LIMIT ${bounded}
    `)
    return rows.map((row) => ({
      id: row.id,
      eventName: row.eventName,
      projectId: row.projectId,
      object: { objectType: row.objectType, objectId: row.objectId },
      occurredAt: toIso(row.occurredAt),
      sensitive: row.sensitive === true,
      payload: toPayload(row.payload) as JsonObject | { references: EventObjectRef[] },
    }))
  }

  /** 仅处理器返回 `DELIVERED` 时调用；并发重复入账由复合主键兜底（`P2002` 视为已完成）。 */
  async markDelivered(consumerId: string, eventId: string, note?: string): Promise<void> {
    try {
      await this.prisma.notificationConsumption.create({
        data: { consumerId, eventId, status: 'DELIVERED', note: note ?? null },
      })
    } catch (error) {
      if (prismaErrorCode(error) !== 'P2002') throw error
    }
  }
}
