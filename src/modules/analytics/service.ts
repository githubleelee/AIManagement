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
 * 4. **口径随响应返回**（`basis`）：阈值、公式、时区、基数口径全部显式声明。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { TaskStatus } from '../../shared/types.js'
import { createAuthorization } from '../authz/permissions.js'
import type {
  AggregationScope,
  DashboardBasis,
  HealthState,
  ProjectDashboardView,
} from './types.js'

/** 分级阈值（百分点）。冻结口径：≤ 10pp 健康；≤ 25pp 预警；> 25pp 风险。 */
export const HEALTHY_THRESHOLD_PP = 10
export const WARNING_THRESHOLD_PP = 25

/** 口径时区（批复冻结：Asia/Shanghai）。 */
export const CALC_TIMEZONE = 'Asia/Shanghai'

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

/**
 * 按口径时区取"今天"（`YYYY-MM-DD`）。
 *
 * 用 `Intl` 而不是本地时钟：服务器时区不可控，而冻结口径写死 Asia/Shanghai。
 * `en-CA` 的日期格式恰好是 `YYYY-MM-DD`。
 */
function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CALC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** ISO 日期 → UTC 天序号（只用于算"相差几天"，与展示时区无关）。 */
function dayIndex(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(ms)) throw new Error(`非法日期：${iso}`)
  return Math.floor(ms / 86_400_000)
}

/** 保留 1 位小数（仅用于**展示**；比较一律用未舍入值）。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 计划时间进度（0~1，**未舍入**）：已过自然日数 ÷ 计划总自然日数，**含首尾**。
 *
 * - 区间天数 = `end − start + 1`；
 * - 已过 = `今天 − start + 1`，截断到 `[0, 区间天数]`；
 *   ⇒ 今天等于开始日时算 1 天已过（含首尾的必然结果），不是 0。
 */
export function planTimeProgressOf(asOf: string, start: string, end: string): number {
  const totalDays = dayIndex(end) - dayIndex(start) + 1
  if (totalDays <= 0) return 1 // 数据异常（end < start）时按"计划时间已用完"处理，不抛错
  const elapsed = Math.min(Math.max(dayIndex(asOf) - dayIndex(start) + 1, 0), totalDays)
  return elapsed / totalDays
}

/**
 * 健康度判定（纯函数）。
 *
 * **偏差 = 计划时间进度 − 实际进度**（正数表示"落后于计划"），单位百分点。
 * 三档判定用**未舍入**的偏差；返回给界面的 `deviationPp` 保留 1 位小数。
 */
export function healthOf(
  ratio: number | null,
  planTimeProgress: number | null,
  total: number,
): { state: HealthState; deviationPp: number | null; note?: string } {
  if (total === 0) {
    return {
      state: 'UNAVAILABLE',
      deviationPp: null,
      note: '暂无计划数据：项目下还没有任务，不做健康度分级。',
    }
  }
  if (ratio === null || planTimeProgress === null) {
    return {
      state: 'UNAVAILABLE',
      deviationPp: null,
      note: '缺少计算健康度所需的数据（进度或计划窗口不可用）。',
    }
  }
  const rawPp = (planTimeProgress - ratio) * 100
  const state: HealthState =
    rawPp <= HEALTHY_THRESHOLD_PP
      ? 'HEALTHY'
      : rawPp <= WARNING_THRESHOLD_PP
        ? 'WARNING'
        : 'AT_RISK'
  return { state, deviationPp: round1(rawPp) }
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
  const planTimeProgress = start && end ? planTimeProgressOf(asOf, start, end) : null

  // 健康度用**未舍入**的 ratio 判定（批复：比较用未舍入值）
  const health = healthOf(rawRatio, planTimeProgress, total)

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
      '偏差 = 计划时间进度 − 实际进度（单位：百分点 pp）；偏差 ≤ 10pp 为健康，> 10pp 且 ≤ 25pp 为预警，> 25pp 为风险；比较用未舍入值、展示保留 1 位小数；项目无任务时不做分级',
    timezone: `${CALC_TIMEZONE} 自然日（含首尾）`,
  }

  return {
    project: { id: project.id, name: project.name },
    progress: {
      closed,
      total,
      // 比例保留 4 位小数，仅为展示稳定；健康度判定用的是未舍入的 rawRatio
      ratio: rawRatio === null ? null : Math.round(rawRatio * 10_000) / 10_000,
    },
    health,
    byStatus,
    basis,
  }
}
