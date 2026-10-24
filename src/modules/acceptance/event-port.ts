/**
 * 验收域事件端口适配器（ROLE-A 生产接线，GitHub #20）。
 *
 * 分层硬约束：本文件在**模块目录内**，不放在 `src/db/**`（禁止
 * `src/db/** → src/modules/**` 反向 import），也不让 shared import 业务模块。
 * 它只依赖 `src/shared/events.ts` 的公共信封与仓储端口，把域内草稿映射为
 * `DomainEventEnvelope`。
 *
 * 职责边界（与甘特域 `src/modules/gantt/event-port.ts`、风险域
 * `src/modules/risk/event-port.ts` 同构，口径逐条对齐）：
 *   - `id` / `storedAt` 由本适配器补齐（缺省 `randomUUID()` + `new Date().toISOString()`，
 *     可被测试的 `newId` / `now` 覆盖）；
 *   - `idempotencyKey` 按 `<eventName>:<objectId>:<occurredAt ISO>` 计算（见下）；
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
import type { AcceptanceEventDraft, AcceptanceEventPort } from './types.js'

/**
 * 接受调用方事务上下文的事件仓储（`PrismaEventRepository` 结构上满足）。
 *
 * 公共 `EventRepositoryPort.appendIfAbsent(event)` 是单参签名（D 的 service 不含事务
 * 语义）；域内需要把 `Prisma.TransactionClient` 传进去，故此处声明这个窄形状，避免让
 * 模块依赖具体实现类。`PrismaEventRepository.appendIfAbsent(event, db?)` 的参数更宽
 * （`EventDb`），方法参数双向协变，结构上可赋值。
 */
export type AcceptanceTransactionalEventRepository = {
  appendIfAbsent(
    event: DomainEventEnvelope,
    transaction: Prisma.TransactionClient,
  ): Promise<AppendEventResult>
}

export type AcceptanceEventPortOptions = {
  repository: AcceptanceTransactionalEventRepository
  /** 信封 `id` 生成器；缺省 `randomUUID`，测试可覆盖以断言确定性。 */
  newId?: () => string
  /** 信封 `storedAt` 生成器；缺省 `() => new Date()`，测试可覆盖。 */
  now?: () => Date
}

/**
 * 幂等键：**一律按更新类**（带 `occurredAt`）。
 *
 * ★ 为什么不按创建类：验收的对象是**任务**，而同一任务可以被
 *   「通过 → 驳回 → 重新提交 → 再通过」反复验收。若用 `<eventName>:<taskId>`，
 *   第二次同结论验收会命中既有幂等记录被永久去重 —— 通知就再也发不出去
 *   （这正是技术负责人 GitHub #20 评论 6358121473 对 `risk.level-raised` 指出的同一个坑）。
 *
 * 带 `occurredAt` 后每次验收各自成键；同毫秒内的同结论重验仍会被合法去重
 * （视为同一次，`src/shared/events.ts` 明示的可接受行为）。
 */
function idempotencyKeyOf(draft: AcceptanceEventDraft): string {
  return `${draft.eventName}:${draft.object.objectId}:${draft.occurredAt}`
}

export function createAcceptanceEventPort(
  options: AcceptanceEventPortOptions,
): AcceptanceEventPort {
  const newId = options.newId ?? randomUUID
  const now = options.now ?? (() => new Date())

  return {
    async publish(
      draft: AcceptanceEventDraft,
      transaction: Prisma.TransactionClient,
    ): Promise<void> {
      const input: PublishEventInput = { ...draft, idempotencyKey: idempotencyKeyOf(draft) }
      const event = buildDomainEventEnvelope(input, {
        id: newId(),
        storedAt: now().toISOString(),
      })
      await options.repository.appendIfAbsent(event, transaction)
    },
  }
}
