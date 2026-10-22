/**
 * US-13 四类指标聚合（工单 #33）—— **纯计算层**（无 Prisma、无 I/O）。
 *
 * ===========================================================================
 * 为什么分两层
 * ===========================================================================
 *
 *   `metrics.ts`（取数层）  ：判权 → 取可见性作用域 → 查库 → 组装**计数事实**
 *   本文件（纯聚合层）      ：只吃计数事实，算出四类指标与「算不出来」的登记
 *
 * 好处有两条，都不是风格问题：
 *   1. 口径可以用**不依赖数据库**的用例逐条钉住（边界、分母为 0、去重、排序、匿名键）；
 *   2. 取数层**没有机会**把任务标题 / 描述 / 成员姓名带进计算过程 ——「不传原文」
 *      由类型（`TaskCountFact` 只有 status / ownerUserId / count）保证，不靠自觉。
 *
 * ===========================================================================
 * 口径来源（一条都不自造）
 * ===========================================================================
 *
 *   - **进度 / 健康度**：直接 import #30 的纯函数与阈值常量（见 `types.ts` 文件头的说明），
 *     本文件**不复制公式**；
 *   - **质量**：#29 的验收记录（结论 = PASS / REJECT）与任务六态；
 *   - **风险**：「未解决 = OPEN / IN_PROGRESS」与关闭阻断同源；`byLevel` 只统计未解决；
 *   - **效率**：负载 = 负责人名下 `status != CLOSED` 的任务数（**含 DONE**），
 *     与 #27 及 DECISIONS `scheduling.load-aggregation-baseline` 一致。
 */
import { createHash } from 'node:crypto'
// ★ 冻结口径的**纯函数**（`analytics/caliber.ts`，零 I/O、零判权）。
//   2026-10-19 #33 评审 P1：原先从这里 import 的是 `analytics/service.js` —— 实质不越界
//   （无环、只取纯函数），但字面违反契约 I-9「模块之间不导出可被调用的 service 函数」。
//   口径已上提为纯口径文件，因此既不必复制公式（会把 H2 缺陷一起搬走），也不违纪。
import { healthOf, planTimeDaysOf, roundTo } from '../analytics/caliber.js'
import type {
  AcceptanceCountFact,
  EfficiencyMetrics,
  InsightAggregationInput,
  InsightMetrics,
  MemberLoad,
  ProgressMetrics,
  QualityMetrics,
  RiskCountFact,
  RiskLevel,
  RiskMetrics,
  RiskStatus,
  TaskFacts,
  UnavailableMetric,
} from './types.js'
import { UNRESOLVED_RISK_STATUSES } from './types.js'

// ★ 取整统一走 `analytics/caliber.ts` 的 `roundTo`（2026-10-19 复审 S-3）。
//   原先本文件自写一个 `round4`，于是 `-0` 归一化只覆盖了 1 位小数的 `deviationPp`、
//   没覆盖 4 位小数的 `ratio` / `rejectionRate`。现在取整只有一处实现。

/**
 * 成员**匿名键**。
 *
 * 效率类的成员维度若带姓名 / 账号 / userId，分析结果本身就变成了人事数据（设计 §11
 * 已知风险第 4 条），而喂给 #31 端口的又必须是这份数字。
 *
 * 取法的三条性质（★ 2026-10-19 评审 P4 更正：原写"不可逆推"，说过头了）：
 *   - **对端口 / 外部是不透明键**：`sha256` 摘要前 12 位十六进制，不是姓名 / 账号 / userId；
 *   - **同项目同一成员稳定**：生成层、界面、统计三处算出来的键一致；
 *   - **跨项目不同**：把 projectId 拌进摘要，避免有人拿两个项目的成员表做串联
 *     （同一个 userId 在两个项目里得到不同的键）。
 *
 * ⚠️ 但**盐就是 projectId**，而 `GET /projects/:id/members`（端点 7）会把每个成员的 `userId`
 *    给到项目成员 —— 因此**同时持有项目成员名单的调用者可以逐个枚举、一一匹配**，等价于实名。
 *    这不是本模块引入的泄漏（能看到名单的人本来就能看到姓名），但**不得**把 memberKey
 *    说成"任何前提下都不可逆"。要真正做到不可枚举，需要**每项目随机盐**（要建一张表；
 *    本批"不建表"，已登记为后续申请项）。
 */
export function memberKeyOf(projectId: string, userId: string): string {
  const digest = createHash('sha256')
    .update(`ai-insights:member:${projectId}:${userId}`)
    .digest('hex')
  return `mk-${digest.slice(0, 12)}`
}

/* ===========================================================================
 * ① 进度（口径与 #30 同源）
 * =========================================================================== */

/**
 * 进度与健康度。
 *
 * 全部算术都交给 #30 的纯函数：`planTimeDaysOf`（整数天数）与 `healthOf`
 * （整数交叉相乘比较）—— 本模块不出现 `(计划 − 实际) × 100 ≤ 阈值` 这类第二次实现。
 */
export function progressOf(tasks: TaskFacts, asOf: string): ProgressMetrics {
  let total = 0
  let closed = 0
  for (const fact of tasks.counts) {
    total += fact.count
    if (fact.status === 'CLOSED') closed += fact.count
  }

  const planDays =
    tasks.planWindow === null
      ? null
      : planTimeDaysOf(asOf, tasks.planWindow.start, tasks.planWindow.end)

  const health = healthOf({ totalTasks: total, closedTasks: closed, planDays })

  return {
    closed,
    total,
    // 与 #30 的 `progress.ratio` 同精度（4 位小数）；total = 0 时是 null，不是 0
    ratio: total === 0 ? null : roundTo(closed / total, 4),
    planTimeProgress:
      planDays === null ? null : planDays.elapsedDays / planDays.totalDays,
    deviationPp: health.deviationPp,
    healthState: health.state,
    healthNote: health.note ?? null,
    planWindow: tasks.planWindow,
  }
}

/* ===========================================================================
 * ② 质量（#29 的验收记录 + 任务六态）
 * =========================================================================== */

/**
 * 质量指标。
 *
 * 「重验」的口径：**同一任务第 2 次起的验收轮次** = `Σ max(0, 该任务记录数 − 1)`。
 * 之所以不去数「驳回后再提交」的间隔：那需要状态变更时间戳，而库里没有（见 `unavailable`）。
 *
 * `rejectionRate` 的分母为 0 时返回 `null`（**不是 0**）—— 没有验收记录 ≠ 驳回率是零
 * （与 #33 设计 §4.4「采纳率分母为 0 返回 null」同一纪律）。
 */
export function qualityOf(
  tasks: TaskFacts,
  acceptances: readonly AcceptanceCountFact[],
): QualityMetrics {
  let acceptanceRounds = 0
  let rejections = 0
  let reverifications = 0
  const roundsByTask = new Map<string, number>()
  const rejectedTasks = new Set<string>()

  for (const fact of acceptances) {
    acceptanceRounds += fact.count
    roundsByTask.set(fact.taskId, (roundsByTask.get(fact.taskId) ?? 0) + fact.count)
    if (fact.conclusion === 'REJECT') {
      rejections += fact.count
      rejectedTasks.add(fact.taskId)
    }
  }
  for (const rounds of roundsByTask.values()) {
    reverifications += Math.max(0, rounds - 1)
  }

  let blockedTasks = 0
  for (const fact of tasks.counts) {
    if (fact.status === 'BLOCKED') blockedTasks += fact.count
  }

  return {
    acceptanceRounds,
    rejections,
    rejectedTasks: rejectedTasks.size,
    reverifications,
    rejectionRate: acceptanceRounds === 0 ? null : roundTo(rejections / acceptanceRounds, 4),
    blockedTasks,
    avgAcceptanceDays: null, // 无数据源，原因见 unavailableMetrics()
  }
}

/* ===========================================================================
 * ③ 风险（与关闭阻断同源）
 * =========================================================================== */

/** 风险指标。`byLevel` 只统计**未解决**（未处理 / 处理中）的风险。 */
export function riskOf(risks: readonly RiskCountFact[]): RiskMetrics {
  const byStatus: Record<RiskStatus, number> = {
    OPEN: 0,
    IN_PROGRESS: 0,
    RESOLVED: 0,
    CLOSED: 0,
  }
  const byLevel: { high: number; medium: number; low: number } = {
    high: 0,
    medium: 0,
    low: 0,
  }
  let total = 0

  const unresolved = new Set<string>(UNRESOLVED_RISK_STATUSES)

  for (const fact of risks) {
    total += fact.count
    byStatus[fact.status] += fact.count
    if (!unresolved.has(fact.status)) continue
    // 已解决 / 已关闭的风险不再算进当前暴露面
    const level: RiskLevel = fact.level
    if (level === 'HIGH') byLevel.high += fact.count
    else if (level === 'MEDIUM') byLevel.medium += fact.count
    else if (level === 'LOW') byLevel.low += fact.count
  }

  return {
    open: byStatus.OPEN,
    inProgress: byStatus.IN_PROGRESS,
    unresolved: byStatus.OPEN + byStatus.IN_PROGRESS,
    resolved: byStatus.RESOLVED,
    closed: byStatus.CLOSED,
    total,
    byLevel,
  }
}

/* ===========================================================================
 * ④ 效率（#27 的负载口径）
 * =========================================================================== */

/**
 * 效率指标。
 *
 * - `byMember` **包含零负载成员**（否则「负载不均」看不出来），按 `openTasks` 降序、
 *   同级按匿名键升序 —— 顺序稳定，用例才钉得住；
 * - 只统计**当前 `ProjectMember`**（与 #27 一致：不实现「退组负责人任务」的口径，
 *   那在 `role-b-workload-design` 里尚未定案）；
 * - `doingTasks` / `pendingAcceptanceTasks` 是**积压**的两块：进行中与「已提交待验收」。
 *   它们的天数版本（滞留多久）需要状态变更时间戳，本批次算不出来。
 */
export function efficiencyOf(
  tasks: TaskFacts,
  members: InsightAggregationInput['members'],
  projectId: string,
): EfficiencyMetrics {
  const openByOwner = new Map<string, number>()
  let doingTasks = 0
  let pendingAcceptanceTasks = 0

  for (const fact of tasks.counts) {
    if (fact.status === 'DOING') doingTasks += fact.count
    if (fact.status === 'DONE') pendingAcceptanceTasks += fact.count
    // 负载口径：非 CLOSED 都算（DONE 只是执行人提交了，仍需验收人关闭）
    if (fact.status !== 'CLOSED') {
      openByOwner.set(fact.ownerUserId, (openByOwner.get(fact.ownerUserId) ?? 0) + fact.count)
    }
  }

  const byMember: MemberLoad[] = members.map((member) => ({
    memberKey: memberKeyOf(projectId, member.userId),
    openTasks: openByOwner.get(member.userId) ?? 0,
  }))

  byMember.sort((a, b) => {
    if (a.openTasks !== b.openTasks) return b.openTasks - a.openTasks
    if (a.memberKey === b.memberKey) return 0
    return a.memberKey < b.memberKey ? -1 : 1
  })

  return {
    byMember,
    members: byMember.length,
    membersWithOpenTasks: byMember.filter((row) => row.openTasks > 0).length,
    idleMembers: byMember.filter((row) => row.openTasks === 0).length,
    // 空集合也要给 0（不是 -Infinity）：Math.max(0, ...[]) === 0
    maxOpenTasks: Math.max(0, ...byMember.map((row) => row.openTasks)),
    doingTasks,
    pendingAcceptanceTasks,
  }
}

/* ===========================================================================
 * ⑤ 汇总
 * =========================================================================== */

/**
 * 本批次**算不出来**的指标（如实登记，不用 0 冒充）。
 *
 * 生成层必须先读这份清单：里面有哪个指标，就不许围绕它编建议。
 */
export function unavailableMetrics(): UnavailableMetric[] {
  return [
    {
      metric: 'quality.avgAcceptanceDays',
      needs: '任务「进入待验收（DONE）」的时间戳（状态变更历史，或提交验收的时间列）',
      reason:
        '现有表只有任务创建时间与验收记录时间：用它算不出「等了多久才被验收」，' +
        '而拿「创建 → 验收」冒充会把整个执行时长当成等待时长。按三态纪律返回 null，不用 0 冒充。',
    },
    {
      metric: 'efficiency.doingTasks / pendingAcceptanceTasks 的**天数**版本',
      needs: '同上：状态变更时间戳',
      reason:
        '「任务在 DOING / 待验收滞留多久」需要知道它何时进入该状态；现在只能给出**数量**（积压规模），给不出时长。',
    },
  ]
}

/**
 * 四类指标聚合（纯函数）。
 *
 * `metrics` 的四个字段与 D §2.1 的四个场景一一对应（`METRIC_KEY_BY_SCENARIO`）；
 * `unavailable` 是**必须随结果一起传下去**的：它是「哪些数算不出来」的唯一声明。
 */
export function aggregateInsightMetrics(input: InsightAggregationInput): {
  metrics: InsightMetrics
  unavailable: UnavailableMetric[]
} {
  return {
    metrics: {
      progress: progressOf(input.tasks, input.asOf),
      quality: qualityOf(input.tasks, input.acceptances),
      risk: riskOf(input.risks),
      efficiency: efficiencyOf(input.tasks, input.members, input.projectId),
    },
    unavailable: unavailableMetrics(),
  }
}
