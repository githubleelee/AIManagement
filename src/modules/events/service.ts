import { randomUUID } from 'node:crypto'
import type {
  DomainEventEnvelope,
  DomainEventInfrastructurePort,
  DomainEventName,
  EventAuthorizationPort,
  EventDeliveryKind,
  EventDeliveryResult,
  EventHandler,
  EventQuery,
  EventRepositoryPort,
  PublishEventInput,
  PublishEventResult,
  RedeliverEventResult,
} from './contracts.js'
import { EventServiceError } from './errors.js'
import { validatePublishEvent } from './validation.js'

export type DomainEventServiceDependencies = {
  repository: EventRepositoryPort
  authorization: EventAuthorizationPort
  now?: () => Date
  createId?: () => string
}

type Subscription = { subscriberId: string; handler: EventHandler }

export class DomainEventService implements DomainEventInfrastructurePort {
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly subscriptions = new Map<DomainEventName, Map<string, EventHandler>>()
  private started = false

  constructor(private readonly deps: DomainEventServiceDependencies) {
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? randomUUID
  }

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
    this.subscriptions.clear()
  }

  subscribe(eventName: DomainEventName, subscriberId: string, handler: EventHandler): () => void {
    if (!eventName || !subscriberId.trim()) {
      throw new EventServiceError(422, 'VALIDATION_FAILED', '订阅事件名和订阅方标识不能为空')
    }
    const subscribers = this.subscriptions.get(eventName) ?? new Map<string, EventHandler>()
    if (subscribers.has(subscriberId)) {
      throw new EventServiceError(409, 'CONFLICT', '同一订阅方不能重复注册同一事件')
    }
    subscribers.set(subscriberId, handler)
    this.subscriptions.set(eventName, subscribers)
    return () => {
      subscribers.delete(subscriberId)
      if (subscribers.size === 0) this.subscriptions.delete(eventName)
    }
  }

  async publish(input: PublishEventInput): Promise<PublishEventResult> {
    this.assertStarted()
    validatePublishEvent(input)
    const event: DomainEventEnvelope = {
      ...structuredClone(input),
      id: this.createId(),
      schemaVersion: 1,
      storedAt: this.now().toISOString(),
    }
    const persisted = await this.deps.repository.appendIfAbsent(event)
    if (persisted.kind === 'DUPLICATE') {
      // A duplicate publish proves persistence only. Delivery is deliberately
      // not repeated; callers use redeliver(existingEvent.id) explicitly.
      return { persistence: 'DUPLICATE', event: persisted.event, deliveries: [] }
    }
    return {
      persistence: 'APPENDED',
      event: persisted.event,
      deliveries: await this.dispatch(persisted.event, 'LIVE'),
    }
  }

  async query(actorUserId: string, query: EventQuery): Promise<DomainEventEnvelope[]> {
    this.assertStarted()
    await this.authorizeRead(actorUserId, query.projectId)
    return this.deps.repository.query(query)
  }

  async redeliver(actorUserId: string, eventId: string): Promise<RedeliverEventResult> {
    this.assertStarted()
    const metadata = await this.deps.repository.findAccessMetadata(eventId)
    if (!metadata) throw new EventServiceError(404, 'NOT_FOUND', '事件不存在或不可见')
    await this.authorizeRead(actorUserId, metadata.projectId)
    const event = await this.deps.repository.findById(eventId)
    if (!event) throw new EventServiceError(404, 'NOT_FOUND', '事件不存在或不可见')
    return { event, deliveries: await this.dispatch(event, 'REDELIVERY') }
  }

  async replay(actorUserId: string, query: EventQuery): Promise<RedeliverEventResult[]> {
    this.assertStarted()
    await this.authorizeRead(actorUserId, query.projectId)
    const events = await this.deps.repository.query(query)
    const results: RedeliverEventResult[] = []
    for (const event of events) {
      results.push({ event, deliveries: await this.dispatch(event, 'REPLAY') })
    }
    return results
  }

  private assertStarted(): void {
    if (!this.started) throw new Error('Domain event infrastructure has not been started')
  }

  private async authorizeRead(actorUserId: string, projectId: string): Promise<void> {
    const decision = await this.deps.authorization.canRead(actorUserId, projectId)
    if (!decision.allow) {
      throw new EventServiceError(
        decision.status,
        decision.code,
        decision.status === 404 ? '事件不存在或不可见' : '你没有查看事件的权限',
      )
    }
  }

  private async dispatch(
    event: DomainEventEnvelope,
    deliveryKind: EventDeliveryKind,
  ): Promise<EventDeliveryResult[]> {
    const subscribers: Subscription[] = [...(this.subscriptions.get(event.eventName)?.entries() ?? [])]
      .map(([subscriberId, handler]) => ({ subscriberId, handler }))
    const results: EventDeliveryResult[] = []
    for (const subscriber of subscribers) {
      try {
        await subscriber.handler(structuredClone(event), { deliveryKind })
        results.push({ subscriberId: subscriber.subscriberId, status: 'DELIVERED', errorCode: null })
      } catch {
        results.push({
          subscriberId: subscriber.subscriberId,
          status: 'FAILED',
          errorCode: 'SUBSCRIBER_FAILED',
        })
      }
    }
    return results
  }
}
