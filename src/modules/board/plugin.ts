/**
 * US-04 故事看板（GitHub #25，本地 #17）—— 路由插件（只读批次）。
 *
 * 只导出插件，**不自行挂载生产路由**：正式注册行在冻结的 `src/routes.ts` 里
 * （契约决策 I-0 / I-9）；公共挂载由主代理另批完成（本地 #19）。
 *
 * 端点（仓库既有契约**无 `/api` 前缀**，与其它模块一致）：
 *   - `GET /projects/:projectId/board`
 *       权限 `project.read`；非成员 / 项目不存在 → 404（响应逐字一致，不泄漏存在性）。
 *       响应 `BoardView`（见 `./types.ts`）。
 *
 * 只读：不新增 `Action`、不改 `permissions.ts`、不 import 其他模块 service。
 * 响应包裹与错误处理沿用仓库既有约定（`AppError` + `requireAuth`，不自造信封）。
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { createAuthorization } from '../authz/permissions.js'
import type { RouteContext } from '../../routes.js'
import { buildBoardView } from './service.js'

/**
 * 「项目不存在 / 我不可见」的**单一 404 文案**（契约决策 I-3）。
 * 与 `src/modules/project/plugin.ts`、`src/modules/workload/plugin.ts`、
 * `src/modules/gantt/plugin.ts` 取值逐字一致。
 */
const PROJECT_NOT_FOUND_MESSAGE = '项目不存在'

export function registerBoardRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // 唯一鉴权入口来自 authz（决策 I-9：不复制权限逻辑，一律问 can()）。
  const { can } = createAuthorization(ctx.prisma)

  // ===========================================================================
  // GET /projects/:projectId/board —— 权限 project.read
  //
  // 响应  200 BoardView
  // 错误  401 UNAUTHENTICATED；404 NOT_FOUND（非成员 / 项目不存在）
  // ===========================================================================
  app.get('/projects/:projectId/board', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { projectId } = req.params as { projectId: string }

    // 契约 I-5 约束 2：status / code 由 can() 直接给出，调用方不自行判断 403/404。
    const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
    if (!decision.allow) {
      throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
    }

    const view = await buildBoardView(ctx.prisma, actorUserId, projectId)
    return reply.status(200).send(view)
  })
}
