import type {
  AppendEventResult,
  DomainEventEnvelope,
  EventQuery,
  EventRepositoryPort,
} from './contracts.js'

function copy<T>(value: T): T {
  return structuredClone(value)
}

function idempotencyScope(event: Pick<DomainEventEnvelope, 'projectId' | 'eventName' | 'idempotencyKey'>) {
  return `${event.projectId}\u0000${event.eventName}\u0000${event.idempotencyKey}`
}

export class InMemoryEventRepository implements EventRepositoryPort {
  private readonly events = new Map<string, DomainEventEnvelope>()
  private readonly idempotencyIndex = new Map<string, string>()

  async appendIfAbsent(event: DomainEventEnvelope): Promise<AppendEventResult> {
    const scope = idempotencyScope(event)
    const existingId = this.idempotencyIndex.get(scope)
    if (existingId) return { kind: 'DUPLICATE', event: copy(this.events.get(existingId)!) }
    this.events.set(event.id, copy(event))
    this.idempotencyIndex.set(scope, event.id)
    return { kind: 'APPENDED', event: copy(event) }
  }

  async findAccessMetadata(eventId: string) {
    const event = this.events.get(eventId)
    if (!event) return null
    return copy({
      id: event.id,
      projectId: event.projectId,
      eventName: event.eventName,
      object: event.object,
      sensitive: event.sensitive,
      storedAt: event.storedAt,
    })
  }

  async findById(eventId: string): Promise<DomainEventEnvelope | null> {
    const event = this.events.get(eventId)
    return event ? copy(event) : null
  }

  async query(query: EventQuery): Promise<DomainEventEnvelope[]> {
    return [...this.events.values()]
      .filter(event => event.projectId === query.projectId)
      .filter(event => !query.eventName || event.eventName === query.eventName)
      .filter(event => !query.storedFrom || event.storedAt >= query.storedFrom)
      .filter(event => !query.storedTo || event.storedAt <= query.storedTo)
      .sort((left, right) => left.storedAt.localeCompare(right.storedAt))
      .map(copy)
  }
}
