/**
 * US-07 成员任务图与负载（GitHub #27）—— 路由插件。
 *
 * 只导出插件，**不自行 `app.get()` 挂生产路由**：正式注册行在冻结的
 * `src/routes.ts` 里（契约决策 I-0 / I-9）；公共挂载由主代理另批完成（本地 #07）。
 *
 * 端点（仓库既有契约**无 `/api` 前缀**，与其它模块一致）：
 *   - `GET /projects/:projectId/workload`
 *       权限 `project.read`；非成员 / 项目不存在 → 404（响应逐字一致，不泄漏存在性）。
 *       响应 `{ projectId, basis: { scopeLabel }, members: [...] }`。
 *   - `GET /projects/:projectId/workload/:userId`
 *       同一入口权限；`userId` 非本项目成员 → 与项目不存在逐字一致的 404。
 *       响应 `{ projectId, userId, basis, total, truncated, items }`。
 *
 * 只读：不新增 `Action`、不改 `permissions.ts`、不 import 其他模块 service。
 * 响应包裹与错误处理沿用仓库既有约定（`AppError` + `requireAuth`，不自造信封）。
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { createAuthorization } from '../authz/permissions.js'
import type { RouteContext } from '../../routes.js'
import { buildMemberWorkload, buildProjectWorkload } from './service.js'

/**
 * 「项目不存在 / 我不可见 / 目标成员不在本项目」的**单一 404 文案**。
 *
 * 契约决策 I-3 要求这几条路径返回**完全一致**的响应，否则调用方能靠文案差异
 * 探测项目或成员是否存在。提成常量可让这条约束在代码里只有一处可改。
 * 与 `src/modules/project/plugin.ts` 的 `PROJECT_NOT_FOUND_MESSAGE` 取值一致。
 */
const PROJECT_NOT_FOUND_MESSAGE = '项目不存在'

export function registerWorkloadRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // 唯一鉴权入口来自 authz（决策 I-9：不复制权限逻辑，一律问 can()）。
  const { can } = createAuthorization(ctx.prisma)

  // ===========================================================================
  // GET /projects/:projectId/workload —— 权限 project.read
  //
  // 响应  200 { projectId, basis: { scopeLabel }, members: MemberWorkloadRow[] }
  // 错误  401 UNAUTHENTICATED；404 NOT_FOUND（非成员 / 项目不存在）
  // ===========================================================================
  app.get('/projects/:projectId/workload', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { projectId } = req.params as { projectId: string }

    // 契约 I-5 约束 2：status / code 由 can() 直接给出，调用方不自行判断 403/404。
    const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
    if (!decision.allow) {
      throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
    }

    const view = await buildProjectWorkload(ctx.prisma, actorUserId, projectId)
    return reply.status(200).send(view)
  })

  // ===========================================================================
  // GET /projects/:projectId/workload/:userId —— 权限 project.read
  //
  // 响应  200 { projectId, userId, basis, total, truncated, items }
  // 错误  401 UNAUTHENTICATED；404 NOT_FOUND（非成员 / 项目不存在 / 目标非本项目成员）
  // ===========================================================================
  app.get(
    '/projects/:projectId/workload/:userId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { projectId, userId } = req.params as { projectId: string; userId: string }

      const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
      }

      const detail = await buildMemberWorkload(ctx.prisma, actorUserId, projectId, userId)
      // 目标 userId 非本项目成员 → 与项目不存在**逐字一致**的 404（不泄漏存在性）。
      if (!detail) throw new AppError(404, 'NOT_FOUND', PROJECT_NOT_FOUND_MESSAGE)

      return reply.status(200).send(detail)
    },
  )
}
