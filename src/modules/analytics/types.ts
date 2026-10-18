/**
 * US-10 项目仪表盘（工单 #30）—— 进度 / 健康度视图类型。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（技术负责人单写）。本模块只**新增**、
 * 不改共享契约；等接口正式并入契约时再由技术负责人决定是否上提。与 US-08 / US-09 同一做法。
 *
 * 前端 `web/src/pages/analytics/api.ts` 会按仓库既有做法声明一份界面侧类型，
 * 两者是否漂移由编译期护栏（`shared-types.typecheck.ts`）钉住。
 *
 * ===========================================================================
 * 口径来源（人工 2026-10-18 逐条拍板，原文见 #30 与 #24 的申请）
 * ===========================================================================
 *
 *   ① 计划时间进度基准：**从任务推导** `min(planStart)` ~ `max(planEnd)`；
 *      **不给 `Project` 加日期字段**（`Project` 本来就没有起止日期）。
 *   ② C1 阈值（**2026-10-18 批复冻结，已取代本处原写法**）：**偏差 = 计划时间进度 − 实际进度**
 *      （正数表示落后于计划），单位百分点；**≤ 10pp 健康 / > 10pp 且 ≤ 25pp 预警 / > 25pp 风险**；
 *      比较用**整数交叉相乘**（见 `caliber.ts` 的 `healthOf`）。阈值常量集中在 `caliber.ts`，
 *      并**随响应返回** `basis.thresholds` —— 定案后只改一处，界面与审查不必猜。
 *   ③ C6：**PM 全局基数；其余角色可见基数**，且分子、分母与计划窗口**同源**
 *      （DECISIONS `analytics.dashboard-window-basis`）。
 *   ④ 时区：**Asia/Shanghai 自然日**（C3 已于 2026-10-18 批复定案；DECISIONS
 *      `timezone.project-wide-asia-shanghai`）。取「今天」的实现见 `caliber.ts` 的 `isoToday()`。
 *
 * 进度口径（handoff §9，本票的必守口径）：
 *   **进度 = 已关闭任务数 ÷ 项目任务总数，`DONE` 不计入分子。**
 */
import type { TaskStatus } from '../../shared/types.js'

/**
 * 健康度状态。
 *
 * **`UNAVAILABLE` 是刻意存在的第四态**：项目下还没有任务时，"健康"与"风险"都无从谈起 ——
 * 返回 `HEALTHY` 是把"算不出来"说成"一切正常"（US-08 的三态纪律：三态而不是两态，
 * 不用 0 冒充"没有"）。界面在 `UNAVAILABLE` 时应显示说明而不是一个健康度标签。
 */
export type HealthState = 'HEALTHY' | 'WARNING' | 'AT_RISK' | 'UNAVAILABLE'

/** 线上常量数组（契约 I-1：不使用中文标签作为取值）。 */
export const HEALTH_STATES = ['HEALTHY', 'WARNING', 'AT_RISK', 'UNAVAILABLE'] as const

/** 健康度状态的中文标签（与线上常量分离）。 */
export const HEALTH_STATE_LABEL: Record<HealthState, string> = {
  HEALTHY: '健康',
  WARNING: '预警',
  AT_RISK: '风险',
  UNAVAILABLE: '无法计算',
}

/**
 * 统计基数的口径（C6）。
 *
 * - `global`：PM 视角 —— 项目内**全部**任务（PM 不受敏感白名单限制）。
 * - `visible`：其余角色 —— 只统计**自己可见**的任务（`visibilityScope()` 作用域）。
 *
 * 随响应返回，使界面与审查都能看出"这个百分比的分母是谁"。
 */
export type AggregationScope = 'global' | 'visible'

export const AGGREGATION_SCOPES = ['global', 'visible'] as const

/** 进度。`ratio` 在 `total === 0` 时为 `null` —— **不是 0**。 */
export type ProjectProgress = {
  /** 已验收关闭的任务数（`status === 'CLOSED'`）；`DONE` 不计入 */
  closed: number
  /** 统计基数内的任务总数（分母） */
  total: number
  /** `closed / total`，保留 4 位小数；`total === 0` 时为 `null` */
  ratio: number | null
}

/** 健康度。 */
export type ProjectHealth = {
  state: HealthState
  /**
   * **偏差 = 计划时间进度 − 实际进度**，单位**百分点（pp）**，正数表示"落后于计划"；
   * 展示保留 1 位小数；**分级不比较这个浮点值**，而是用整数交叉相乘精确比较
   * （2026-10-19 评审 H2，实现见 `service.ts` 的 `healthOf`）。
   * `state === 'UNAVAILABLE'` 时为 `null`（算不出来就不编一个数）。
   */
  deviationPp: number | null
  /** 面向界面直接显示的说明（例如「暂无计划数据：项目下还没有任务，不做健康度分级」） */
  note?: string
}

/**
 * 计算口径的**显式声明**（沿用 US-08 `basis` 的做法）：
 * 随响应返回，避免界面、审查、测试对"进度""健康""计划时间进度"各说各话。
 */
export type DashboardBasis = {
  /** 计算时使用的"今天"（口径时区 Asia/Shanghai 的 `YYYY-MM-DD`） */
  asOf: string
  /** 本次统计的基数口径（C6） */
  scope: AggregationScope
  /** 计划窗口：统计基数内任务的 `min(planStart)` ~ `max(planEnd)`；无任务时为 `null` */
  planWindow: { start: string; end: string } | null
  /**
   * 计划时间进度（0~1，**未舍入**）= 已过自然日数 ÷ 计划总自然日数（**含首尾**）；
   * 无窗口时为 `null`。
   *
   * ⚠️ 这个比值只供**展示与口径声明**：健康度分级不比较它（浮点误差会把正好落在
   *    阈值上的情形错分，见 `service.ts` 的 `healthOf`）。
   */
  planTimeProgress: number | null
  /**
   * 分级阈值（**百分点**）。判定：偏差 ≤ `healthyPp` → 健康；≤ `warningPp` → 预警；否则风险。
   * 冻结口径：10 / 25。
   */
  thresholds: { healthyPp: number; warningPp: number }
  progressMeans: string
  planTimeProgressMeans: string
  healthMeans: string
  /** 时区口径说明（批复冻结：Asia/Shanghai 自然日、含首尾） */
  timezone: string
}

export type ProjectDashboardView = {
  project: { id: string; name: string }
  progress: ProjectProgress
  health: ProjectHealth
  /** 各状态任务数（六态齐全，未出现的状态计 0）；之和必须等于 `progress.total` */
  byStatus: Record<TaskStatus, number>
  basis: DashboardBasis
}
