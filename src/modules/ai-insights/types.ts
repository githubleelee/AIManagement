/**
 * US-13 AI 质量 / 进度 / 风险 / 效率分析（工单 #33）—— 指标聚合类型。
 *
 * ===========================================================================
 * 本批次的范围（2026-10-19）：**只做四类指标的聚合**
 * ===========================================================================
 *
 * 只把项目数据算成一组**聚合数值**（`InsightMetrics`），供后续的「规则式建议生成」使用。
 * 以下四件事本批次一律不做，各有一条依据：
 *
 *   1. **不建表、不加迁移** —— `ai.suggestion-store-shared`：建议与处置走 #31 的**共享
 *      存储**（B 落地），A 只提字段需求，不单独建表；
 *   2. **不加 `Action`、不判处置权限** —— `permissions.ai-suggestion-disposal`：处置仅 PM，
 *      且与 #32 合并为**同一个动作**，等 B 随共享存储一并加入 `can()`；
 *   3. **不注册路由** —— AC5 要求接入 #31 公共端口后才生成建议，端点的前置件还不存在；
 *   4. **不 import 其它业务模块的 service** —— 契约决策 I-9（#33 的 AC5 原文也是
 *      「不跨模块调 service」）。本模块自己查 Prisma、自己组装类型。
 *
 * ===========================================================================
 * 进度口径为什么是 import 而不是自己写（AC6 的关键）
 * ===========================================================================
 *
 * 进度类的分级口径（含首尾自然日、计划 − 实际、10 / 25pp 阈值、整数精确比较）是 **#30
 * 的冻结口径**，已随 PR #55 合入 main。本模块**只 import 它的纯函数**
 * （`analytics/service.ts` 的 `planTimeDaysOf` / `healthOf` 与两个阈值常量），
 * **不复制第二份公式**：
 *
 *   - 复制的代价是真实的：那份公式刚被独立评审修掉一个浮点边界缺陷（H2，
 *     `(0.4−0.3)×100 = 10.000000000000004 > 10` 把正好落在阈值上的情形错分），
 *     抄一份等于把缺陷一起搬进一个没有交叉校验用例的新模块；
 *   - 复用的方式是**单向依赖纯函数**：`ai-insights → analytics`，只取无 I/O、无鉴权
 *     副作用的纯函数与线上常量，不调用 `buildDashboard` 这类带查库与判权的 service 函数，
 *     因此不构成契约 I-9 要防的「模块互相调用 service」（且两模块同属 ROLE-A）。
 *   - `metrics.test.ts` 里另有一条**接口层交叉校验**用例：同一批造数下，本模块的
 *     进度 / 健康度必须与 `GET /projects/:projectId/dashboard` 逐字段相等 —— 哪天
 *     #30 改了口径，这条用例会立刻红。
 *
 * 统计基数与计划窗口的**可见窗口**口径，按 DECISIONS `analytics.dashboard-window-basis`
 * 执行：PM = 全项目；MEMBER / VIEWER = 各自可见范围，且分子、分母与计划区间**同源同窗口**。
 *
 * ===========================================================================
 * 数据边界（设计 §5.1，四层收窄；本文件是第 2 层的落点）
 * ===========================================================================
 *
 * **本结构的每个字段都必须是计数 / 比率 / 天数这类数值**：不含任务标题、描述、驳回原因
 * 原文、成员姓名或 account。这不是「顺手脱敏」，而是给 #31 端口准备的输入 —— 端口拿到的
 * 就是这些数字，因而天然满足「最小必要」与「不外发原文」。
 *
 * 唯一的成员维度是 `MemberLoad.memberKey`：**匿名键**（见 `aggregate.ts` 的
 * `memberKeyOf`），不是姓名、账号或 userId —— 效率类的成员维度若带真名，分析结果
 * 本身就变成了人事数据（设计 §11 已知风险第 4 条）。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（B 单写）。本模块只**新增**，
 * 与 US-08 / US-09 / US-10 同一做法。
 */
import type { TaskStatus } from '../../shared/types.js'
import type { HealthState } from '../analytics/types.js'

/* ===========================================================================
 * ① 与 ROLE-D 协议对齐的线上常量
 * =========================================================================== */

/**
 * 分析场景（D 的 `role-d.ai-events.v0.2-draft` §2.1 **线上常量**）。
 *
 * ★ 不自造 `InsightKind` 字面量：D §2.1 明确「不得只用一个 `INSIGHTS` 值再把分析类别
 *   藏进任意 JSON；细分场景必须可索引、可统计」。四类建议因此是四个独立场景值。
 */
export const INSIGHT_SCENARIOS = [
  'INSIGHT_QUALITY',
  'INSIGHT_PROGRESS',
  'INSIGHT_RISK',
  'INSIGHT_EFFICIENCY',
] as const

export type InsightScenario = (typeof INSIGHT_SCENARIOS)[number]

/** 场景的中文标签（与线上常量分离，契约决策 I-1）。 */
export const INSIGHT_SCENARIO_LABEL: Record<InsightScenario, string> = {
  INSIGHT_QUALITY: '质量',
  INSIGHT_PROGRESS: '进度',
  INSIGHT_RISK: '风险',
  INSIGHT_EFFICIENCY: '效率',
}

/** 场景 → `InsightMetrics` 的字段名（生成层按类别取数时要一一对应，不得错位）。 */
export const METRIC_KEY_BY_SCENARIO: Record<
  InsightScenario,
  keyof InsightMetrics
> = {
  INSIGHT_QUALITY: 'quality',
  INSIGHT_PROGRESS: 'progress',
  INSIGHT_RISK: 'risk',
  INSIGHT_EFFICIENCY: 'efficiency',
}

/**
 * 统计基数（D §2.3 `populationBasis`）。
 *
 * - `OBJECT`：对象级场景用（#31 需求拆分、#32 排期）—— **本票不使用**；
 * - `GLOBAL`：PM 视角，全项目基数；
 * - `VISIBLE`：其余角色，只统计自己可见的范围。
 *
 * ★ D §2.3 的硬约束：**#33 非 PM 必须是 `VISIBLE`**，不得用可见子集冒充全项目。
 */
export const POPULATION_BASES = ['OBJECT', 'GLOBAL', 'VISIBLE'] as const

export type PopulationBasis = (typeof POPULATION_BASES)[number]

/** 项目级聚合只可能是这两种（`OBJECT` 留给对象级场景）。 */
export type ProjectPopulationBasis = Exclude<PopulationBasis, 'OBJECT'>

/* ===========================================================================
 * ② 取值口径（与 #30 / 风险台账一致，防漂移）
 * =========================================================================== */

/** 风险等级线上取值（DECISIONS `permissions.risk-status-flow`）。 */
export const RISK_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

/** 风险状态线上取值（同上）：未处理 / 处理中 / 已解决 / 已关闭。 */
export const RISK_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const
export type RiskStatus = (typeof RISK_STATUSES)[number]

/**
 * **会阻断项目关闭**的风险状态（handoff §9 + #30 批复）。
 *
 * 本票的「未解决风险」直接复用它，因此风险类的证据数字与关闭阻断的判断**同源**
 * （`RESOLVED` / `CLOSED` 不阻断）。
 */
export const UNRESOLVED_RISK_STATUSES: readonly RiskStatus[] = ['OPEN', 'IN_PROGRESS']

/** 验收结论线上取值（#29）。 */
export const ACCEPTANCE_CONCLUSIONS = ['PASS', 'REJECT'] as const
export type AcceptanceConclusion = (typeof ACCEPTANCE_CONCLUSIONS)[number]

/** 任务六态（契约决策 I-1）。 */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'TODO',
  'DOING',
  'BLOCKED',
  'SUSPENDED',
  'DONE',
  'CLOSED',
]

/* ===========================================================================
 * ③ 聚合输入（**纯计算的事实**：已按可见性过滤后的计数，不含原文）
 * =========================================================================== */

/**
 * 任务计数事实：按 `(status, ownerUserId)` 分组后的计数。
 *
 * 为什么传**计数**而不是任务行：聚合层因此是纯函数（`aggregate.test.ts` 不需要数据库），
 * 且取数层根本没有机会把标题、描述带进计算过程 —— 「不传原文」由类型保证，不靠自觉。
 */
export type TaskCountFact = { status: TaskStatus; ownerUserId: string; count: number }

/** 任务侧全部输入：分组计数 + 计划窗口。 */
export type TaskFacts = {
  counts: readonly TaskCountFact[]
  /**
   * 统计基数内任务的 `min(planStart)` ~ `max(planEnd)`。
   *
   * **可见窗口**（DECISIONS `analytics.dashboard-window-basis`）：PM 是全项目窗口，
   * 其余角色是自己可见任务的窗口；与分子分母同源。无任务时为 `null`（不做分级，
   * 而不是当作「进度 0」）。
   */
  planWindow: { start: string; end: string } | null
}

/** 验收计数事实：按 `(taskId, conclusion)` 分组后的计数（`taskId` 只用于分组，不对外输出）。 */
export type AcceptanceCountFact = {
  taskId: string
  conclusion: AcceptanceConclusion
  count: number
}

/** 风险计数事实：按 `(status, level)` 分组后的计数。 */
export type RiskCountFact = { status: RiskStatus; level: RiskLevel; count: number }

/** 成员事实：当前 `ProjectMember`（零负载成员也要在内，否则看不出负载不均）。 */
export type MemberFact = { userId: string }

/** 一次聚合的全部输入。 */
export type InsightAggregationInput = {
  projectId: string
  /** 计算时使用的「今天」（口径时区 `Asia/Shanghai` 的 `YYYY-MM-DD`） */
  asOf: string
  tasks: TaskFacts
  acceptances: readonly AcceptanceCountFact[]
  risks: readonly RiskCountFact[]
  members: readonly MemberFact[]
}

/* ===========================================================================
 * ④ 四类指标（**输出**：全部是数值，可直接作为证据展示）
 * =========================================================================== */

/** 进度。口径与 #30 的仪表盘**同源**（直接复用其纯函数，见文件头）。 */
export type ProgressMetrics = {
  /** 已验收关闭的任务数（`status === 'CLOSED'`）；**`DONE` 不计入** */
  closed: number
  /** 统计基数内的任务总数（分母） */
  total: number
  /** `closed / total`，保留 4 位小数（与 #30 一致）；`total === 0` 时为 `null`（**不是 0**） */
  ratio: number | null
  /** 计划时间进度（0~1，**未舍入**）；无计划窗口时为 `null` */
  planTimeProgress: number | null
  /**
   * **偏差 = 计划时间进度 − 实际进度**，单位**百分点（pp）**，正数表示落后于计划；
   * 展示保留 1 位小数（分级判定用整数精确比较，见 `analytics/service.ts` 的 `healthOf`）。
   * `UNAVAILABLE` 时为 `null`。
   */
  deviationPp: number | null
  /** 健康度分级（取值与 #30 的 `HealthState` **同一类型**，不是另立一套字面量） */
  healthState: HealthState
  /** 面向界面的分级说明（例如「暂无计划数据」）；可分级时为 `null` */
  healthNote: string | null
  /** 计划窗口（可见窗口口径）；无任务时为 `null` */
  planWindow: { start: string; end: string } | null
}

/** 质量。输入来自 #29 的验收记录与任务状态。 */
export type QualityMetrics = {
  /** 验收轮次总数（验收记录条数）；驳回率的分母 */
  acceptanceRounds: number
  /** 驳回结论的条数 */
  rejections: number
  /** 至少被驳回一次的**任务数**（去重 —— 同一任务被驳回两次只计一个任务） */
  rejectedTasks: number
  /** 重验次数 = Σ max(0, 该任务验收记录数 − 1)，即同一任务第 2 次起的验收轮次 */
  reverifications: number
  /** `rejections / acceptanceRounds`，保留 4 位小数；**分母为 0 时为 `null`** */
  rejectionRate: number | null
  /** 当前卡住的任务数（`status = 'BLOCKED'`） */
  blockedTasks: number
  /**
   * 验收平均等待天数：**恒为 `null`**（本批次）。
   *
   * 现有表没有「任务何时进入待验收（`DONE`）」的时间戳（只有任务创建时间与验收记录
   * 时间），这个数**算不出来**。按本仓库纪律：返回 `null` 并在 `unavailable` 里写明
   * 原因与缺什么，**不用 0 冒充**，也不拿「创建→验收」冒充「等待验收」。
   */
  avgAcceptanceDays: number | null
}

/** 风险。口径与 #30 的关闭阻断同源。 */
export type RiskMetrics = {
  /** 未处理（`OPEN`） */
  open: number
  /** 处理中（`IN_PROGRESS`） */
  inProgress: number
  /** 未处理 + 处理中 —— 即「未解决」，与 #30 的阻断口径同源 */
  unresolved: number
  /** 已解决（`RESOLVED`） */
  resolved: number
  /** 已关闭（`CLOSED`） */
  closed: number
  /** 统计基数内的风险总数（四态之和） */
  total: number
  /**
   * **未解决**风险的等级分布（不是全部风险的等级分布 —— 后者会把已解决的高危也算成
   * 当前暴露面）。取这个字段名是为了与 D §2.3 快照字段 `byLevel` 对齐；口径写在
   * `basis.formulas.riskByLevel`，并由用例钉住。
   */
  byLevel: { high: number; medium: number; low: number }
}

/** 单个成员的负载（**匿名键**，见 `memberKeyOf`）。 */
export type MemberLoad = {
  /** 匿名成员键：不是姓名、不是 account、不是 userId */
  memberKey: string
  /** 未关闭任务数（`status != 'CLOSED'`，**含 `DONE`**）—— 与 #27 的负载口径一致 */
  openTasks: number
}

/** 效率。输入来自 #27 的负载口径与任务六态。 */
export type EfficiencyMetrics = {
  /** 全部当前成员的负载，按 `openTasks` 降序（零负载成员也在内，否则看不出不均） */
  byMember: MemberLoad[]
  /** 当前成员数（分母：包括零负载的人） */
  members: number
  /** 手上有未关闭任务的成员数 */
  membersWithOpenTasks: number
  /** 零负载成员数（未关闭任务数为 0） */
  idleMembers: number
  /**
   * 单人最大未关闭任务数。
   *
   * **不给「超过 N 即过载」的阈值** —— 阈值属业务裁定，不在聚合层发明
   * （与 DECISIONS `scheduling.load-aggregation-baseline`「只给分布、不设过载阈值」一致）。
   */
  maxOpenTasks: number
  /** 进行中（`DOING`）任务数 */
  doingTasks: number
  /** 待验收（`DONE`）任务数 —— 「已提交但没被验收」的积压 */
  pendingAcceptanceTasks: number
}

/** 四类指标。 */
export type InsightMetrics = {
  progress: ProgressMetrics
  quality: QualityMetrics
  risk: RiskMetrics
  efficiency: EfficiencyMetrics
}

/**
 * 一条「算不出来」的登记。
 *
 * 沿用本仓库的三态纪律：**算不出来 ≠ 一切正常**。这里如实列出哪个指标缺席、缺什么、
 * 为什么缺，使界面与审查都不必猜。
 */
export type UnavailableMetric = {
  /** 指标路径（如 `quality.avgAcceptanceDays`） */
  metric: string
  /** 需要什么才能算出它 */
  needs: string
  /** 为什么现在没有 */
  reason: string
}

/* ===========================================================================
 * ⑤ 聚合结果（随响应返回的计算口径声明）
 * =========================================================================== */

/**
 * 计算口径的**显式声明**（沿用 US-08 / US-10 的 `basis` 做法）。
 *
 * 这份文本会随指标一起交给 #31 端口与界面：界面要标注「可见范围」，审查要能核对
 * 「这个数是怎么来的」，生成层要能照抄成共享记录的 `inputScope`。
 */
export type MetricsBasis = {
  /** 计算时使用的「今天」（口径时区 `Asia/Shanghai` 的 `YYYY-MM-DD`） */
  asOf: string
  /** 基数口径（C6 / D §2.3）：PM = `GLOBAL`，其余 = `VISIBLE` */
  populationBasis: ProjectPopulationBasis
  /** 面向界面的基数标签：`全项目` / `可见范围` */
  scopeLabel: '全项目' | '可见范围'
  /** 口径来源（写死，避免后人以为是本模块自造） */
  caliberOwner: 'US-10 (#30)'
  /**
   * 分级阈值（**百分点**）。与 #30 的 `basis.thresholds` 同一组常量（import，不另立）。
   */
  thresholds: { healthyPp: number; warningPp: number }
  /** 各类指标的口径文案（含公式与边界） */
  formulas: {
    progress: string
    quality: string
    riskByLevel: string
    memberLoad: string
  }
  /** 时区口径 */
  timezone: string
  /** 匿名化口径（成员维度为什么只给 memberKey） */
  anonymization: string
  /** 数据边界声明（设计 §5.1 第 2 条） */
  dataBoundary: string
  /** 本结构取数的表（便于审查核对「数从哪里来」） */
  sourceTables: string[]
}

/** 指标聚合的完整结果。 */
export type InsightMetricsView = {
  projectId: string
  asOf: string
  /** 本次统计的基数（C6 / D §2.3）：PM = `GLOBAL`，其余 = `VISIBLE` */
  populationBasis: ProjectPopulationBasis
  /**
   * 本次可供生成的场景（D §2.1 的线上常量，四类齐全）。
   *
   * 若将来某一类的数据源缺失，应把它从这里移除并在 `unavailable` 写明原因，
   * **不要**返回一堆 0 让生成层编出结论。
   */
  scenarios: InsightScenario[]
  metrics: InsightMetrics
  /** 算不出来的指标（不用 0 冒充） */
  unavailable: UnavailableMetric[]
  basis: MetricsBasis
}
