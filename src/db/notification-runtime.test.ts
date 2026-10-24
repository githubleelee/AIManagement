/**
 * #34 通知公共运行时测试（ROLE-B）—— 真实 SQLite 临时库（`mkdtemp` 隔离，绝不碰项目 `var/`）。
 *
 * 覆盖本批任务的硬边界：
 *   - 查询级可见性：撤权 / 解绑 / 删除后仍隐藏；伪造来源 fail-closed；越权与不存在同形；
 *   - 同一快照的 total / unreadCount / limit / truncated；
 *   - 持久消费账本：幂等、安全重放、UNAVAILABLE 不确认、单条失败不阻塞后续；
 *   - 首次启用基线 SKIPPED_BASELINE（重启不重置）；
 *   - 健康降级（读源故障 → UNAVAILABLE，恢复 → AVAILABLE）；
 *   - 定时生产 `task.overdue` / `milestone.due` 的去重与补扫边界、occurredAt = 条件成立时间；
 *   - `latencyMs` 保留原始负值（不归零伪装达标）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  buildDomainEventEnvelope,
  type DomainEventSubscriberPort,
  type PublishEventInput,
} from '../shared/events.js'
import type {
  NotificationEventName,
  NotificationRecord,
  NotificationSourceEvent,
} from '../modules/notification/contracts.js'
import { createTempDatabase, resetDatabase, type TestDatabase } from './test-support.js'
import { PrismaEventRepository } from './event-repository.js'
import { PrismaNotificationRepository } from './notification-repository.js'
import {
  NOTIFICATION_CONSUMER_ID,
  PrismaNotificationConsumerStore,
} from './notification-consumer-store.js'
import { createNotificationBridge } from './notification-bridge.js'
import { createNotificationScheduler } from './notification-scheduler.js'
import { createNotificationRuntime } from './notification-runtime.js'

let db: TestDatabase
let prisma: PrismaClient
let eventRepository: PrismaEventRepository

beforeAll(() => {
  db = createTempDatabase()
  prisma = db.prisma
  eventRepository = new PrismaEventRepository(prisma)
}, 120_000)

afterAll(async () => {
  await db.dispose()
})

beforeEach(async () => {
  await resetDatabase(prisma)
})

let seq = 0
function unique(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

const fakeSubscriber: DomainEventSubscriberPort = { subscribe: () => () => undefined }

// ---------------------------------------------------------------------------
// 种子
// ---------------------------------------------------------------------------

async function makeUser(account = unique('user')) {
  return prisma.user.create({ data: { account, displayName: account, passwordHash: 'hash' } })
}

type Graph = {
  pm: string
  member: string
  outsider: string
  projectId: string
  storyId: string
  taskId: string
  milestoneId: string
}

async function seedGraph(): Promise<Graph> {
  const pm = await makeUser(unique('pm'))
  const member = await makeUser(unique('member'))
  const outsider = await makeUser(unique('outsider'))
  const project = await prisma.project.create({
    data: {
      name: unique('project'),
      ownerUserId: pm.id,
      members: { create: [{ userId: pm.id, role: 'PM' }, { userId: member.id, role: 'MEMBER' }] },
    },
  })
  const goal = await prisma.businessGoal.create({
    data: { projectId: project.id, name: unique('goal'), sortOrder: 1 },
  })
  const activity = await prisma.userActivity.create({
    data: { projectId: project.id, goalId: goal.id, name: unique('activity'), sortOrder: 1 },
  })
  const story = await prisma.userStory.create({
    data: {
      projectId: project.id,
      activityId: activity.id,
      title: unique('story'),
      roleText: 'r',
      capabilityText: 'c',
      valueText: 'v',
      businessValue: 'HIGH',
      priority: 'HIGH',
    },
  })
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      storyId: story.id,
      title: unique('task'),
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      planStart: '2026-10-01',
      planEnd: '2027-01-01',
    },
  })
  const milestone = await prisma.milestone.create({
    data: { projectId: project.id, name: unique('milestone'), dueDate: '2027-01-01', ownerUserId: member.id },
  })
  return {
    pm: pm.id,
    member: member.id,
    outsider: outsider.id,
    projectId: project.id,
    storyId: story.id,
    taskId: task.id,
    milestoneId: milestone.id,
  }
}

async function makeRisk(g: Graph, ownerUserId?: string): Promise<string> {
  const risk = await prisma.risk.create({
    data: { projectId: g.projectId, title: unique('risk'), level: 'HIGH', ownerUserId: ownerUserId ?? g.member },
  })
  return risk.id
}

async function appendEvent(input: PublishEventInput) {
  const envelope = buildDomainEventEnvelope(input, {
    id: randomUUID(),
    storedAt: new Date().toISOString(),
  })
  const result = await eventRepository.appendIfAbsent(envelope)
  return result.event
}

function baseEventInput(
  eventName: NotificationEventName,
  projectId: string,
  object: { objectType: string; objectId: string },
  extra: Partial<PublishEventInput> = {},
): PublishEventInput {
  return {
    eventName,
    projectId,
    object,
    actor: { kind: 'SYSTEM', component: 'test' },
    occurredAt: '2026-10-23T10:00:00.000Z',
    idempotencyKey: `${eventName}:${object.objectId}:${randomUUID()}`,
    sensitive: false,
    payload: {},
    ...extra,
  } as PublishEventInput
}

function recordFor(
  event: { id: string; eventName: string; projectId: string; object: { objectType: string; objectId: string } },
  recipientUserId: string,
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
  return {
    id: randomUUID(),
    projectId: event.projectId,
    recipientUserId,
    type: 'RISK_ALERT',
    sourceEventId: event.id,
    sourceEventName: event.eventName as NotificationEventName,
    dedupeKey: `${event.id}:${recipientUserId}:${randomUUID()}`,
    reference: { objectType: event.object.objectType, objectId: event.object.objectId },
    content: { kind: 'REFERENCE_ONLY', title: null, summary: null },
    sensitive: false,
    occurredAt: '2026-10-23T10:00:00.000Z',
    storedAt: new Date().toISOString(),
    latencyMs: 1000,
    withinDeliveryTarget: true,
    isRead: false,
    readAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 查询级可见性
// ---------------------------------------------------------------------------

describe('通知查询层可见性（契约 I-6 / source-event-provenance）', () => {
  it('收件人可见；非收件人 / 非成员 / 不存在的 id 一律 null（同形）', async () => {
    const g = await seedGraph()
    const riskId = await makeRisk(g)
    const event = await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: riskId }))
    const repository = new PrismaNotificationRepository(prisma)
    const created = await repository.appendIfAbsent(recordFor(event, g.member))

    expect(await repository.findById(created.record.id, g.member)).not.toBeNull()
    // 非收件人成员 / 非成员 / 不存在的 id：同一 null，不泄漏存在性。
    expect(await repository.findById(created.record.id, g.pm)).toBeNull()
    expect(await repository.findById(created.record.id, g.outsider)).toBeNull()
    expect(await repository.findById('does-not-exist', g.member)).toBeNull()
    expect(await repository.findAccessMetadata(created.record.id, g.member)).toMatchObject({
      recipientUserId: g.member,
    })
    expect(await repository.findAccessMetadata(created.record.id, g.outsider)).toBeNull()
    expect(await repository.markRead(created.record.id, g.outsider, new Date().toISOString())).toBeNull()
    expect(await repository.markRead('does-not-exist', g.member, new Date().toISOString())).toBeNull()
  })

  it('敏感事件的 payload.references 任一不可见 → 整条隐藏；白名单后可见；撤权后再隐藏', async () => {
    const g = await seedGraph()
    await prisma.task.update({ where: { id: g.taskId }, data: { isSensitive: true } })
    const riskId = await makeRisk(g)
    const event = await appendEvent(
      baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: riskId }, {
        sensitive: true,
        payload: { references: [{ objectType: 'task', objectId: g.taskId }] },
      } as Partial<PublishEventInput>),
    )
    const repository = new PrismaNotificationRepository(prisma)
    const created = await repository.appendIfAbsent(recordFor(event, g.member, { sensitive: true }))
    const pmNotification = await repository.appendIfAbsent(
      recordFor(event, g.pm, { sensitive: true, dedupeKey: `pm-${event.id}` }),
    )

    // 成员不在敏感白名单 → 隐藏；发给 PM 的同源通知恒可见。
    expect(await repository.findById(created.record.id, g.member)).toBeNull()
    expect(await repository.findById(pmNotification.record.id, g.pm)).not.toBeNull()

    // 加入白名单 → 可见。
    await prisma.objectVisibility.create({
      data: { projectId: g.projectId, objectType: 'task', objectId: g.taskId, userId: g.member },
    })
    expect(await repository.findById(created.record.id, g.member)).not.toBeNull()

    // 撤权（删白名单）→ 再次隐藏。
    await prisma.objectVisibility.deleteMany({ where: { objectId: g.taskId, userId: g.member } })
    expect(await repository.findById(created.record.id, g.member)).toBeNull()
  })

  it('删除被引用的任务后旧通知仍隐藏（当前业务关联 fail-closed）', async () => {
    const g = await seedGraph()
    const event = await appendEvent(baseEventInput('task.assigned', g.projectId, { objectType: 'task', objectId: g.taskId }))
    const repository = new PrismaNotificationRepository(prisma)
    const created = await repository.appendIfAbsent(recordFor(event, g.member, { reference: { objectType: 'task', objectId: g.taskId } }))
    expect(await repository.findById(created.record.id, g.member)).not.toBeNull()

    await prisma.task.delete({ where: { id: g.taskId } })
    expect(await repository.findById(created.record.id, g.member)).toBeNull()
  })

  it('伪造来源归属（sourceEvent 的 object 与通知不一致）→ fail-closed 隐藏', async () => {
    const g = await seedGraph()
    const riskA = await makeRisk(g)
    const riskB = await makeRisk(g)
    const event = await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: riskA }))
    // 绕过仓储校验，直写一条归属不一致的通知行（模拟伪造 / 损坏来源）。
    const forged = await prisma.notification.create({
      data: {
        projectId: g.projectId,
        recipientUserId: g.member,
        type: 'RISK_ALERT',
        sourceEventId: event.id,
        sourceEventName: event.eventName,
        dedupeKey: unique('forged'),
        referenceObjectType: 'risk',
        referenceObjectId: riskB,
        contentKind: 'REFERENCE_ONLY',
        sensitive: false,
        occurredAt: new Date('2026-10-23T10:00:00.000Z'),
        storedAt: new Date(),
        latencyMs: 0,
        withinDeliveryTarget: true,
      },
    })
    const repository = new PrismaNotificationRepository(prisma)
    expect(await repository.findById(forged.id, g.member)).toBeNull()
  })

  it('风险当前关联任务敏感且未授权 → 隐藏；仅解绑 taskId 但敏感事件引用仍在 → 仍隐藏', async () => {
    const g = await seedGraph()
    await prisma.task.update({ where: { id: g.taskId }, data: { isSensitive: true } })
    const risk = await prisma.risk.create({
      data: { projectId: g.projectId, title: 'R', level: 'HIGH', ownerUserId: g.member, taskId: g.taskId },
    })
    const event = await appendEvent(
      baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: risk.id }, {
        sensitive: true,
        payload: { references: [{ objectType: 'task', objectId: g.taskId }] },
      } as Partial<PublishEventInput>),
    )
    const repository = new PrismaNotificationRepository(prisma)
    const created = await repository.appendIfAbsent(recordFor(event, g.member, { sensitive: true }))
    expect(await repository.findById(created.record.id, g.member)).toBeNull()

    // 解绑 taskId：当前关联不再受限，但敏感事件的 payload.references 仍含敏感任务 → 仍隐藏。
    await prisma.risk.update({ where: { id: risk.id }, data: { taskId: null } })
    expect(await repository.findById(created.record.id, g.member)).toBeNull()

    // 授权该任务后才可见。
    await prisma.objectVisibility.create({
      data: { projectId: g.projectId, objectType: 'task', objectId: g.taskId, userId: g.member },
    })
    expect(await repository.findById(created.record.id, g.member)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 一次快照
// ---------------------------------------------------------------------------

describe('listByRecipient 同一快照', () => {
  it('total / unreadCount / limit / truncated 语义正确且跨收件人隔离', async () => {
    const g = await seedGraph()
    const repository = new PrismaNotificationRepository(prisma)
    const riskId = await makeRisk(g)
    const event = await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: riskId }))
    const other = await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: await makeRisk(g, g.pm) }))

    for (let i = 0; i < 3; i++) {
      await repository.appendIfAbsent(recordFor(event, g.member, { dedupeKey: `m-${i}` }))
    }
    await repository.appendIfAbsent(recordFor(other, g.pm, { dedupeKey: 'pm-0' }))

    const first = await repository.findById(
      (await repository.listByRecipient(g.member, false, 200)).items[0]!.id,
      g.member,
    )
    await repository.markRead(first!.id, g.member, new Date().toISOString())

    const snapshot = await repository.listByRecipient(g.member, false, 200)
    expect(snapshot).toMatchObject({ total: 3, unreadCount: 2, limit: 200, truncated: false })
    const unreadOnly = await repository.listByRecipient(g.member, true, 200)
    expect(unreadOnly).toMatchObject({ total: 2, unreadCount: 2, truncated: false })

    const limited = await repository.listByRecipient(g.member, false, 2)
    expect(limited).toMatchObject({ total: 3, limit: 2, truncated: true })
    expect(limited.items).toHaveLength(2)

    // PM 的通知不计入成员。
    expect(await repository.listByRecipient(g.pm, false, 200)).toMatchObject({ total: 1 })
  })

  it('latencyMs 保留原始负值（不归零伪装达标）', async () => {
    const g = await seedGraph()
    const repository = new PrismaNotificationRepository(prisma)
    const riskId = await makeRisk(g)
    const event = await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: riskId }))
    const created = await repository.appendIfAbsent(
      recordFor(event, g.member, { latencyMs: -7_170_000, withinDeliveryTarget: false }),
    )
    expect(created.record.latencyMs).toBe(-7_170_000)
    expect(created.record.withinDeliveryTarget).toBe(false)
    const fetched = await repository.findById(created.record.id, g.member)
    expect(fetched?.latencyMs).toBe(-7_170_000)
    expect(fetched?.withinDeliveryTarget).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 激活基线 + 消费账本 + 桥接
// ---------------------------------------------------------------------------

describe('首次启用基线、消费账本与提交后桥接', () => {
  it('首次启用把既有支持事件记为 SKIPPED_BASELINE，不投递；重启不重置', async () => {
    const g = await seedGraph()
    const event = await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: await makeRisk(g) }))
    const store = new PrismaNotificationConsumerStore(prisma)
    const runtime = createNotificationRuntime({
      prisma,
      subscriber: fakeSubscriber,
      eventRepository,
      autoStartLoops: false,
    })
    await runtime.start()
    await runtime.stop()

    const ledger = await prisma.notificationConsumption.findMany({ where: { consumerId: NOTIFICATION_CONSUMER_ID } })
    expect(ledger.map((row) => row.eventId)).toContain(event.id)
    expect(ledger.every((row) => row.status === 'SKIPPED_BASELINE')).toBe(true)
    expect(await prisma.notification.count()).toBe(0)

    // 再次激活不重置：账本行数与激活日不变。
    const before = await store.getActivation(NOTIFICATION_CONSUMER_ID)
    const retry = createNotificationRuntime({ prisma, subscriber: fakeSubscriber, eventRepository, autoStartLoops: false })
    await retry.start()
    await retry.stop()
    const after = await store.getActivation(NOTIFICATION_CONSUMER_ID)
    expect(after).toEqual(before)
  })

  it('激活后的事件被投递且账本幂等；重复 runOnce 不重复建通知', async () => {
    const g = await seedGraph()
    const risk = await prisma.risk.create({
      data: { projectId: g.projectId, title: 'R', level: 'HIGH', ownerUserId: g.member },
    })
    const runtime = createNotificationRuntime({ prisma, subscriber: fakeSubscriber, eventRepository, autoStartLoops: false })
    await runtime.start()
    await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: risk.id }))

    await runtime.bridge.runOnce()
    await runtime.bridge.runOnce()

    const notifications = await prisma.notification.findMany()
    expect(notifications.length).toBeGreaterThan(0)
    const ledger = await prisma.notificationConsumption.findMany({ where: { status: 'DELIVERED' } })
    expect(ledger).toHaveLength(1)
    await runtime.stop()
  })

  it('UNAVAILABLE 不确认可重试；单条失败不阻塞后续事件', async () => {
    const g = await seedGraph()
    const mentioned = await appendEvent(baseEventInput('task.mentioned', g.projectId, { objectType: 'task', objectId: g.taskId }))
    const risk = await prisma.risk.create({
      data: { projectId: g.projectId, title: 'R', level: 'LOW', ownerUserId: g.member },
    })
    const runtime = createNotificationRuntime({ prisma, subscriber: fakeSubscriber, eventRepository, autoStartLoops: false })
    await runtime.start()
    // 激活之后追加两个事件：一个 UNAVAILABLE（mentioned），一个可投递（risk.created）。
    const ready = await appendEvent(baseEventInput('risk.created', g.projectId, { objectType: 'risk', objectId: risk.id }))

    await runtime.bridge.runOnce()

    const ledger = await prisma.notificationConsumption.findMany({ where: { status: 'DELIVERED' } })
    expect(ledger.map((row) => row.eventId)).toContain(ready.id)
    expect(ledger.map((row) => row.eventId)).not.toContain(mentioned.id)
    // 后续事件未被 UNAVAILABLE 阻塞。
    expect(await prisma.notification.count()).toBeGreaterThan(0)
    await runtime.stop()
  })

  it('读源故障 → 健康诚实降级为 UNAVAILABLE；恢复后 AVAILABLE', async () => {
    const runtime = createNotificationRuntime({ prisma, subscriber: fakeSubscriber, eventRepository, autoStartLoops: false })
    const store = new PrismaNotificationConsumerStore(prisma)
    expect(runtime.eventSource.health().state).toBe('UNAVAILABLE')
    await runtime.start()
    expect(runtime.eventSource.health().state).toBe('AVAILABLE')

    const original = store.readPending.bind(store)
    const failing = { readPending: async () => { throw new Error('source down') }, markDelivered: store.markDelivered.bind(store) }
    const bridge = createNotificationBridge({ store: failing, eventSource: runtime.eventSource, consumerId: NOTIFICATION_CONSUMER_ID })
    await bridge.runOnce()
    expect(runtime.eventSource.health().state).toBe('UNAVAILABLE')
    expect(runtime.module.sourceState().state).toBe('UNAVAILABLE')

    const recovering = createNotificationBridge({
      store: { readPending: () => original(NOTIFICATION_CONSUMER_ID, 50), markDelivered: store.markDelivered.bind(store) },
      eventSource: runtime.eventSource,
      consumerId: NOTIFICATION_CONSUMER_ID,
    })
    await recovering.runOnce()
    expect(runtime.eventSource.health().state).toBe('AVAILABLE')

    await runtime.stop()
    expect(runtime.eventSource.health().state).toBe('UNAVAILABLE')
  })

  it('sourceCapabilities：已接来源 AVAILABLE（六类），未接来源诚实 UNAVAILABLE', async () => {
    const runtime = createNotificationRuntime({
      prisma,
      subscriber: fakeSubscriber,
      eventRepository,
      autoStartLoops: false,
    })
    const before = runtime.module.sourceState()
    const capability = (name: string) => before.sourceCapabilities.find((item) => item.eventName === name)
    // 真实生产方已在：不因调度未启动而降级。
    // 2026-10-24 起扩到六类——A 补齐任务域事件通道后，`task.assigned` 与
    // `acceptance.submitted` 已有真实生产方（端点 24 创建 / 端点 28 改派与进入 DONE）。
    for (const name of [
      'risk.created',
      'risk.level-raised',
      'acceptance.approved',
      'acceptance.rejected',
      'task.assigned',
      'acceptance.submitted',
    ]) {
      expect(capability(name)).toMatchObject({ state: 'AVAILABLE', note: null })
    }
    // 调度未启动：B 自产的两类降级为 UNAVAILABLE。
    expect(capability('task.overdue')?.state).toBe('UNAVAILABLE')
    expect(capability('milestone.due')?.state).toBe('UNAVAILABLE')
    // 仍未接生产方：只剩后置 @提及。
    for (const name of ['task.mentioned']) {
      expect(capability(name)?.state).toBe('UNAVAILABLE')
    }
    expect(before.sourceCapabilities).toHaveLength(9)
  })

})

// ---------------------------------------------------------------------------
// 定时生产
// ---------------------------------------------------------------------------

describe('B 定时生产点（task.overdue / milestone.due）', () => {
  const NOW = new Date('2026-10-24T02:00:00.000Z') // 上海 2026-10-24 10:00

  async function makeTask(g: Graph, planEnd: string, status: string) {
    const story = await prisma.userStory.findUniqueOrThrow({ where: { id: g.storyId } })
    return prisma.task.create({
      data: {
        projectId: g.projectId,
        storyId: story.id,
        title: unique('task'),
        ownerUserId: g.member,
        acceptorUserId: g.pm,
        planStart: '2026-10-01',
        planEnd,
        status,
      },
    })
  }

  it('task.overdue：planEnd 次日 00:00 起算，DONE 也算，CLOSED / 未到期不算；去重且补扫', async () => {
    const g = await seedGraph()
    await makeTask(g, '2026-10-23', 'DONE') // 逾期（含 DONE）
    await makeTask(g, '2026-10-23', 'CLOSED') // 不算
    await makeTask(g, '2026-10-24', 'TODO') // 今天到期，次日 00:00 才逾期 → 不算
    const scheduler = createNotificationScheduler({
      prisma,
      repository: eventRepository,
      getActivatedDay: async () => '2026-10-24',
      now: () => NOW,
    })
    await scheduler.runOnce()
    await scheduler.runOnce()

    const events = await prisma.domainEvent.findMany({ where: { eventName: 'task.overdue' } })
    expect(events).toHaveLength(1)
    // occurredAt = 条件成立时间（planEnd 次日 00:00 上海 = UTC 前一天 16:00）。
    expect(events[0]!.occurredAt.toISOString()).toBe('2026-10-23T16:00:00.000Z')
    expect(events[0]!.idempotencyKey).toBe(`task.overdue:${events[0]!.objectId}:2026-10-23`)
  })

  it('milestone.due：仅补启用日及之后、已到 09:00 的节点；occurredAt = 当日 09:00', async () => {
    const g = await seedGraph()
    const dueToday = await prisma.milestone.create({
      data: { projectId: g.projectId, name: unique('m'), dueDate: '2026-10-24' },
    })
    await prisma.milestone.create({ data: { projectId: g.projectId, name: unique('m'), dueDate: '2026-10-23' } })
    await prisma.milestone.create({ data: { projectId: g.projectId, name: unique('m'), dueDate: '2026-10-25' } })
    const scheduler = createNotificationScheduler({
      prisma,
      repository: eventRepository,
      getActivatedDay: async () => '2026-10-24',
      now: () => NOW,
    })
    await scheduler.runOnce()
    await scheduler.runOnce()

    const events = await prisma.domainEvent.findMany({ where: { eventName: 'milestone.due' } })
    expect(events).toHaveLength(1)
    expect(events[0]!.objectId).toBe(dueToday.id)
    expect(events[0]!.occurredAt.toISOString()).toBe('2026-10-24T01:00:00.000Z')
    expect(events[0]!.idempotencyKey).toBe(`milestone.due:${dueToday.id}:2026-10-24`)
  })

  it('milestone.due：到点前不产生；关联敏感任务时事件为敏感且只含引用', async () => {
    const g = await seedGraph()
    const notYet = new Date('2026-10-24T00:30:00.000Z') // 上海 08:30，未到 09:00
    await prisma.milestone.update({ where: { id: g.milestoneId }, data: { dueDate: '2026-10-24' } })
    const early = createNotificationScheduler({
      prisma,
      repository: eventRepository,
      getActivatedDay: async () => '2026-10-24',
      now: () => notYet,
    })
    await early.runOnce()
    expect(await prisma.domainEvent.count({ where: { eventName: 'milestone.due' } })).toBe(0)

    await prisma.task.update({ where: { id: g.taskId }, data: { isSensitive: true } })
    await prisma.taskMilestone.create({ data: { taskId: g.taskId, milestoneId: g.milestoneId } })
    const due = createNotificationScheduler({
      prisma,
      repository: eventRepository,
      getActivatedDay: async () => '2026-10-24',
      now: () => NOW,
    })
    await due.runOnce()
    const event = await prisma.domainEvent.findFirstOrThrow({ where: { eventName: 'milestone.due' } })
    expect(event.sensitive).toBe(true)
    expect(event.payload).toEqual({ references: [{ objectType: 'task', objectId: g.taskId }] })
  })

  it('定时端到端：调度产出事件 → 桥接消费 → 生成通知', async () => {
    const g = await seedGraph()
    await makeTask(g, '2026-10-23', 'DOING')
    const runtime = createNotificationRuntime({
      prisma,
      subscriber: fakeSubscriber,
      eventRepository,
      autoStartLoops: false,
      now: () => NOW,
    })
    await runtime.start()
    await runtime.scheduler.runOnce()
    await runtime.bridge.runOnce()

    const notifications = await prisma.notification.findMany({ where: { type: 'TASK_OVERDUE' } })
    expect(notifications.length).toBeGreaterThan(0)
    // 任务负责人 + PM 都收到（去重后）。
    const recipients = new Set(notifications.map((row) => row.recipientUserId))
    expect(recipients.has(g.member)).toBe(true)
    expect(recipients.has(g.pm)).toBe(true)
    await runtime.stop()
  })
})
