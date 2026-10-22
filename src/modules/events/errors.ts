import { AppError } from '../../shared/errors.js'

export type EventServiceErrorKind =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'

/**
 * 事件模块的稳定错误类型，同时属于公共 AppError 体系。
 * 这样未来任何 HTTP 入口都由统一错误处理器转换为对应 4xx，而不会退化成未知 500。
 */
export class EventServiceError extends AppError {
  constructor(
    status: 403 | 404 | 409 | 422,
    public readonly kind: EventServiceErrorKind,
    message: string,
  ) {
    super(status, kind, message)
    this.name = 'EventServiceError'
  }
}
