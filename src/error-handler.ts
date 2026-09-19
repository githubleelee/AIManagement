/**
 * 统一错误处理器（决策 I-2b / I-3 / I-4）
 *
 * 规则：
 *   1. 抛 AppError → 转成契约的 ErrorResponse（透传 status / code / message / details）。
 *   2. Fastify 自身的客户端错误（如非法 JSON 请求体、不支持的媒体类型）→ 4xx，
 *      使用 VALIDATION_FAILED(422)。契约 I-3 规定所有失败响应为 4xx；若落到 500，
 *      会把客户端输入错误误报为服务端故障（且触发无意义的错误日志）。
 *   3. 未知异常 → 500，响应体**不含堆栈**，只给稳定的 INTERNAL_ERROR 与通用文案。
 *   4. 未知路由 → 404，同样使用 ErrorResponse 结构，保证失败响应只有一种形状。
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

/** 读取 Fastify 赋在错误对象上的 4xx statusCode（error 参数类型为 unknown）。 */
function clientStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined
  }
  const { statusCode } = error as { statusCode?: unknown }
  return typeof statusCode === 'number' ? statusCode : undefined
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    // 1) 契约内错误：AppError 携带了 status / code / message / details
    if (error instanceof AppError) {
      const body = toErrorResponse(error.code, error.message, error.details)
      return reply.status(error.status).send(body)
    }

    // 2) Fastify 自身的客户端错误（FST_ERR_CTP_* 等）：带 4xx statusCode
    //    契约 I-3 要求失败响应为 4xx；I-4 中唯一能承载「格式非法」的顶层码是
    //    VALIDATION_FAILED(422)。不透传 error.message，避免泄漏库内部信息。
    const statusCode = clientStatusCode(error)
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.status(422).send(toErrorResponse('VALIDATION_FAILED', '请求格式非法'))
    }

    // 3) 未知异常：不把 error.message 与堆栈暴露给调用方，仅服务端记录
    app.log.error(error)
    return reply.status(500).send(toErrorResponse('INTERNAL_ERROR', '服务器内部错误'))
  })

  // 4) 未匹配的路径也返回统一信封
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send(toErrorResponse('NOT_FOUND', '资源不存在'))
  })
}
