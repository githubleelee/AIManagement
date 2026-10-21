import { describe, expect, it } from 'vitest'
import type { EventAuthorizationPort, PublishEventInput } from './contracts.js'
import { EventServiceError } from './errors.js'
import { InMemoryEventRepository } from './in-memory-repository.js'
import { DomainEventService } from './service.js'

const allowMembers: EventAuthorizationPort = {
  async canRead(actorUserId) {
    if (actorUserId === 'outsider') return { allow: false, status: 404, code: 'NOT_FOUND' }
    if (actorUserId === 'viewer-denied') return { allow: false, status: 403, code: 'FORBIDDEN' }
    return { allow: true }
  },
}

const baseEvent: PublishEventInput = {
  eventName: 'scheduling.suggestion-disposed',
  projectId: 'project-1',
  object: { objectType: 'aiSuggestion', objectId: 'suggestion-1' },
  actor: { kind: 'USER', userId: 'pm-1' },
  occurredAt: '2026-10-18T10:00:00.000Z',
  idempotencyKey: 'disposition-1',
  correlationId: 'request-1',
  sensitive: false,
  payload: { disposition: 'ACCEPTED' },
}

function createService(repository = new InMemoryEventRepository()) {
  let sequence = 0
  const service = new DomainEventService({
    repository,
    authorization: allowMembers,
    now: () => new Date('2026-10-18T10:01:00.000Z'),
    createId: () => `event-${++sequence}`,
  })
  return { service, repository }
}

describe('DomainEventService', () => {
  it('stores, queries and delivers a published event', async () => {
    const { service } = createService()
    const received: string[] = []
    await service.start()
    service.subscribe(baseEvent.eventName, 'analytics', event => {
      received.push(event.id)
    })

    const result = await service.publish(baseEvent)
    const queried = await service.query('member-1', { projectId: 'project-1' })

    expect(result.persistence).toBe('APPENDED')
    expect(result.deliveries).toEqual([
      { subscriberId: 'analytics', status: 'DELIVERED', errorCode: null },
    ])
    expect(received).toEqual([result.event.id])
    expect(queried).toEqual([result.event])
  })

  it('deduplicates by project + event name + idempotency key and does not redispatch', async () => {
    const { service } = createService()
    let deliveries = 0
    await service.start()
    service.subscribe(baseEvent.eventName, 'analytics', () => { deliveries += 1 })

    const first = await service.publish(baseEvent)
    const duplicate = await service.publish({ ...baseEvent, occurredAt: '2026-10-18T10:02:00.000Z' })

    expect(duplicate.persistence).toBe('DUPLICATE')
    expect(duplicate.event.id).toBe(first.event.id)
    expect(duplicate.deliveries).toEqual([])
    expect(deliveries).toBe(1)
  })

  it('returns subscriber failures without rolling back the persisted event', async () => {
    const { service } = createService()
    await service.start()
    service.subscribe(baseEvent.eventName, 'broken-consumer', () => {
      throw new Error('consumer unavailable')
    })

    const result = await service.publish(baseEvent)
    const records = await service.query('member-1', { projectId: 'project-1' })

    expect(result.persistence).toBe('APPENDED')
    expect(result.deliveries[0]).toMatchObject({ status: 'FAILED', errorCode: 'SUBSCRIBER_FAILED' })
    expect(records).toHaveLength(1)
  })

  it('explicit redelivery dispatches the stored event without appending another row', async () => {
    const { service } = createService()
    const kinds: string[] = []
    await service.start()
    service.subscribe(baseEvent.eventName, 'consumer', (_event, context) => {
      kinds.push(context.deliveryKind)
    })
    const published = await service.publish(baseEvent)

    const redelivered = await service.redeliver('member-1', published.event.id)
    const records = await service.query('member-1', { projectId: 'project-1' })

    expect(redelivered.deliveries[0]?.status).toBe('DELIVERED')
    expect(kinds).toEqual(['LIVE', 'REDELIVERY'])
    expect(records).toHaveLength(1)
  })

  it('replay does not append records and marks delivery as replay', async () => {
    const { service } = createService()
    const kinds: string[] = []
    await service.start()
    await service.publish(baseEvent)
    service.subscribe(baseEvent.eventName, 'consumer', (_event, context) => {
      kinds.push(context.deliveryKind)
    })

    const replayed = await service.replay('member-1', { projectId: 'project-1' })
    const records = await service.query('member-1', { projectId: 'project-1' })

    expect(replayed).toHaveLength(1)
    expect(kinds).toEqual(['REPLAY'])
    expect(records).toHaveLength(1)
  })

  it('an event without subscribers succeeds', async () => {
    const { service } = createService()
    await service.start()
    await expect(service.publish(baseEvent)).resolves.toMatchObject({ deliveries: [] })
  })

  it('outsider receives 404 before any protected event body is returned', async () => {
    const { service } = createService()
    await service.start()
    const published = await service.publish(baseEvent)

    await expect(service.redeliver('outsider', published.event.id)).rejects.toMatchObject({
      status: 404,
      kind: 'NOT_FOUND',
    })
    await expect(service.query('outsider', { projectId: 'project-1' })).rejects.toBeInstanceOf(
      EventServiceError,
    )
  })

  it('sensitive payload accepts references only', async () => {
    const { service } = createService()
    await service.start()
    const sensitive: PublishEventInput = {
      ...baseEvent,
      sensitive: true,
      payload: { references: [{ objectType: 'task', objectId: 'task-secret' }] },
    }
    const result = await service.publish(sensitive)
    expect(result.event.payload).toEqual({
      references: [{ objectType: 'task', objectId: 'task-secret' }],
    })

    await expect(
      service.publish({
        ...sensitive,
        idempotencyKey: 'bad-sensitive',
        payload: { references: [], title: 'secret' } as never,
      }),
    ).rejects.toMatchObject({ status: 422 })
  })
})
