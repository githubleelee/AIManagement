export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type DomainEventName = `${string}.${string}`

export type EventObjectRef = {
  objectType: string
  objectId: string
}

export type EventActor =
  | { kind: 'USER'; userId: string }
  | { kind: 'SYSTEM'; component: string }

type PublishEventBase = {
  eventName: DomainEventName
  projectId: string
  object: EventObjectRef
  actor: EventActor
  occurredAt: string
  idempotencyKey: string
  correlationId?: string
  causationId?: string
}

export type PublishEventInput =
  | (PublishEventBase & { sensitive: false; payload: JsonObject })
  | (PublishEventBase & {
      sensitive: true
      /** Sensitive events carry references only; never titles, descriptions or content. */
      payload: { references: EventObjectRef[] }
    })

export type DomainEventEnvelope = PublishEventInput & {
  id: string
  schemaVersion: 1
  storedAt: string
}

export type EventAccessMetadata = Pick<
  DomainEventEnvelope,
  'id' | 'projectId' | 'eventName' | 'object' | 'sensitive' | 'storedAt'
>

export type EventQuery = {
  projectId: string
  eventName?: DomainEventName
  storedFrom?: string
  storedTo?: string
}

export type AppendEventResult =
  | { kind: 'APPENDED'; event: DomainEventEnvelope }
  | { kind: 'DUPLICATE'; event: DomainEventEnvelope }

/** Uniqueness scope is exactly projectId + eventName + idempotencyKey. */
export interface EventRepositoryPort {
  appendIfAbsent(event: DomainEventEnvelope): Promise<AppendEventResult>
  findAccessMetadata(eventId: string): Promise<EventAccessMetadata | null>
  findById(eventId: string): Promise<DomainEventEnvelope | null>
  query(query: EventQuery): Promise<DomainEventEnvelope[]>
}

export type EventReadDecision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

export interface EventAuthorizationPort {
  canRead(actorUserId: string, projectId: string): Promise<EventReadDecision>
}

export type EventDeliveryKind = 'LIVE' | 'REDELIVERY' | 'REPLAY'

export type EventHandler = (
  event: DomainEventEnvelope,
  context: { deliveryKind: EventDeliveryKind },
) => Promise<void> | void

export type EventDeliveryResult = {
  subscriberId: string
  status: 'DELIVERED' | 'FAILED'
  errorCode: string | null
}

export type PublishEventResult = {
  persistence: 'APPENDED' | 'DUPLICATE'
  event: DomainEventEnvelope
  deliveries: EventDeliveryResult[]
}

export type RedeliverEventResult = {
  event: DomainEventEnvelope
  deliveries: EventDeliveryResult[]
}

export interface DomainEventPublisherPort {
  publish(input: PublishEventInput): Promise<PublishEventResult>
}

export interface DomainEventSubscriberPort {
  subscribe(eventName: DomainEventName, subscriberId: string, handler: EventHandler): () => void
}

export interface DomainEventQueryPort {
  query(actorUserId: string, query: EventQuery): Promise<DomainEventEnvelope[]>
}

export interface DomainEventReplayPort {
  redeliver(actorUserId: string, eventId: string): Promise<RedeliverEventResult>
  replay(actorUserId: string, query: EventQuery): Promise<RedeliverEventResult[]>
}

export interface DomainEventLifecyclePort {
  start(): Promise<void>
  stop(): Promise<void>
}

export type DomainEventInfrastructurePort = DomainEventPublisherPort &
  DomainEventSubscriberPort &
  DomainEventQueryPort &
  DomainEventReplayPort &
  DomainEventLifecyclePort
