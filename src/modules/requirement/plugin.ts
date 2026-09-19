/**
 * 需求层级模块 —— HTTP 路由插件（M4 / US-03，端点 11、12、14、15、16、18）
 *
 * 契约依据
 *   - 决策 I-9「模块依赖方向」：`M2 / M4 / M5 ──→ 通过 can() / visibilityScope() 使用 M3，
 *     不复制其逻辑`。因此本文件**不写任何 `if (role === 'PM')`**，权限一律问 `can()`。
 *   - 决策 I-5 约束 2：`can()` 直接给出 `status` 与 `code`，调用方**直接使用**，
 *     不得自行判断 403 还是 404。
 *   - 决策 I-5 约束 3：判定顺序**短路**。端点 11 的 `requirement.write` 对 MEMBER / VIEWER
 *     落到第 5 条 → 403；非项目成员在第 2 条即 404，两者不会混淆。
 *   - 决策 I-8 端点 11 的完整契约见下方注释。
 *
 * 归属与注册（决策 I-0）
 *   本文件属 M4 独占，只新增、不触碰冻结文件。
 *   本模块**只导出插件**，不自行为 `app.get/post` 挂载生产路由：正式注册行
 *   （`registerRequirementRoutes(app, context)`）位于冻结文件 `src/routes.ts`，
 *   由**技术负责人**统一添加（T3.1 收尾时已授权补上）。
 *   测试**不手动注册**：`createHttpTestContext()` 内部的 `buildApp()` →
 *   `registerRoutes()` 已完成注册；重复注册会抛 Fastify 的
 *   `FST_ERR_DUPLICATED_ROUTE`（核实于 fastify/lib/route.js:365）。
 *   因此测试走的是真实生产注册路径，而非测试自搭的旁路。
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { createAuthorization } from '../authz/permissions.js'
import type { RouteContext } from '../../routes.js'
import {
  createBusinessGoal,
  createUserActivity,
  reorderBusinessGoals,
  reorderUserActivities,
  updateBusinessGoal,
  updateUserActivity,
} from './service.js'
import {
  createBusinessGoalSchema,
  createUserActivitySchema,
  fieldError,
  parseBody,
  reorderActivitiesSchema,
  reorderGoalsSchema,
  updateBusinessGoalSchema,
  updateUserActivitySchema,
  validationFailedWith,
} from './schemas.js'

/**
 * 端点 15 的 404 文案（**单一定义处**）。
 *
 * 契约决策 I-3：当对象对调用者不可见时，`message` 必须与「对象不存在」的文案**完全
 * 一致**，不得出现「无权限」「敏感」等字样。端点 15 有两条会产生 404 的路径
 * ——「goalId 不存在」与「目标存在但调用者不是项目成员」—— 二者必须是同一个字符串，
 * 否则调用方能靠文案差异探出某个目标是否存在。
 *
 * 之所以提成模块级常量而不是在两处各写一个字面量：让这条约束在代码里只有一处可改，
 * 而不是依赖两处字面量恰好一直保持相同。
 */
const GOAL_NOT_FOUND_MESSAGE = '目标不存在'

/**
 * 端点 16 的 404 文案（**单一定义处**）。理由同 `GOAL_NOT_FOUND_MESSAGE`：
 * 「activityId 不存在」与「活动存在但调用者不是项目成员」必须用同一个字符串，
 * 否则调用方能靠文案差异探出活动是否存在（决策 I-3）。
 */
const ACTIVITY_NOT_FOUND_MESSAGE = '用户活动不存在'

/**
 * 端点 14 的 404 文案（**单一定义处**）。理由同前两个常量。
 *
 * 【本次顺带统一了端点 11 的两处字面量】端点 11 原先在两处各写了一次 `'项目不存在'`
 * （第 1 步的项目存在性检查、第 2 步 can() 拒绝分支），并配了注释说明两者必须一致 ——
 * 但「必须一致」当时只是**恰好成立**，靠的是两处字面量没有被改歪。
 * 既然本任务需要同一个文案常量，就把它提为唯一来源并让端点 11 也引用它：
 * 契约 I-3 的「不可区分」从此是**结构上**成立，而不是靠人记得同步。
 * 该改动是纯常量替换、行为零变化，端点 11 的 404 路径由对抗测试的 79 例覆盖。
 */
const PROJECT_NOT_FOUND_MESSAGE = '项目不存在'

/**
 * 注册需求层级模块的全部路由。
 *
 * 签名固定为 `(app, ctx)`（与 `src/routes.ts` 的 `RouteContext` 约定一致）：
 * **不 import `src/db/client.ts` 的全局单例**，数据库一律从 `ctx.prisma` 取得，
 * 否则测试无法把 app 指向独立临时库。
 */
export function registerRequirementRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { can } = createAuthorization(ctx.prisma)

  // ===========================================================================
  // 端点 11 —— POST /projects/:projectId/goals —— 权限：requirement.write
  //
  // 请求  { name: string, description?: string }
  // 响应  201 BusinessGoal
  // 错误  403 FORBIDDEN（MEMBER / VIEWER）
  //       404 NOT_FOUND（非项目成员）
  //       422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
  // 副作用 status 默认 'ACTIVE'；sortOrder = 当前项目内最大值 + 1
  // ===========================================================================
  app.post(
    '/projects/:projectId/goals',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { projectId } = req.params as { projectId: string }

      // ---------------------------------------------------------------------
      // 第 1 步：父级项目必须先存在
      //
      // 为什么在 can() 之前单独查一次：can() 的判定顺序第 1 条是「目标对象不存在
      // → 404」，第 2 条是「非项目成员 → 404」。若只调 can()，当 projectId 根本
      // 不存在时，第 2 条会因为「查不到成员关系」而同样回 404 —— 结果一致，
      // 但「项目不存在」与「项目存在而我不是成员」这两条路径就无法分别测试。
      // 这里显式判一次，使两条路径的语义在代码中可见，且都满足契约的 404 要求。
      // （契约决策 I-5 允许调用方先做存在性检查；它禁止的是调用方自行判断 403/404。）
      // ---------------------------------------------------------------------
      const project = await ctx.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      })
      if (!project) {
        throw new AppError(404, 'NOT_FOUND', PROJECT_NOT_FOUND_MESSAGE)
      }

      // ---------------------------------------------------------------------
      // 第 2 步：唯一鉴权入口（决策 I-5）。不自行判断任何角色。
      //
      // 注意 ref 里同时给出 projectId 与 url 参数：主键查到的行归属必须与
      // URL 的父级一致，否则属跨项目引用。端点 11 是**新建**目标，传入的
      // objectId 就是 URL 里的项目 id，因此这里二者天然相等；
      // 保留该断言是为了在 T3.2 起（ref 带真实 objectId）统一防护。
      // ---------------------------------------------------------------------
      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'project',
        projectId,
      })
      if (!decision.allow) {
        // 直接使用 can() 给出的 status / code，调用方不改写（决策 I-5 约束 2）
        throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
      }

      // ---------------------------------------------------------------------
      // 第 3 步：字段校验（决策 I-2b：单字段形状归 Zod）
      // ---------------------------------------------------------------------
      const input = parseBody(createBusinessGoalSchema, req.body ?? {})

      // 纯空白名称：`.min(1)` 拦不住（长度不为 0），必须 trim 后判空。
      // 决策 I-4 对 REQUIRED 的定义是「必填缺失或**纯空白**」。
      const name = input.name.trim()
      if (name === '') {
        validationFailedWith([fieldError('name', 'REQUIRED')])
      }

      // ---------------------------------------------------------------------
      // 第 4 步：写入。projectId 由 URL 父级推导，不接受请求体传入（决策 I-10）。
      // ---------------------------------------------------------------------
      const goal = await createBusinessGoal(ctx.prisma, projectId, {
        name,
        // description 允许为纯空白字符串（契约未要求 trim 描述），仅在提供时写入
        ...(input.description === undefined ? {} : { description: input.description }),
      })

      return reply.status(201).send(goal)
    },
  )

  // ===========================================================================
  // 端点 15 —— POST /goals/:goalId/activities —— 权限：requirement.write
  //
  // 请求  { name: string, description?: string }
  // 响应  201 UserActivity
  // 错误  403 FORBIDDEN（MEMBER / VIEWER）
  //       404 NOT_FOUND（非项目成员；goalId 不存在时同为 404）
  //       422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
  // 副作用 projectId 取自 goalId 所属目标（不接受请求体传入，防止 CROSS_PROJECT_REF）
  //       status 默认 'ACTIVE'；sortOrder = 该目标下最大值 + 1
  //
  // 契约依据：决策 I-8 端点 15；基线 AC-US-03-02「必须在某业务目标下创建；
  //           不允许无归属的用户活动」。
  // ===========================================================================
  app.post(
    '/goals/:goalId/activities',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { goalId } = req.params as { goalId: string }

      // ---------------------------------------------------------------------
      // 第 1 步：父级目标必须先存在，并**取出它所属的 projectId**
      //
      // 端点 11 在 can() 之前只查「项目是否存在」，这里必须查得更实一点：
      //   (a) 端点 15 的 projectId **只能**由父级目标推导（决策 I-10），不查就无从得知，
      //       而请求体里没有、也不允许有这个字段；
      //   (b) can() 的 ObjectRef 对 `kind: 'goal'` 要求同时给出 projectId 与 objectId，
      //       但 URL 里只有 goalId。这里填**目标真实的** projectId 而不是占位值，是因为
      //       can() 将来可能用该字段做「主键查到的行归属必须与 URL 父级一致」的校验；
      //       填真值则无论 M3 将来是否启用该校验，本端点都正确。
      // ---------------------------------------------------------------------
      const goal = await ctx.prisma.businessGoal.findUnique({
        where: { id: goalId },
        select: { id: true, projectId: true },
      })
      if (!goal) {
        throw new AppError(404, 'NOT_FOUND', GOAL_NOT_FOUND_MESSAGE)
      }

      // ---------------------------------------------------------------------
      // 第 2 步：唯一鉴权入口（决策 I-5）。不自行判断任何角色。
      //
      // 判定顺序短路：非项目成员在第 2 条即 404；MEMBER / VIEWER 对写类动作
      // 落到第 5 条 → 403，两者不会混淆。
      // 本条 404 与上一条 404 使用**同一个** GOAL_NOT_FOUND_MESSAGE，
      // 使「目标不存在」与「目标存在但我是外人」不可区分（决策 I-3）。
      // ---------------------------------------------------------------------
      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'goal',
        projectId: goal.projectId,
        objectId: goalId,
      })
      if (!decision.allow) {
        // 直接使用 can() 给出的 status / code，调用方不改写（决策 I-5 约束 2）
        throw new AppError(decision.status, decision.code, GOAL_NOT_FOUND_MESSAGE)
      }

      // ---------------------------------------------------------------------
      // 第 3 步：字段校验（决策 I-2b：单字段形状归 Zod）
      //
      // 顺序与端点 11 一致：存在性与权限判定都在字段校验**之前** ——
      // 越权请求不得通过 422 的 details 探出字段规则。
      // ---------------------------------------------------------------------
      const input = parseBody(createUserActivitySchema, req.body ?? {})

      // 纯空白名称：`.min(1)` 拦不住（长度不为 0），必须 trim 后判空。
      // 决策 I-4 对 REQUIRED 的定义是「必填缺失或**纯空白**」。
      const name = input.name.trim()
      if (name === '') {
        validationFailedWith([fieldError('name', 'REQUIRED')])
      }

      // ---------------------------------------------------------------------
      // 第 4 步：写入。projectId **取自父级目标**，不接受请求体传入（决策 I-10）——
      // 这从结构上消除了 CROSS_PROJECT_REF，而不是靠校验去拦。
      // ---------------------------------------------------------------------
      const activity = await createUserActivity(ctx.prisma, goalId, goal.projectId, {
        name,
        // description 允许为纯空白字符串（契约未要求 trim 描述），仅在提供时写入
        ...(input.description === undefined ? {} : { description: input.description }),
      })

      return reply.status(201).send(activity)
    },
  )

  // ===========================================================================
  // 端点 12 —— PATCH /goals/:goalId —— 权限：requirement.write
  //
  // 请求  { name?: string, description?: string, status?: GoalStatus }
  // 响应  200 BusinessGoal
  // 错误  403 FORBIDDEN
  //       404 NOT_FOUND
  //       422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG
  //                              status: INVALID_VALUE）
  // 说明  部分更新：请求体中未出现的字段保持不变（决策 I-10）
  // ===========================================================================
  app.patch(
    '/goals/:goalId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { goalId } = req.params as { goalId: string }

      // ---------------------------------------------------------------------
      // 第 1 步：目标必须先存在，并取出它所属的 projectId
      // （理由同端点 15：ObjectRef 的 kind:'goal' 要求真实 projectId）
      // ---------------------------------------------------------------------
      const goal = await ctx.prisma.businessGoal.findUnique({
        where: { id: goalId },
        select: { id: true, projectId: true },
      })
      if (!goal) {
        throw new AppError(404, 'NOT_FOUND', GOAL_NOT_FOUND_MESSAGE)
      }

      // ---------------------------------------------------------------------
      // 第 2 步：唯一鉴权入口（决策 I-5）。非成员 → 404；MEMBER / VIEWER → 403。
      // 两类 404 共用同一文案，不可区分（决策 I-3）。
      // ---------------------------------------------------------------------
      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'goal',
        projectId: goal.projectId,
        objectId: goalId,
      })
      if (!decision.allow) {
        // 直接使用 can() 给出的 status / code，调用方不改写（决策 I-5 约束 2）
        throw new AppError(decision.status, decision.code, GOAL_NOT_FOUND_MESSAGE)
      }

      // ---------------------------------------------------------------------
      // 第 3 步：字段校验（部分更新 —— 只校验请求体中**出现**的字段）
      // ---------------------------------------------------------------------
      const input = parseBody(updateBusinessGoalSchema, req.body ?? {})

      // ⚠️ `name` 在端点 12 是**可选**字段：只有出现时才需要判纯空白。
      // 若照端点 11 的写法无条件 `trim()` 后判空，那么 `{ status: 'DONE' }`
      // 这种合法请求会被误判成 422 —— 这是部分更新最容易写错的一处。
      let name: string | undefined
      if (input.name !== undefined) {
        const trimmed = input.name.trim()
        if (trimmed === '') {
          validationFailedWith([fieldError('name', 'REQUIRED')])
        }
        name = trimmed
      }

      // ---------------------------------------------------------------------
      // 第 4 步：写入。只提交请求体明确给出的字段，未出现的保持原值（决策 I-10）；
      // `projectId` 与 `sortOrder` 不在可改白名单内，本端点无法改动它们。
      // ---------------------------------------------------------------------
      const updated = await updateBusinessGoal(ctx.prisma, goalId, {
        ...(name === undefined ? {} : { name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.status === undefined ? {} : { status: input.status }),
      })
      if (!updated) {
        // TOCTOU：can() 之后、写入之前目标被删除（端点 13 属 T3.9）。
        // 转 404 而不是让 Prisma 的 P2025 变成 500。
        throw new AppError(404, 'NOT_FOUND', GOAL_NOT_FOUND_MESSAGE)
      }

      return reply.status(200).send(updated)
    },
  )

  // ===========================================================================
  // 端点 16 —— PATCH /activities/:activityId —— 权限：requirement.write
  //
  // 请求  { name?: string, description?: string, status?: GoalStatus }
  // 响应  200 UserActivity
  // 错误  同端点 12（403 FORBIDDEN / 404 NOT_FOUND /
  //       422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG；status: INVALID_VALUE））
  // 说明  部分更新：请求体中未出现的字段保持不变（决策 I-10）
  // ===========================================================================
  app.patch(
    '/activities/:activityId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { activityId } = req.params as { activityId: string }

      // 第 1 步：活动必须存在，并取出它所属的 projectId
      // （理由同端点 15/12：ObjectRef 的 kind:'activity' 要求真实 projectId）
      const activity = await ctx.prisma.userActivity.findUnique({
        where: { id: activityId },
        select: { id: true, projectId: true },
      })
      if (!activity) {
        throw new AppError(404, 'NOT_FOUND', ACTIVITY_NOT_FOUND_MESSAGE)
      }

      // 第 2 步：唯一鉴权入口（决策 I-5）。非成员 → 404；MEMBER / VIEWER → 403。
      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'activity',
        projectId: activity.projectId,
        objectId: activityId,
      })
      if (!decision.allow) {
        // 直接使用 can() 给出的 status / code，调用方不改写（决策 I-5 约束 2）
        throw new AppError(decision.status, decision.code, ACTIVITY_NOT_FOUND_MESSAGE)
      }

      // 第 3 步：字段校验（只校验请求体中**出现**的字段）
      const input = parseBody(updateUserActivitySchema, req.body ?? {})

      // `name` 是可选字段：只有出现时才判纯空白（同端点 12，部分更新最易写错处）
      let name: string | undefined
      if (input.name !== undefined) {
        const trimmed = input.name.trim()
        if (trimmed === '') {
          validationFailedWith([fieldError('name', 'REQUIRED')])
        }
        name = trimmed
      }

      // 第 4 步：写入。goalId / projectId / sortOrder 不在可改白名单内。
      const updated = await updateUserActivity(ctx.prisma, activityId, {
        ...(name === undefined ? {} : { name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.status === undefined ? {} : { status: input.status }),
      })
      if (!updated) {
        // TOCTOU：can() 之后、写入之前活动被删除（端点 17 属 T3.9）
        throw new AppError(404, 'NOT_FOUND', ACTIVITY_NOT_FOUND_MESSAGE)
      }

      return reply.status(200).send(updated)
    },
  )

  // ===========================================================================
  // 端点 18 —— PUT /goals/:goalId/activities/order —— 权限：requirement.write
  //
  // 请求  { orderedIds: string[] }
  // 响应  200 ListResponse<UserActivity>
  // 错误  403 FORBIDDEN
  //       404 NOT_FOUND
  //       422 VALIDATION_FAILED（orderedIds: INVALID_VALUE
  //                              —— 集合与该目标下现有活动集合不一致）
  // 语义  同端点 14，范围限定在该目标下的用户活动：
  //       第 i 个 id 的 sortOrder 置为 i；幂等，可重复调用
  // ===========================================================================
  app.put(
    '/goals/:goalId/activities/order',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { goalId } = req.params as { goalId: string }

      // 第 1 步 / 第 2 步：父级目标存在性 + 唯一鉴权入口（同端点 15）
      const goal = await ctx.prisma.businessGoal.findUnique({
        where: { id: goalId },
        select: { id: true, projectId: true },
      })
      if (!goal) {
        throw new AppError(404, 'NOT_FOUND', GOAL_NOT_FOUND_MESSAGE)
      }

      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'goal',
        projectId: goal.projectId,
        objectId: goalId,
      })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, GOAL_NOT_FOUND_MESSAGE)
      }

      // 第 3 步：形状校验（必须是字符串数组；集合一致性属业务规则，在 service 内判）
      const input = parseBody(reorderActivitiesSchema, req.body ?? {})

      // 第 4 步：全量替换（校验与写入在同一个事务内，见 service 的说明）
      const result = await reorderUserActivities(ctx.prisma, goalId, input.orderedIds)
      if (!result.ok) {
        // 契约 I-8 端点 18「同端点 14」：集合不一致 → 422 orderedIds: INVALID_VALUE。
        // 此处**没有发生任何写入**（校验在写入之前、同一事务内），失败零副作用。
        validationFailedWith([fieldError('orderedIds', 'INVALID_VALUE')])
      }

      // 契约 I-3 的 ListResponse 包装：列表端点的响应体是 { items: [...] }
      return reply.status(200).send({ items: result.activities })
    },
  )

  // ===========================================================================
  // 端点 14 —— PUT /projects/:projectId/goals/order —— 权限：requirement.write
  //
  // 请求  { orderedIds: string[] }
  // 响应  200 ListResponse<BusinessGoal>
  // 错误  403 FORBIDDEN
  //       404 NOT_FOUND
  //       422 VALIDATION_FAILED（orderedIds: INVALID_VALUE
  //                              —— 集合与本项目现有目标集合不一致）
  // 语义  全量替换顺序：第 i 个 id 的 sortOrder 置为 i；幂等，可重复调用
  // ===========================================================================
  app.put(
    '/projects/:projectId/goals/order',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { projectId } = req.params as { projectId: string }

      // 第 1 步：项目必须先存在
      // 理由同端点 11：can() 对「项目不存在」与「非成员」都会给 404，
      // 显式判一次使两条路径在代码里可见，且都满足契约的 404 要求。
      const project = await ctx.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      })
      if (!project) {
        throw new AppError(404, 'NOT_FOUND', PROJECT_NOT_FOUND_MESSAGE)
      }

      // 第 2 步：唯一鉴权入口（决策 I-5）。非成员 → 404；MEMBER / VIEWER → 403。
      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'project',
        projectId,
      })
      if (!decision.allow) {
        // 直接使用 can() 给出的 status / code，调用方不改写（决策 I-5 约束 2）
        throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
      }

      // 第 3 步：形状校验（必须是字符串数组；集合一致性属业务规则）
      const input = parseBody(reorderGoalsSchema, req.body ?? {})

      // 第 4 步：全量替换（校验与写入在同一个事务内，见 service 的说明）
      const result = await reorderBusinessGoals(ctx.prisma, projectId, input.orderedIds)
      if (!result.ok) {
        // 契约 I-8 端点 14：集合与本项目现有目标集合不一致 → 422 orderedIds: INVALID_VALUE。
        // 此处**没有发生任何写入**（校验在写入之前、同一事务内），失败零副作用。
        validationFailedWith([fieldError('orderedIds', 'INVALID_VALUE')])
      }

      // 契约 I-3 的 ListResponse 包装
      return reply.status(200).send({ items: result.goals })
    },
  )

  // 供后续任务使用的占位注释：端点 13 属 T3.9，
  // 端点 10 属 T3.8 / T3.10，端点 17 属 T3.9，端点 19 属 T3.6，
  // 端点 20–22 属 T3.7 / T3.9。均在本文件内按任务逐步追加。
}
