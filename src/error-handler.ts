/**
 * 统一错误处理器（决策 I-2b / I-3 / I-4）
 *
 * 规则：
 *   1. 抛 AppError → 转成契约的 ErrorResponse（透传 status / code / message / details）。
 *   2. Fastify 请求体**解析层**错误（FST_ERR_CTP_INVALID_JSON_BODY /
 *      FST_ERR_CTP_EMPTY_JSON_BODY）→ 400 BAD_REQUEST。只按 Fastify 的错误码匹配，
 *      **不按 statusCode 区间匹配**，避免把其它 4xx 一律改写。
 *   3. 其它 Fastify 客户端错误（401 / 403 / 413 / 415 / 429 等）→ **保持原始状态码**。
 *      例如 T0-04 的 requireAuth 以 `throw errorWithStatus(401)` 报错时，若被改写成
 *      422 会破坏契约 I-4 的 UNAUTHENTICATED 流程。
 *   4. 未知异常 → 500，响应体**不含堆栈**，只给稳定的 INTERNAL_ERROR 与通用文案。
 *   5. 未知路由 → 404，同样使用 ErrorResponse 结构，保证失败响应只有一种形状。
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

/**
 * 请求体解析层错误：仅这两个 Fastify 错误码属于「请求体语法非法」，
 * 由解析层产生、没有可归属的字段，按契约 I-4 归 400 BAD_REQUEST。
 */
const PARSE_ERROR_CODES = new Set([
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
])

/** 读取 Fastify 赋在错误对象上的 code（error 参数类型为 unknown）。 */
function fastifyErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  const { code } = error as { code?: unknown }
  return typeof code === 'string' ? code : undefined
}

/** 读取 Fastify 赋在错误对象上的 statusCode（error 参数类型为 unknown）。 */
function clientStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined
  }
  const { statusCode } = error as { statusCode?: unknown }
  return typeof statusCode === 'number' ? statusCode : undefined
}

/**
 * 已知客户端状态码 → 契约 I-4 顶层码。
 * 未列出的 4xx（如 413 / 415 / 429）本轮不新增错误码，
 * 用通用的 BAD_REQUEST 承载，是否单列留 Sprint 2 评估（状态码本身保持不变）。
 */
const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    // 1) 契约内错误：AppError 携带了 status / code / message / details
    if (error instanceof AppError) {
      const body = toErrorResponse(error.code, error.message, error.details)
      return reply.status(error.status).send(body)
    }

    // 2) 请求体解析层错误：只匹配 Fastify 的错误码，不透传解析器内部信息
    if (PARSE_ERROR_CODES.has(fastifyErrorCode(error) ?? '')) {
      return reply.status(400).send(toErrorResponse('BAD_REQUEST', '请求体不是合法的 JSON'))
    }

    // 3) 其它 Fastify 客户端错误：保持原始状态码，禁止按 4xx 区间改写。
    //    401/403/413/415/429 等必须原样透出，避免劫持鉴权与传输层语义。
    const statusCode = clientStatusCode(error)
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const code = STATUS_TO_CODE[statusCode] ?? 'BAD_REQUEST'
      return reply.status(statusCode).send(toErrorResponse(code, '请求无法处理'))
    }

    // 4) 未知异常：不把 error.message 与堆栈暴露给调用方，仅服务端记录
    app.log.error(error)
    return reply.status(500).send(toErrorResponse('INTERNAL_ERROR', '服务器内部错误'))
  })

  // 5) 未匹配的路径也返回统一信封
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send(toErrorResponse('NOT_FOUND', '资源不存在'))
  })
}
