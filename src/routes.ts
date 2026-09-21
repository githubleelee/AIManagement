/**
 * 路由集中注册表（冻结，决策 I-0 / I-9 / I-11）
 *
 * 各模块只导出路由插件，由本文件集中注册；数据库依赖通过 RouteContext 注入。
 */
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { registerAuthRoutes } from './auth/plugin.js'
import { registerSensitivityRoutes } from './modules/authz/plugin.js'
import { registerProjectRoutes } from './modules/project/plugin.js'
import { registerRequirementRoutes } from './modules/requirement/plugin.js'

export type RouteContext = {
  prisma: PrismaClient
}

export function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/health', async () => ({ status: 'ok' }))

  // M1 身份与会话（端点 1–2）
  registerAuthRoutes(app, context)

  // M2 项目与成员（端点 3–9）
  registerProjectRoutes(app, context)

  // M3 授权与敏感可见（端点 23、30）
  registerSensitivityRoutes(app, context)

  // M4 需求层级（端点 10–22）
  registerRequirementRoutes(app, context)

  // M5 任务（端点 24–30 中除敏感设置外的路由）尚未合入 main。
}
