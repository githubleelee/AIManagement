import type { EventObjectRef, PublishEventInput } from './contracts.js'
import { EventServiceError } from './errors.js'

const EVENT_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new EventServiceError(422, 'VALIDATION_FAILED', `${field} 不能为空`)
}

function validateRef(ref: EventObjectRef): void {
  requireText(ref.objectType, 'objectType')
  requireText(ref.objectId, 'objectId')
}

export function validatePublishEvent(input: PublishEventInput): void {
  if (!EVENT_NAME.test(input.eventName)) {
    throw new EventServiceError(422, 'VALIDATION_FAILED', '事件名必须使用小写 namespace.name')
  }
  requireText(input.projectId, 'projectId')
  requireText(input.idempotencyKey, 'idempotencyKey')
  validateRef(input.object)
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new EventServiceError(422, 'VALIDATION_FAILED', 'occurredAt 必须是 ISO 8601 时间')
  }
  if (input.actor.kind === 'USER') requireText(input.actor.userId, 'actor.userId')
  else requireText(input.actor.component, 'actor.component')

  if (input.sensitive) {
    const keys = Object.keys(input.payload)
    if (keys.length !== 1 || keys[0] !== 'references') {
      throw new EventServiceError(422, 'VALIDATION_FAILED', '敏感事件载荷只能包含 references')
    }
    input.payload.references.forEach(validateRef)
  }
}
