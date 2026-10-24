/**
 * #34 通知运行时 —— B 自己的真实定时生产点（ROLE-B 单写）。
 *
 * 依据 `DECISIONS.md` `notifications.public-integration-and-scheduling`：
 *   - `task.overdue`：`planEnd` 次日 00:00 Asia/Shanghai 仍**非 CLOSED**（含 DONE）即逾期；
 *     `occurredAt` = 条件成立时间（planEnd 次日 00:00），**不是**扫描时刻；启动补扫当前
 *     已逾期非 CLOSED 任务；每 10 秒扫描；同实例不重叠；关闭停止。
 *   - `milestone.due`：`dueDate` 当日 09:00 Asia/Shanghai；首次只补**启用当日**已到点节点，
 *     之后补**启用日及之后**已到点节点，**不补**启用日前的旧节点（启用日持久化在
 *     `NotificationConsumer.activatedDay`）。
 *
 * 事件写入复用 `src/db/event-repository.ts`（`appendIfAbsent`），在**调用方事务**内落库、
 * 失败回滚；幂等键确定性：`task.overdue:<taskId>:<planEnd>` / `milestone.due:<milestoneId>:<dueDate>`
 * —— 把「计划的截止/到期日」纳入键，使改期后能产生新事件（与服务层逾期去重按 planEnd 对齐）。
 * 由提交后消费桥接生成通知；**不**把里程碑 CRUD 当到期提醒。
 */
import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  buildDomainEventEnvelope,
  type AppendEventResult,
  type DomainEventEnvelope,
  type PublishEventInput,
} from '../shared/events.js'
import { shanghaiDay, shanghaiNextMidnight, shanghaiTimeOnDay } from './notification-time.js'

const SYSTEM_COMPONENT = 'notification-scheduler'

/** 接受调用方事务上下文的事件仓储窄形状（`PrismaEventRepository` 结构上满足）。 */
export type ScheduledEventRepository = {
  appendIfAbsent(
    event: DomainEventEnvelope,
    transaction: Prisma.TransactionClient,
  ): Promise<AppendEventResult>
}

export type NotificationSchedulerOptions = {
  prisma: PrismaClient
  repository: ScheduledEventRepository
  /** 启用日 `'YYYY-MM-DD'`（Asia/Shanghai）；未激活时返回 null → 里程碑不补扫。 */
  getActivatedDay: () => Promise<string | null>
  now?: () => Date
  newId?: () => string
  intervalMs?: number
  onError?: (error: unknown) => void
}

export type NotificationScheduler = {
  runOnce: () => Promise<void>
  start: () => void
  stop: () => void
}

/** `task.overdue` 确定性幂等键：把 planEnd 纳入，改期后可再发。 */
export function overdueIdempotencyKey(taskId: string, planEnd: string): string {
  return `task.overdue:${taskId}:${planEnd}`
}

/** `milestone.due` 确定性幂等键：把 dueDate 纳入，改期后可再发。 */
export function milestoneDueIdempotencyKey(milestoneId: string, dueDate: string): string {
  return `milestone.due:${milestoneId}:${dueDate}`
}

export function createNotificationScheduler(
  options: NotificationSchedulerOptions,
): NotificationScheduler {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? randomUUID
  const intervalMs = options.intervalMs ?? 10_000
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false

  async function produceOverdue(at: Date): Promise<void> {
    const today = shanghaiDay(at)
    const tasks = await options.prisma.task.findMany({
      // planEnd 是 'YYYY-MM-DD'（文本）→ 与上海自然日做字典序比较（ISO 日期安全）。
      where: { status: { not: 'CLOSED' }, planEnd: { lt: today } },
      select: { id: true, projectId: true, planEnd: true, isSensitive: true },
    })
    for (const task of tasks) {
      // 条件成立时间：planEnd 次日 00:00 Asia/Shanghai（停机补扫时也必须回到该时刻）。
      const occurredAt = shanghaiNextMidnight(task.planEnd)
      const base = {
        eventName: 'task.overdue' as const,
        projectId: task.projectId,
        object: { objectType: 'task', objectId: task.id },
        actor: { kind: 'SYSTEM' as const, component: SYSTEM_COMPONENT },
        occurredAt: occurredAt.toISOString(),
        idempotencyKey: overdueIdempotencyKey(task.id, task.planEnd),
      }
      const input: PublishEventInput = task.isSensitive
        ? { ...base, sensitive: true, payload: { references: [{ objectType: 'task', objectId: task.id }] } }
        : { ...base, sensitive: false, payload: { planEnd: task.planEnd } }
      await appendInTransaction(input)
    }
  }

  async function produceMilestones(at: Date): Promise<void> {
    const activatedDay = await options.getActivatedDay()
    if (!activatedDay) return
    const today = shanghaiDay(at)
    const milestones = await options.prisma.milestone.findMany({
      // 下界 = 启用日（不补启用日前旧节点）；上界 = 今天。
      where: { dueDate: { gte: activatedDay, lte: today } },
      select: { id: true, projectId: true, name: true, dueDate: true },
    })
    for (const milestone of milestones) {
      const dueMoment = shanghaiTimeOnDay(milestone.dueDate, '09:00')
      if (at.getTime() < dueMoment.getTime()) continue
      const links = await options.prisma.taskMilestone.findMany({
        where: { milestoneId: milestone.id },
        select: { task: { select: { id: true, isSensitive: true } } },
      })
      const sensitive = links.some((link) => link.task.isSensitive)
      const references = links.map((link) => ({ objectType: 'task', objectId: link.task.id }))
      const base = {
        eventName: 'milestone.due' as const,
        projectId: milestone.projectId,
        object: { objectType: 'milestone', objectId: milestone.id },
        actor: { kind: 'SYSTEM' as const, component: SYSTEM_COMPONENT },
        occurredAt: dueMoment.toISOString(),
        idempotencyKey: milestoneDueIdempotencyKey(milestone.id, milestone.dueDate),
      }
      const input: PublishEventInput = sensitive
        ? { ...base, sensitive: true, payload: { references } }
        : { ...base, sensitive: false, payload: { name: milestone.name, dueDate: milestone.dueDate } }
      await appendInTransaction(input)
    }
  }

  async function appendInTransaction(input: PublishEventInput): Promise<void> {
    const envelope = buildDomainEventEnvelope(input, { id: newId(), storedAt: now().toISOString() })
    await options.prisma.$transaction(async (tx) => {
      await options.repository.appendIfAbsent(envelope, tx)
    })
  }

  async function runOnce(): Promise<void> {
    if (running) return
    running = true
    try {
      const at = now()
      await produceOverdue(at)
      await produceMilestones(at)
    } catch (error) {
      options.onError?.(error)
    } finally {
      running = false
    }
  }

  return {
    runOnce,
    start(): void {
      if (timer) return
      // 启动补扫：立即跑一次，再进入周期性扫描。
      void runOnce()
      timer = setInterval(() => {
        void runOnce()
      }, intervalMs)
      timer.unref?.()
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
