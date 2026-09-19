/**
 * Fastify 应用装配（T0-01）
 *
 * 只做两件事：注册统一错误处理器、集中注册路由。
 * 业务模块不得在这里 import 自己的 handler；统一走 routes.ts。
 */
import Fastify, { type FastifyInstance } from 'fastify'
import { registerErrorHandler } from './error-handler.js'
import { registerRoutes } from './routes.js'

export type BuildAppOptions = {
  /** 是否开启 Fastify 日志。测试环境建议关闭，避免噪声。 */
  logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
  })

  registerErrorHandler(app)
  registerRoutes(app)

  return app
}
