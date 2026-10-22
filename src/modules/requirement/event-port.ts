/**
 * 需求域事件端口适配器（ROLE-B 生产接线）。
 *
 * 分层硬约束：本文件在**模块目录内**（禁止 `src/db/** → src/modules/**` 反向 import）。
 * 只依赖 `src/shared/events.ts` 的公共信封与仓储端口，把 `updateUserStory` 的域内事件
 * 映射为 `DomainEventEnvelope`。
 *
 * 职责边界：
 *   - `id` / `storedAt` 由本适配器补齐（缺省 `randomUUID()` + `new Date().toISOString()`，
 *     测试可覆盖 `newId` / `now`）；
 *   - `idempotencyKey` 确定性计算：`requirement.story.status-changed:<storyId>:<occurredAt>`；
 *     同一毫秒的同对象状态变更会去重（有意：同毫秒同动作视为同一次）；
 *   - 通过 `repository.appendIfAbsent(event, transaction)` 追加到**调用方事务**，
 *     **不自行提交、不派发订阅者**；发布失败 = 业务写入回滚。
 */
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import {
  buildDomainEventEnvelope,
  type AppendEventResult,
  type DomainEventEnvelope,
  type PublishEventInput,
} from '../../shared/events.js'
import type {
  RequirementEventPort,
  RequirementStoryStatusChangedEvent,
} from './service.js'

/** 接受调用方事务上下文的事件仓储（`PrismaEventRepository` 结构上满足）。 */
export type RequirementTransactionalEventRepository = {
  appendIfAbsent(
    event: DomainEventEnvelope,
    transaction: Prisma.TransactionClient,
  ): Promise<AppendEventResult>
}

export type RequirementEventPortOptions = {
  repository: RequirementTransactionalEventRepository
  /** 信封 `id` 生成器；缺省 `randomUUID`，测试可覆盖以断言确定性。 */
  newId?: () => string
  /** 信封 `storedAt` 生成器；缺省 `() => new Date()`，测试可覆盖。 */
  now?: () => Date
}

/** 需求域唯一事件名（登记于 `src/shared/events.ts` 的「业务域事件目录」）。 */
const STORY_STATUS_CHANGED = 'requirement.story.status-changed' as const

export function createRequirementEventPort(
  options: RequirementEventPortOptions,
): RequirementEventPort {
  const newId = options.newId ?? randomUUID
  const now = options.now ?? (() => new Date())

  return {
    async publishStoryStatusChanged(
      event: RequirementStoryStatusChangedEvent,
    ): Promise<void> {
      const object = { objectType: 'story', objectId: event.storyId }
      const base = {
        eventName: STORY_STATUS_CHANGED,
        projectId: event.projectId,
        object,
        actor: { kind: 'USER', userId: event.actorUserId },
        occurredAt: event.occurredAt,
        idempotencyKey: `${STORY_STATUS_CHANGED}:${event.storyId}:${event.occurredAt}`,
      } as const

      // 敏感事件载荷只能是 references；非敏感载荷只含状态 {from, to}。
      const input: PublishEventInput = event.sensitive
        ? { ...base, sensitive: true, payload: { references: [object] } }
        : {
            ...base,
            sensitive: false,
            payload: { from: event.before, to: event.after },
          }

      const envelope = buildDomainEventEnvelope(input, {
        id: newId(),
        storedAt: now().toISOString(),
      })
      await options.repository.appendIfAbsent(envelope, event.transaction)
    },
  }
}
