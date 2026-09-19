// 共享错误类型（接口契约决策 I-3、I-4、I-2b，冻结）

// 字段级错误码（位于 ErrorResponse.error.details[].code）
export type FieldErrorCode =
  | 'REQUIRED'
  | 'TOO_LONG'
  | 'INVALID_FORMAT'
  | 'INVALID_VALUE'
  | 'DUPLICATE'
  | 'USER_NOT_FOUND'
  | 'NOT_PROJECT_MEMBER'
  | 'ACCEPTOR_EQUALS_OWNER'
  | 'END_BEFORE_START'
  | 'INSUFFICIENT_MEMBERS'
  | 'SELF_REMOVAL_FORBIDDEN'
  | 'LAST_PM'
  | 'CROSS_PROJECT_REF'
  | 'HAS_CHILDREN'

export type FieldError = { field: string; code: FieldErrorCode }

// 顶层错误码（接口契约决策 I-4）。INTERNAL 不在契约表中，仅用于未预期异常的 500 响应。
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'INTERNAL'

export type ErrorResponse = {
  error: {
    code: ErrorCode
    message: string
    details?: FieldError[]
  }
}

// 统一错误出口：业务规则失败一律抛 AppError（接口契约决策 I-2b）
export class AppError extends Error {
  constructor(
    public status: 403 | 404 | 409 | 422,
    public code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
    public details?: FieldError[],
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// 401 不在 AppError 契约签名内，单独建模，避免改动冻结的 AppError
export class UnauthenticatedError extends Error {
  readonly status = 401 as const
  readonly code = 'UNAUTHENTICATED' as const
  constructor(message = '未登录或凭证失效') {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}
