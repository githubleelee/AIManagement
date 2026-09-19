/**
 * Fastify 应用装配（T0-01）
 *
 * 只做三件事：注册统一错误处理器、集中注册路由、提供依赖注入缝隙。
 * 业务模块不得在这里 import 自己的 handler；统一走 routes.ts。
 *
 * ---------------------------------------------------------------------------
 * 【本次扩展】为什么新增 `prisma` 可选注入（T0 缺口修补）
 *
 * 契约「Testing Decisions → 唯一 seam」规定：**HTTP 接口层是唯一测试 seam**，
 * 且「越权用例必须打接口，不能用『前端不渲染按钮』代替」。
 *
 * 但原装配只有 `buildApp({ logger })`，而数据库来自 `src/db/client.ts` 的
 * **模块级单例**——该单例在首次构造时绑定当时的 `DATABASE_URL`，之后不再重新绑定
 * （见 test/db-client-isolation.test.ts 的探针结论）。
 *
 * 后果：`buildApp()` 构造出的 app 永远查单例，也就是**永远连 `.env` 的 dev.db**，
 * 无法指向测试用临时库。于是「打接口」的测试要么污染开发库，要么无法隔离。
 * 这是 T0 交付的真缺口：数据层可测（97 例），但 **HTTP 层没有注入缝隙**，
 * 导致契约要求的「接口层越权测试」在四个模块上都写不出来。
 *
 * 修补方式（**向后兼容，不改变任何既有行为**）：
 *   - 新增可选参数 `prisma`。**不传时行为与原先完全一致**（回落全局单例）。
 *   - 现有调用 `buildApp({ logger: false })` 与 `buildApp()` 均无需改动。
 *   - 测试改为 `buildApp({ prisma: tempDb.prisma })`，即可让 app 指向独立临时库。
 *
 * 本扩展不改动 `src/db/client.ts`（仍保持单例语义），不触碰 `AppError`、
 * 错误码表或任何既有签名，因此**不构成契约变更**；待模块负责人接管后可调整。
 * ---------------------------------------------------------------------------
 */
import Fastify, { type FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { registerErrorHandler } from './error-handler.js'
import { registerRoutes, type RouteContext } from './routes.js'
import { registerActorResolver } from './auth/actor.js'
import { prisma as defaultPrisma } from './db/client.js'

export type BuildAppOptions = {
  /** 是否开启 Fastify 日志。测试环境建议关闭，避免噪声。 */
  logger?: boolean
  /**
   * 数据库客户端注入点。
   *
   * 不传时回落到 `src/db/client.ts` 的全局单例（生产 / 本地开发路径）；
   * 测试传入 `createTempDatabase().prisma` 以使用独立临时库，避免污染 dev.db。
   */
  prisma?: PrismaClient
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
  })

  // 不传 prisma 时与原先行为完全一致（回落单例）
  const context: RouteContext = { prisma: options.prisma ?? defaultPrisma }

  registerErrorHandler(app)
  // Actor 解析：只把「当前是谁」注入 request，不做权限判定（权限一律由 can() 现查库）。
  // 采用 onRequest 钩子而非全局强制鉴权，避免误拦公开端点（如端点 1 登录）。
  registerActorResolver(app, context.prisma)
  registerRoutes(app, context)

  return app
}
