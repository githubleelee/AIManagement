/**
 * 路由集中注册表（冻结，决策 I-0 / I-9 / I-11）
 *
 * 冻结规则：各模块**不得自行** `app.get/post(...)` 挂载路由；
 * 只能导出自己的路由插件，由本文件集中 `register`。
 *
 * 当前工单 T0-01 仅提供健康检查与挂载点。后续工单按决策 I-8 的 30 个端点
 * 在此处追加注册；模块目录本身留空占位。
 *
 * ---------------------------------------------------------------------------
 * 【本次扩展】`RouteContext` 参数（T0 缺口修补，向后兼容）
 *
 * 原签名为 `registerRoutes(app)`，模块插件拿不到数据库，只能各自 import
 * `src/db/client.ts` 的全局单例。那会使**测试无法把 app 指向独立临时库**
 * （原因详见 src/app.ts 顶部说明），与契约「HTTP 层是唯一测试 seam」冲突。
 *
 * 现改为 `registerRoutes(app, context)`，把数据库作为参数向下传递：
 *   - 模块插件统一写成 `(app, { prisma }) => void`，不再 import 单例；
 *   - 测试通过 `buildApp({ prisma })` 即可注入独立临时库。
 *
 * 该改动**不删除任何既有内容**，仅是签名扩展；`context` 目前只有 `prisma` 一个字段，
 * 后续如需更多依赖（如时钟、配置）在此追加即可。
 * ---------------------------------------------------------------------------
 */
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { registerAuthRoutes } from './auth/plugin.js'
import { registerRequirementRoutes } from './modules/requirement/plugin.js'
import { registerProjectRoutes } from './modules/project/plugin.js'

/** 路由注册所需的依赖集合。模块插件通过它取得数据库，而非 import 全局单例。 */
export type RouteContext = {
  prisma: PrismaClient
}

export function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  // 基础设施端点：健康检查（不属于决策 I-8 的 30 个业务端点）
  app.get('/health', async () => ({ status: 'ok' }))

  // -------------------------------------------------------------------------
  // 模块路由挂载点（各模块只导出插件、不自行 app.listen）
  //
  // 各模块插件统一签名：(app: FastifyInstance, ctx: RouteContext) => void
  // -------------------------------------------------------------------------

  // M1 身份与会话（T0-04，端点 1/2）：登录与当前用户
  registerAuthRoutes(app, context)

  // M2 项目与成员（T1.1–T1.7，端点 3–9）
  registerProjectRoutes(app, context)

  // M3 授权与敏感可见（T2.x）→ src/modules/authz（仅提供 can()/visibilityScope()，无独立端点）

  // M4 需求层级（T3.1–T3.10，端点 10–22）
  // 注册此行前，本模块的端点在生产 app 上一律 404（模块只导出插件、不自挂路由）。
  registerRequirementRoutes(app, context)

  // M5 任务（T5.x）→ src/modules/task
}
