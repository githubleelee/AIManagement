import { describe, expect, it } from 'vitest'
import type { DomainEventEnvelope } from './contracts.js'
import { InMemoryEventRepository } from './in-memory-repository.js'

function event(id: string, storedAt: string): DomainEventEnvelope {
  return {
    id,
    schemaVersion: 1,
    eventName: 'test.event.created',
    projectId: 'project-1',
    object: { objectType: 'test', objectId: id },
    actor: { kind: 'SYSTEM', component: 'test' },
    occurredAt: '2026-10-18T10:00:00.000Z',
    storedAt,
    idempotencyKey: id,
    sensitive: false,
    payload: {},
  }
}

describe('InMemoryEventRepository time filtering', () => {
  it('compares and sorts timestamps by instant rather than lexical text', async () => {
    const repository = new InMemoryEventRepository()
    await repository.appendIfAbsent(event('later-text-earlier-time', '2026-10-18T18:30:00.000+08:00'))
    await repository.appendIfAbsent(event('earlier-text-later-time', '2026-10-18T11:00:00.000Z'))

    const records = await repository.query({
      projectId: 'project-1',
      storedFrom: '2026-10-18T10:15:00.000Z',
    })

    expect(records.map(record => record.id)).toEqual([
      'later-text-earlier-time',
      'earlier-text-later-time',
    ])
  })
})
