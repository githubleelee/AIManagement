import type { FastifyInstance } from 'fastify'
import { registerProjectRoutes } from './modules/project/routes'

// 路由注册表（冻结，技术负责人唯一修改人）。
// 各模块只导出自己的路由注册函数；模块之间禁止互相调用 service（决策 I-9）。
// 未实现的模块不注册，避免出现无鉴权的半成品端点。

export function registerRoutes(app: FastifyInstance): void {
  registerProjectRoutes(app)
}
