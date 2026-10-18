/**
 * US-13 四类指标**取数层**测试（工单 #33）—— 判权、可见性 / C6、只读、数据边界。
 *
 * 覆盖：
 *   - `can('project.read')` 的 404（非成员 / 项目不存在，响应逐字一致）；
 *   - C6 基数：PM = `GLOBAL`，其余 = `VISIBLE`；**分子分母与计划窗口同源**；
 *   - 敏感任务不计入任何一类指标；白名单成员可见；敏感风险继承关联任务可见性；
 *   - 只输出聚合数值（不含标题 / 姓名 / 账号 / userId / taskId / riskId）；
 *   - **只读**：调用前后相关表行数不变（不写审计、不落库）；
 *   - ★ AC6 交叉校验：与 `GET /projects/:projectId/dashboard`（#30，已合入 main）
 *     的进度 / 健康度 / 计划窗口**逐字段相等** —— 两边共用同一份口径实现。
 *
 * ⚠️ 本批次**不注册路由**（等 #31 的公共端口），因此这里直接调取数层函数；
 *    唯一走 HTTP 的是 #30 的仪表盘端点，用来做交叉校验（也顺便证明"跨模块"是走接口对表，
 *    而不是调对方的 service）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeSensitive,
  makeUser,
} from '../../../test/factories.js'
import type { ProjectDashboardView } from '../analytics/types.js'
import { buildInsightMetrics } from './metrics.js'
import type { InsightMetricsView } from './types.js'

let ctx: HttpTestContext
let pm: { id: string; account: string; displayName: string }
let member1: { id: string; account: string; displayName: string }
let member2: { id: string; account: string; displayName: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser('pm@example.com', '项目经理')
  member1 = await makeUser('m1@example.com', '成员一')
  member2 = await makeUser('m2@example.com', '成员二')
  viewer = await makeUser('viewer@example.com', '阅览者')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const created = await makeProject(pm.id, '指标聚合测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '看指标',
    valueText: '做分析',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, member1.id, 'MEMBER')
  await makeMember(projectId, member2.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

/* ===========================================================================
 * 夹具
 * =========================================================================== */

/** 按口径时区取今天 —— 与服务端同一套取法，避免跨时区抖动。 */
function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * 计划时间进度 = 0.5 的窗口：今天−1 ~ 今天+2 ⇒ 含首尾 4 天、已过 2 天。
 * 与 #30 的 `analytics.test.ts` 同一个构造，便于两边交叉校验。
 */
function halfWindow(): { planStart: string; planEnd: string } {
  const today = isoToday()
  return { planStart: shiftDays(today, -1), planEnd: shiftDays(today, 2) }
}

type SeedTaskOptions = {
  status?: string
  ownerUserId?: string
  acceptorUserId?: string
  isSensitive?: boolean
  title?: string
  planStart?: string
  planEnd?: string
}

async function seedTask(options: SeedTaskOptions = {}): Promise<string> {
  const win = halfWindow()
  const owner = options.ownerUserId ?? member1.id
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: options.title ?? '任务',
      description: null,
      ownerUserId: owner,
      acceptorUserId: options.acceptorUserId ?? (owner === member2.id ? member1.id : member2.id),
      planStart: options.planStart ?? win.planStart,
      planEnd: options.planEnd ?? win.planEnd,
      status: options.status ?? 'TODO',
      isSensitive: options.isSensitive ?? false,
    },
    select: { id: true },
  })
  return task.id
}

/** 造一条验收记录（#29 的表；本票只读它）。 */
async function seedAcceptance(
  taskId: string,
  conclusion: 'PASS' | 'REJECT',
): Promise<void> {
  await ctx.db.acceptanceRecord.create({
    data: {
      projectId,
      taskId,
      actorUserId: member2.id,
      conclusion,
      reason: conclusion === 'REJECT' ? '不满足验收标准' : null,
      statusBefore: 'DONE',
      statusAfter: conclusion === 'PASS' ? 'CLOSED' : 'DOING',
    },
  })
}

async function seedRisk(options: {
  level: 'HIGH' | 'MEDIUM' | 'LOW'
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  ownerUserId?: string
  taskId?: string | null
  title?: string
}): Promise<string> {
  const risk = await ctx.db.risk.create({
    data: {
      projectId,
      title: options.title ?? '风险',
      description: null,
      level: options.level,
      status: options.status,
      ownerUserId: options.ownerUserId ?? member1.id,
      taskId: options.taskId ?? null,
      resolution:
        options.status === 'RESOLVED' || options.status === 'CLOSED' ? '已处理' : null,
    },
    select: { id: true },
  })
  return risk.id
}

/**
 * 一批「各类都有」的造数：5 个任务（2 CLOSED / 1 DONE / 1 BLOCKED / 1 DOING）、
 * 3 条验收记录（1 驳回 + 2 通过）、3 条风险（未处理高 / 处理中低 / 已解决中）。
 *
 * 计划窗口取 `halfWindow()`（计划 0.5）、实际 2/5 = 0.4 ⇒ 偏差正好 **10pp** ⇒ 健康
 * （顺带压住 #30 修过的 H2 边界）。
 */
async function seedTypical(): Promise<{ taskIds: string[] }> {
  // ★ 标题一律用**唯一标记**：既方便断言「标题不许出现在结果里」，也避免与 basis 的
  //   口径文案撞词（第一版用了「待验收」当标题，而口径文案里本来就有「进入待验收
  //   （DONE）」—— 断言假红了一次，教训记在这里）。
  const closed1 = await seedTask({ status: 'CLOSED', title: '标题甲-已关闭' })
  const closed2 = await seedTask({ status: 'CLOSED', title: '标题乙-已关闭' })
  const done = await seedTask({ status: 'DONE', ownerUserId: member2.id, title: '标题丙-待验收' })
  const blocked = await seedTask({ status: 'BLOCKED', ownerUserId: member2.id, title: '标题丁-卡住' })
  const doing = await seedTask({ status: 'DOING', title: '标题戊-进行中' })

  await seedAcceptance(closed1, 'REJECT')
  await seedAcceptance(closed1, 'PASS')
  await seedAcceptance(closed2, 'PASS')

  await seedRisk({ level: 'HIGH', status: 'OPEN' })
  await seedRisk({ level: 'LOW', status: 'IN_PROGRESS' })
  await seedRisk({ level: 'MEDIUM', status: 'RESOLVED' })

  return { taskIds: [closed1, closed2, done, blocked, doing] }
}

/** 以某身份读 #30 的仪表盘（交叉校验用；走 HTTP，不调 analytics 的 service）。 */
async function dashboardOf(actorUserId: string): Promise<ProjectDashboardView> {
  const res = await ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${projectId}/dashboard`)
  expect(res.status).toBe(200)
  return res.body as ProjectDashboardView
}

/* ===========================================================================
 * ① 四类数字本身
 * =========================================================================== */

describe('四类指标：PM 全项目基数', () => {
  it('★ 四类数字与造数一一对上（含 C6 = GLOBAL、四类场景齐全）', async () => {
    await seedTypical()

    const view = await buildInsightMetrics(ctx.db, pm.id, projectId)

    expect(view.projectId).toBe(projectId)
    expect(view.populationBasis).toBe('GLOBAL')
    expect(view.basis.scopeLabel).toBe('全项目')
    expect(view.basis.caliberOwner).toBe('US-10 (#30)')
    expect(view.scenarios).toEqual([
      'INSIGHT_QUALITY',
      'INSIGHT_PROGRESS',
      'INSIGHT_RISK',
      'INSIGHT_EFFICIENCY',
    ])
    expect(view.basis.thresholds).toEqual({ healthyPp: 10, warningPp: 25 })

    // 进度：5 个任务里 2 个 CLOSED（DONE 不计入分子）⇒ 0.4；计划 0.5 ⇒ 偏差 10pp
    expect(view.metrics.progress).toMatchObject({
      closed: 2,
      total: 5,
      ratio: 0.4,
      planTimeProgress: 0.5,
      deviationPp: 10,
      healthState: 'HEALTHY',
    })

    // 质量：3 轮验收、1 条驳回、1 个任务被驳回、重验 1 次、卡住 1 个
    expect(view.metrics.quality).toMatchObject({
      acceptanceRounds: 3,
      rejections: 1,
      rejectedTasks: 1,
      reverifications: 1,
      rejectionRate: 0.3333,
      blockedTasks: 1,
      avgAcceptanceDays: null,
    })

    // 风险：未解决 2（未处理高 1 + 处理中低 1），已解决 1 不计入暴露面
    expect(view.metrics.risk).toEqual({
      open: 1,
      inProgress: 1,
      unresolved: 2,
      resolved: 1,
      closed: 0,
      total: 3,
      byLevel: { high: 1, medium: 0, low: 1 },
    })

    // 效率：4 个成员都在（含零负载），负载含 DONE、不含 CLOSED
    expect(view.metrics.efficiency.members).toBe(4)
    expect(view.metrics.efficiency.byMember[0]?.openTasks).toBe(2) // member2：DONE + BLOCKED
    expect(view.metrics.efficiency.membersWithOpenTasks).toBe(2)
    expect(view.metrics.efficiency.idleMembers).toBe(2)
    expect(view.metrics.efficiency.maxOpenTasks).toBe(2)
    expect(view.metrics.efficiency.doingTasks).toBe(1)
    expect(view.metrics.efficiency.pendingAcceptanceTasks).toBe(1)
  })

  it('today 可覆盖：同一批数据换「今天」，计划时间进度随之变化（口径可测）', async () => {
    await seedTask({ status: 'TODO', planStart: '2026-03-01', planEnd: '2026-03-04' })

    const firstDay = await buildInsightMetrics(ctx.db, pm.id, projectId, { today: '2026-03-01' })
    const afterEnd = await buildInsightMetrics(ctx.db, pm.id, projectId, { today: '2026-06-01' })

    expect(firstDay.metrics.progress.planTimeProgress).toBe(0.25) // 含首尾 4 天、已过 1 天
    expect(firstDay.basis.asOf).toBe('2026-03-01')
    expect(afterEnd.metrics.progress.planTimeProgress).toBe(1)
    expect(afterEnd.metrics.progress.deviationPp).toBe(100)
    expect(afterEnd.metrics.progress.healthState).toBe('AT_RISK')
  })

  it('★ 空项目：进度 ratio 为 null + UNAVAILABLE，其余三类全 0（不编数字、不报错）', async () => {
    const view = await buildInsightMetrics(ctx.db, pm.id, projectId)

    expect(view.metrics.progress).toMatchObject({
      closed: 0,
      total: 0,
      ratio: null,
      planTimeProgress: null,
      deviationPp: null,
      healthState: 'UNAVAILABLE',
      planWindow: null,
    })
    expect(view.metrics.quality.rejectionRate).toBeNull() // 分母 0 ⇒ null，不是 0
    expect(view.metrics.quality.acceptanceRounds).toBe(0)
    expect(view.metrics.risk.total).toBe(0)
    expect(view.metrics.efficiency.members).toBe(4) // 成员还在，只是负载都是 0
    expect(view.metrics.efficiency.maxOpenTasks).toBe(0)
    expect(view.metrics.efficiency.byMember.every((row) => row.openTasks === 0)).toBe(true)
  })
})

/* ===========================================================================
 * ② C6 基数与敏感对象
 * =========================================================================== */

describe('C6 基数与敏感对象', () => {
  it('★ 非 PM：VISIBLE 基数，敏感任务不进任何一类指标（分子分母同源）', async () => {
    await seedTypical()
    await seedTask({ status: 'BLOCKED', isSensitive: true, title: '敏感卡住' })

    const pmView = await buildInsightMetrics(ctx.db, pm.id, projectId)
    const memberView = await buildInsightMetrics(ctx.db, member1.id, projectId)

    expect(pmView.populationBasis).toBe('GLOBAL')
    expect(pmView.metrics.progress.total).toBe(6)
    expect(pmView.metrics.quality.blockedTasks).toBe(2)

    expect(memberView.populationBasis).toBe('VISIBLE')
    expect(memberView.basis.scopeLabel).toBe('可见范围')
    expect(memberView.metrics.progress.total).toBe(5) // 敏感任务不在分母里
    expect(memberView.metrics.progress.closed).toBe(2)
    expect(memberView.metrics.quality.blockedTasks).toBe(1) // 敏感卡住任务不算
    // 负载也不含它（它是 member1 名下，但对他不可见）
    expect(memberView.metrics.efficiency.byMember[0]?.openTasks).toBe(2)
  })

  it('白名单内的成员：敏感任务计入（与 #30 的可见性口径一致）', async () => {
    await seedTask({ status: 'CLOSED' })
    const sensitiveId = await seedTask({ status: 'CLOSED', isSensitive: true })
    await makeSensitive('task', sensitiveId, [member1.id])

    const memberView = await buildInsightMetrics(ctx.db, member1.id, projectId)
    expect(memberView.metrics.progress.total).toBe(2)
    expect(memberView.metrics.progress.closed).toBe(2)
  })

  it('★ 敏感风险继承关联任务的可见性：非 PM 不计入风险指标', async () => {
    const sensitiveTask = await seedTask({ isSensitive: true, status: 'TODO' })
    await seedRisk({ level: 'HIGH', status: 'OPEN', taskId: sensitiveTask })
    await seedRisk({ level: 'LOW', status: 'OPEN' }) // 不关联任务的公开风险

    const pmView = await buildInsightMetrics(ctx.db, pm.id, projectId)
    const memberView = await buildInsightMetrics(ctx.db, member1.id, projectId)

    expect(pmView.metrics.risk.unresolved).toBe(2)
    expect(pmView.metrics.risk.byLevel.high).toBe(1)

    expect(memberView.metrics.risk.unresolved).toBe(1) // 只剩公开那条
    expect(memberView.metrics.risk.byLevel.high).toBe(0) // 敏感高危不泄漏
  })

  it('计划窗口取**同一窗口**（可见任务的 min/max），不泄漏不可见任务的日期', async () => {
    // 公开任务窗口：今天−1 ~ 今天+2；敏感任务窗口更早更晚
    await seedTask({ status: 'TODO' })
    await seedTask({
      status: 'TODO',
      isSensitive: true,
      planStart: shiftDays(isoToday(), -30),
      planEnd: shiftDays(isoToday(), 30),
    })

    const pmView = await buildInsightMetrics(ctx.db, pm.id, projectId)
    const memberView = await buildInsightMetrics(ctx.db, member1.id, projectId)

    expect(pmView.metrics.progress.planWindow).not.toEqual(memberView.metrics.progress.planWindow)
    expect(memberView.metrics.progress.planWindow).toEqual({
      start: shiftDays(isoToday(), -1),
      end: shiftDays(isoToday(), 2),
    })
  })

  it('跨项目隔离：别的项目的任务 / 风险 / 验收都不计入', async () => {
    await seedTypical()

    const other = await makeProject(pm.id, '另一个项目')
    const otherGoal = await makeGoal(other.projectId, '目标')
    const otherActivity = await makeActivity(otherGoal, '活动')
    const otherStory = await makeStory(otherActivity, { title: '别的需求' })
    await ctx.db.task.create({
      data: {
        projectId: other.projectId,
        storyId: otherStory,
        title: '别的任务',
        description: null,
        ownerUserId: member1.id,
        acceptorUserId: member2.id,
        planStart: '2026-01-01',
        planEnd: '2026-01-02',
        status: 'BLOCKED',
      },
    })
    await ctx.db.risk.create({
      data: {
        projectId: other.projectId,
        title: '别的风险',
        description: null,
        level: 'HIGH',
        status: 'OPEN',
        ownerUserId: member1.id,
        taskId: null,
        resolution: null,
      },
    })

    const view = await buildInsightMetrics(ctx.db, pm.id, projectId)
    expect(view.metrics.progress.total).toBe(5)
    expect(view.metrics.quality.blockedTasks).toBe(1)
    expect(view.metrics.risk.total).toBe(3)
  })
})

/* ===========================================================================
 * ③ 判权
 * =========================================================================== */

describe('判权', () => {
  it('★ 非项目成员 → 404，与「项目不存在」的响应逐字一致', async () => {
    await seedTypical()

    const notMember = await buildInsightMetrics(ctx.db, outsider.id, projectId).catch((e) => e)
    const missing = await buildInsightMetrics(
      ctx.db,
      outsider.id,
      '00000000-0000-0000-0000-000000000000',
    ).catch((e) => e)

    expect(notMember.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(notMember.message).toBe(missing.message)
  })

  it('VIEWER 可以读（只读聚合，与 #30 的风险台账只读口径一致）', async () => {
    await seedTypical()
    const view = await buildInsightMetrics(ctx.db, viewer.id, projectId)
    expect(view.populationBasis).toBe('VISIBLE')
    expect(view.metrics.progress.total).toBe(5)
  })
})

/* ===========================================================================
 * ④ 数据边界与只读
 * =========================================================================== */

describe('数据边界（设计 §5.1 第 2 条）与只读', () => {
  it('★ 结果里只有聚合数值：不含标题 / 姓名 / 账号 / userId / taskId / riskId', async () => {
    const { taskIds } = await seedTypical()
    const riskId = await seedRisk({ level: 'HIGH', status: 'OPEN', title: '标题己-风险' })

    const view = await buildInsightMetrics(ctx.db, pm.id, projectId)
    const json = JSON.stringify(view)

    // 原文（标题 / 人名 / 账号）一律不出现在结果里
    for (const raw of [
      '标题甲-已关闭',
      '标题丙-待验收',
      '标题丁-卡住',
      '标题己-风险',
      member1.displayName,
      member1.account,
      pm.account,
    ]) {
      expect(json).not.toContain(raw)
    }
    // 对象 id 也不出现（聚合层只给计数）
    for (const id of [...taskIds, riskId]) {
      expect(json).not.toContain(id)
    }
    // 成员维度只给匿名键
    expect(json).not.toContain(member1.id)
    expect(json).toContain('mk-')

    // ★ 更严的一层（2026-10-19 评审 S4）：**递归遍历结果里的每一个字符串**，逐个走白名单。
    //   上面那几个字面串只能抓住"我想到的"泄漏；这一层能抓住"将来新增字段带出原文"。
    //   口径文案（basis.* / unavailable[] / healthNote）按路径豁免 —— 它们是静态字面量，
    //   我在 audit 里逐句核过（无插值）。
    const exemptPath = [/^projectId$/, /^basis\./, /^unavailable\[\d+\]\.(metric|needs|reason)$/, /^metrics\.progress\.healthNote$/]
    const allowedValue = [
      /^mk-[0-9a-f]{12}$/, // 匿名成员键
      /^INSIGHT_(QUALITY|PROGRESS|RISK|EFFICIENCY)$/, // 场景常量
      /^(GLOBAL|VISIBLE|全项目|可见范围)$/,
      /^\d{4}-\d{2}-\d{2}$/, // asOf / 计划窗口日期
      /^(HEALTHY|WARNING|AT_RISK|UNAVAILABLE)$/,
      /^(Task|AcceptanceRecord|Risk|ProjectMember)$/,
      /^US-10 \(#30\)$/,
    ]
    const offenders: Array<{ path: string; value: string }> = []
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (exemptPath.some((re) => re.test(path))) return
        if (allowedValue.some((re) => re.test(value))) return
        offenders.push({ path, value })
        return
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          walk(child, path === '' ? key : `${path}.${key}`)
        }
      }
    }
    walk(view, '')
    expect(offenders).toEqual([])
  })

  it('memberKey 不是 userId，也不含 userId 片段', async () => {
    await seedTypical()
    const view = await buildInsightMetrics(ctx.db, pm.id, projectId)
    for (const row of view.metrics.efficiency.byMember) {
      expect(row.memberKey).not.toBe(member1.id)
      expect(row.memberKey.startsWith('mk-')).toBe(true)
    }
  })

  it('★ 只读：调用前后任务 / 风险 / 验收 / 审计的行数都不变（不写库、不写审计）', async () => {
    await seedTypical()

    const countRows = async () => ({
      tasks: await ctx.db.task.count(),
      risks: await ctx.db.risk.count(),
      acceptances: await ctx.db.acceptanceRecord.count(),
      audits: await ctx.db.auditLog.count(),
    })
    const before = await countRows()

    await buildInsightMetrics(ctx.db, pm.id, projectId)
    await buildInsightMetrics(ctx.db, member1.id, projectId)

    expect(await countRows()).toEqual(before)
  })

  it('「算不出来」的指标带原因登记（生成层不得围绕它编建议）', async () => {
    await seedTypical()
    const view = await buildInsightMetrics(ctx.db, pm.id, projectId)

    expect(view.metrics.quality.avgAcceptanceDays).toBeNull()
    const entry = view.unavailable.find((item) => item.metric === 'quality.avgAcceptanceDays')
    expect(entry?.needs).toContain('时间戳')
    expect(view.unavailable.length).toBeGreaterThan(0)
  })

  it('口径声明随结果返回（基数、阈值、公式、时区、匿名化、数据边界）', async () => {
    await seedTypical()
    const view = await buildInsightMetrics(ctx.db, member1.id, projectId)

    expect(view.basis.scopeLabel).toBe('可见范围')
    expect(view.basis.timezone).toContain('Asia/Shanghai')
    expect(view.basis.thresholds).toEqual({ healthyPp: 10, warningPp: 25 })
    // ★ 2026-10-19 评审 S3：文案**不逐字断言**（改措辞不该假红），只钉"四段都在且非空"；
    //   口径本身由数值用例钉住（progress 的边界用例、quality 的分母 0 等）。
    expect(Object.keys(view.basis.formulas).sort()).toEqual([
      'memberLoad',
      'progress',
      'quality',
      'riskByLevel',
    ])
    for (const text of Object.values(view.basis.formulas)) {
      expect(text.length).toBeGreaterThan(20)
    }
    expect(view.basis.anonymization.length).toBeGreaterThan(20)
    expect(view.basis.dataBoundary.length).toBeGreaterThan(20)
    // 取数来源：内容钉住、顺序不钉（改顺序不该假红）
    expect([...view.basis.sourceTables].sort()).toEqual([
      'AcceptanceRecord',
      'ProjectMember',
      'Risk',
      'Task',
    ])
  })
})

/* ===========================================================================
 * ⑤ AC6 —— 与 #30 的仪表盘交叉校验（同批数据、逐字段对表）
 * =========================================================================== */

describe('AC6 与 #30 的口径一致性（交叉校验）', () => {
  it('★ PM（全项目基数）：进度 / 健康度 / 计划窗口与 GET /dashboard 逐字段相等', async () => {
    await seedTypical()
    await seedTask({ status: 'CLOSED', isSensitive: true, title: '敏感已关闭' })

    const dashboard = await dashboardOf(pm.id)
    const view = await buildInsightMetrics(ctx.db, pm.id, projectId)

    expect(view.populationBasis).toBe('GLOBAL')
    expect(dashboard.basis.scope).toBe('global')

    expect(view.metrics.progress.closed).toBe(dashboard.progress.closed)
    expect(view.metrics.progress.total).toBe(dashboard.progress.total)
    expect(view.metrics.progress.ratio).toBe(dashboard.progress.ratio)
    expect(view.metrics.progress.planTimeProgress).toBe(dashboard.basis.planTimeProgress)
    expect(view.metrics.progress.deviationPp).toBe(dashboard.health.deviationPp)
    expect(view.metrics.progress.healthState).toBe(dashboard.health.state)
    expect(view.metrics.progress.planWindow).toEqual(dashboard.basis.planWindow)
    expect(view.basis.thresholds).toEqual(dashboard.basis.thresholds)

    // ★ 绝对值锚点（2026-10-19 评审 P2 的整改）：上面几条"两边相等"对**口径**是**恒真**的
    //   —— 两边调的是同一个 `healthOf`（那正是复用的目的），所以它们证明的是**取数层等价**
    //   （分子 / 分母 / 计划窗口由两边各自独立查询），不是"口径没漂移"。口径本身由这里的
    //   绝对期望 + `aggregate.test.ts` 的边界用例兜住。
    //   本组数据：6 个任务里 3 个 CLOSED ⇒ 0.5；计划窗口 4 天、已过 2 天 ⇒ 0.5 ⇒ 偏差 0pp。
    expect(view.metrics.progress.closed).toBe(3)
    expect(view.metrics.progress.total).toBe(6)
    expect(view.metrics.progress.deviationPp).toBe(0)
    expect(view.metrics.progress.healthState).toBe('HEALTHY')
    expect(dashboard.health.state).toBe('HEALTHY')
  })

  it('★ 非 PM（可见窗口）：同样逐字段相等（敏感任务两侧都不计入）', async () => {
    await seedTypical()
    await seedTask({ status: 'BLOCKED', isSensitive: true, title: '敏感卡住' })

    const dashboard = await dashboardOf(member1.id)
    const view = await buildInsightMetrics(ctx.db, member1.id, projectId)

    expect(view.populationBasis).toBe('VISIBLE')
    expect(dashboard.basis.scope).toBe('visible')

    expect(view.metrics.progress.closed).toBe(dashboard.progress.closed)
    expect(view.metrics.progress.total).toBe(dashboard.progress.total)
    expect(view.metrics.progress.ratio).toBe(dashboard.progress.ratio)
    expect(view.metrics.progress.planTimeProgress).toBe(dashboard.basis.planTimeProgress)
    expect(view.metrics.progress.deviationPp).toBe(dashboard.health.deviationPp)
    expect(view.metrics.progress.healthState).toBe(dashboard.health.state)
    expect(view.metrics.progress.planWindow).toEqual(dashboard.basis.planWindow)

    // 绝对值锚点：5 个可见任务里 2 个 CLOSED ⇒ 0.4；计划窗口 4 天、已过 2 天 ⇒ 0.5
    // ⇒ 偏差**正好** 10pp ⇒ 健康（浮点实现会算成 10.000000000000002 > 10 而错判「预警」，
    //   所以这一条同时是 H2 边界穿透到聚合层的回归）
    expect(view.metrics.progress.closed).toBe(2)
    expect(view.metrics.progress.total).toBe(5)
    expect(view.metrics.progress.deviationPp).toBe(10)
    expect(view.metrics.progress.healthState).toBe('HEALTHY')
    expect(dashboard.health.state).toBe('HEALTHY')

    // 反证：非 PM 的数字确实比 PM 小（不是"两边都恰好一样"而看不出可见性生效）
    const pmView = await buildInsightMetrics(ctx.db, pm.id, projectId)
    expect(view.metrics.progress.total).toBeLessThan(pmView.metrics.progress.total)
  })
})

/* ===========================================================================
 * 类型护栏：本模块的视图类型必须自洽（编译期）
 * =========================================================================== */

describe('类型护栏', () => {
  it('返回类型就是 InsightMetricsView（字段齐全）', async () => {
    await seedTypical()
    const view: InsightMetricsView = await buildInsightMetrics(ctx.db, pm.id, projectId)
    expect(Object.keys(view.metrics).sort()).toEqual(
      ['efficiency', 'progress', 'quality', 'risk'].sort(),
    )
  })
})
