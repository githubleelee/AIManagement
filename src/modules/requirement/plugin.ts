/**
 * 需求层级模块 —— HTTP 路由插件
 * （M4 / US-03，端点 10–22 全部 13 个端点，T3.1–T3.10）
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
  createUserStory,
  deleteBusinessGoal,
  deleteUserActivity,
  deleteUserStory,
  getGoalTree,
  getUserStory,
  reorderBusinessGoals,
  reorderUserActivities,
  updateBusinessGoal,
  updateUserActivity,
  updateUserStory,
} from './service.js'
import {
  createBusinessGoalSchema,
  createUserActivitySchema,
  createUserStorySchema,
  fieldError,
  parseBody,
  reorderActivitiesSchema,
  reorderGoalsSchema,
  updateBusinessGoalSchema,
  updateUserActivitySchema,
  updateUserStorySchema,
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

/** 端点 22 的 404 文案（**单一定义处**）。理由同前三个常量。 */
const STORY_NOT_FOUND_MESSAGE = '用户故事不存在'

/**
 * 构造 `409 CONFLICT / HAS_CHILDREN`（端点 13/17/22 共用）。
 *
 * 【字段级错误码里 `field` 取什么值 —— 契约空白，本实现的选择与依据】
 *   契约决策 I-4 把 `HAS_CHILDREN` 列在**字段级错误码**表里（即 `details[].code`），
 *   但该表的「典型字段」栏写的是「—」，且端点 13/17/22 的括号写法是
 *   「409 CONFLICT（HAS_CHILDREN，……）」——**没有** `field:` 前缀
 *   （对比端点 6 写的是「409 CONFLICT（account: DUPLICATE，……）」，那个有前缀）。
 *   也就是说：契约把 HAS_CHILDREN 归入字段级，却没有给它天然字段，
 *   而 `FieldError.field` 的类型是必填 string。
 *
 *   本实现取**被拒绝对象的 id 参数名**（goalId / activityId / storyId），理由：
 *     ① I-4 把它归入字段级，说明契约希望它在 `details[].code` 里机器可读；
 *     ② `field` 指向「哪个对象还有子项」，对客户端有实际信息量；
 *     ③ 与端点 6 的 `account: DUPLICATE` 同构。
 *   若团队裁决应为「无字段」（例如空字符串），只需改这一个函数 —— 三个端点共用它。
 *   该空白已记入表五，留 Sprint 2 澄清。
 *
 * message 采用基线 AC-US-03-05 的原话「请先处理子项」。
 */
function hasChildrenError(field: string): AppError {
  return new AppError(409, 'CONFLICT', '仍有下级对象，请先处理子项', [
    fieldError(field, 'HAS_CHILDREN'),
  ])
}

/**
 * 把删除结果翻译成要抛的 `AppError`（端点 13/17/22 共用）。
 *
 * `reason !== 'HAS_CHILDREN'` 只剩 `NOT_FOUND`，对应「`can()` 之后、删除之前
 * 被别人删掉」这一 TOCTOU 窗口 —— 转 404 而不是让 Prisma 的 P2025 变成 500。
 */
function deleteFailureError(
  result: { ok: false; reason: 'HAS_CHILDREN' | 'NOT_FOUND' },
  field: string,
  notFoundMessage: string,
): AppError {
  return result.reason === 'HAS_CHILDREN'
    ? hasChildrenError(field)
    : new AppError(404, 'NOT_FOUND', notFoundMessage)
}

/**
 * 注册需求层级模块的全部路由。
 *
 * 签名固定为 `(app, ctx)`（与 `src/routes.ts` 的 `RouteContext` 约定一致）：
 * **不 import `src/db/client.ts` 的全局单例**，数据库一律从 `ctx.prisma` 取得，
 * 否则测试无法把 app 指向独立临时库。
 */
export function registerRequirementRoutes(app: FastifyInstance, ctx: RouteContext): void {
  // 唯一鉴权入口与列表可见性作用域都来自 M3（决策 I-9：M4 通过 can() / visibilityScope()
  // 使用 M3，不复制其逻辑）。两者签名冻结，本模块只调用、不实现。
  const { can, visibilityScope } = createAuthorization(ctx.prisma)

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

  // ===========================================================================
  // 端点 13 —— DELETE /goals/:goalId —— 权限：requirement.write
  //
  // 请求  —
  // 响应  204（无响应体）
  // 错误  403 FORBIDDEN
  //       404 NOT_FOUND
  //       409 CONFLICT（HAS_CHILDREN，该目标下仍有用户活动）
  // 说明  由外键 RESTRICT 保证，不依赖应用层判断（决策 I-7 / 契约 I-8 端点 13）
  // ===========================================================================
  app.delete(
    '/goals/:goalId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { goalId } = req.params as { goalId: string }

      // 第 1 步 / 第 2 步：存在性 + 唯一鉴权入口（同端点 12/15）
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

      // 第 3 步：删除。有子项时由数据库拒绝（P2003）→ 409，不是应用层 count 判断。
      const result = await deleteBusinessGoal(ctx.prisma, goalId)
      if (!result.ok) {
        throw deleteFailureError(result, 'goalId', GOAL_NOT_FOUND_MESSAGE)
      }

      // 契约 I-3：删除成功 → HTTP 204，无响应体
      return reply.status(204).send()
    },
  )

  // ===========================================================================
  // 端点 17 —— DELETE /activities/:activityId —— 权限：requirement.write
  //
  // 请求  —
  // 响应  204
  // 错误  403 FORBIDDEN
  //       404 NOT_FOUND
  //       409 CONFLICT（HAS_CHILDREN，该活动下仍有用户故事）
  // ===========================================================================
  app.delete(
    '/activities/:activityId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { activityId } = req.params as { activityId: string }

      const activity = await ctx.prisma.userActivity.findUnique({
        where: { id: activityId },
        select: { id: true, projectId: true },
      })
      if (!activity) {
        throw new AppError(404, 'NOT_FOUND', ACTIVITY_NOT_FOUND_MESSAGE)
      }

      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'activity',
        projectId: activity.projectId,
        objectId: activityId,
      })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, ACTIVITY_NOT_FOUND_MESSAGE)
      }

      const result = await deleteUserActivity(ctx.prisma, activityId)
      if (!result.ok) {
        throw deleteFailureError(result, 'activityId', ACTIVITY_NOT_FOUND_MESSAGE)
      }

      return reply.status(204).send()
    },
  )

  // ===========================================================================
  // 端点 22 —— DELETE /stories/:storyId —— 权限：requirement.write
  //
  // 请求  —
  // 响应  204
  // 错误  403 FORBIDDEN
  //       404 NOT_FOUND
  //       409 CONFLICT（HAS_CHILDREN，该故事下仍有任务）
  // 副作用 同一事务内清理 ObjectVisibility(objectType='story', objectId=storyId)
  //        —— 决策 I-7 的多态列无外键，必须人工保证
  // ===========================================================================
  app.delete(
    '/stories/:storyId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { storyId } = req.params as { storyId: string }

      // 存在性检查与 can()：注意 can() 对敏感故事的判定在 M3 接管前后会变化
      // （T0.4 骨架为非 PM 保守 404，T2.3/T2.4 放开为白名单成员可见）。
      // 本 handler 不做任何角色判断，只使用 can() 给的结论（决策 I-5 约束 2）。
      const story = await ctx.prisma.userStory.findUnique({
        where: { id: storyId },
        select: { id: true, projectId: true },
      })
      if (!story) {
        throw new AppError(404, 'NOT_FOUND', STORY_NOT_FOUND_MESSAGE)
      }

      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'story',
        projectId: story.projectId,
        objectId: storyId,
      })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, STORY_NOT_FOUND_MESSAGE)
      }

      // 删除 + 同事务清理可见性记录（见 service 的说明）
      const result = await deleteUserStory(ctx.prisma, storyId)
      if (!result.ok) {
        throw deleteFailureError(result, 'storyId', STORY_NOT_FOUND_MESSAGE)
      }

      return reply.status(204).send()
    },
  )

  // ===========================================================================
  // 端点 19 —— POST /activities/:activityId/stories —— 权限：requirement.write
  //
  // 请求  { title, roleText, capabilityText, valueText, businessValue: string
  //         priority: Priority
  //         acceptanceCriteria?: string }
  // 响应  201 UserStory
  // 错误  403 FORBIDDEN
  //       404 NOT_FOUND
  //       422 VALIDATION_FAILED（title / roleText / capabilityText / valueText /
  //                              businessValue: REQUIRED | TOO_LONG
  //                              priority: REQUIRED | INVALID_VALUE）
  // 副作用 projectId 取自 activityId 所属活动；
  //        status 默认 'DRAFT'；isSensitive 默认 false
  // 契约依据：决策 I-8 端点 19；基线 AC-US-03-03「必须在某用户活动下创建；
  //           三段式、业务价值、优先级均可填写并持久化」
  // ===========================================================================
  app.post(
    '/activities/:activityId/stories',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { activityId } = req.params as { activityId: string }

      // 第 1 步：父级活动必须存在，并取出它所属的 projectId（同端点 15/16）
      const activity = await ctx.prisma.userActivity.findUnique({
        where: { id: activityId },
        select: { id: true, projectId: true },
      })
      if (!activity) {
        throw new AppError(404, 'NOT_FOUND', ACTIVITY_NOT_FOUND_MESSAGE)
      }

      // 第 2 步：唯一鉴权入口（决策 I-5）
      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'activity',
        projectId: activity.projectId,
        objectId: activityId,
      })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, ACTIVITY_NOT_FOUND_MESSAGE)
      }

      // 第 3 步：字段校验
      const input = parseBody(createUserStorySchema, req.body ?? {})

      // 五个必填文本字段都要判纯空白（`.min(1)` 拦不住 `'   '`），且**一次报全部**，
      // 而不是遇到第一个就返回 —— 客户端应当一轮就拿到所有问题（决策 I-4）。
      const title = input.title.trim()
      const roleText = input.roleText.trim()
      const capabilityText = input.capabilityText.trim()
      const valueText = input.valueText.trim()
      const businessValue = input.businessValue.trim()

      const blankFields: string[] = []
      if (title === '') blankFields.push('title')
      if (roleText === '') blankFields.push('roleText')
      if (capabilityText === '') blankFields.push('capabilityText')
      if (valueText === '') blankFields.push('valueText')
      if (businessValue === '') blankFields.push('businessValue')
      if (blankFields.length > 0) {
        validationFailedWith(blankFields.map((field) => fieldError(field, 'REQUIRED')))
      }

      // 第 4 步：写入。projectId 取自父级活动（决策 I-10）；
      // status / isSensitive 交给表默认值，请求体里也没有这两个字段。
      const story = await createUserStory(ctx.prisma, activityId, activity.projectId, {
        title,
        roleText,
        capabilityText,
        valueText,
        businessValue,
        priority: input.priority,
        ...(input.acceptanceCriteria === undefined
          ? {}
          : { acceptanceCriteria: input.acceptanceCriteria }),
      })

      return reply.status(201).send(story)
    },
  )

  // ===========================================================================
  // 端点 20 —— GET /stories/:storyId —— 权限：project.read
  //
  // 请求  —
  // 响应  200 UserStory
  // 错误  404 NOT_FOUND（不存在、非项目成员、或敏感且未授权 —— 三者响应一致）
  //
  // ⚠️ 本端点是**读**动作，因此正确结果里没有 403：
  //    项目成员读非敏感故事应当允许（决策 I-5 判定顺序第 6 条），
  //    所以「拒绝」只有 404 一种形态，且三种原因必须完全不可区分（契约 I-8 端点 20）。
  // ===========================================================================
  app.get(
    '/stories/:storyId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { storyId } = req.params as { storyId: string }

      // 【纵深防御】鉴权之前只读 `id` + `projectId` 两个字段，**不读故事正文**。
      //   `getUserStory()` 会一次性把 13 个字段（title / roleText / capabilityText /
      //   valueText / businessValue / acceptanceCriteria 等敏感内容）全部读进进程内存，
      //   而鉴权要等 `can()` 返回之后才发生 —— 一旦将来有人把 `reply.send()` 挪到鉴权
      //   之前（这类改动很容易顺手做出来），故事正文就会泄漏给非项目成员。
      //   本端点先用窄读建立 ObjectRef、完成鉴权，**通过之后**才读整行用于响应，
      //   使「未授权时正文不出库」成为结构上的性质，而不是靠代码顺序的巧合。
      //   （该改造采纳自代码审查智能体的建议 S1；端点 12/15/16/18/13/17/22 本来就是
      //   窄读，只有端点 20/21 是整行读。）
      const ref = await ctx.prisma.userStory.findUnique({
        where: { id: storyId },
        select: { id: true, projectId: true },
      })
      if (!ref) {
        throw new AppError(404, 'NOT_FOUND', STORY_NOT_FOUND_MESSAGE)
      }

      // 唯一鉴权入口：`kind: 'story'` 会让 can() **自己现查** isSensitive
      // （决策 I-5 约束 1：调用方无法通过传入敏感标记影响判定）。
      // 本轮 T0.4 骨架对敏感对象的非 PM 一律 404（保守实现，由 T2.3/T2.4 放开为
      // 白名单成员可见），本 handler 不做任何角色或敏感判断，只使用 can() 的结论。
      //
      // 注意：`can()` 自己必须读 isSensitive 才能做判定，这是契约 I-5 约束 1 的要求，
      // 不属本端点的读放大；本端点能做的是**不额外读出故事的正文内容**。
      const decision = await can(actorUserId, 'project.read', {
        kind: 'story',
        projectId: ref.projectId,
        objectId: storyId,
      })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, STORY_NOT_FOUND_MESSAGE)
      }

      // 鉴权通过后读取完整行用于响应（多一次主键窄查询，换取「未授权不出正文」）
      const story = await getUserStory(ctx.prisma, storyId)
      if (!story) {
        // TOCTOU：can() 之后、读取之前故事被删除（端点 22 已交付，该窗口真实可达）
        throw new AppError(404, 'NOT_FOUND', STORY_NOT_FOUND_MESSAGE)
      }

      return reply.status(200).send(story)
    },
  )

  // ===========================================================================
  // 端点 21 —— PATCH /stories/:storyId —— 权限：requirement.write
  //
  // 请求  { title?, roleText?, capabilityText?, valueText?, businessValue?,
  //         priority?, status?, acceptanceCriteria? }
  //         —— **不含 isSensitive**（该字段只能通过端点 23 修改）
  // 响应  200 UserStory
  // 错误  403 FORBIDDEN / 404 NOT_FOUND / 422 VALIDATION_FAILED
  // 说明  部分更新：请求体中未出现的字段保持不变（决策 I-10）
  // ===========================================================================
  app.patch(
    '/stories/:storyId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { storyId } = req.params as { storyId: string }

      // 【纵深防御】同端点 20：鉴权前只读 `id` + `projectId`，不读故事正文
      // （采纳自代码审查智能体的建议 S1）。
      // 本端点**本来就只需窄读** —— 写入由 `updateUserStory` 完成并返回更新后的整行，
      // 因此这里换成窄读后查询次数不变（仍是一次主键查询），却不再把正文读进内存。
      const ref = await ctx.prisma.userStory.findUnique({
        where: { id: storyId },
        select: { id: true, projectId: true },
      })
      if (!ref) {
        throw new AppError(404, 'NOT_FOUND', STORY_NOT_FOUND_MESSAGE)
      }

      const decision = await can(actorUserId, 'requirement.write', {
        kind: 'story',
        projectId: ref.projectId,
        objectId: storyId,
      })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, STORY_NOT_FOUND_MESSAGE)
      }

      const input = parseBody(updateUserStorySchema, req.body ?? {})

      // 五个文本字段都是**可选**的：只有出现时才判纯空白并 trim
      // （同端点 12/16 —— 部分更新最容易写错的地方就是无条件判空）。
      const trimmed: Record<string, string> = {}
      for (const field of ['title', 'roleText', 'capabilityText', 'valueText', 'businessValue'] as const) {
        const raw = input[field]
        if (raw !== undefined) {
          const value = raw.trim()
          if (value === '') {
            validationFailedWith([fieldError(field, 'REQUIRED')])
          }
          trimmed[field] = value
        }
      }

      const updated = await updateUserStory(ctx.prisma, storyId, {
        ...(trimmed.title === undefined ? {} : { title: trimmed.title }),
        ...(trimmed.roleText === undefined ? {} : { roleText: trimmed.roleText }),
        ...(trimmed.capabilityText === undefined ? {} : { capabilityText: trimmed.capabilityText }),
        ...(trimmed.valueText === undefined ? {} : { valueText: trimmed.valueText }),
        ...(trimmed.businessValue === undefined ? {} : { businessValue: trimmed.businessValue }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.acceptanceCriteria === undefined
          ? {}
          : { acceptanceCriteria: input.acceptanceCriteria }),
      })
      if (!updated) {
        // TOCTOU：can() 之后、写入之前故事被删除（端点 22 已由 T3.9 交付，该窗口真实可达）
        throw new AppError(404, 'NOT_FOUND', STORY_NOT_FOUND_MESSAGE)
      }

      return reply.status(200).send(updated)
    },
  )

  // ===========================================================================
  // 端点 10 —— GET /projects/:projectId/goals —— 权限：project.read
  //
  // 请求  —
  // 响应  200 ListResponse<GoalNode>
  // 说明  返回完整层级树；goals 按 sortOrder 升序，activities 按 sortOrder 升序，
  //       stories 按 createdAt 升序
  //       敏感用户故事按 visibilityScope(actor, projectId, 'story') 过滤；
  //       被过滤掉的 story 不出现在 stories 数组中，其父级 activity 与 goal 仍正常返回
  // 错误  404 NOT_FOUND（非项目成员）
  //
  // 契约依据：决策 I-8 端点 10；决策 I-6（列表可见性作用域）；
  //           基线 AC-US-03-04（四层结构一致性）、AC-US-03-08（敏感联动）
  // ===========================================================================
  app.get(
    '/projects/:projectId/goals',
    { preHandler: requireAuth },
    async (req, reply) => {
      const actorUserId = currentUserId(req)
      const { projectId } = req.params as { projectId: string }

      // 第 1 步：项目必须存在（理由同端点 11：让两条 404 路径在代码里可见）
      const project = await ctx.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      })
      if (!project) {
        throw new AppError(404, 'NOT_FOUND', PROJECT_NOT_FOUND_MESSAGE)
      }

      // 第 2 步：唯一鉴权入口。`project.read` 是读动作 —— 成员与 VIEWER 都允许，
      // 所以本端点不会出现 403，拒绝只有 404 一种形态。
      const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
      if (!decision.allow) {
        throw new AppError(decision.status, decision.code, PROJECT_NOT_FOUND_MESSAGE)
      }

      // 第 3 步（T3.10）：取列表可见性作用域，交给 service 下推到查询层。
      //
      // ⚠️ 本调用今天**必然是空操作**：T0.4 骨架的 visibilityScope() 对非 PM 的成员
      // 返回 `{mode:'all'}`（第 4 条的敏感白名单属 T2.3/T2.4，`visibilityScope` 的
      // 真正实现属 T2.5）。而能走到这一步的调用者一定是项目成员（非成员已被上面
      // 的 can() 判成 404），所以永远拿到 'all'。
      // 接线本身是正确的、也是必须的（契约 I-6 要求所有返回敏感对象集合的端点都必须
      // 调用它）；只是它的效果在 T2.5 落地前无法通过接口观测，已记入表五。
      const scope = await visibilityScope(actorUserId, projectId, 'story')

      // 第 4 步：组装层级树（过滤与排序都在查询层完成，见 service 的说明）
      const goals = await getGoalTree(ctx.prisma, projectId, scope)

      // 契约 I-3 的 ListResponse 包装；元素是 GoalNode（BusinessGoal + activities[]）
      return reply.status(200).send({ items: goals })
    },
  )

  // 端点 11–22 均已交付（T3.1–T3.9）。本文件按任务顺序追加，到此 US-03 的 13 个端点全部就位。
}
