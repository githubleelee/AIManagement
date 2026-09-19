/**
 * 需求层级模块 —— HTTP 路由插件（M4 / US-03，端点 11）
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
 *   由**技术负责人**在合并时统一添加。
 *   测试通过 `app.register(registerRequirementRoutes, { prisma })` 在独立临时库上加载。
 */
import type { FastifyInstance } from 'fastify'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { AppError } from '../../shared/errors.js'
import { createAuthorization } from '../authz/permissions.js'
import type { RouteContext } from '../../routes.js'
import { createBusinessGoal } from './service.js'
import { createBusinessGoalSchema, fieldError, parseBody, validationFailedWith } from './schemas.js'

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
        throw new AppError(404, 'NOT_FOUND', '项目不存在')
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
        throw new AppError(decision.status, decision.code, '项目不存在')
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

  // 供后续任务使用的占位注释：端点 12/13/14 属 T3.2 / T3.9 / T3.3，
  // 端点 10 属 T3.8 / T3.10，端点 15–19 属 T3.4 / T3.5 / T3.6，
  // 端点 20–22 属 T3.7 / T3.9。均在本文件内按任务逐步追加。
}
