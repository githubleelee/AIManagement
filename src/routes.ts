/**
 * 路由集中注册表（冻结，决策 I-0 / I-9 / I-11）
 *
 * 冻结规则：各模块**不得自行** `app.get/post(...)` 挂载路由；
 * 只能导出自己的路由插件，由本文件集中 `register`。
 *
 * 当前工单 T0-01 仅提供健康检查与挂载点。后续工单按决策 I-8 的 30 个端点
 * 在此处追加注册；模块目录本身留空占位。
 */
import type { FastifyInstance } from 'fastify'

export function registerRoutes(app: FastifyInstance): void {
  // 基础设施端点：健康检查（不属于决策 I-8 的 30 个业务端点）
  app.get('/health', async () => ({ status: 'ok' }))

  // -------------------------------------------------------------------------
  // 模块路由挂载点（后续工单填充，各模块只导出插件、不自行 app.listen）
  // -------------------------------------------------------------------------
  // M1 身份与会话（T0-04/T0-03）→ src/auth
  // M2 项目与成员（T1.1–T1.7）  → src/modules/project
  // M3 授权与敏感可见（T2.x）   → src/modules/authz
  // M4 需求层级（T3.x）         → src/modules/requirement
  // M5 任务（T5.x）             → src/modules/task
  //
  // 示例（待各模块就绪后启用）：
  //   await app.register(projectRoutes)
  //   await app.register(authzRoutes)
}
