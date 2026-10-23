/**
 * 路由集中注册表（冻结，决策 I-0 / I-9 / I-11）
 *
 * 各模块只导出路由插件，由本文件集中注册；数据库依赖通过 RouteContext 注入。
 */
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { registerAuthRoutes } from './auth/plugin.js'
import { registerAcceptanceRoutes } from './modules/acceptance/plugin.js'
import { registerAnalyticsRoutes } from './modules/analytics/plugin.js'
import { registerSensitivityRoutes } from './modules/authz/plugin.js'
import { registerProjectRoutes } from './modules/project/plugin.js'
import { registerRiskRoutes } from './modules/risk/plugin.js'
import { registerTaskRoutes } from './modules/task/routes.js'
import { registerWorkloadRoutes } from './modules/workload/plugin.js'
import { registerGanttRoutes } from './modules/gantt/plugin.js'
import { registerBoardRoutes } from './modules/board/plugin.js'
import { registerWorkbenchRoutes } from './modules/workbench/plugin.js'
import { registerRequirementRoutes } from './modules/requirement/plugin.js'
import { registerAiRoutes } from './modules/ai/plugin.js'
import { registerNotificationRoutes } from './modules/notification/plugin.js'
import type { NotificationService } from './modules/notification/service.js'
import type { AiBreakdownService } from './modules/ai/service.js'
import type { GanttEventPort } from './modules/gantt/types.js'
import type { RequirementEventPort } from './modules/requirement/service.js'
import type { RiskEventPort } from './modules/risk/types.js'

export type RouteContext = {
  prisma: PrismaClient
  /**
   * #31 US-11 AI 建议服务（由 `src/app.ts` 显式组装注入）。
   *
   * 为什么用服务实例而不是在 `registerRoutes` 里现建：AI 模块的插件签名是
   * `registerAiRoutes(app, { service })`（D 的独立实现），组装（模型端口 / 仓储 / 鉴权 /
   * 故事来源）必须留在唯一组装点 `src/app.ts`，路由总表只负责注册。
   * 可选：模块测试可能只构造 `{ prisma }` 并注册部分路由；缺省时跳过 AI 路由注册。
   */
  aiService?: AiBreakdownService
  /**
   * 甘特域事件发布端口（由 `src/app.ts` 用 `createGanttEventPort` 显式组装注入）。
   *
   * 为什么用端口实例而不是在插件里现建：组装（仓储 / 事务适配器）必须留在唯一组装点
   * `src/app.ts`；路由总表只负责注册。可选：模块测试可能只构造 `{ prisma }` 并注册
   * 部分路由；缺省时 `registerGanttRoutes` 会 fail-fast 报组装缺失（不得静默跳过发布）。
   */
  ganttEvents?: GanttEventPort
  /** 需求域事件发布端口（由 `createRequirementEventPort` 组装注入，同上）。 */
  requirementEvents?: RequirementEventPort
  /**
   * 风险域事件发布端口（由 `src/app.ts` 用 `createRiskEventPort` 显式组装注入）。
   *
   * 与 `ganttEvents` / `requirementEvents` 同构：组装留在唯一组装点 `src/app.ts`，
   * 路由总表只负责注册。可选；缺省时 `registerRiskRoutes` 会 fail-fast 报组装缺失
   * （不得静默跳过发布）。事件名见 `src/modules/risk/types.ts` 的 `RiskEventName`。
   */
  riskEvents?: RiskEventPort
  /**
   * #34 站内通知服务（由 `src/app.ts` 用真实仓储 / 接收者解析器 / #37 适配器显式组装）。
   *
   * 组装（仓储 / 解析器 / 事件源）留在唯一组装点 `src/app.ts`；路由总表只负责注册。
   * 缺失即 fail-fast —— **禁止** hasRoute 跳过、默认 no-op 或内存仓储回退（本批任务约束）。
   */
  notificationService?: NotificationService
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

  // A / US-10 进度·健康度·风险与关闭阻断（工单 #30）：GET /projects/:projectId/dashboard、
  // GET /projects/:projectId/closure-check、风险台账（/risks 增改）与关闭 / 重开。
  // 不在 Sprint 1 契约的 30 个端点内，属本阶段新增（见 docs/us-10-progress-risk-api.md）。
  // 挂载授权：项目负责人 2026-10-18 批复第 3、4 项「改由 A 在 B 的登记范围内自行挂载」。
  registerAnalyticsRoutes(app, context)
  registerRiskRoutes(app, context)

  // B / US-06 甘特图（工单 #26）：GET /projects/:projectId/gantt。
  // 不在 Sprint 1 契约的 30 个端点内，属本阶段新增（见 docs/role-b-gantt-design.md）。
  // 只读聚合：复用既有 project.read，不新增 Action；里程碑 / 依赖写入属后续批次（#12，待公共事件端口）。
  registerGanttRoutes(app, context)

  // B / US-04 故事看板（工单 #25）：GET /projects/:projectId/board（只读三列）。
  // 不在 Sprint 1 契约的 30 个端点内，属本阶段新增（见 docs/role-b-board-design.md）。
  // 状态写入仍走既有 PATCH /stories/:storyId（端点 21），本模块不建镜像写入口。
  registerBoardRoutes(app, context)

  // #31 US-11 AI 建议（B 公共接入）：POST / AI 建议生成、GET 列表、POST 处置。
  // 不在 Sprint 1 契约的 30 个端点内，属本阶段新增；服务由 `src/app.ts` 组装后经 context 注入。
  // 三个入口均 `requireAuth`，服务端逐次走 `can()`（read 复用 project.read；生成 / 处置仅 PM）。
  if (context.aiService) registerAiRoutes(app, { service: context.aiService })

  // #34 站内通知（B 公共接入）：GET /me/notifications、GET /notifications/:id、
  // PATCH /notifications/:id/read。不在 Sprint 1 契约的 30 个端点内，属本阶段新增。
  // 服务（真实 DB 仓储 / 权威接收者解析器 / #37 适配器）由 `src/app.ts` 组装后经 context 注入；
  // **缺失即 fail-fast**：不得 hasRoute 跳过、不得默认 no-op、不得回退内存仓储（本批约束）。
  if (!context.notificationService) {
    throw new Error(
      '通知服务未组装：src/app.ts 必须注入真实 notificationService（禁止 hasRoute 跳过 / 默认 no-op / 内存仓储回退）',
    )
  }
  registerNotificationRoutes(app, context.notificationService)
}
