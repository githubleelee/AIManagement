/**
 * US-10 项目仪表盘（工单 #30）—— 进度 / 健康度聚合服务。
 *
 * ===========================================================================
 * 纪律（四条）
 * ===========================================================================
 *
 * 1. **判权只走冻结入口 `can()`**（契约 I-5），不自行判角色。
 * 2. **分子与分母同源**（C6 的人工拍板）：两者都拼进**同一个 where**，且该 where 已包含
 *    `visibilityScope()` 的作用域条件 —— 因此不存在"分母算全部、分子只算可见"这种
 *    既能凑数又能泄漏存在性的写法（决策 I-6：查询层过滤，禁止内存过滤后计数）。
 * 3. **算不出来就不编数字**：任务数为 0 时 `ratio` 返回 `null`（不是 0）、
 *    健康度返回 `UNAVAILABLE`（不是 `HEALTHY`）。这是 US-08 的三态纪律在汇总上的延续。
 * 4. **口径随响应返回**（`basis`）：阈值、计划窗口、时区、基数口径全部显式声明，
 *    便于界面直接展示、便于审查核对、也便于阈值定案后只改一处。
 *
 * ===========================================================================
 * 口径（人工 2026-10-18 拍板，见 #30 / #24）
 * ===========================================================================
 *
 * - 进度 = 已关闭任务数 ÷ 任务总数，**`DONE` 不计入分子**（handoff §9）。
 * - 计划时间进度 = `(asOf − min(planStart)) / (max(planEnd) − min(planStart))`，截断到 [0,1]；
 *   窗口**从任务推导**，因为 `Project` 表没有起止日期（这是本票实测确认的事实）。
 * - 健康度 = 实际进度 − 计划时间进度，按 C1 阈值分三态。
 * - 时区：UTC 日期（沿用 US-08；C3 定案后只改 `isoToday()`）。
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

/**
 * C1 阈值（**本票自定默认值**，C1 在 #24 仍是待确认项）。
 *
 * 判定语义：`deviation >= HEALTHY_THRESHOLD` → 健康；`>= WARNING_THRESHOLD` → 预警；否则风险。
 * 阈值**随响应返回**（`basis.thresholds`），界面与审查不必猜；C1 定案后只改这两个常量。
 */
export const HEALTHY_THRESHOLD = -0.1
export const WARNING_THRESHOLD = -0.25

/** 六状态的固定顺序（用于 `byStatus` 的初始化与界面展示）。 */
const TASK_STATUSES: readonly TaskStatus[] = [
  'TODO',
  'DOING',
  'BLOCKED',
  'SUSPENDED',
  'DONE',
  'CLOSED',
]

/** 与「对象不存在」完全一致的 404（契约 I-3，不泄漏对象是否存在）。 */
function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', '资源不存在')
}

/** 对象可见但操作不允许：403。 */
function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
}

function denied(decision: { status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }): AppError {
  return decision.code === 'NOT_FOUND' ? notFound() : forbidden()
}

/** 按 UTC 日期取"今天"（C3 待定案；与 `workbench/service.ts` 同一口径）。 */
function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** ISO 日期 → UTC 天序号（用于按"天"算区间，避免引入依赖）。 */
function dayIndex(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(ms)) throw new Error(`非法日期：${iso}`)
  return Math.floor(ms / 86_400_000)
}

/** 保留 4 位小数：让接口返回值稳定、可断言，避免浮点噪声。 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * 计划时间进度：`(asOf − start) / (end − start)`，截断到 [0,1]。
 *
 * - `asOf` 早于或等于 `start` → 0（计划时间还没开始走）；
 * - `asOf` 晚于或等于 `end` → 1（计划时间已全部用完）；
 * - `start === end`（同日任务）→ 当天为 0、之后为 1。
 */
export function planTimeProgressOf(asOf: string, start: string, end: string): number {
  const t = dayIndex(asOf)
  const s = dayIndex(start)
  const e = dayIndex(end)
  if (t <= s) return 0
  if (t >= e) return 1
  return round4((t - s) / (e - s))
}

/** 健康度判定（纯函数，便于单测与反事实）。 */
export function healthOf(
  ratio: number | null,
  planTimeProgress: number | null,
  total: number,
): { state: HealthState; deviation: number | null; note?: string } {
  if (total === 0) {
    return {
      state: 'UNAVAILABLE',
      deviation: null,
      note: '项目下还没有任务，无法计算健康度（不是"健康"，是"算不出来"）。',
    }
  }
  if (ratio === null || planTimeProgress === null) {
    return {
      state: 'UNAVAILABLE',
      deviation: null,
      note: '缺少计算健康度所需的数据（进度或计划窗口不可用）。',
    }
  }
  const deviation = round4(ratio - planTimeProgress)
  if (deviation >= HEALTHY_THRESHOLD) return { state: 'HEALTHY', deviation }
  if (deviation >= WARNING_THRESHOLD) return { state: 'WARNING', deviation }
  return { state: 'AT_RISK', deviation }
}

export type BuildDashboardOptions = {
  /** 覆盖"今天"（测试用来钉住边界；默认按 UTC 今天） */
  today?: string
}

/**
 * 组装项目仪表盘。
 *
 * 权限：`can(actor, 'project.read', { kind: 'project' })` —— 四种角色都能读；
 * 非项目成员 / 项目不存在 → 404（两者响应逐字一致）。
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
  if (!project) throw notFound() // 理论上 can() 已拦；兜底

  // ★ 可见性作用域（决策 I-6）：与下面的统计条件拼进**同一个 where**。
  const scope = await visibilityScope(actorUserId, projectId, 'task')
  const where: Prisma.TaskWhereInput = {
    projectId,
    ...(scope.mode === 'subset' ? { id: { in: scope.ids } } : {}),
  }

  // 分子 / 分母 / 状态分布 / 计划窗口 —— **全部用同一个 where**（C6：分子分母同源）。
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

  const ratio = total === 0 ? null : round4(closed / total)
  const start = window._min.planStart
  const end = window._max.planEnd
  const asOf = options.today ?? isoToday()
  const planTimeProgress = start && end ? planTimeProgressOf(asOf, start, end) : null

  const health = healthOf(ratio, planTimeProgress, total)

  // C6：PM 是全局基数（visibilityScope 对 PM 返回 all），其余角色是可见基数。
  const aggregationScope: AggregationScope = scope.mode === 'all' ? 'global' : 'visible'

  const basis: DashboardBasis = {
    asOf,
    scope: aggregationScope,
    planWindow: start && end ? { start, end } : null,
    planTimeProgress,
    thresholds: { healthy: HEALTHY_THRESHOLD, warning: WARNING_THRESHOLD },
    progressMeans: '已验收关闭的任务数 ÷ 统计基数内的任务总数（status = CLOSED 计入分子，DONE 不计入）',
    planTimeProgressMeans:
      '计划时间进度 = (今天 − 统计基数内任务的 min(planStart)) ÷ (max(planEnd) − min(planStart))，截断到 0~1；项目表没有起止日期，窗口由任务推导',
    healthMeans:
      '健康度 = 实际进度 − 计划时间进度；偏差 ≥ healthy 阈值判「健康」，≥ warning 阈值判「预警」，否则「风险」；没有任务时不判定（UNAVAILABLE）',
    timezone: 'UTC 日期（C3 待定案；与工作台同一口径）',
  }

  return {
    project: { id: project.id, name: project.name },
    progress: { closed, total, ratio },
    health,
    byStatus,
    basis,
  }
}
