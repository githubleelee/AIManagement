/**
 * 统一错误处理器（决策 I-2b / I-3 / I-4）
 *
 * 规则：
 *   1. 抛 AppError → 转成契约的 ErrorResponse（透传 status / code / message / details）。
 *   2. 未知异常 → 500，响应体**不含堆栈**，只给稳定的 INTERNAL_ERROR 与通用文案。
 *   3. 未知路由 → 404，同样使用 ErrorResponse 结构，保证失败响应只有一种形状。
 *
 * 这是唯一允许拼装 ErrorResponse 的地方（唯一错误出口）。
 */
import type { FastifyInstance } from 'fastify'
import { AppError } from './shared/errors.js'
import type { ErrorCode, ErrorResponse } from './shared/types.js'

function toErrorResponse(
  code: ErrorCode,
  message: string,
  details?: ErrorResponse['error']['details'],
): ErrorResponse {
  return details && details.length > 0
    ? { error: { code, message, details } }
    : { error: { code, message } }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    // 1) 契约内错误：AppError 携带了 status / code / message / details
    if (error instanceof AppError) {
      const body = toErrorResponse(error.code, error.message, error.details)
      return reply.status(error.status).send(body)
    }

    // 2) 未知异常：不把 error.message 与堆栈暴露给调用方，仅服务端记录
    app.log.error(error)
    return reply.status(500).send(toErrorResponse('INTERNAL_ERROR', '服务器内部错误'))
  })

  // 3) 未匹配的路径也返回统一信封
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send(toErrorResponse('NOT_FOUND', '资源不存在'))
  })
}
