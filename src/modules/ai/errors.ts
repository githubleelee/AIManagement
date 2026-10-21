export type AiServiceErrorKind =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'

export class AiServiceError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409 | 422,
    public readonly kind: AiServiceErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'AiServiceError'
  }
}

/**
 * 模型端口内部的稳定错误语义。当前公共 ErrorCode 没有 AI 专用错误码，因此：
 * - INVALID_RESPONSE / DATA_POLICY_VIOLATION 由业务服务转换为 422；
 * - TIMEOUT / SERVICE_UNAVAILABLE 交给统一错误出口返回不泄漏细节的 500；
 * - MODE_NOT_CONFIGURED 在应用组装阶段直接失败，禁止静默降级到本地桩。
 */
export type AiPortErrorCode =
  | 'AI_TIMEOUT'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_DATA_POLICY_VIOLATION'
  | 'AI_MODE_NOT_CONFIGURED'

export class AiPortError extends Error {
  constructor(
    public readonly code: AiPortErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'AiPortError'
  }
}
