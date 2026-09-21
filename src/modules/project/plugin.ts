/**
 * M2 项目与成员 —— HTTP 路由插件（US-01，端点 3–9，T1.1–T1.7）
 *
 * 契约依据
 *   - 决策 I-9「模块依赖方向」：M2 通过 `can()` 使用 M3，不复制其逻辑。
 *     因此本文件**不写任何 `if (role === 'PM')`**，权限一律问 `can()`。
 *   - 决策 I-5 约束 2：`can()` 直接给出 `status` 与 `code`，调用方**直接使用**，
 *     不得自行判断 403 还是 404。
 *   - 决策 I-10「`projectId` 的推导」：子对象的 `projectId` 一律从父对象推导，
 *     不接受请求体传入 —— 这从结构上消除了 `CROSS_PROJECT_REF`。
 *
 * 归属与注册（决策 I-0）
 *   本文件属 M2 独占，只新增、不触碰冻结文件。
 *   正式注册行（`registerProjectRoutes(app, context)`）位于冻结文件 `src/routes.ts`；
 *   测试不手动注册 —— `createHttpTestContext()` 内部的 `buildApp()` 已包含注册。
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { createAuthorization } from '../authz/permissions.js'
import type { RouteContext } from '../../routes.js'
import {
  addMember,
  countProjectManagers,
  createProjectWithOwner,
  findMembership,
  findUserByAccount,
  getProjectView,
  listMembers,
  listProjectsForUser,
  removeMember,
  updateMemberRole,
} from './service.js'
import {
  addMemberSchema,
  createProjectSchema,
  fieldError,
  parseBody,
  updateMemberRoleSchema,
  validationFailedWith,
} from './schemas.js'

/**
 * 项目不可见时的 404 文案（**单一定义处**）。
 *
 * 契约决策 I-3：「项目不存在」与「我是非成员所以看不到」两条路径必须返回**完全一致**
 * 的 message，否则调用方能靠文案差异探测项目是否存在。提成常量可让这条约束在代码里
 * 只有一处可改，而不是依赖两处字面量恰好相同。
 */
const PROJECT_NOT_FOUND_MESSAGE = '项目不存在'

/** 对象可见但操作不允许（MEMBER / VIEWER 写操作）时的 403 文案。 */
const FORBIDDEN_MESSAGE = '该操作需要项目经理权限'

/** 目标用户不是本项目成员时的 404 文案（端点 8/9）。 */
const MEMBER_NOT_FOUND_MESSAGE = '该成员不存在'

/**
 * 注册项目与成员模块的全部路由。
 *
 * 签名固定为 `(app, ctx)`（与 `src/routes.ts` 的 `RouteContext` 约定一致）；
 * **不 import `src/db/client.ts` 的全局单例**，数据库一律从 `ctx.prisma` 取得，
 * 否则测试无法把 app 指向独立临时库。
 */
export function registerProjectRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // 唯一鉴权入口来自 M3（决策 I-9：M2 通过 can() 使用 M3，不复制其逻辑）
  const { can } = createAuthorization(ctx.prisma)

  // ===========================================================================
  // 端点 3 —— POST /projects —— 权限：已登录
  //
  // 请求  { name: string, description?: string }
  // 响应  201 Project
  // 错误  401 UNAUTHENTICATED；422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
  // 副作用 同一事务内写入 ProjectMember(projectId, 当前用户, 'PM')
  // ===========================================================================
  app.post('/projects', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const input = parseBody(createProjectSchema, req.body ?? {})

    // 纯空白名称：`.min(1)` 拦不住（长度不为 0），必须 trim 后判空（决策 I-4）
    const name = input.name.trim()
    if (name === '') {
      validationFailedWith([fieldError('name', 'REQUIRED')])
    }
    const description =
      input.description && input.description.trim() !== '' ? input.description.trim() : null

    const project = await createProjectWithOwner(ctx.prisma, { name, description, ownerUserId: actorUserId })
    return reply.status(201).send(project)
  })

  // ===========================================================================
  // 端点 4 —— GET /projects —— 权限：已登录
  //
  // 响应  200 ListResponse<ProjectView>
  // 说明  只返回当前用户参与的项目；myRole 为该项目中的角色
  // ===========================================================================
  app.get('/projects', { preHandler: requireAuth }, async (req) => {
    const actorUserId = currentUserId(req)
    const items = await listProjectsForUser(ctx.prisma, actorUserId)
    return { items }
  })

  // ===========================================================================
  // 端点 5 —— GET /projects/:projectId —— 权限：project.read
  //
  // 响应  200 ProjectView
  // 错误  401 UNAUTHENTICATED；404 NOT_FOUND（非项目成员、或项目不存在，两者响应一致）
  // ===========================================================================
  app.get('/projects/:projectId', { preHandler: requireAuth }, async (req) => {
    const actorUserId = currentUserId(req)
    const { projectId } = req.params as { projectId: string }

    const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
    if (!decision.allow) {
      throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
    }

    const project = await getProjectView(ctx.prisma, projectId, actorUserId)
    if (!project) throw new AppError(404, 'NOT_FOUND', PROJECT_NOT_FOUND_MESSAGE)
    return project
  })

  // ===========================================================================
  // 端点 6 —— POST /projects/:projectId/members —— 权限：project.manage_members
  //
  // 请求  { account: string, role: ProjectRole }
  // 响应  201 ProjectMemberView
  // 错误  403 FORBIDDEN（MEMBER / VIEWER）；404 NOT_FOUND（非项目成员）
  //       422 VALIDATION_FAILED（account: REQUIRED | USER_NOT_FOUND；role: REQUIRED | INVALID_VALUE）
  //       409 CONFLICT（account: DUPLICATE）
  // ===========================================================================
  app.post('/projects/:projectId/members', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { projectId } = req.params as { projectId: string }

    // 先鉴权再校验请求体，避免向无权者暴露字段级信息
    const decision = await can(actorUserId, 'project.manage_members', {
      kind: 'project',
      projectId,
    })
    if (!decision.allow) {
      throw new AppError(
        decision.status,
        decision.code,
        decision.status === 404 ? PROJECT_NOT_FOUND_MESSAGE : FORBIDDEN_MESSAGE,
      )
    }

    const input = parseBody(addMemberSchema, req.body ?? {})
    const account = input.account.trim()
    if (account === '') {
      validationFailedWith([fieldError('account', 'REQUIRED')])
    }

    const target = await findUserByAccount(ctx.prisma, account)
    if (!target) {
      throw new AppError(422, 'VALIDATION_FAILED', '账号对应的用户不存在', [
        fieldError('account', 'USER_NOT_FOUND'),
      ])
    }

    const existing = await findMembership(ctx.prisma, projectId, target.id)
    if (existing) {
      throw new AppError(409, 'CONFLICT', '该用户已是项目成员', [
        fieldError('account', 'DUPLICATE'),
      ])
    }

    const member = await addMember(ctx.prisma, projectId, target.id, input.role)
    return reply.status(201).send(member)
  })

  // ===========================================================================
  // 端点 7 —— GET /projects/:projectId/members —— 权限：project.read
  //
  // 响应  200 ListResponse<ProjectMemberView>（按 joinedAt 升序）
  // 错误  404 NOT_FOUND（非项目成员）
  // ===========================================================================
  app.get('/projects/:projectId/members', { preHandler: requireAuth }, async (req) => {
    const actorUserId = currentUserId(req)
    const { projectId } = req.params as { projectId: string }

    const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
    if (!decision.allow) {
      throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
    }

    const items = await listMembers(ctx.prisma, projectId)
    return { items }
  })

  // ===========================================================================
  // 端点 8 —— PATCH /projects/:projectId/members/:userId —— 权限：project.manage_members
  //
  // 请求  { role: ProjectRole }
  // 响应  200 ProjectMemberView
  // 错误  403 FORBIDDEN；404 NOT_FOUND（userId 不是本项目成员）
  //       422 VALIDATION_FAILED（role: INVALID_VALUE；userId: LAST_PM）
  // ===========================================================================
  app.patch('/projects/:projectId/members/:userId', { preHandler: requireAuth }, async (req) => {
    const actorUserId = currentUserId(req)
    const { projectId, userId } = req.params as { projectId: string; userId: string }

    const decision = await can(actorUserId, 'project.manage_members', {
      kind: 'project',
      projectId,
    })
    if (!decision.allow) {
      throw new AppError(
        decision.status,
        decision.code,
        decision.status === 404 ? PROJECT_NOT_FOUND_MESSAGE : FORBIDDEN_MESSAGE,
      )
    }

    const input = parseBody(updateMemberRoleSchema, req.body ?? {})

    const target = await findMembership(ctx.prisma, projectId, userId)
    if (!target) throw new AppError(404, 'NOT_FOUND', MEMBER_NOT_FOUND_MESSAGE)

    // 把 PM 降级前确认项目仍有其他 PM，避免项目失去唯一管理者
    if (target.role === 'PM' && input.role !== 'PM') {
      const pmCount = await countProjectManagers(ctx.prisma, projectId)
      if (pmCount <= 1) {
        throw new AppError(422, 'VALIDATION_FAILED', '不能把最后一个项目经理降级', [
          fieldError('userId', 'LAST_PM'),
        ])
      }
    }

    return updateMemberRole(ctx.prisma, projectId, userId, input.role, actorUserId)
  })

  // ===========================================================================
  // 端点 9 —— DELETE /projects/:projectId/members/:userId —— 权限：project.manage_members
  //
  // 请求  —
  // 响应  204（无响应体）
  // 错误  403 FORBIDDEN；404 NOT_FOUND（userId 不是本项目成员）
  //       422 VALIDATION_FAILED（userId: SELF_REMOVAL_FORBIDDEN | LAST_PM）
  // 副作用 该用户立即失去本项目全部访问权（权限每次请求现查库，无需重新登录，决策 I-10）
  // ===========================================================================
  app.delete('/projects/:projectId/members/:userId', { preHandler: requireAuth }, async (req, reply) => {
    const actorUserId = currentUserId(req)
    const { projectId, userId } = req.params as { projectId: string; userId: string }

    const decision = await can(actorUserId, 'project.manage_members', {
      kind: 'project',
      projectId,
    })
    if (!decision.allow) {
      throw new AppError(
        decision.status,
        decision.code,
        decision.status === 404 ? PROJECT_NOT_FOUND_MESSAGE : FORBIDDEN_MESSAGE,
      )
    }

    const target = await findMembership(ctx.prisma, projectId, userId)
    if (!target) throw new AppError(404, 'NOT_FOUND', MEMBER_NOT_FOUND_MESSAGE)

    if (userId === actorUserId) {
      throw new AppError(422, 'VALIDATION_FAILED', '不能移除自己', [
        fieldError('userId', 'SELF_REMOVAL_FORBIDDEN'),
      ])
    }

    if (target.role === 'PM') {
      const pmCount = await countProjectManagers(ctx.prisma, projectId)
      if (pmCount <= 1) {
        throw new AppError(422, 'VALIDATION_FAILED', '不能移除最后一个项目经理', [
          fieldError('userId', 'LAST_PM'),
        ])
      }
    }

    await removeMember(ctx.prisma, projectId, userId, actorUserId)
    return reply.status(204).send()
  })
}
