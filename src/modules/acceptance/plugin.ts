/**
 * US-09 任务验收（工单 #29）—— 路由插件。
 *
 * 只导出插件，**不自行 `app.get()` 挂生产路由**：正式注册行在冻结的
 * `src/routes.ts` 里（契约决策 I-0 / I-9）。
 *
 * 端点（均不在 Sprint 1 契约的 30 个端点内，属本票新增；
 * 接口与规则说明见 `docs/us-09-acceptance-api.md`，并入契约需走契约变更流程）：
 *
 *   `POST /tasks/:taskId/acceptance`             执行验收（通过 → CLOSED；驳回 → DOING，必填原因）
 *   `GET  /tasks/:taskId/acceptances`            某任务的验收历史（旧 → 新；AC5 追溯）
 *   `GET  /projects/:projectId/acceptance-queue` 待我验收的任务（界面主链路）
 *
 * 三处刻意的顺序 / 边界：
 *   1. **鉴权先于形状校验**（与 T5-06 的既有约定一致）：先 `assertMayAccept`
 *      （加载任务 + `can('task.accept')`），再 Zod。这样"非验收人提交非法请求体"
 *      得到 403/404 而不是 422，不因请求体形状泄漏对象是否存在。
 *   2. 请求体 schema **只接受 `conclusion` 与 `reason` 两个字段**；Zod 默认剥离未知键，
 *      因此不存在"借验收捎带改标题 / 负责人 / 计划"的通道（US-08 审查 B-1 那类越权写）。
 *   3. 读路径不做形状校验之外的任何自行判权，全部走 `can()` + `visibilityScope()`。
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../../shared/errors.js'
import { toFieldErrors } from '../../shared/validation.js'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import type { RouteContext } from '../../routes.js'
import { ACCEPTANCE_CONCLUSIONS, ACCEPTANCE_REASON_MAX_LENGTH } from './types.js'
import { assertMayAccept, listAcceptanceQueue, listTaskAcceptances, submitAcceptance } from './service.js'

/**
 * 验收请求体的**形状**校验（契约决策 I-2b：单字段形状归 Zod；跨字段与查库的业务规则
 * 归服务层的 AppError）。
 *
 * `conclusion` 用本模块的线上常量数组（契约 I-1：线上常量与中文标签分离）——
 * 传中文"通过"会被判 422 `conclusion: INVALID_VALUE`。
 *
 * `reason` **先 trim 再判长度**：长度上限的业务口径是"去掉首尾空白后的 200 字"
 * （见 `service.ts` 的同款判断）。若这里对**原始串**判长度，则"200 字 + 尾随空格"
 * 会被 Zod 误判 `TOO_LONG` —— 两处口径必须一致（独立审查 S7）。
 *
 * `reason` 的"驳回必填"属跨字段规则，不在这里判（服务层强制，产出 `reason: REQUIRED`）。
 */
const submitAcceptanceSchema = z.object({
  conclusion: z.enum(ACCEPTANCE_CONCLUSIONS),
  reason: z.string().trim().max(ACCEPTANCE_REASON_MAX_LENGTH).nullable().optional(),
})

/** 统一的 422 抛出（与其它模块逐字一致）。 */
function validationFailed(error: z.ZodError): AppError {
  return new AppError(422, 'VALIDATION_FAILED', '字段校验失败', toFieldErrors(error.issues))
}

export function registerAcceptanceRoutes(app: FastifyInstance, context: RouteContext): void {
  const prisma = context.prisma

  // -------------------------------------------------------------------------
  // 端点 A：POST /tasks/:taskId/acceptance —— 执行验收
  // -------------------------------------------------------------------------
  app.post('/tasks/:taskId/acceptance', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { taskId } = request.params as { taskId: string }

    // ① 鉴权（唯一判权点）：任务不存在 / 非成员 / 敏感未授权 → 404；非验收人 / VIEWER → 403
    const task = await assertMayAccept(prisma, actorUserId, taskId)

    // ② 形状校验
    const parsed = submitAcceptanceSchema.safeParse(request.body)
    if (!parsed.success) throw validationFailed(parsed.error)

    // ③ 业务规则 + 落库（状态机、驳回必填原因、CAS 防并发重复验收）
    const result = await submitAcceptance(prisma, actorUserId, task, parsed.data)
    return reply.status(200).send(result)
  })

  // -------------------------------------------------------------------------
  // 端点 B：GET /tasks/:taskId/acceptances —— 某任务的验收历史
  // -------------------------------------------------------------------------
  app.get('/tasks/:taskId/acceptances', { preHandler: requireAuth }, async (request, reply) => {
    const actorUserId = currentUserId(request)
    const { taskId } = request.params as { taskId: string }

    const items = await listTaskAcceptances(prisma, actorUserId, taskId)
    return reply.status(200).send({ items })
  })

  // -------------------------------------------------------------------------
  // 端点 C：GET /projects/:projectId/acceptance-queue —— 待我验收的任务
  // -------------------------------------------------------------------------
  app.get(
    '/projects/:projectId/acceptance-queue',
    { preHandler: requireAuth },
    async (request, reply) => {
      const actorUserId = currentUserId(request)
      const { projectId } = request.params as { projectId: string }

      const items = await listAcceptanceQueue(prisma, actorUserId, projectId)
      return reply.status(200).send({ items })
    },
  )
}
