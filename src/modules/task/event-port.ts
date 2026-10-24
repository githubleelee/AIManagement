/**
 * 任务域事件端口（#34 站内通知的两处生产点）。
 *
 * ===========================================================================
 * 为什么任务域此前没有事件通道
 * ===========================================================================
 *
 * 甘特 / 需求 / 风险 / 验收四域都已有各自的 `event-port.ts`，唯独任务域没有。
 * #34 的九类通知里 `task.assigned` 与 `acceptance.submitted` 因此长期停在
 * "生产方尚未接入"（`src/db/notification-runtime.ts` 的 UNAVAILABLE 清单）。
 * 本文件补齐这条通道；形状与其它四域逐条对齐，便于统一复核。
 *
 * ===========================================================================
 * 两个事件的口径（依据 #34 票面的两处要求）
 * ===========================================================================
 *
 * - `task.assigned`：**真实创建分配**或**负责人实际变化**时，在原业务写事务内追加；
 *   **同值不发**（把 owner 写成原值不产生事件）。
 * - `acceptance.submitted`：任务**真实进入 `DONE`**（提交验收）时追加；
 *   **重复设置 `DONE` 不重复发**。该事件只表示"提交了验收"，
 *   验收**结果**（通过 / 驳回）由验收域的 `acceptance.approved` / `acceptance.rejected` 表达，
 *   两者不互相冒充。
 *
 * ### 幂等键：一律"按发生次"（键含 `occurredAt`）
 *
 * 两个事件都**不能**按对象永久去重：
 *   - 同一任务可以被改派多次（每次都是真实的分配变化）；
 *   - 同一任务可以被驳回后重新提交 `DONE`（每次都是真实的提交）。
 * 若按 `<eventName>:<taskId>` 计，第二次真实发生会被静默吞掉 —— 这正是
 * `risk.level-raised` 当年踩过的坑（技术负责人 GitHub #20 评论 6358121473）。
 * 因此本适配器对两个事件统一使用 `<eventName>:<objectId>:<occurredAt ISO>`。
 *
 * ### 敏感规则（契约 I-6）
 *
 * 任务 `isSensitive` 为真时，载荷**只能**是 `{references}`：任务标题 / 描述 / 阻塞原因
 * 等一律不进载荷。敏感标记必须在**同一事务内**读取，否则会与并发的敏感开关产生
 * "事件敏感度落后于实际"的窗口。
 *
 * ### 同事务语义
 *
 * 必须在业务写入的**同一个 `$transaction` 内**调用（`transaction` 即该事务的 `tx`）；
 * 适配器只把事件追加到该事务，**不自行提交、不派发订阅者**。
 * 发布失败 = 业务写入回滚（宁可业务失败，也不产生"业务成功但通知丢失"）。
 *
 * 收件人**不进载荷**：由通知公共运行时按 `Task.ownerUserId` / `acceptorUserId`
 * 现查并做可见性筛选，不信任 payload 自报的收件人。
 */
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import {
  buildDomainEventEnvelope,
  type AppendEventResult,
  type DomainEventEnvelope,
  type EventActor,
  type EventObjectRef,
  type JsonObject,
  type PublishEventInput,
} from '../../shared/events.js'

/** 任务域事件名（命名规范 `<domain>.<object>.<action>`，与 #34 的九名目录一致）。 */
export type TaskEventName = 'task.assigned' | 'acceptance.submitted'

/**
 * 域内事件草稿：**不含** `id` / `schemaVersion` / `storedAt` / `idempotencyKey`，
 * 后四者由适配器补齐。
 */
type TaskEventDraftBase = {
  eventName: TaskEventName
  projectId: string
  object: EventObjectRef
  actor: EventActor
  /** ISO 8601 UTC（带毫秒，`…Z`）。 */
  occurredAt: string
}

export type TaskEventDraft =
  | (TaskEventDraftBase & { sensitive: false; payload: JsonObject })
  | (TaskEventDraftBase & { sensitive: true; payload: { references: EventObjectRef[] } })

/** 接受调用方事务上下文的事件仓储（`PrismaEventRepository` 结构上满足）。 */
export type TaskTransactionalEventRepository = {
  appendIfAbsent(
    event: DomainEventEnvelope,
    transaction: Prisma.TransactionClient,
  ): Promise<AppendEventResult>
}

export type TaskEventPortOptions = {
  repository: TaskTransactionalEventRepository
  /** 信封 `id` 生成器；缺省 `randomUUID`，测试可覆盖以断言确定性。 */
  newId?: () => string
  /** 信封 `storedAt` 生成器；缺省 `() => new Date()`，测试可覆盖。 */
  now?: () => Date
}

/** 任务域业务事件的发布端口（由 `src/app.ts` 组装注入 `RouteContext.taskEvents`）。 */
export type TaskEventPort = {
  publish(event: TaskEventDraft, transaction: Prisma.TransactionClient): Promise<void>
}

/**
 * 确定性幂等键：**两个事件一律按发生次**（含 `occurredAt`）。
 *
 * 见文件头说明：改派与重新提交都是可重复发生的真实业务动作，按对象永久去重会吞掉第二次。
 * 同一毫秒内的同事件仍会被合法去重（视为同一次，`src/shared/events.ts` 明示的可接受行为）。
 */
function idempotencyKeyOf(draft: TaskEventDraft): string {
  return `${draft.eventName}:${draft.object.objectId}:${draft.occurredAt}`
}

export function createTaskEventPort(options: TaskEventPortOptions): TaskEventPort {
  const newId = options.newId ?? randomUUID
  const now = options.now ?? (() => new Date())

  return {
    async publish(
      draft: TaskEventDraft,
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
