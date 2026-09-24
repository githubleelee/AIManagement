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
import { registerTaskRoutes } from './modules/task/routes.js'
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

  // M5 任务（端点 24–29）：24 故事任务列表 / 25 创建任务 / 26 按项目列任务 /
  // 27 任务详情 / 28 部分更新 / 29 删除。
  // 注意：端点 30（PUT /tasks/:taskId/sensitivity）唯一归属 M3，由上方
  // registerSensitivityRoutes 注册；M5 不得再注册，否则 Fastify 抛
  // FST_ERR_DUPLICATED_ROUTE 使整个应用无法构建。
  registerTaskRoutes(app, context)
}
