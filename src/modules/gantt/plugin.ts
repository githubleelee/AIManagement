/**
 * US-06 甘特图（GitHub #26，本地 #11 只读 + #12 写路径）—— 路由插件。
 *
 * 只导出插件，**不自行挂载生产路由**：正式注册行在冻结的 `src/routes.ts` 里
 * （契约决策 I-0 / I-9）；公共挂载由主代理另批完成。
 *
 * 端点（仓库既有契约**无 `/api` 前缀**，与其它模块一致）：
 *
 *   - `GET /projects/:projectId/gantt`               200 `GanttView`
 *       权限 `project.read`；非成员 / 项目不存在 → 404（响应逐字一致，不泄漏存在性）。
 *   - `POST /projects/:projectId/milestones`         201 `MilestoneWriteView`
 *   - `PATCH /milestones/:milestoneId`               200 `MilestoneWriteView`
 *   - `DELETE /milestones/:milestoneId`              204
 *   - `POST /projects/:projectId/task-dependencies`  201 `TaskDependencyView`
 *   - `DELETE /task-dependencies/:dependencyId`      204
 *
 * 写端点权限一律 `gantt.write`（仅 PM：MEMBER / VIEWER 403，非成员 404，未登录 401）；
 * **判权在 `./write.ts` 内通过唯一入口 `can()` 完成** —— 按 id 操作必须先解析真实
 * `projectId` 再判权，本层只做形状校验（Zod）与响应码。
 *
 * 错误处理沿用仓库既有约定（`AppError` + `requireAuth`，不自造信封、不改错误信封形状）。
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { dateSchema, toFieldErrors } from '../../shared/validation.js'
import { createAuthorization } from '../authz/permissions.js'
import type { RouteContext } from '../../routes.js'
import { buildGanttView } from './service.js'
import { MILESTONE_NAME_MAX_LENGTH } from './types.js'
import {
  createDependency,
  createMilestone,
  deleteDependency,
  deleteMilestone,
  updateMilestone,
} from './write.js'

/**
 * 「项目不存在 / 我不可见」的**单一 404 文案**（契约决策 I-3）。
 * 与 `src/modules/project/plugin.ts`、`src/modules/workload/plugin.ts` 取值逐字一致。
 */
const PROJECT_NOT_FOUND_MESSAGE = '项目不存在'

/**
 * 新建 / 修改里程碑。
 *
 * `dueDate` 只校验 `'YYYY-MM-DD'` 形状（决策 I-10）；`2026-02-30` 这类日历不存在
 * 的值由 `./write.ts` 判 422 `INVALID_VALUE`（业务校验不塞进 Zod）。
 * `taskIds` 在 PATCH 里**出现即整体替换**关联集。
 */
const milestoneCreateSchema = z.object({
  name: z.string().trim().min(1).max(MILESTONE_NAME_MAX_LENGTH),
  dueDate: dateSchema,
  ownerUserId: z.string().min(1).nullable().optional(),
  taskIds: z.array(z.string().min(1)).optional(),
})

/** 修改里程碑：全部字段可选（部分更新）。 */
const milestonePatchSchema = milestoneCreateSchema.partial()

/**
 * 新建 FS 依赖。
 *
 * `type` 刻意**不用** `z.enum(['FS'])`：那会映射成 `INVALID_VALUE`，而本票要求
 * `UNSUPPORTED_DEPENDENCY_TYPE`（422）。故这里只校验形状，取值由 `./write.ts` 拒绝。
 */
const dependencyCreateSchema = z.object({
  predecessorTaskId: z.string().min(1),
  successorTaskId: z.string().min(1),
  type: z.string().min(1).optional(),
})

function validationFailed(error: z.ZodError): AppError {
  return new AppError(422, 'VALIDATION_FAILED', '字段校验失败', toFieldErrors(error.issues))
}

export function registerGanttRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // 唯一鉴权入口来自 authz（决策 I-9：不复制权限逻辑，一律问 can()）。
  const { can } = createAuthorization(ctx.prisma)

  // ===========================================================================
  // GET /projects/:projectId/gantt —— 权限 project.read
  //
  // 响应  200 GanttView
  // 错误  401 UNAUTHENTICATED；404 NOT_FOUND（非成员 / 项目不存在）
  // ===========================================================================
  app.get('/projects/:projectId/gantt', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { projectId } = req.params as { projectId: string }

    // 契约 I-5 约束 2：status / code 由 can() 直接给出，调用方不自行判断 403/404。
    const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
    if (!decision.allow) {
      throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
    }

    const view = await buildGanttView(ctx.prisma, actorUserId, projectId)
    return reply.status(200).send(view)
  })

  // ===========================================================================
  // POST /projects/:projectId/milestones —— 权限 gantt.write（仅 PM）
  //
  // 请求  { name, dueDate, ownerUserId?, taskIds? }
  // 响应  201 MilestoneWriteView
  // 错误  401 UNAUTHENTICATED；403 FORBIDDEN；404 NOT_FOUND；
  //       422 VALIDATION_FAILED（name；dueDate: INVALID_FORMAT | INVALID_VALUE；
  //           ownerUserId: NOT_PROJECT_MEMBER；taskIds: CROSS_PROJECT_REF）
  // ===========================================================================
  app.post('/projects/:projectId/milestones', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { projectId } = req.params as { projectId: string }

    const parsed = milestoneCreateSchema.safeParse(req.body)
    if (!parsed.success) throw validationFailed(parsed.error)

    const milestone = await createMilestone(ctx.prisma, actorUserId, projectId, parsed.data)
    return reply.status(201).send(milestone)
  })

  // ===========================================================================
  // PATCH /milestones/:milestoneId —— 权限 gantt.write（仅 PM）
  //
  // 响应  200 MilestoneWriteView（`taskIds` 出现即整体替换关联集）
  // 错误  401；403 FORBIDDEN；404 NOT_FOUND（里程碑不存在 / 非成员，文案一致）；
  //       422 VALIDATION_FAILED（同上）
  // ===========================================================================
  app.patch('/milestones/:milestoneId', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { milestoneId } = req.params as { milestoneId: string }

    const parsed = milestonePatchSchema.safeParse(req.body)
    if (!parsed.success) throw validationFailed(parsed.error)

    const milestone = await updateMilestone(ctx.prisma, actorUserId, milestoneId, parsed.data)
    return reply.status(200).send(milestone)
  })

  // ===========================================================================
  // DELETE /milestones/:milestoneId —— 权限 gantt.write（仅 PM）
  //
  // 响应  204（无响应体；`TaskMilestone` 关联行由 schema 级联清理）
  // 错误  401；403 FORBIDDEN；404 NOT_FOUND
  // ===========================================================================
  app.delete('/milestones/:milestoneId', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { milestoneId } = req.params as { milestoneId: string }

    await deleteMilestone(ctx.prisma, actorUserId, milestoneId)
    return reply.status(204).send()
  })

  // ===========================================================================
  // POST /projects/:projectId/task-dependencies —— 权限 gantt.write（仅 PM）
  //
  // 请求  { predecessorTaskId, successorTaskId, type? }（type 缺省 FS）
  // 响应  201 TaskDependencyView
  // 错误  401；403 FORBIDDEN；404 NOT_FOUND；
  //       422 VALIDATION_FAILED（type: UNSUPPORTED_DEPENDENCY_TYPE；
  //           successorTaskId: SELF_DEPENDENCY；
  //           predecessorTaskId / successorTaskId: CROSS_PROJECT_REF）；
  //       409 CONFLICT（successorTaskId: DUPLICATE_DEPENDENCY | FS_CYCLE）
  // ===========================================================================
  app.post(
    '/projects/:projectId/task-dependencies',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { projectId } = req.params as { projectId: string }

      const parsed = dependencyCreateSchema.safeParse(req.body)
      if (!parsed.success) throw validationFailed(parsed.error)

      const dependency = await createDependency(ctx.prisma, actorUserId, projectId, parsed.data)
      return reply.status(201).send(dependency)
    },
  )

  // ===========================================================================
  // DELETE /task-dependencies/:dependencyId —— 权限 gantt.write（仅 PM）
  //
  // 响应  204（无响应体）
  // 错误  401；403 FORBIDDEN；404 NOT_FOUND
  // ===========================================================================
  app.delete(
    '/task-dependencies/:dependencyId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { dependencyId } = req.params as { dependencyId: string }

      await deleteDependency(ctx.prisma, actorUserId, dependencyId)
      return reply.status(204).send()
    },
  )
}
