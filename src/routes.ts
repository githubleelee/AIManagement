/**
 * 路由集中注册表（冻结，决策 I-0 / I-9 / I-11）
 *
 * 各模块只导出路由插件，由本文件集中注册；数据库依赖通过 RouteContext 注入。
 */
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { registerAuthRoutes } from './auth/plugin.js'
import { registerAcceptanceRoutes } from './modules/acceptance/plugin.js'
import { registerSensitivityRoutes } from './modules/authz/plugin.js'
import { registerProjectRoutes } from './modules/project/plugin.js'
import { registerTaskRoutes } from './modules/task/routes.js'
import { registerWorkloadRoutes } from './modules/workload/plugin.js'
import { registerWorkbenchRoutes } from './modules/workbench/plugin.js'
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

  // A / US-08 个人工作台（工单 #28）：GET /me/workbench。
  // 该端点不在 Sprint 1 契约的 30 个端点内，属本阶段新增（见 docs/us-08-workbench-api.md）。
  registerWorkbenchRoutes(app, context)

  // A / US-09 任务验收（工单 #29）：POST /tasks/:taskId/acceptance、
  // GET /tasks/:taskId/acceptances、GET /projects/:projectId/acceptance-queue。
  // 同样不在 Sprint 1 契约的 30 个端点内，属本阶段新增（见 docs/us-09-acceptance-api.md）。
  // 注意：这两个路径与 M3 已注册的 PUT /tasks/:taskId/sensitivity 后缀不同，
  // 不与 M2 的 /projects/... 前缀冲突（Fastify 同 method+path 重复注册会抛
  // FST_ERR_DUPLICATED_ROUTE 使整个应用无法构建）。
  registerAcceptanceRoutes(app, context)

  // B / US-07 成员任务图与负载（工单 #27）：GET /projects/:projectId/workload、
  // GET /projects/:projectId/workload/:userId。
  // 同样不在 Sprint 1 契约的 30 个端点内，属本阶段新增（见 docs/role-b-workload-design.md）。
  // 只读聚合：复用既有 project.read 权限，不新增 Action。
  registerWorkloadRoutes(app, context)
}
