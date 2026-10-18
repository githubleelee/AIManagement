/**
 * US-10 风险台账与项目关闭阻断（工单 #30）—— 路由插件。
 *
 * 只导出插件，正式注册行在冻结的 `src/routes.ts`（决策 I-0 / I-9）。
 * 挂载授权：项目负责人 2026-10-18 批复第 3、4 项「改由 A 在 B 的登记范围内自行挂载」。
 *
 * 端点（均不在 Sprint 1 契约的 30 个端点内，属本票新增）：
 *   GET   /projects/:projectId/risks            风险台账（可按 status / level / ownerUserId 过滤）
 *   POST  /projects/:projectId/risks            新建风险（risk.write）
 *   GET   /risks/:riskId                        风险详情
 *   PATCH /risks/:riskId                        修改风险（含四态流转，risk.write）
 *   GET   /projects/:projectId/closure-check    关闭阻断校验预览（只读）
 *   POST  /projects/:projectId/close            关闭项目（project.close；被阻断 → 409）
 *   POST  /projects/:projectId/reopen           重开项目（project.close）
 *
 * 三层职责与其它模块一致：形状校验归 Zod（契约 I-2b），业务规则与查库归 service，
 * 判权一律走 `can()`，不自判角色。
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../../shared/errors.js'
import { toFieldErrors } from '../../shared/validation.js'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import type { RouteContext } from '../../routes.js'
import { checkClosure } from './closure.js'
import {
  RISK_RESOLUTION_MAX_LENGTH,
  RISK_TITLE_MAX_LENGTH,
  closeProject,
  createRisk,
  getRisk,
  listRisks,
  patchRisk,
  reopenProject,
} from './service.js'
import { RISK_LEVELS, RISK_STATUSES } from './types.js'

/**
 * 新建风险。`level` / `status` 用线上常量数组校验 —— 传中文或未定义取值一律
 * 422 `INVALID_VALUE`（AC3「三级四态、非法值拒绝」）。
 */
const riskCreateSchema = z.object({
  title: z.string().trim().min(1).max(RISK_TITLE_MAX_LENGTH),
  description: z.string().nullable().optional(),
  level: z.enum(RISK_LEVELS),
  ownerUserId: z.string().min(1),
  taskId: z.string().min(1).nullable().optional(),
  status: z.enum(RISK_STATUSES).optional(),
  resolution: z.string().trim().max(RISK_RESOLUTION_MAX_LENGTH).nullable().optional(),
})

/** 修改风险：全部字段可选（部分更新）。 */
const riskPatchSchema = riskCreateSchema.partial()

/** 清单过滤参数。 */
const riskQuerySchema = z.object({
  status: z.enum(RISK_STATUSES).optional(),
  level: z.enum(RISK_LEVELS).optional(),
  ownerUserId: z.string().min(1).optional(),
})

function validationFailed(error: z.ZodError): AppError {
  return new AppError(422, 'VALIDATION_FAILED', '字段校验失败', toFieldErrors(error.issues))
}

/** 查询参数里出现非字符串（含重复传参被解析成数组）时，直接判 INVALID_VALUE。 */
function assertQueryValuesAreStrings(
  query: Record<string, unknown>,
  fields: readonly string[],
): void {
  const bad = fields.filter(
    (field) => query[field] !== undefined && typeof query[field] !== 'string',
  )
  if (bad.length > 0) {
    throw new AppError(
      422,
      'VALIDATION_FAILED',
      '字段校验失败',
      bad.map((field) => ({ field, code: 'INVALID_VALUE' as const })),
    )
  }
}

export function registerRiskRoutes(app: FastifyInstance, context: RouteContext): void {
  const prisma = context.prisma

  // -------------------------------------------------------------------------
  // 风险台账：列表 / 新建
  // -------------------------------------------------------------------------
  app.get('/projects/:projectId/risks', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { projectId } = request.params as { projectId: string }

    const query = (request.query ?? {}) as Record<string, unknown>
    assertQueryValuesAreStrings(query, ['status', 'level', 'ownerUserId'])
    const parsed = riskQuerySchema.safeParse(query)
    if (!parsed.success) throw validationFailed(parsed.error)

    const items = await listRisks(prisma, actorUserId, projectId, parsed.data)
    return reply.status(200).send({ items })
  })

  app.post('/projects/:projectId/risks', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { projectId } = request.params as { projectId: string }

    const parsed = riskCreateSchema.safeParse(request.body)
    if (!parsed.success) throw validationFailed(parsed.error)

    const risk = await createRisk(prisma, actorUserId, projectId, parsed.data)
    return reply.status(201).send(risk)
  })

  // -------------------------------------------------------------------------
  // 风险详情 / 修改（含四态流转）
  // -------------------------------------------------------------------------
  app.get('/risks/:riskId', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { riskId } = request.params as { riskId: string }

    const risk = await getRisk(prisma, actorUserId, riskId)
    return reply.status(200).send(risk)
  })

  app.patch('/risks/:riskId', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { riskId } = request.params as { riskId: string }

    const parsed = riskPatchSchema.safeParse(request.body)
    if (!parsed.success) throw validationFailed(parsed.error)

    const risk = await patchRisk(prisma, actorUserId, riskId, parsed.data)
    return reply.status(200).send(risk)
  })

  // -------------------------------------------------------------------------
  // 关闭阻断校验（只读预览）
  // -------------------------------------------------------------------------
  app.get(
    '/projects/:projectId/closure-check',
    { preHandler: requireAuth },
    async (request, reply) => {
      const actorUserId = currentUserId(request)
      const { projectId } = request.params as { projectId: string }

      const view = await checkClosure(prisma, actorUserId, projectId)
      return reply.status(200).send(view)
    },
  )

  // -------------------------------------------------------------------------
  // 关闭 / 重开项目（仅 PM；被阻断 → 409）
  // -------------------------------------------------------------------------
  app.post('/projects/:projectId/close', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { projectId } = request.params as { projectId: string }

    const view = await closeProject(prisma, actorUserId, projectId)
    return reply.status(200).send(view)
  })

  app.post('/projects/:projectId/reopen', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { projectId } = request.params as { projectId: string }

    const view = await reopenProject(prisma, actorUserId, projectId)
    return reply.status(200).send(view)
  })
}
