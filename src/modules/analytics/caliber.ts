/**
 * US-10 项目仪表盘（工单 #30）—— **冻结口径的纯计算层**（无 I/O、无 Prisma、无判权）。
 *
 * ===========================================================================
 * 为什么单独一个文件（2026-10-19 #33 独立评审 P1）
 * ===========================================================================
 *
 * 原先这些函数与 `buildDashboard`（查库 + 判权）同处 `service.ts`，于是任何想**复用口径**
 * 的模块都只能去 import 一个 service 文件 —— 那正是契约决策 I-9 明令禁止的
 * 「模块之间不导出可被调用的 service 函数」。
 *
 * 更要紧的是当时的选择题本身是假的：
 *   - import `service.ts` ⇒ 字面违纪；
 *   - 把公式抄一份到新模块 ⇒ 把刚修好的浮点边界缺陷（H2）一起复制过去。
 *
 * 把**口径**与**I/O** 分成两个文件后，两条都不必选：
 *   - 公式只有一份（在 `analytics/service.ts` 与本文件之外没有任何第二实现）；
 *   - 依赖边变成「模块 → 纯口径文件」，不再是 service → service；
 *   - 不碰 `src/shared/*`（B 的冻结区），也不需要为 I-9 开豁免。
 *
 * 谁在用：`analytics/service.ts`（仪表盘）与 `ai-insights/*`（#33 的四类指标，进度类）。
 *
 * ===========================================================================
 * 口径来源（冻结，不得在此文件之外另立一份）
 * ===========================================================================
 *
 * 项目负责人 2026-10-18 批复第 3 节 + DECISIONS `analytics.health-thresholds-and-planned-progress`、
 * `analytics.dashboard-window-basis`：
 *
 *   - 计划时间进度 = 已过自然日数 ÷ 计划总自然日数，**含首尾**，时区 Asia/Shanghai；
 *   - 偏差 = **计划 − 实际**（单位 pp，正数表示落后）；
 *   - 分级 ≤ 10pp 健康 / > 10pp 且 ≤ 25pp 预警 / > 25pp 风险，**比较用整数交叉相乘**；
 *   - 无任务 ⇒ 不做分级（`UNAVAILABLE`），不用 0 或「健康」冒充。
 *
 * ⚠️ 本文件**只做算术**：不查库、不判权、不读环境。计划区间取哪个窗口（PM 全项目 /
 *    其余可见窗口）属**取数层**的口径，由调用方决定后把 `planWindow` 传进来。
 */
import type { HealthState } from './types.js'

/** 分级阈值（百分点）。冻结口径：≤ 10pp 健康；≤ 25pp 预警；> 25pp 风险。 */
export const HEALTHY_THRESHOLD_PP = 10
export const WARNING_THRESHOLD_PP = 25

/** 口径时区（批复冻结：Asia/Shanghai；DECISIONS `timezone.project-wide-asia-shanghai`）。 */
export const CALC_TIMEZONE = 'Asia/Shanghai'

/**
 * 按口径时区取「今天」（`YYYY-MM-DD`）。
 *
 * 用 `Intl` 而不是本地时钟：服务器时区不可控，而口径写死 Asia/Shanghai。
 * `en-CA` 的日期格式恰好是 `YYYY-MM-DD`。
 *
 * ★ 2026-10-19 起本函数只有这一份实现（原先 `analytics/service.ts` 与 #33 各有一份）。
 */
export function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CALC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** ISO 日期 → UTC 天序号（只用于算「相差几天」，与展示时区无关）。 */
function dayIndex(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(ms)) throw new Error(`非法日期：${iso}`)
  return Math.floor(ms / 86_400_000)
}

/**
 * 四舍五入到 `digits` 位小数（**仅用于展示**；比较一律用未舍入值）。
 *
 * ★ 结果里的 `-0` 一律归一为 `0`（2026-10-19 #33 评审 S1）：`rawPp ∈ (-0.05, 0)` 时
 *   `Math.round(...)/10` 会得到 `-0`；`JSON.stringify(-0)` 是 `"0"`、`(-0).toFixed(1)`
 *   是 `"0.0"`，线上无碍，但 `expect(x).toBe(0)` 用的是 `Object.is` ⇒ 会假红。
 *   归一在一处，两个模块同益。
 */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** 保留 1 位小数（展示用）。 */
function round1(value: number): number {
  return roundTo(value, 1)
}

/**
 * 计划窗口的**天数分解**（整数）：已过自然日数 / 计划总自然日数，**含首尾**。
 *
 * ★ 为什么把「天数」单独暴露出来：健康度分级必须用**整数**比较（见 `healthOf`），
 *   而两个比值一旦相减就会引入浮点误差。算天数只做整数加减，因此这里是口径的
 *   唯一来源，`planTimeProgressOf` 只是它的一层比值封装。
 */
export type PlanTimeWindow = {
  /** 已过自然日数，截断到 `[0, totalDays]` */
  elapsedDays: number
  /** 计划总自然日数（含首尾）= `end − start + 1` */
  totalDays: number
}

/**
 * 计划窗口天数（整数）。
 *
 * - 区间天数 = `end − start + 1`；
 * - 已过 = `今天 − start + 1`，截断到 `[0, 区间天数]`；
 *   ⇒ 今天等于开始日时算 1 天已过（含首尾的必然结果），不是 0；
 * - 数据异常（`end < start`）时按「计划时间已用完」处理（`1/1`），不抛错。
 */
export function planTimeDaysOf(asOf: string, start: string, end: string): PlanTimeWindow {
  const totalDays = dayIndex(end) - dayIndex(start) + 1
  if (totalDays <= 0) return { elapsedDays: 1, totalDays: 1 }
  const elapsedDays = Math.min(Math.max(dayIndex(asOf) - dayIndex(start) + 1, 0), totalDays)
  return { elapsedDays, totalDays }
}

/**
 * 计划时间进度（0~1，**未舍入**）：已过自然日数 ÷ 计划总自然日数，**含首尾**。
 *
 * ⚠️ 这个比值**只用于展示与口径声明**（`basis.planTimeProgress`），**不得**用它的
 *    浮点差去和阈值比较 —— 分级请调 `healthOf`。
 */
export function planTimeProgressOf(asOf: string, start: string, end: string): number {
  const { elapsedDays, totalDays } = planTimeDaysOf(asOf, start, end)
  return elapsedDays / totalDays
}

export type HealthInput = {
  /** 统计基数内的任务总数（分母） */
  totalTasks: number
  /** 已关闭的任务数（分子） */
  closedTasks: number
  /** 计划窗口天数（`planTimeDaysOf` 的结果）；无计划窗口时为 `null` */
  planDays: PlanTimeWindow | null
}

/**
 * 健康度判定（纯函数）。
 *
 * **偏差 = 计划时间进度 − 实际进度**（正数表示"落后于计划"），单位百分点。
 *
 * ★ 分级用**整数交叉相乘**，不用浮点偏差比较（2026-10-19 独立评审 H2）：
 *
 * ```
 *   rawPp ≤ pp  ⟺  100·(E·T − C·D) ≤ pp·D·T
 *   （E=已过天数，D=计划总天数，C=已关闭数，T=任务总数）
 * ```
 *
 * 旧实现写的是 `(E/D − C/T) × 100 ≤ pp`，而 IEEE754 下 `(0.4 − 0.3) × 100`
 * `= 10.000000000000004 > 10`、`(7/12 − 1/3) × 100 = 25.000000000000007 > 25`：
 * **正好落在阈值上**（计划 2/5 天、进度 3/10；计划 7/12 天、进度 1/3）的两种情形
 * 分别被错分成「预警」「风险」。旧边界用例恰好用了二进制友好的 0.5 / 0.4 / 0.25，
 * 因此掩盖了该缺陷；现补两条用例钉住（`analytics.test.ts`）。
 *
 * 展示用的 `deviationPp` 仍按浮点算（只影响显示，保留 1 位小数，±1e-14 的误差
 * 舍入后不可见；`-0` 已由 `roundTo` 归一），分级不受它影响。
 *
 * ★ 溢出边界（#33 评审核算）：乘积需满足 `100·D·T < 2^53`；`D ≈ 10⁴` 天时任务数要超过
 *   约 9×10⁹ 条才会丢精度 —— 现实中不可达，故整数比较成立。
 */
export function healthOf(input: HealthInput): {
  state: HealthState
  deviationPp: number | null
  note?: string
} {
  const { totalTasks, closedTasks, planDays } = input

  if (totalTasks === 0) {
    return {
      state: 'UNAVAILABLE',
      deviationPp: null,
      note: '暂无计划数据：项目下还没有任务，不做健康度分级。',
    }
  }
  if (planDays === null) {
    return {
      state: 'UNAVAILABLE',
      deviationPp: null,
      note: '缺少计算健康度所需的数据（进度或计划窗口不可用）。',
    }
  }

  const { elapsedDays, totalDays } = planDays
  // 未舍入偏差 ×(D·T)：全为正整数的交叉相乘，无浮点误差
  const scaledDeviation = 100 * (elapsedDays * totalTasks - closedTasks * totalDays)
  const limit = totalDays * totalTasks

  const state: HealthState =
    scaledDeviation <= HEALTHY_THRESHOLD_PP * limit
      ? 'HEALTHY'
      : scaledDeviation <= WARNING_THRESHOLD_PP * limit
        ? 'WARNING'
        : 'AT_RISK'

  const rawPp = 100 * (elapsedDays / totalDays - closedTasks / totalTasks)
  return { state, deviationPp: round1(rawPp) }
}
