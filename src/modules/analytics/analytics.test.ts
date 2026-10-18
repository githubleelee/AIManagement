/**
 * US-10 项目仪表盘（工单 #30）测试 —— 端点 `GET /projects/:projectId/dashboard`。
 *
 * 口径按**项目负责人 2026-10-18 批复第 3 节（冻结）**：
 *   计划时间进度 = 已过自然日数 ÷ 计划总自然日数（**含首尾**），时区 Asia/Shanghai；
 *   偏差 = 计划时间进度 − 实际进度，单位**百分点**；比较用未舍入值、展示保留 1 位小数；
 *   分级 ≤10pp 健康 / ≤25pp 预警 / >25pp 风险；无任务不做分级（「暂无计划数据」）。
 *
 * 覆盖：AC1 进度（`DONE` 不计入 / 无任务 null）、AC2 三档与**正好落在阈值上**的边界、
 *       AC6 基数口径、AC7 敏感不计入、越权。
 *
 * ⚠️ 前置：本端点需在 `src/routes.ts` 注册 1 行才能真跑；注册前会 404（未接线）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeUser,
} from '../../../test/factories.js'
import type { ProjectDashboardView } from './types.js'

let ctx: HttpTestContext
let pm: { id: string }
let member1: { id: string }
let member2: { id: string }
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

  const created = await makeProject(pm.id, '仪表盘测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '看进度',
    valueText: '掌握健康度',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, member1.id, 'MEMBER')
  await makeMember(projectId, member2.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

/* ===========================================================================
 * 工具：按"相对今天"构造计划区间，钉住"含首尾"的口径边界
 * =========================================================================== */

/** 按口径时区（Asia/Shanghai）取今天 —— 与服务端同一套取法，避免跨时区抖动。 */
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

/** 计划区间 = 今天+offsetStart ~ 今天+offsetEnd（含首尾算天数）。 */
function windowOf(offsetStart: number, offsetEnd: number): { planStart: string; planEnd: string } {
  const today = isoToday()
  return { planStart: shiftDays(today, offsetStart), planEnd: shiftDays(today, offsetEnd) }
}

/**
 * 计划时间进度 = 0.5 的窗口：今天−1 ~ 今天+2 ⇒ 共 4 天、已过 2 天。
 * 健康度偏差（pp）= (0.5 − 实际进度) × 100，便于构造阈值边界。
 */
function halfWindow(): { planStart: string; planEnd: string } {
  return windowOf(-1, 2)
}

type SeedOptions = {
  status?: string
  planStart?: string
  planEnd?: string
  ownerUserId?: string
  acceptorUserId?: string
  isSensitive?: boolean
  title?: string
}

async function seedTask(options: SeedOptions = {}): Promise<string> {
  const win = halfWindow()
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: options.title ?? '任务',
      description: null,
      ownerUserId: options.ownerUserId ?? member1.id,
      acceptorUserId: options.acceptorUserId ?? member2.id,
      planStart: options.planStart ?? win.planStart,
      planEnd: options.planEnd ?? win.planEnd,
      status: options.status ?? 'TODO',
      isSensitive: options.isSensitive ?? false,
    },
    select: { id: true },
  })
  return task.id
}

/** 批量造同窗口任务：前 `closed` 个 CLOSED，其余 TODO。 */
async function seedMany(
  count: number,
  closed: number,
  win: { planStart: string; planEnd: string } = halfWindow(),
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await seedTask({
      status: i < closed ? 'CLOSED' : 'TODO',
      title: `任务${i}`,
      planStart: win.planStart,
      planEnd: win.planEnd,
    })
  }
}

function getDashboard(actorUserId: string, targetProjectId = projectId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${targetProjectId}/dashboard`)
}

function body<T>(payload: unknown): T {
  return payload as T
}

/* ===========================================================================
 * AC1 —— 进度口径
 * =========================================================================== */

describe('AC1 进度 = 已关闭 ÷ 总数', () => {
  it('六种状态各一个：分母 6、分子 1、比例 0.1667', async () => {
    for (const status of ['TODO', 'DOING', 'BLOCKED', 'SUSPENDED', 'DONE', 'CLOSED']) {
      await seedTask({ status, title: status })
    }

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.progress.total).toBe(6)
    expect(view.progress.closed).toBe(1)
    expect(view.progress.ratio).toBe(0.1667)
  })

  it('★ `DONE` 不计入分子：全 DONE 时进度为 0（不是 100%）', async () => {
    await seedTask({ status: 'DONE' })
    await seedTask({ status: 'DONE' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.progress.total).toBe(2)
    expect(view.progress.closed).toBe(0)
    expect(view.progress.ratio).toBe(0)
  })

  it('全部 CLOSED 时进度为 1', async () => {
    await seedTask({ status: 'CLOSED' })
    await seedTask({ status: 'CLOSED' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.progress.ratio).toBe(1)
  })

  it('★ 没有任务时 ratio 为 **null**、健康度 UNAVAILABLE 且提示「暂无计划数据」', async () => {
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)

    expect(view.progress.total).toBe(0)
    expect(view.progress.ratio).toBeNull()
    expect(view.health.state).toBe('UNAVAILABLE')
    expect(view.health.deviationPp).toBeNull()
    expect(view.health.note).toContain('暂无计划数据')
  })

  it('byStatus 六态齐全，且各项之和等于 total', async () => {
    await seedTask({ status: 'TODO' })
    await seedTask({ status: 'BLOCKED' })
    await seedTask({ status: 'CLOSED' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(Object.keys(view.byStatus).sort()).toEqual(
      ['BLOCKED', 'CLOSED', 'DOING', 'DONE', 'SUSPENDED', 'TODO'].sort(),
    )
    expect(Object.values(view.byStatus).reduce((a, b) => a + b, 0)).toBe(view.progress.total)
    expect(view.byStatus.CLOSED).toBe(1)
  })
})

/* ===========================================================================
 * AC2 —— 健康度（口径：计划 − 实际，单位 pp，含首尾）
 * =========================================================================== */

describe('AC2 健康度三档与阈值边界', () => {
  it('计划窗口由任务推导：min(planStart) ~ max(planEnd)', async () => {
    const w1 = windowOf(-30, -20)
    const w2 = windowOf(-10, 10)
    await seedTask(w1)
    await seedTask(w2)

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planWindow?.start).toBe(w1.planStart)
    expect(view.basis.planWindow?.end).toBe(w2.planEnd)
  })

  it('计划时间进度**含首尾**：今天−1 ~ 今天+2 ⇒ 4 天中已过 2 天 = 0.5', async () => {
    await seedTask()

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(0.5)
  })

  it('实际进度与计划持平 ⇒ 偏差 0pp ⇒ 健康', async () => {
    await seedMany(10, 5) // 实际 0.5，计划 0.5
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviationPp).toBe(0)
    expect(view.health.state).toBe('HEALTHY')
  })

  it('★ 边界：偏差**正好 10pp** ⇒ 仍判「健康」（阈值是 ≤）', async () => {
    await seedMany(10, 4) // 实际 0.4 ⇒ 偏差 10pp
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviationPp).toBe(10)
    expect(view.health.state).toBe('HEALTHY')
  })

  it('偏差 15pp（10~25 之间）⇒ 预警', async () => {
    await seedMany(20, 7) // 实际 0.35 ⇒ 偏差 15pp
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviationPp).toBe(15)
    expect(view.health.state).toBe('WARNING')
  })

  it('★ 边界：偏差**正好 25pp** ⇒ 仍判「预警」（阈值是 ≤）', async () => {
    await seedMany(20, 5) // 实际 0.25 ⇒ 偏差 25pp
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviationPp).toBe(25)
    expect(view.health.state).toBe('WARNING')
  })

  /* ---------------------------------------------------------------------------
   * H2 回归（2026-10-19 独立评审）：**正好落在阈值上**时的浮点错分
   *
   * 旧实现比较 `(E/D − C/T) × 100 ≤ pp`，而 IEEE754 下
   *   (0.4 − 0.3) × 100 = 10.000000000000004 > 10
   *   (7/12 − 1/3) × 100 = 25.000000000000007 > 25
   * ⇒ 下面两条在旧实现下分别错成 WARNING / AT_RISK（已实测复现：先加用例得红、
   *   再把比较改回浮点仍得红，最后用整数交叉相乘转绿）。
   * 上面那组旧边界用例恰好用了 0.5 / 0.4 / 0.25 这些"浮点友好"的数，掩盖了该缺陷。
   * ------------------------------------------------------------------------- */

  it('★ H2：计划 2/5 天、进度 3/10 ⇒ 偏差正好 10pp ⇒ **健康**（旧实现错判预警）', async () => {
    const win = windowOf(-1, 3) // 含首尾 5 天、已过 2 天 ⇒ 计划时间进度 0.4
    await seedMany(10, 3, win) // 实际 0.3 ⇒ 偏差正好 10pp

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(0.4)
    expect(view.health.deviationPp).toBe(10)
    expect(view.health.state).toBe('HEALTHY')
  })

  it('★ H2：计划 7/12 天、进度 1/3 ⇒ 偏差正好 25pp ⇒ **预警**（旧实现错判风险）', async () => {
    const win = windowOf(-6, 5) // 含首尾 12 天、已过 7 天 ⇒ 计划时间进度 7/12
    await seedMany(3, 1, win) // 实际 1/3 ⇒ 偏差正好 25pp

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviationPp).toBe(25)
    expect(view.health.state).toBe('WARNING')
  })

  it('偏差 100pp（计划时间已用完、一个都没关）⇒ 风险', async () => {
    const done = windowOf(-3, 0) // 共 4 天、全部已过 ⇒ 计划时间进度 1
    await seedMany(10, 0, done)

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(1)
    expect(view.health.deviationPp).toBe(100)
    expect(view.health.state).toBe('AT_RISK')
  })

  it('今天早于计划开始 ⇒ 计划时间进度为 0（不出现负数）', async () => {
    const future = windowOf(1, 5)
    await seedTask({ ...future, status: 'TODO' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(0)
    expect(view.health.deviationPp).toBe(0)
    expect(view.health.state).toBe('HEALTHY')
  })

  it('阈值与时区随响应返回（冻结口径：10 / 25pp，Asia/Shanghai）', async () => {
    await seedTask()
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.thresholds).toEqual({ healthyPp: 10, warningPp: 25 })
    expect(view.basis.timezone).toContain('Asia/Shanghai')
    expect(view.basis.planTimeProgressMeans).toContain('含首尾')
    expect(view.basis.progressMeans).toContain('CLOSED')
  })
})

/* ===========================================================================
 * AC6 —— 基数口径
 * =========================================================================== */

describe('AC6 基数口径（C6）', () => {
  it('PM 是 global 基数；普通成员与阅览者都是 visible 基数', async () => {
    await seedTask()

    expect(body<ProjectDashboardView>((await getDashboard(pm.id)).body).basis.scope).toBe('global')
    expect(body<ProjectDashboardView>((await getDashboard(member1.id)).body).basis.scope).toBe(
      'visible',
    )
    const viewerRes = await getDashboard(viewer.id)
    expect(viewerRes.status).toBe(200)
    expect(body<ProjectDashboardView>(viewerRes.body).basis.scope).toBe('visible')
  })
})

/* ===========================================================================
 * AC7 —— 敏感任务不计入
 * =========================================================================== */

describe('AC7 敏感任务：分子、分母、状态分布都不含', () => {
  it('★ 非白名单成员：分母不含敏感任务，且与 PM 的 total 不同', async () => {
    await seedTask({ status: 'CLOSED', title: '普通已关闭' })
    await seedTask({ status: 'TODO', title: '普通待办1' })
    await seedTask({ status: 'TODO', title: '普通待办2' })
    await seedTask({ status: 'CLOSED', isSensitive: true, title: '敏感已关闭' })

    const pmView = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    const memberView = body<ProjectDashboardView>((await getDashboard(member1.id)).body)

    expect(pmView.progress.total).toBe(4)
    expect(pmView.progress.closed).toBe(2)

    expect(memberView.progress.total).toBe(3)
    expect(memberView.progress.closed).toBe(1)
    expect(memberView.progress.ratio).toBe(0.3333)
    expect(Object.values(memberView.byStatus).reduce((a, b) => a + b, 0)).toBe(
      memberView.progress.total,
    )
  })

  it('白名单内的成员能看到敏感任务计入后的数字', async () => {
    await seedTask({ status: 'TODO', title: '普通待办' })
    const sensitiveId = await seedTask({ status: 'CLOSED', isSensitive: true, title: '敏感已关闭' })
    await ctx.db.objectVisibility.create({
      data: { projectId, objectType: 'task', objectId: sensitiveId, userId: member1.id },
    })

    const view = body<ProjectDashboardView>((await getDashboard(member1.id)).body)
    expect(view.progress.total).toBe(2)
    expect(view.progress.closed).toBe(1)
    expect(view.progress.ratio).toBe(0.5)
  })
})

/* ===========================================================================
 * 越权
 * =========================================================================== */

describe('越权与身份', () => {
  it('非项目成员 → 404，且与"项目不存在"的响应逐字一致', async () => {
    await seedTask()
    const notMember = await getDashboard(outsider.id)
    const missing = await getDashboard(outsider.id, '00000000-0000-0000-0000-000000000000')

    expect(notMember.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(notMember.body).toEqual(missing.body)
  })

  it('未登录 → 401', async () => {
    const res = await ctx.asUser(null).get(`/projects/${projectId}/dashboard`)
    expect(res.status).toBe(401)
  })
})
