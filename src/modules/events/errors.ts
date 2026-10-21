export type EventServiceErrorKind =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'

export class EventServiceError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409 | 422,
    public readonly kind: EventServiceErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'EventServiceError'
  }
}
