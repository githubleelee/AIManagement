import type { FieldError } from '../../shared/types.js'

export class AttachmentServiceError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409 | 422,
    public readonly kind: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
    public readonly details?: FieldError[],
  ) {
    super(message)
    this.name = 'AttachmentServiceError'
  }
}
