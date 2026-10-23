import type { EventObjectRef, EventQuery, PublishEventInput } from './contracts.js'
import { EventServiceError } from './errors.js'

const EVENT_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const UTC_MILLISECOND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const OFFSET_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new EventServiceError(422, 'VALIDATION_FAILED', `${field} 不能为空`)
}

function validateRef(ref: EventObjectRef): void {
  requireText(ref.objectType, 'objectType')
  requireText(ref.objectId, 'objectId')
}

function timestampMillis(value: string, field: string, pattern: RegExp): number {
  if (!pattern.test(value)) {
    throw new EventServiceError(422, 'VALIDATION_FAILED', `${field} 必须是完整的 ISO 8601 时间`)
  }
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) {
    throw new EventServiceError(422, 'VALIDATION_FAILED', `${field} 必须是有效时间`)
  }
  return millis
}

/** 查询边界允许显式偏移量，但进入仓储前统一转换为 UTC 毫秒格式。 */
export function normalizeEventQuery(query: EventQuery): EventQuery {
  const storedFromMillis = query.storedFrom
    ? timestampMillis(query.storedFrom, 'storedFrom', OFFSET_TIMESTAMP)
    : undefined
  const storedToMillis = query.storedTo
    ? timestampMillis(query.storedTo, 'storedTo', OFFSET_TIMESTAMP)
    : undefined
  if (
    storedFromMillis !== undefined &&
    storedToMillis !== undefined &&
    storedFromMillis > storedToMillis
  ) {
    throw new EventServiceError(422, 'VALIDATION_FAILED', 'storedFrom 不能晚于 storedTo')
  }
  return {
    ...query,
    ...(storedFromMillis === undefined
      ? {}
      : { storedFrom: new Date(storedFromMillis).toISOString() }),
    ...(storedToMillis === undefined ? {} : { storedTo: new Date(storedToMillis).toISOString() }),
  }
}

export function validatePublishEvent(input: PublishEventInput): void {
  if (!EVENT_NAME.test(input.eventName)) {
    throw new EventServiceError(422, 'VALIDATION_FAILED', '事件名必须使用小写 namespace.name')
  }
  requireText(input.projectId, 'projectId')
  requireText(input.idempotencyKey, 'idempotencyKey')
  validateRef(input.object)
  const occurredAtMillis = timestampMillis(
    input.occurredAt,
    'occurredAt',
    UTC_MILLISECOND_TIMESTAMP,
  )
  if (new Date(occurredAtMillis).toISOString() !== input.occurredAt) {
    throw new EventServiceError(
      422,
      'VALIDATION_FAILED',
      'occurredAt 必须是有效的 ISO 8601 UTC 毫秒时间',
    )
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
