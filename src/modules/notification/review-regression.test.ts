import { describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_EVENT_NAMES, type NotificationEventHandler, type NotificationSourceEvent,
  type NotificationSourceHealth } from './contracts.js'
import { createNotificationModule } from './factory.js'
import { InMemoryNotificationRepository } from './in-memory-repository.js'
import { NotificationService } from './service.js'

const event: NotificationSourceEvent = { id: 'event', eventName: 'task.assigned', projectId: 'p',
  object: { objectType: 'task', objectId: 't' }, occurredAt: '2026-10-23T10:00:00.000Z',
  sensitive: false, payload: {} }
function health(): NotificationSourceHealth {
  return { state: 'AVAILABLE', note: null, sourceCapabilities: NOTIFICATION_EVENT_NAMES.map(eventName => ({
    eventName, state: eventName === 'task.mentioned' ? 'UNAVAILABLE' : 'AVAILABLE',
    note: eventName === 'task.mentioned' ? '@提及真实来源未接入' : null,
  })) }
}
function harness() {
  let visible = true
  let now = '2026-10-23T10:00:30.000Z'
  const repository = new InMemoryNotificationRepository(() => visible)
  const service = new NotificationService({ repository,
    recipientResolver: { resolve: async () => ({ state: 'AVAILABLE', recipients: [{ userId: 'member' }] }) },
    sourceState: health, now: () => new Date(now) })
  return { repository, service, revoke: () => { visible = false }, setNow: (value: string) => { now = value } }
}
describe('notification review regressions', () => {
  it('fixture refuses a missing visibility policy instead of implicitly allowing access', () => {
    expect(() => new InMemoryNotificationRepository(undefined as never)).toThrow('必须显式提供可见性检查')
  })
  it('repository read failure is explicit UNAVAILABLE with no false empty total', async () => {
    const h = harness()
    vi.spyOn(h.repository, 'listByRecipient').mockRejectedValue(new Error('private DB details'))
    const result = await h.service.list('member')
    expect(result).toMatchObject({ state: 'UNAVAILABLE', total: null, unreadCount: null, items: [] })
    expect(JSON.stringify(result)).not.toContain('private DB details')
  })
  it('future event keeps negative latency and is not on time', async () => {
    const h = harness()
    const result = await h.service.consume({ ...event, occurredAt: '2026-10-23T12:00:00.000Z' })
    expect(result.notifications[0]).toMatchObject({ latencyMs: -7_170_000, withinDeliveryTarget: false })
  })
  it('one snapshot reports real totals with 200 limit and independent unread count', async () => {
    const h = harness()
    for (let i = 0; i < 250; i++) await h.service.consume({ ...event, id: `e${i}` })
    const spy = vi.spyOn(h.repository, 'listByRecipient')
    const list = await h.service.list('member')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('member', false, 200)
    expect(list).toMatchObject({ state: 'AVAILABLE', total: 250, unreadCount: 250, limit: 200, truncated: true })
    expect(list.items).toHaveLength(200)
    await h.service.markRead('member', list.items[0]!.id)
    expect(await h.service.list('member', true)).toMatchObject({ total: 249, unreadCount: 249 })
  })
  it('all read/conditional-write paths pass actor and hide revoked notifications', async () => {
    const h = harness()
    const result = await h.service.consume(event)
    const id = result.notifications[0]!.id
    h.revoke()
    expect(await h.service.list('member')).toMatchObject({ total: 0, unreadCount: 0 })
    await expect(h.service.get('member', id)).rejects.toMatchObject({ status: 404 })
    await expect(h.service.markRead('member', id)).rejects.toMatchObject({ status: 404 })
    const write = vi.spyOn(h.repository, 'markRead')
    await h.service.markRead('outsider', id).catch(() => undefined)
    expect(write).toHaveBeenCalledWith(id, 'outsider', expect.any(String))
  })
  it('list/detail/read views never contain delivery or recipient diagnostics', async () => {
    const h = harness()
    const id = (await h.service.consume(event)).notifications[0]!.id
    const listed = await h.service.list('member')
    for (const view of [listed.items[0], await h.service.get('member', id), await h.service.markRead('member', id)]) {
      for (const key of ['dedupeKey', 'recipientUserId', 'sourceEventId', 'sourceEventName', 'latencyMs', 'withinDeliveryTarget', 'occurredAt']) {
        expect(view).not.toHaveProperty(key)
      }
    }
    expect(listed.sourceCapabilities.find(item => item.eventName === 'task.mentioned')?.state).toBe('UNAVAILABLE')
    expect(listed.items).toHaveLength(1)
  })
  it('read replay and event redelivery preserve first read timestamp', async () => {
    const h = harness()
    const id = (await h.service.consume(event)).notifications[0]!.id
    const first = await h.service.markRead('member', id)
    h.setNow('2026-10-23T11:00:00.000Z')
    await h.service.consume(event)
    expect((await h.service.markRead('member', id)).readAt).toBe(first.readAt)
  })
  it('factory handler returns UNAVAILABLE and later delivered result, source faults are dynamic', async () => {
    let handler: NotificationEventHandler | undefined
    let current = health()
    let resolverReady = false
    const module = createNotificationModule({ repository: new InMemoryNotificationRepository(() => true),
      recipientResolver: { resolve: async () => resolverReady ? { state: 'AVAILABLE', recipients: [] }
        : { state: 'UNAVAILABLE', note: 'resolver unavailable' } },
      eventSource: { health: () => current, subscribe: (_name, _id, fn) => { handler = fn; return () => undefined } } })
    expect(module.sourceState().state).toBe('UNAVAILABLE')
    expect(module.start().state).toBe('AVAILABLE')
    expect(await handler!(event)).toMatchObject({ state: 'UNAVAILABLE', note: 'resolver unavailable' })
    resolverReady = true
    expect(await handler!(event)).toMatchObject({ state: 'DELIVERED' })
    current = { ...current, state: 'UNAVAILABLE', note: 'DB read fault' }
    expect(await module.service.list('member')).toMatchObject({ state: 'UNAVAILABLE', total: null })
    expect(await handler!(event)).toMatchObject({ state: 'UNAVAILABLE', note: 'DB read fault' })
    module.stop()
    expect(module.sourceState().state).toBe('UNAVAILABLE')
  })
  it('third subscribe failure disposes earlier callbacks, stop is idempotent', () => {
    let calls = 0
    const disposed: number[] = []
    const module = createNotificationModule({ repository: new InMemoryNotificationRepository(() => true),
      recipientResolver: { resolve: async () => ({ state: 'AVAILABLE', recipients: [] }) },
      eventSource: { health, subscribe: () => { const call = ++calls
        if (call === 3) throw new Error('register failed')
        return () => { disposed.push(call) } } } })
    expect(module.start().state).toBe('UNAVAILABLE')
    expect(disposed).toEqual([1, 2])
    module.stop(); module.stop()
    expect(disposed).toEqual([1, 2])
  })
  it('source health exceptions fail closed without losing source capability list', () => {
    const module = createNotificationModule({ repository: new InMemoryNotificationRepository(() => true),
      recipientResolver: { resolve: async () => ({ state: 'AVAILABLE', recipients: [] }) },
      eventSource: { health: () => { throw new Error('source fault') }, subscribe: () => () => undefined } })
    expect(module.start()).toMatchObject({ state: 'UNAVAILABLE' })
    expect(module.sourceState().sourceCapabilities).toHaveLength(9)
    module.stop()
  })
})
