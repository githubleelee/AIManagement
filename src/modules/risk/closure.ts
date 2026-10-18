/**
 * US-10 项目关闭阻断（工单 #30）—— 只读校验服务。
 *
 * ===========================================================================
 * 本文件只做"能不能关、卡在哪"的**校验预览**，不做关闭动作
 * ===========================================================================
 *
 * 关闭动作需要：① `Project.status` 字段；② 一个 PM 专属的授权动作。两者都还在
 * 冻结区申请中（#24），所以本票先把**判定与清单**做出来 —— 这部分 AC4 的一半，
 * 且完全只读，不需要任何新表或新动作。
 *
 * ===========================================================================
 * 三态纪律：不敢说"能关"就不要说
 * ===========================================================================
 *
 * 阻断条件是**或**：有未关闭任务 **或** 有未处理/处理中风险 ⇒ 不能关。
 *
 * 因此：
 *   - 任务侧已阻断 ⇒ **确定不能关**（`blocked`），风险侧未知也不影响这个结论；
 *   - 任务侧没阻断，但 `Risk` 表还没落地 ⇒ **判不了**（`unavailable`，`canClose: null`）。
 *     这里**绝不能**返回 `clear` —— 那等于"在缺一半数据的情况下给项目放行"。
 *
 * 清单与计数都在**查询层**过滤（决策 I-6）：`visibilityScope()` 的作用域条件与
 * "未关闭"条件拼进同一个 where，`total` 与 `rows` 同源，不泄漏敏感任务的存在性。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { TaskStatus, TaskView, UserBrief } from '../../shared/types.js'
import { createAuthorization } from '../authz/permissions.js'
import type { BlockingSide, ClosureCheckView, ClosureVerdict, RiskView } from './types.js'

/** 清单最多返回多少条（`total` 始终是精确值，不受此上限影响）。 */
export const BLOCKING_ROWS_LIMIT = 50

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', '资源不存在')
}

function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
}

function denied(decision: { status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }): AppError {
  return decision.code === 'NOT_FOUND' ? notFound() : forbidden()
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

const TASK_INCLUDE = {
  owner: { select: { id: true, account: true, displayName: true } },
  acceptor: { select: { id: true, account: true, displayName: true } },
} as const

type TaskWithPeople = {
  id: string
  projectId: string
  storyId: string
  title: string
  description: string | null
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
  status: string
  progress: number | null
  blockedReason: string | null
  isSensitive: boolean
  createdAt: Date
  owner: UserBrief
  acceptor: UserBrief
}

/** 按共享类型 `TaskView` 组装（不 import 任务模块，决策 I-9）。 */
function toTaskView(row: TaskWithPeople): TaskView {
  return {
    id: row.id,
    projectId: row.projectId,
    storyId: row.storyId,
    title: row.title,
    description: row.description,
    ownerUserId: row.ownerUserId,
    acceptorUserId: row.acceptorUserId,
    planStart: row.planStart,
    planEnd: row.planEnd,
    status: row.status as TaskStatus,
    progress: row.progress,
    blockedReason: row.blockedReason,
    isSensitive: row.isSensitive,
    createdAt: row.createdAt.toISOString(),
    owner: row.owner,
    acceptor: row.acceptor,
  }
}

/**
 * 计算关闭判定。
 *
 * 纯函数：只依据"任务侧是否阻断"与"风险侧是否可判"得出结论，便于单测与今后接线。
 */
export function verdictOf(taskBlocking: boolean, risksKnown: boolean): ClosureVerdict {
  if (taskBlocking) {
    return {
      state: 'blocked',
      canClose: false,
      note: '存在未关闭的任务，项目不能关闭（见下方清单）。',
    }
  }
  if (!risksKnown) {
    return {
      state: 'unavailable',
      canClose: null,
      note: '任务侧没有未关闭项，但风险台账尚未交付，无法确认是否还有阻断风险 —— 因此不能判定"可以关闭"。',
    }
  }
  return { state: 'clear', canClose: true, note: '任务与风险两侧均无阻断项，可以关闭。' }
}

/**
 * 关闭阻断校验预览。
 *
 * 权限：`can(actor, 'project.read', { kind: 'project' })` —— 四种角色都能读；
 * 非成员 / 项目不存在 → 404（两者响应逐字一致）。
 *
 * ⚠️ 非 PM 看到的是**自己可见范围内**的阻断清单（`basis.scope = 'visible'`）。
 * 关闭动作本身只有 PM 能执行（待授权），这一条在 `basis.closeActionNote` 里如实写明，
 * 避免成员看到"没有阻断项"就以为关得掉。
 */
export async function checkClosure(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  options: { today?: string } = {},
): Promise<ClosureCheckView> {
  const { can, visibilityScope } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) throw notFound()

  const scope = await visibilityScope(actorUserId, projectId, 'task')
  const where: Prisma.TaskWhereInput = {
    projectId,
    status: { not: 'CLOSED' },
    ...(scope.mode === 'subset' ? { id: { in: scope.ids } } : {}),
  }

  // 计数与清单**同一个 where**（I-6），total 与 rows 同源。
  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      // 最该处理的排在前面：计划结束早的先看
      orderBy: [{ planEnd: 'asc' }, { createdAt: 'asc' }],
      take: BLOCKING_ROWS_LIMIT,
      include: TASK_INCLUDE,
    }),
  ])

  const blockingTasks: BlockingSide<TaskView> = {
    state: 'ok',
    total,
    rows: tasks.map((task) => toTaskView(task as TaskWithPeople)),
  }

  // 风险侧：`Risk` 表尚未落地（申请中）。如实返回 unavailable，**不返回 0**。
  const blockingRisks: BlockingSide<RiskView> = {
    state: 'unavailable',
    total: null,
    rows: [],
    note: '风险台账（三级四态）尚未交付，这一侧还没有数据源；这不代表"没有风险"。',
  }

  const verdict = verdictOf(total > 0, blockingRisks.state === 'ok')

  return {
    project: { id: project.id, name: project.name },
    verdict,
    blockingTasks,
    blockingRisks,
    basis: {
      asOf: options.today ?? isoToday(),
      scope: scope.mode === 'all' ? 'global' : 'visible',
      blockingMeans:
        '阻断条件（handoff §9）：存在 status != CLOSED 的任务，或存在「未处理 / 处理中」的风险。',
      riskSideNote: '风险侧在 Risk 表落地前恒为 unavailable；判定因此最多只能到达「确定不能关」，不能到达「确定能关」。',
      closeActionNote:
        '关闭动作本身尚未开放（需 Project.status 字段与 PM 专属授权动作，均在 #24 申请中）。本端点只做校验预览。',
    },
  }
}
