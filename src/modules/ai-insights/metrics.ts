/**
 * US-13 四类指标聚合（工单 #33）—— **取数层**。
 *
 * ===========================================================================
 * 职责边界
 * ===========================================================================
 *
 *   本文件：判权 → 取可见性作用域 → 查库 → 组装**计数事实** → 交给纯聚合层 → 附口径声明
 *   `aggregate.ts`：只吃计数事实做算术（无 Prisma、无 I/O）
 *
 * ===========================================================================
 * 四条纪律（缺一条这个模块就不该合）
 * ===========================================================================
 *
 * 1. **判权只走 `can()`**（契约 I-5）：读路径用 `project.read`，非成员 / 不存在 → 404
 *    逐字一致。本文件不出现任何角色字符串比较。
 * 2. **可见性过滤在查询层**（契约 I-6）：`visibilityScope()` 的作用域拼进**同一个 `where`**，
 *    计数与内容同源；不存在「先查全量再在内存里剔掉敏感项」的路径（那会在计数上泄漏
 *    敏感对象的存在性）。敏感风险再按「继承所关联任务的可见性」过滤（#30 批复第 7 项）。
 * 3. **只取聚合数值**：查询一律用 `groupBy` / `aggregate` / `select { userId }`，
 *    **不把任务行或风险行取进内存**；标题、描述、成员姓名根本没有机会进入结果
 *    （#33 设计 §5.1 第 2 条，也是给 #31 端口准备的输入）。
 * 4. **本层只读**：不写库、不写审计、不产生领域事件 —— 建议的生成与处置都等 #31 的
 *    共享存储（`ai.suggestion-store-shared`）。用例里有「调用前后行数不变」的钉子。
 *
 * ===========================================================================
 * 基数口径（C6 / D §2.3）
 * ===========================================================================
 *
 * PM = `GLOBAL`（全项目）；MEMBER / VIEWER = `VISIBLE`（各自可见范围），**分子分母同源**。
 * 计划窗口同样取**同一窗口**内的任务（DECISIONS `analytics.dashboard-window-basis`），
 * 不泄漏不可见任务的日期。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { TaskStatus } from '../../shared/types.js'
// ★ 冻结口径的纯函数 / 常量 / 口径时区取「今天」，统一来自 `analytics/caliber.ts`
//   （2026-10-19 #33 评审 P1：不再 import `analytics/service.js`，也不在本模块复制一份）。
import {
  CALC_TIMEZONE,
  HEALTHY_THRESHOLD_PP,
  WARNING_THRESHOLD_PP,
  isoToday,
} from '../analytics/caliber.js'
import { createAuthorization } from '../authz/permissions.js'
import { aggregateInsightMetrics } from './aggregate.js'
import {
  INSIGHT_SCENARIOS,
  type AcceptanceConclusion,
  type AcceptanceCountFact,
  type InsightMetricsView,
  type MemberFact,
  type MetricsBasis,
  type ProjectPopulationBasis,
  type RiskCountFact,
  type RiskLevel,
  type RiskStatus,
  type TaskCountFact,
  type TaskFacts,
} from './types.js'

/* ===========================================================================
 * 错误构造：与其它模块逐字一致（契约 I-3 / I-4），不新增错误码
 * =========================================================================== */

function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', '资源不存在')
}

function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', '没有权限执行该操作')
}

/** 把 `can()` 的拒绝结果原样翻译成 AppError；调用方不自行判断 403/404（契约 I-5）。 */
function denied(decision: { status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }): AppError {
  return decision.code === 'NOT_FOUND' ? notFound() : forbidden()
}

/**
 * 取 `groupBy` 结果里的 `_count._all`。
 *
 * 为什么需要这个函数：查询被放进 `prisma.$transaction([...])` 之后，Prisma 对 `_count` 的
 * **类型推断**会退化成 `true | { _all?: number }`（运行时形状恒为 `{ _all: number }`，
 * 只是类型信息丢了）。与其写一个裸 `as`，这里带一道运行时校验：形状不符就抛错，
 * 而不是让 `undefined` 悄悄参与算术、变成 `NaN` 混进指标里。
 */
function groupCount(row: { _count?: unknown }): number {
  const count = (row._count ?? {}) as { _all?: unknown }
  if (typeof count._all !== 'number') {
    throw new Error('groupBy 未返回 _count._all（查询形状与预期不符）')
  }
  return count._all
}

/**
 * 风险的可见性条件：**敏感风险继承所关联任务的可见性**（#30 批复第 7 项）。
 *
 * - PM（`visibleIds === null`）→ 不加条件；
 * - 其余角色 → `taskId IS NULL`（不关联任务的公开风险）**或** `taskId IN (可见任务)`。
 *
 * ★ 这是**查询层**条件（决策 I-6），与计数、聚合同源，不做内存过滤。
 */
function riskVisibilityWhere(visibleIds: string[] | null): Prisma.RiskWhereInput {
  if (visibleIds === null) return {}
  return { OR: [{ taskId: null }, { taskId: { in: visibleIds } }] }
}

export type BuildInsightMetricsOptions = {
  /** 覆盖「今天」（测试用来钉住边界；默认按口径时区取今天） */
  today?: string
}

/**
 * 组装四类指标聚合。
 *
 * 权限：`can(actor, 'project.read', { kind: 'project' })`；非成员 / 不存在 → 404（逐字一致）。
 *
 * ⚠️ 本函数**不生成建议、不落库**：它只回答「这几类数字各是多少」。建议的生成要接入
 * #31 的公共端口（AC5），存储与处置走共享存储（`ai.suggestion-store-shared`）。
 */
export async function buildInsightMetrics(
  prisma: PrismaClient,
  actorUserId: string,
  projectId: string,
  options: BuildInsightMetricsOptions = {},
): Promise<InsightMetricsView> {
  const { can, visibilityScope } = createAuthorization(prisma)

  const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!project) throw notFound()

  const scope = await visibilityScope(actorUserId, projectId, 'task')
  const visibleIds = scope.mode === 'subset' ? scope.ids : null

  // ★ 任务 / 验收 / 风险三侧都拼同一个作用域（I-6），且与各自的其它条件进同一个 where
  const taskWhere: Prisma.TaskWhereInput = {
    projectId,
    ...(visibleIds ? { id: { in: visibleIds } } : {}),
  }
  const acceptanceWhere: Prisma.AcceptanceRecordWhereInput = {
    projectId,
    ...(visibleIds ? { taskId: { in: visibleIds } } : {}),
  }
  const riskWhere: Prisma.RiskWhereInput = {
    projectId,
    ...riskVisibilityWhere(visibleIds),
  }

  // ★ 一个读取窗口（2026-10-19 #33 评审 P3）：5 条查询放进**同一个事务**，避免并发写入时
  //   拿到互相矛盾的一组数（例如 total = 0 却 planWindow ≠ null、验收轮次与任务状态对不上）。
  //   仍是只读：事务里没有任何写操作。
  //   ⚠️ 前提（2026-10-19 复审 P-3 补）：这条"单一快照"保证来自**数据库的隔离级别**，不是
  //   `$transaction` 本身 —— SQLite 的事务可串行化（延迟 BEGIN、首读建快照），因此成立；
  //   若将来迁到默认 READ COMMITTED 的库（Postgres / MySQL），事务内每条语句各取新快照，
  //   本条保证**失效**，届时需改用 REPEATABLE READ 或把相关读取合并成一条语句。
  const [taskGroups, window, acceptanceGroups, riskGroups, memberRows] = await prisma.$transaction([
    // 只取计数：不把任务行取进内存（纪律 3）
    prisma.task.groupBy({
      by: ['status', 'ownerUserId'],
      where: taskWhere,
      // `$transaction([...])` 走的是 groupBy 的严格重载（orderBy 必填，即使只为让类型成立）；
      // 这里按状态排，对下面的计数聚合没有任何语义影响。
      orderBy: { status: 'asc' },
      _count: { _all: true },
    }),
    prisma.task.aggregate({
      where: taskWhere,
      _min: { planStart: true },
      _max: { planEnd: true },
    }),
    prisma.acceptanceRecord.groupBy({
      by: ['taskId', 'conclusion'],
      where: acceptanceWhere,
      orderBy: { taskId: 'asc' },
      _count: { _all: true },
    }),
    prisma.risk.groupBy({
      by: ['status', 'level'],
      where: riskWhere,
      orderBy: { status: 'asc' },
      _count: { _all: true },
    }),
    prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
      orderBy: { joinedAt: 'asc' },
    }),
  ])

  const planStart = window._min.planStart
  const planEnd = window._max.planEnd
  const tasks: TaskFacts = {
    counts: taskGroups.map(
      (group): TaskCountFact => ({
        status: group.status as TaskStatus,
        ownerUserId: group.ownerUserId,
        count: groupCount(group),
      }),
    ),
    // 计划区间只由**同一窗口内**的任务推导（可见窗口口径）；无任务 → null（不做分级）
    planWindow: planStart && planEnd ? { start: planStart, end: planEnd } : null,
  }
  const acceptances: AcceptanceCountFact[] = acceptanceGroups.map((group) => ({
    taskId: group.taskId,
    conclusion: group.conclusion as AcceptanceConclusion,
    count: groupCount(group),
  }))
  const risks: RiskCountFact[] = riskGroups.map((group) => ({
    status: group.status as RiskStatus,
    level: group.level as RiskLevel,
    count: groupCount(group),
  }))
  const members: MemberFact[] = memberRows.map((row) => ({ userId: row.userId }))

  const asOf = options.today ?? isoToday()
  const { metrics, unavailable } = aggregateInsightMetrics({
    projectId,
    asOf,
    tasks,
    acceptances,
    risks,
    members,
  })

  const populationBasis: ProjectPopulationBasis =
    scope.mode === 'all' ? 'GLOBAL' : 'VISIBLE'

  const basis: MetricsBasis = {
    asOf,
    populationBasis,
    scopeLabel: scope.mode === 'all' ? '全项目' : '可见范围',
    caliberOwner: 'US-10 (#30)',
    // 与 #30 的 basis.thresholds 同一组常量（import，不另立一份）
    thresholds: { healthyPp: HEALTHY_THRESHOLD_PP, warningPp: WARNING_THRESHOLD_PP },
    formulas: {
      progress:
        '实际进度 = 已关闭任务数 ÷ 统计基数内任务总数（status = CLOSED 计入分子，DONE 不计入）；计划时间进度 = 已过自然日数 ÷ 计划总自然日数（含首尾），计划区间取**同一窗口**内任务的 min(planStart) ~ max(planEnd)，已过天数截断到 [0, 区间天数]；偏差 = 计划时间进度 − 实际进度（单位 pp，正数表示落后），分级 ≤10pp 健康 / >10pp 且 ≤25pp 预警 / >25pp 风险，判定用**整数精确比较**（复用 #30 的 healthOf）；项目无任务时不做分级',
      quality:
        '驳回数 = 验收记录中 conclusion = REJECT 的条数；重验次数 = Σ max(0, 该任务验收记录数 − 1)（同一任务第 2 次起的验收轮次）；驳回率 = 驳回条数 ÷ 验收轮次总数，**分母为 0 时返回 null（不是 0）**；卡住 = status = BLOCKED 的任务数；验收平均等待天数本批次无法计算（见 unavailable）',
      riskByLevel:
        '未解决风险 = 未处理（OPEN）+ 处理中（IN_PROGRESS）——与 #30 的关闭阻断口径**同源**（RESOLVED / CLOSED 既不阻断、也不计入当前暴露面）；byLevel 只统计**未解决**风险的高 / 中 / 低分布',
      memberLoad:
        '负载 = 负责人名下 status != CLOSED 的任务数（**含 DONE**：执行人提交了仍需验收人关闭），与 #27 及 DECISIONS scheduling.load-aggregation-baseline 一致；只统计当前项目成员；给出分布与最大值，**不设「超过 N 即过载」的阈值**（阈值属业务裁定，不在聚合层发明）',
    },
    timezone: `${CALC_TIMEZONE} 自然日（含首尾）`,
    anonymization:
      '成员维度只给 memberKey = sha256("ai-insights:member:" + projectId + ":" + userId) 的前 12 位十六进制：不是姓名、不是 account、不是 userId；同一项目同一成员稳定，跨项目不同（防止跨项目串联成员）。⚠️ 盐就是 projectId，对**同时持有项目成员名单**的调用者可逐个枚举匹配（端点 7 会给出 userId）—— 它是"对外部与端口不透明"，不是"任何前提下都不可逆"；要真正不可枚举需每项目随机盐（需建表，未申请）',
    dataBoundary:
      '本结果只含计数 / 比率 / 天数，不含任务标题、描述、驳回原因原文、成员姓名或账号 —— 可直接作为 #31 端口的输入（#33 设计 §5.1 第 2 条）',
    sourceTables: ['Task', 'AcceptanceRecord', 'Risk', 'ProjectMember'],
  }

  return {
    projectId,
    asOf,
    populationBasis,
    scenarios: [...INSIGHT_SCENARIOS],
    metrics,
    unavailable,
    basis,
  }
}
