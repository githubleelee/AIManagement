/**
 * 共享契约 —— 应用错误类（冻结）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md` 决策 I-2b。
 *
 * 唯一错误出口：所有端点不得自行拼装 ErrorResponse，一律通过抛 AppError
 * 或由 Zod 校验失败自动转换；Fastify 统一错误处理器负责转成决策 I-3 的
 * ErrorResponse。未抛 AppError 的异常一律转 500，且响应体不包含堆栈。
 *
 * 401 出口规则：未登录 / 凭证失效不属于 AppError 的 4xx 子集（契约 I-2b 的
 * AppError 仅为 403/404/409/422），由 M1 抛「带 statusCode=401 的错误」，
 * 统一错误处理器按原始状态码透出并映射为 UNAUTHENTICATED（契约 I-4）。
 */
import type { FieldError } from './types.js'

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
