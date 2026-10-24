import { describe, expect, it } from 'vitest'
import type {
  NotificationEventHandler,
  NotificationEventName,
  NotificationSourceEvent,
  RecipientResolution,
} from './contracts.js'
import { createNotificationModule } from './factory.js'
import { InMemoryNotificationRepository } from './in-memory-repository.js'
import { NotificationService } from './service.js'
import { NOTIFICATION_EVENT_NAMES } from './contracts.js'

const sourceCapabilities = NOTIFICATION_EVENT_NAMES.map(eventName => ({
  eventName, state: 'AVAILABLE' as const, note: null,
}))

const baseEvent: NotificationSourceEvent = {
  id: 'event-1',
  eventName: 'task.assigned',
  projectId: 'project-1',
  object: { objectType: 'task', objectId: 'task-1' },
  occurredAt: '2026-10-21T10:00:00.000Z',
  sensitive: false,
  payload: { ignored: true },
}

function createHarness(options: {
  resolution?: RecipientResolution
  sourceAvailable?: boolean
  now?: string
} = {}) {
  const repository = new InMemoryNotificationRepository(() => true)
  let resolution: RecipientResolution = options.resolution ?? {
    state: 'AVAILABLE',
    recipients: [
      {
        userId: 'member-1',
        content: { kind: 'TEXT', title: '新任务', summary: '请查看任务' },
      },
    ],
  }
  let now = options.now ?? '2026-10-21T10:00:30.000Z'
  let sequence = 0
  const service = new NotificationService({
    repository,
    recipientResolver: { resolve: async () => resolution },
    sourceState: () =>
      options.sourceAvailable === false
        ? { state: 'UNAVAILABLE', note: '事件端口未接入', sourceCapabilities }
        : { state: 'AVAILABLE', note: null, sourceCapabilities },
    now: () => new Date(now),
    createId: () => `notification-${++sequence}`,
  })
  return {
    repository,
    service,
    setResolution: (next: RecipientResolution) => {
      resolution = next
    },
    setNow: (next: string) => {
      now = next
    },
  }
}

describe('US-14 六类通知映射与落库', () => {
  const cases: Array<[NotificationEventName, string]> = [
    ['task.assigned', 'TASK_ASSIGNED'],
    ['task.mentioned', 'MENTIONED'],
    ['task.overdue', 'TASK_OVERDUE'],
    ['acceptance.submitted', 'ACCEPTANCE'],
    ['acceptance.approved', 'ACCEPTANCE'],
    ['acceptance.rejected', 'ACCEPTANCE'],
    ['risk.created', 'RISK_ALERT'],
    ['risk.level-raised', 'RISK_ALERT'],
    ['milestone.due', 'MILESTONE_REMINDER'],
  ]

  it.each(cases)('%s 映射为 %s', async (eventName, expectedType) => {
    const h = createHarness({
      resolution:
        eventName === 'task.overdue'
          ? {
              state: 'AVAILABLE',
              recipients: [{ userId: 'member-1' }],
              dedupeDiscriminator: '2026-10-20',
            }
          : undefined,
    })
    const result = await h.service.consume({ ...baseEvent, eventName })
    expect(result.state).toBe('DELIVERED')
    if (result.state === 'DELIVERED') {
      expect(result.notifications[0]?.type).toBe(expectedType)
      expect(result.notifications[0]?.withinDeliveryTarget).toBe(true)
    }
  })

  it('同一事件与接收者重复消费只落一条', async () => {
    const h = createHarness()
    expect((await h.service.consume(baseEvent)).created).toBe(1)
    const repeated = await h.service.consume(baseEvent)
    expect(repeated.created).toBe(0)
    expect(repeated.duplicate).toBe(1)
    const listed = await h.service.list('member-1')
    expect(listed.state === 'AVAILABLE' ? listed.total : null).toBe(1)
  })

  it('逾期按任务、截止日期、接收者去重，即使上游生成了不同事件 id', async () => {
    const h = createHarness({
      resolution: {
        state: 'AVAILABLE',
        recipients: [{ userId: 'member-1' }],
        dedupeDiscriminator: '2026-10-20',
      },
    })
    await h.service.consume({ ...baseEvent, eventName: 'task.overdue', id: 'overdue-1' })
    const second = await h.service.consume({
      ...baseEvent,
      eventName: 'task.overdue',
      id: 'overdue-2',
    })
    expect(second.duplicate).toBe(1)
  })

  it('同一任务改变截止日期后允许新的逾期通知', async () => {
    const h = createHarness({
      resolution: {
        state: 'AVAILABLE',
        recipients: [{ userId: 'member-1' }],
        dedupeDiscriminator: '2026-10-20',
      },
    })
    await h.service.consume({ ...baseEvent, eventName: 'task.overdue', id: 'overdue-1' })
    h.setResolution({
      state: 'AVAILABLE',
      recipients: [{ userId: 'member-1' }],
      dedupeDiscriminator: '2026-10-25',
    })
    const next = await h.service.consume({
      ...baseEvent,
      eventName: 'task.overdue',
      id: 'overdue-2',
    })
    expect(next.created).toBe(1)
  })

  it('逾期解析缺少 planEnd 时拒绝，避免错误去重', async () => {
    const h = createHarness({
      resolution: { state: 'AVAILABLE', recipients: [{ userId: 'member-1' }] },
    })
    await expect(
      h.service.consume({ ...baseEvent, eventName: 'task.overdue' }),
    ).rejects.toMatchObject({ status: 422, kind: 'VALIDATION_FAILED' })
  })

  it('接收者重复时仅生成一条通知', async () => {
    const h = createHarness({
      resolution: {
        state: 'AVAILABLE',
        recipients: [{ userId: 'member-1' }, { userId: 'member-1' }],
      },
    })
    const result = await h.service.consume(baseEvent)
    expect(result.created).toBe(1)
  })
})

describe('US-14 时延、敏感与降级', () => {
  it('事件发生后恰好 60 秒入库仍满足目标', async () => {
    const h = createHarness({ now: '2026-10-21T10:01:00.000Z' })
    const result = await h.service.consume(baseEvent)
    if (result.state !== 'DELIVERED') throw new Error('预期已投递')
    expect(result.notifications[0]?.latencyMs).toBe(60_000)
    expect(result.notifications[0]?.withinDeliveryTarget).toBe(true)
  })

  it('超过 60 秒会如实记录未达标', async () => {
    const h = createHarness({ now: '2026-10-21T10:01:00.001Z' })
    const result = await h.service.consume(baseEvent)
    if (result.state !== 'DELIVERED') throw new Error('预期已投递')
    expect(result.notifications[0]?.withinDeliveryTarget).toBe(false)
  })

  it('敏感事件强制只保存引用，解析器返回的标题也会被丢弃', async () => {
    const h = createHarness()
    const result = await h.service.consume({ ...baseEvent, sensitive: true })
    if (result.state !== 'DELIVERED') throw new Error('预期已投递')
    expect(result.notifications[0]?.content).toEqual({
      kind: 'REFERENCE_ONLY',
      title: null,
      summary: null,
    })
  })

  it('接收者数据源未就绪时返回 UNAVAILABLE，不用空列表冒充无人接收', async () => {
    const h = createHarness({
      resolution: { state: 'UNAVAILABLE', note: '任务生产方尚未接入' },
    })
    const result = await h.service.consume(baseEvent)
    expect(result).toMatchObject({
      state: 'UNAVAILABLE',
      created: 0,
      note: '任务生产方尚未接入',
    })
  })

  it('公共事件端口未接入时列表返回 total=null 与说明', async () => {
    const h = createHarness({ sourceAvailable: false })
    expect(await h.service.list('member-1')).toEqual({
      state: 'UNAVAILABLE',
      total: null,
      unreadCount: null,
      items: [],
      limit: 200,
      truncated: false,
      sourceCapabilities,
      note: '事件端口未接入',
    })
  })
})

describe('US-14 本人可见与已读状态', () => {
  it('列表按接收者隔离并维护未读计数', async () => {
    const h = createHarness({
      resolution: {
        state: 'AVAILABLE',
        recipients: [{ userId: 'member-1' }, { userId: 'member-2' }],
      },
    })
    await h.service.consume(baseEvent)
    const first = await h.service.list('member-1')
    const second = await h.service.list('member-2')
    expect(first.state === 'AVAILABLE' ? [first.total, first.unreadCount] : null).toEqual([1, 1])
    expect(second.state === 'AVAILABLE' ? second.total : null).toBe(1)
  })

  it('非接收者读取通知统一返回 404', async () => {
    const h = createHarness()
    const result = await h.service.consume(baseEvent)
    if (result.state !== 'DELIVERED') throw new Error('预期已投递')
    await expect(h.service.get('outsider', result.notifications[0]!.id)).rejects.toMatchObject({
      status: 404,
      kind: 'NOT_FOUND',
    })
  })

  it('接收者可标记已读，重复操作保持第一次 readAt', async () => {
    const h = createHarness()
    const result = await h.service.consume(baseEvent)
    if (result.state !== 'DELIVERED') throw new Error('预期已投递')
    const id = result.notifications[0]!.id
    h.setNow('2026-10-21T10:02:00.000Z')
    const first = await h.service.markRead('member-1', id)
    h.setNow('2026-10-21T10:03:00.000Z')
    const replay = await h.service.markRead('member-1', id)
    expect(first.readAt).toBe('2026-10-21T10:02:00.000Z')
    expect(replay.readAt).toBe(first.readAt)
    const unread = await h.service.list('member-1', true)
    expect(unread.state === 'AVAILABLE' ? unread.total : null).toBe(0)
  })
})

describe('US-14 #37 订阅生命周期', () => {
  it('未提供 #37 端口时保持显式 UNAVAILABLE', () => {
    const module = createNotificationModule({
      repository: new InMemoryNotificationRepository(() => true),
      recipientResolver: { resolve: async () => ({ state: 'AVAILABLE', recipients: [] }) },
    })
    expect(module.start()).toMatchObject({ state: 'UNAVAILABLE' })
  })

  it('启动后订阅全部事件，停止时逐一解除订阅', () => {
    const handlers = new Map<NotificationEventName, NotificationEventHandler>()
    const disposed: string[] = []
    const module = createNotificationModule({
      repository: new InMemoryNotificationRepository(() => true),
      recipientResolver: { resolve: async () => ({ state: 'AVAILABLE', recipients: [] }) },
      eventSource: {
        health: () => ({ state: 'AVAILABLE', note: null, sourceCapabilities }),
        subscribe(eventName, _subscriberId, handler) {
          handlers.set(eventName, handler)
          return () => disposed.push(eventName)
        },
      },
    })
    expect(module.start()).toEqual({ state: 'AVAILABLE', note: null, sourceCapabilities })
    expect(handlers.size).toBe(9)
    module.stop()
    expect(disposed).toHaveLength(9)
    expect(module.sourceState()).toMatchObject({ state: 'UNAVAILABLE' })
  })
})
