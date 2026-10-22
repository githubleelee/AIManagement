/**
 * US-10 项目仪表盘（工单 #30）—— 进度 / 健康度聚合服务。
 *
 * ===========================================================================
 * 口径来源：项目负责人 2026-10-18 批复第 3 节（**冻结**）
 * ===========================================================================
 *
 * - 实际进度 = 已关闭任务数 ÷ 项目任务总数（`DONE` 不计入）。
 * - **计划时间进度 = 已过自然日数 ÷ 计划总自然日数**：
 *   - 计划区间 = 统计基数内任务的 `min(planStart)` ~ `max(planEnd)`，**自然日、含首尾**；
 *   - 已过自然日数 = 今天 − `min(planStart)` + 1，截断到 `[0, 区间天数]`；
 *   - 时区 **Asia/Shanghai**；
 *   - 项目无任务 → 「暂无计划数据」，**不做分级**。
 * - **偏差 = 计划时间进度 − 实际进度**，单位 **百分点（pp）**；
 *   **比较用未舍入值**，展示保留 1 位小数。
 * - 分级：偏差 ≤ 10pp 健康；> 10pp 且 ≤ 25pp 预警；> 25pp 风险。
 * - 覆盖范围：PM 全项目基数；MEMBER / VIEWER 各自可见范围（界面须标注「可见范围」）。
 *
 * ===========================================================================
 * 四条实现纪律
 * ===========================================================================
 *
 * 1. **判权只走 `can()`**；
 * 2. **分子与分母同源**（同一个 where，且该 where 已含 `visibilityScope` 的作用域）；
 * 3. **算不出来就不编数字**：无任务时 `ratio` 与 `deviationPp` 均为 `null`、健康度
 *    `UNAVAILABLE` —— 不用 0 或「健康」冒充；
 * 4. **口径随响应返回**（`basis`）：阈值、公式、时区、基数口径全部显式声明；
 * 5. **阈值比较用整数交叉相乘**（2026-10-19 独立评审 H2 修复）：`rawPp ≤ 10` 一律用
 *    `100·(已过天数·任务总数 − 已关闭数·总天数) ≤ 10·总天数·任务总数` 判定，
 *    **不比较浮点偏差**。理由见 `healthOf` 的注释：IEEE754 下 `(0.4 − 0.3) × 100`
 *    `= 10.000000000000004 > 10`，会把**正好落在阈值上**的情形错分到下一档
 *    （旧实现即如此，已修，并补了 `2/5 vs 3/10`、`7/12 vs 1/3` 两条边界用例）。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { TaskStatus } from '../../shared/types.js'
import { createAuthorization } from '../authz/permissions.js'
// ★ 冻结口径的纯函数在 `caliber.ts`（2026-10-19 #33 评审 P1：口径与 I/O 分层，
//   使跨模块复用口径不再需要 import 一个 service 文件）。
import {
  CALC_TIMEZONE,
  HEALTHY_THRESHOLD_PP,
  WARNING_THRESHOLD_PP,
  healthOf,
  isoToday,
  planTimeDaysOf,
  roundTo,
} from './caliber.js'
import type { AggregationScope, DashboardBasis, ProjectDashboardView } from './types.js'

const TASK_STATUSES: readonly TaskStatus[] = [
  'TODO',
  'DOING',
  'BLOCKED',
  'SUSPENDED',
  'DONE',
  'CLOSED',
]

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', '资源不存在')
}

function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
}

function denied(decision: { status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }): AppError {
  return decision.code === 'NOT_FOUND' ? notFound() : forbidden()
}

export type BuildDashboardOptions = {
  /** 覆盖"今天"（测试用来钉住边界；默认按口径时区取今天） */
  today?: string
}

/**
 * 组装项目仪表盘。
 *
 * 权限：`can(actor, 'project.read', { kind: 'project' })`；非成员 / 不存在 → 404（逐字一致）。
 */
export async function buildDashboard(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  options: BuildDashboardOptions = {},
): Promise<ProjectDashboardView> {
  const { can, visibilityScope } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) throw notFound()

  // ★ 可见性作用域：与统计条件拼进**同一个 where**（C6：分子分母同源）。
  const scope = await visibilityScope(actorUserId, projectId, 'task')
  const where: Prisma.TaskWhereInput = {
    projectId,
    ...(scope.mode === 'subset' ? { id: { in: scope.ids } } : {}),
  }

  const [total, closed, grouped, window] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.count({ where: { ...where, status: 'CLOSED' } }),
    prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.task.aggregate({ where, _min: { planStart: true }, _max: { planEnd: true } }),
  ])

  const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >
  for (const row of grouped) {
    if ((TASK_STATUSES as readonly string[]).includes(row.status)) {
      byStatus[row.status as TaskStatus] = row._count._all
    }
  }

  const rawRatio = total === 0 ? null : closed / total
  const start = window._min.planStart
  const end = window._max.planEnd
  const asOf = options.today ?? isoToday()
  // 天数用整数算、比值只供展示：分级交给 healthOf 的整数交叉相乘（H2）
  const planDays = start && end ? planTimeDaysOf(asOf, start, end) : null
  const planTimeProgress =
    planDays === null ? null : planDays.elapsedDays / planDays.totalDays

  const health = healthOf({ totalTasks: total, closedTasks: closed, planDays })

  const aggregationScope: AggregationScope = scope.mode === 'all' ? 'global' : 'visible'

  const basis: DashboardBasis = {
    asOf,
    scope: aggregationScope,
    planWindow: start && end ? { start, end } : null,
    planTimeProgress,
    thresholds: { healthyPp: HEALTHY_THRESHOLD_PP, warningPp: WARNING_THRESHOLD_PP },
    progressMeans:
      '实际进度 = 已验收关闭的任务数 ÷ 统计基数内的任务总数（status = CLOSED 计入分子，DONE 不计入）',
    planTimeProgressMeans:
      '计划时间进度 = 已过自然日数 ÷ 计划总自然日数（含首尾）；计划区间取统计基数内任务的 min(planStart) ~ max(planEnd)，已过天数截断到 [0, 区间天数]',
    healthMeans:
      '偏差 = 计划时间进度 − 实际进度（单位：百分点 pp）；偏差 ≤ 10pp 为健康，> 10pp 且 ≤ 25pp 为预警，> 25pp 为风险；分级用未舍入偏差的**整数交叉相乘**精确比较（100·(已过·总数 − 已关闭·总天数) ≤ 阈值·总天数·总数），不比较浮点比值，避免正好落在阈值上的情形被浮点误差错分；展示保留 1 位小数；项目无任务时不做分级',
    timezone: `${CALC_TIMEZONE} 自然日（含首尾）`,
  }

  return {
    project: { id: project.id, name: project.name },
    progress: {
      closed,
      total,
      // 比例保留 4 位小数，仅为展示稳定；健康度判定用的是未舍入的 rawRatio。
      // ★ 2026-10-19：改用 `caliber.roundTo`，与甘特「故事进度」（C10 口径，DECISIONS
      //   `analytics.story-progress-aggregation` 要求"同一实现"）真正共用一处取整；
      //   `roundTo` 会把 `-0` 归一为 `0`，而 ratio 恒非负 ⇒ 现有数值零变化。
      ratio: rawRatio === null ? null : roundTo(rawRatio, 4),
    },
    health,
    byStatus,
    basis,
  }
}
