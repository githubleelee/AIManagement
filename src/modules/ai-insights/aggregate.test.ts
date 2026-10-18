/**
 * US-13 四类指标**纯聚合层**测试（工单 #33）。
 *
 * 本文件**不建数据库、不发 HTTP**：`aggregate.ts` 是纯函数，只吃「计数事实」。
 * 好处是口径边界（分母为 0、去重、阈值、匿名键、排序、不变性）可以逐条钉住，且跑得快。
 *
 * 接口层的事（判权 404、可见性/C6、敏感不计入、只读、与 #30 的交叉校验）在 `metrics.test.ts`；
 * 这里只回答一个问题：**给定这些计数，四类数字算得对不对**。
 */
import { describe, expect, it } from 'vitest'
import { HEALTHY_THRESHOLD_PP, WARNING_THRESHOLD_PP } from '../analytics/service.js'
import type { TaskStatus } from '../../shared/types.js'
import {
  aggregateInsightMetrics,
  efficiencyOf,
  memberKeyOf,
  progressOf,
  qualityOf,
  riskOf,
  unavailableMetrics,
} from './aggregate.js'
import {
  INSIGHT_SCENARIOS,
  METRIC_KEY_BY_SCENARIO,
  type AcceptanceCountFact,
  type MemberFact,
  type RiskCountFact,
  type TaskCountFact,
  type TaskFacts,
} from './types.js'

/* ===========================================================================
 * 夹具：口径「含首尾」用的固定日期
 *
 *   窗口 2026-03-01 ~ 2026-03-04 ⇒ 含首尾 4 天；asOf = 2026-03-02 ⇒ 已过 2 天
 *   ⇒ 计划时间进度 = 2/4 = 0.5（与 #30 的 `halfWindow()` 同一构造，便于两边对表）
 * =========================================================================== */

const AS_OF = '2026-03-02'
const HALF_WINDOW = { start: '2026-03-01', end: '2026-03-04' }
const U1 = 'user-1'
const U2 = 'user-2'

function taskCounts(...rows: Array<[TaskStatus, number]>): TaskCountFact[] {
  return rows.map(([status, count]) => ({ status, ownerUserId: U1, count }))
}

function taskFacts(
  counts: TaskCountFact[],
  planWindow: TaskFacts['planWindow'] = HALF_WINDOW,
): TaskFacts {
  return { counts, planWindow }
}

function acceptances(...rows: Array<[string, 'PASS' | 'REJECT', number]>): AcceptanceCountFact[] {
  return rows.map(([taskId, conclusion, count]) => ({ taskId, conclusion, count }))
}

function risks(...rows: Array<[RiskCountFact['status'], RiskCountFact['level'], number]>): RiskCountFact[] {
  return rows.map(([status, level, count]) => ({ status, level, count }))
}

const members = (...ids: string[]): MemberFact[] => ids.map((userId) => ({ userId }))

/* ===========================================================================
 * 常量与形状：与 D 的协议、与 #30 的阈值对齐（防漂移）
 * =========================================================================== */

describe('常量与形状', () => {
  it('场景值就是 D §2.1 的四个线上常量（不是自造的 InsightKind 字面量）', () => {
    expect([...INSIGHT_SCENARIOS]).toEqual([
      'INSIGHT_QUALITY',
      'INSIGHT_PROGRESS',
      'INSIGHT_RISK',
      'INSIGHT_EFFICIENCY',
    ])
  })

  it('场景 → 指标字段 的映射一一对应（生成层取数不得错位）', () => {
    expect(METRIC_KEY_BY_SCENARIO).toEqual({
      INSIGHT_QUALITY: 'quality',
      INSIGHT_PROGRESS: 'progress',
      INSIGHT_RISK: 'risk',
      INSIGHT_EFFICIENCY: 'efficiency',
    })
    // 四个字段都在聚合结果里
    const { metrics } = aggregateInsightMetrics({
      projectId: 'p',
      asOf: AS_OF,
      tasks: taskFacts(taskCounts(['TODO', 1])),
      acceptances: [],
      risks: [],
      members: members(U1),
    })
    expect(Object.keys(metrics).sort()).toEqual(
      Object.values(METRIC_KEY_BY_SCENARIO).sort(),
    )
  })

  it('阈值就是 #30 的常量（10 / 25pp），本模块不另立一份', () => {
    expect(HEALTHY_THRESHOLD_PP).toBe(10)
    expect(WARNING_THRESHOLD_PP).toBe(25)
  })
})

/* ===========================================================================
 * ① 进度（口径与 #30 同源）
 * =========================================================================== */

describe('进度指标', () => {
  it('分子只计 CLOSED：全 DONE 时进度是 0（不是 100%）', () => {
    const result = progressOf(taskFacts(taskCounts(['DONE', 2])), AS_OF)
    expect(result.total).toBe(2)
    expect(result.closed).toBe(0)
    expect(result.ratio).toBe(0)
  })

  it('六态混合：分母是任务总数、分子只有 CLOSED', () => {
    const result = progressOf(
      taskFacts(taskCounts(['TODO', 1], ['DOING', 1], ['BLOCKED', 1], ['SUSPENDED', 1], ['DONE', 1], ['CLOSED', 1])),
      AS_OF,
    )
    expect(result.total).toBe(6)
    expect(result.closed).toBe(1)
    expect(result.ratio).toBe(0.1667)
  })

  it('★ 没有任务：ratio 是 null（不是 0）、健康度 UNAVAILABLE 并带说明', () => {
    const result = progressOf(taskFacts([], null), AS_OF)
    expect(result.total).toBe(0)
    expect(result.ratio).toBeNull()
    expect(result.planTimeProgress).toBeNull()
    expect(result.deviationPp).toBeNull()
    expect(result.healthState).toBe('UNAVAILABLE')
    expect(result.healthNote).toContain('暂无计划数据')
  })

  it('计划时间进度**含首尾**：今天 = 开始日 ⇒ 已过 1 天（不是 0）', () => {
    const result = progressOf(taskFacts(taskCounts(['TODO', 1])), HALF_WINDOW.start)
    expect(result.planTimeProgress).toBe(0.25) // 1 / 4
  })

  it('今天早于计划开始 ⇒ 0；晚于计划结束 ⇒ 1（不出现负数或超过 1）', () => {
    const early = progressOf(taskFacts(taskCounts(['TODO', 1])), '2026-02-20')
    expect(early.planTimeProgress).toBe(0)
    const late = progressOf(taskFacts(taskCounts(['TODO', 1])), '2026-12-31')
    expect(late.planTimeProgress).toBe(1)
  })

  it('偏差 = 计划时间进度 − 实际进度（pp，正数表示落后）', () => {
    // 计划 0.5、实际 0.5 ⇒ 0pp
    const onTrack = progressOf(taskFacts(taskCounts(['CLOSED', 5], ['TODO', 5])), AS_OF)
    expect(onTrack.deviationPp).toBe(0)
    expect(onTrack.healthState).toBe('HEALTHY')

    // 计划 0.5、实际 0.2 ⇒ 30pp ⇒ 风险
    const behind = progressOf(taskFacts(taskCounts(['CLOSED', 2], ['TODO', 8])), AS_OF)
    expect(behind.deviationPp).toBe(30)
    expect(behind.healthState).toBe('AT_RISK')
  })

  it('★ H2 边界（与 #30 同一份整数比较）：计划 2/5、进度 3/10 ⇒ 正好 10pp ⇒ 健康', () => {
    // 含首尾 5 天、已过 2 天 ⇒ 计划时间进度 0.4；实际 0.3
    // 浮点实现会算成 10.000000000000004 > 10 ⇒ 错判「预警」；本模块复用 #30 修好的实现
    const result = progressOf(
      taskFacts(taskCounts(['CLOSED', 3], ['TODO', 7]), { start: '2026-03-01', end: '2026-03-05' }),
      AS_OF,
    )
    expect(result.planTimeProgress).toBe(0.4)
    expect(result.deviationPp).toBe(10)
    expect(result.healthState).toBe('HEALTHY')
  })

  it('★ H2 边界：计划 7/12、进度 1/3 ⇒ 正好 25pp ⇒ 预警（不是风险）', () => {
    const result = progressOf(
      taskFacts(taskCounts(['CLOSED', 1], ['TODO', 2]), { start: '2026-03-01', end: '2026-03-12' }),
      '2026-03-07', // 含首尾 12 天、已过 7 天 ⇒ 7/12
    )
    expect(result.deviationPp).toBe(25)
    expect(result.healthState).toBe('WARNING')
  })

  it('计划窗口原样带出（可见窗口口径由取数层负责）', () => {
    const result = progressOf(taskFacts(taskCounts(['TODO', 1])), AS_OF)
    expect(result.planWindow).toEqual(HALF_WINDOW)
  })
})

/* ===========================================================================
 * ② 质量（#29 的验收记录）
 * =========================================================================== */

describe('质量指标', () => {
  it('驳回数、被驳回任务数（去重）、重验次数、驳回率', () => {
    const result = qualityOf(
      taskFacts(taskCounts(['CLOSED', 2], ['DOING', 1])),
      // t1：驳回 → 重验 → 通过（3 轮）；t2：一次通过（1 轮）⇒ 共 4 轮、驳回 1 条
      acceptances(['t1', 'REJECT', 1], ['t1', 'PASS', 2], ['t2', 'PASS', 1]),
    )
    expect(result.acceptanceRounds).toBe(4)
    expect(result.rejections).toBe(1)
    expect(result.rejectedTasks).toBe(1)
    expect(result.reverifications).toBe(2) // t1 有 3 轮 ⇒ 多出 2 轮；t2 只有 1 轮 ⇒ 0
    expect(result.rejectionRate).toBe(0.25)
  })

  it('同一任务被驳回两次只算**一个**被驳回任务，但重验次数按轮次累加', () => {
    const result = qualityOf(
      taskFacts(taskCounts(['DOING', 1])),
      acceptances(['t1', 'REJECT', 2], ['t1', 'PASS', 1]),
    )
    expect(result.rejections).toBe(2)
    expect(result.rejectedTasks).toBe(1)
    expect(result.reverifications).toBe(2) // 3 轮 ⇒ 2 次重验
    expect(result.rejectionRate).toBe(0.6667)
  })

  it('★ 没有验收记录：驳回率是 **null**（不是 0）—— 「没验收过」≠「驳回率零」', () => {
    const result = qualityOf(taskFacts(taskCounts(['TODO', 3])), [])
    expect(result.acceptanceRounds).toBe(0)
    expect(result.rejectionRate).toBeNull()
  })

  it('卡住任务数只数 BLOCKED', () => {
    const result = qualityOf(
      taskFacts(taskCounts(['BLOCKED', 2], ['DOING', 3], ['SUSPENDED', 1])),
      [],
    )
    expect(result.blockedTasks).toBe(2)
  })

  it('验收平均等待天数恒为 null（无状态变更时间戳，不用 0 冒充）', () => {
    const result = qualityOf(taskFacts(taskCounts(['DONE', 5])), acceptances(['t1', 'PASS', 1]))
    expect(result.avgAcceptanceDays).toBeNull()
  })
})

/* ===========================================================================
 * ③ 风险（与关闭阻断同源）
 * =========================================================================== */

describe('风险指标', () => {
  it('未解决 = 未处理 + 处理中；byLevel 只统计未解决（已解决的高危不算当前暴露面）', () => {
    const result = riskOf(
      risks(
        ['OPEN', 'HIGH', 2],
        ['IN_PROGRESS', 'MEDIUM', 1],
        ['RESOLVED', 'HIGH', 3], // 已解决：进 total，不进 byLevel
        ['CLOSED', 'LOW', 1],
      ),
    )
    expect(result.open).toBe(2)
    expect(result.inProgress).toBe(1)
    expect(result.unresolved).toBe(3)
    expect(result.resolved).toBe(3)
    expect(result.closed).toBe(1)
    expect(result.total).toBe(7)
    expect(result.byLevel).toEqual({ high: 2, medium: 1, low: 0 })
  })

  it('四个状态之和恒等于 total；空集合全 0', () => {
    const result = riskOf([])
    expect(result).toEqual({
      open: 0,
      inProgress: 0,
      unresolved: 0,
      resolved: 0,
      closed: 0,
      total: 0,
      byLevel: { high: 0, medium: 0, low: 0 },
    })
  })
})

/* ===========================================================================
 * ④ 效率（#27 的负载口径）
 * =========================================================================== */

describe('效率指标', () => {
  it('负载 = 非 CLOSED（含 DONE）；零负载成员也在列表里', () => {
    const result = efficiencyOf(
      taskFacts([
        { status: 'DOING', ownerUserId: U1, count: 2 },
        { status: 'DONE', ownerUserId: U1, count: 1 },
        { status: 'CLOSED', ownerUserId: U1, count: 4 }, // 不计入负载
        { status: 'TODO', ownerUserId: U2, count: 1 },
      ]),
      members(U1, U2, 'user-3'),
      'project-1',
    )
    expect(result.byMember).toHaveLength(3)
    expect(result.members).toBe(3)
    expect(result.byMember[0]).toMatchObject({ openTasks: 3 }) // U1：DOING 2 + DONE 1
    expect(result.byMember[1]).toMatchObject({ openTasks: 1 })
    expect(result.byMember[2]).toMatchObject({ openTasks: 0 }) // 零负载排在最后
    expect(result.membersWithOpenTasks).toBe(2)
    expect(result.idleMembers).toBe(1)
    expect(result.maxOpenTasks).toBe(3)
  })

  it('积压两块：进行中与待验收分开计数', () => {
    const result = efficiencyOf(
      taskFacts(taskCounts(['DOING', 3], ['DONE', 4], ['CLOSED', 5])),
      members(U1),
      'project-1',
    )
    expect(result.doingTasks).toBe(3)
    expect(result.pendingAcceptanceTasks).toBe(4)
  })

  it('空成员表：maxOpenTasks 是 0（不是 -Infinity）', () => {
    const result = efficiencyOf(taskFacts([]), [], 'project-1')
    expect(result.byMember).toEqual([])
    expect(result.members).toBe(0)
    expect(result.maxOpenTasks).toBe(0)
  })

  it('顺序稳定：同负载时按匿名键升序，两次调用结果一致', () => {
    const input = { tasks: taskFacts([]), members: members(U1, U2, 'user-3'), projectId: 'p' }
    const first = efficiencyOf(input.tasks, input.members, input.projectId).byMember
    const second = efficiencyOf(input.tasks, input.members, input.projectId).byMember
    expect(first).toEqual(second)
    const keys = first.map((row) => row.memberKey)
    expect([...keys].sort()).toEqual(keys)
  })
})

/* ===========================================================================
 * 匿名键（效率类的成员维度不能是人事数据）
 * =========================================================================== */

describe('成员匿名键 memberKey', () => {
  it('不含 userId 本身，且以固定前缀开头', () => {
    const key = memberKeyOf('project-1', U1)
    expect(key).not.toContain(U1)
    expect(key.startsWith('mk-')).toBe(true)
    expect(key).toHaveLength(15) // mk- + 12 位十六进制
  })

  it('同一项目同一成员稳定；不同成员 / 不同项目都不同', () => {
    expect(memberKeyOf('project-1', U1)).toBe(memberKeyOf('project-1', U1))
    expect(memberKeyOf('project-1', U1)).not.toBe(memberKeyOf('project-1', U2))
    // 跨项目不同：防止拿两个项目的成员表做串联
    expect(memberKeyOf('project-1', U1)).not.toBe(memberKeyOf('project-2', U1))
  })
})

/* ===========================================================================
 * 汇总与「算不出来」的登记
 * =========================================================================== */

describe('汇总与 unavailable', () => {
  it('四类一次性算出，且不修改入参（纯函数）', () => {
    const taskCountList = taskCounts(['CLOSED', 1], ['DONE', 1])
    const memberList = members(U1)
    const input = {
      projectId: 'p',
      asOf: AS_OF,
      tasks: taskFacts(taskCountList),
      acceptances: acceptances(['t1', 'PASS', 1]),
      risks: risks(['OPEN', 'HIGH', 1]),
      members: memberList,
    }
    const snapshot = JSON.stringify(input)

    const { metrics } = aggregateInsightMetrics(input)

    expect(metrics.progress.total).toBe(2)
    expect(metrics.quality.acceptanceRounds).toBe(1)
    expect(metrics.risk.unresolved).toBe(1)
    expect(metrics.efficiency.members).toBe(1)
    expect(JSON.stringify(input)).toBe(snapshot) // 入参没被就地排序 / 改写
  })

  it('avgAcceptanceDays 等算不出来的指标必须带「缺什么 + 为什么」登记', () => {
    const list = unavailableMetrics()
    const entry = list.find((item) => item.metric === 'quality.avgAcceptanceDays')
    expect(entry).toBeDefined()
    expect(entry?.needs).toContain('时间戳')
    expect(entry?.reason).toContain('null')
    // 每一条都要写清 needs 与 reason，不能只给个指标名
    for (const item of list) {
      expect(item.needs.length).toBeGreaterThan(0)
      expect(item.reason.length).toBeGreaterThan(0)
    }
  })

  it('聚合结果里带上 unavailable（生成层必须先读它，再决定能编哪几类建议）', () => {
    const { metrics, unavailable } = aggregateInsightMetrics({
      projectId: 'p',
      asOf: AS_OF,
      tasks: taskFacts([]),
      acceptances: [],
      risks: [],
      members: [],
    })
    expect(unavailable.length).toBeGreaterThan(0)
    expect(metrics.quality.avgAcceptanceDays).toBeNull()
  })
})
