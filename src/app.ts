import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { AppError, UnauthenticatedError, type ErrorResponse } from './shared/errors'
import { toFieldErrors } from './shared/validation'
import { registerRoutes } from './routes'

// 应用装配。统一错误处理器是全部端点唯一的错误出口（决策 I-2b、I-3）：
// 业务代码只抛 AppError，Zod 校验失败自动转 422，其余异常一律 500 且不泄漏堆栈。

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const body: ErrorResponse = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      }
      return reply.status(error.status).send(body)
    }

    if (error instanceof UnauthenticatedError) {
      return reply.status(401).send({
        error: { code: 'UNAUTHENTICATED', message: error.message },
      } satisfies ErrorResponse)
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: '字段校验失败',
          details: toFieldErrors(error.issues),
        },
      } satisfies ErrorResponse)
    }

    // Fastify 内置错误（如请求体不是合法 JSON）带 statusCode
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode === 401) {
      return reply.status(401).send({
        error: { code: 'UNAUTHENTICATED', message: '未登录或凭证失效' },
      } satisfies ErrorResponse)
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: { code: 'VALIDATION_FAILED', message: '请求无效' },
      } satisfies ErrorResponse)
    }

    return reply.status(500).send({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
    } satisfies ErrorResponse)
  })

  app.get('/health', async () => ({ status: 'ok' }))

  registerRoutes(app)
  return app
}
