export class NotificationServiceError extends Error {
  constructor(
    public readonly status: 404 | 409 | 422,
    public readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'NotificationServiceError'
  }
}
