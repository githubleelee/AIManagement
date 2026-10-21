/**
 * 甘特域事件端口适配器（ROLE-B 生产接线）。
 *
 * 分层硬约束：本文件在**模块目录内**，不放在 `src/db/**`（禁止 `src/db/** → src/modules/**`
 * 反向 import），也不让 shared import 业务模块。它只依赖 `src/shared/events.ts` 的公共信封与
 * 仓储端口，把域内草稿映射为 `DomainEventEnvelope`。
 *
 * 职责边界：
 *   - `id` / `storedAt` 由本适配器补齐（缺省 `randomUUID()` + `new Date().toISOString()`，
 *     可被测试的 `newId` / `now` 覆盖）；
 *   - `idempotencyKey` 按 `src/shared/events.ts` 目录注释的确定性规则计算：
 *     创建 / 删除 → `<eventName>:<objectId>`；更新 → `<eventName>:<objectId>:<occurredAt ISO>`；
 *   - 通过 `repository.appendIfAbsent(event, transaction)` 追加到**调用方事务**，
 *     **不自行提交、不派发订阅者**。发布失败 = 业务写入回滚（同一事务）。
 */
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import {
  buildDomainEventEnvelope,
  type AppendEventResult,
  type DomainEventEnvelope,
  type PublishEventInput,
} from '../../shared/events.js'
import type { GanttEventDraft, GanttEventPort } from './types.js'

/**
 * 接受调用方事务上下文的事件仓储（`PrismaEventRepository` 结构上满足）。
 *
 * 公共 `EventRepositoryPort.appendIfAbsent(event)` 是单参签名（D 的 service 不含事务语义）；
 * 域内需要把 `Prisma.TransactionClient` 传进去，故此处声明这个窄形状，避免让模块依赖
 * 具体实现类。`PrismaEventRepository.appendIfAbsent(event, db?)` 的参数更宽（`EventDb`），
 * 方法参数双向协变，结构上可赋值。
 */
export type GanttTransactionalEventRepository = {
  appendIfAbsent(
    event: DomainEventEnvelope,
    transaction: Prisma.TransactionClient,
  ): Promise<AppendEventResult>
}

export type GanttEventPortOptions = {
  repository: GanttTransactionalEventRepository
  /** 信封 `id` 生成器；缺省 `randomUUID`，测试可覆盖以断言确定性。 */
  newId?: () => string
  /** 信封 `storedAt` 生成器；缺省 `() => new Date()`，测试可覆盖。 */
  now?: () => Date
}

/** 更新类事件（幂等键需带 `occurredAt`，见 shared 目录注释）。 */
const UPDATE_LIKE_EVENTS: ReadonlySet<GanttEventDraft['eventName']> = new Set([
  'gantt.milestone.updated',
])

/** 确定性幂等键：创建 / 删除无 `occurredAt`；更新带 `occurredAt`（同毫秒重复更新去重）。 */
function idempotencyKeyOf(draft: GanttEventDraft): string {
  const objectId = draft.object.objectId
  return UPDATE_LIKE_EVENTS.has(draft.eventName)
    ? `${draft.eventName}:${objectId}:${draft.occurredAt}`
    : `${draft.eventName}:${objectId}`
}

export function createGanttEventPort(options: GanttEventPortOptions): GanttEventPort {
  const newId = options.newId ?? randomUUID
  const now = options.now ?? (() => new Date())

  return {
    async publish(draft: GanttEventDraft, transaction: Prisma.TransactionClient): Promise<void> {
      const input: PublishEventInput = { ...draft, idempotencyKey: idempotencyKeyOf(draft) }
      const event = buildDomainEventEnvelope(input, {
        id: newId(),
        storedAt: now().toISOString(),
      })
      await options.repository.appendIfAbsent(event, transaction)
    },
  }
}
