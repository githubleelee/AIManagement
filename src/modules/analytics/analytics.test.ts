/**
 * US-10 项目仪表盘（工单 #30）测试 —— 端点 `GET /projects/:projectId/dashboard`。
 *
 * 覆盖：
 *   AC1 进度 = 已关闭 ÷ 总数；**`DONE` 不计入分子**；无任务时 `ratio` 为 **null 而不是 0**
 *   AC2 健康度三态 + 边界（正好等于阈值）、计划窗口由任务推导、算不出来时 UNAVAILABLE
 *   AC6 基数口径：PM = global；其余角色 = visible，**且分子分母同源**
 *   AC7 敏感任务对非白名单成员**不计入分母、不计入分子、不计入状态分布**
 *   越权：非成员 404（与"项目不存在"逐字一致）、未登录 401
 *
 * ⚠️ 前置：本端点需在冻结文件 `src/routes.ts` 注册 1 行才能真跑（授权后才有）；
 *    注册前本文件全部用例会是 404 —— 那是**未接线**，不是功能缺陷。
 *
 * 口径来源（人工 2026-10-18 拍板）：计划时间进度 = (今天 − min(planStart)) ÷ (max(planEnd) − min(planStart))；
 * C1 阈值 −10% / −25%；C6 PM 全局、其余可见且分子分母同源；时区 UTC。
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
 * 工具：按"相对今天"构造计划区间，从而钉住健康度的边界（不引入测试专用查询参数）
 * =========================================================================== */

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 窗口中点正好是今天的计划区间（今天在窗口正中间 ⇒ 计划时间进度 = 0.5）。 */
function middleWindow(daysEachSide = 10): { planStart: string; planEnd: string } {
  const today = isoToday()
  return { planStart: shiftDays(today, -daysEachSide), planEnd: shiftDays(today, daysEachSide) }
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
  const win = middleWindow()
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

/** 批量造同窗口的任务：前 `closed` 个为 CLOSED，其余为 TODO。 */
async function seedMany(count: number, closed: number, statusRest = 'TODO'): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await seedTask({ status: i < closed ? 'CLOSED' : statusRest, title: `任务${i}` })
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

    const res = await getDashboard(pm.id)
    expect(res.status).toBe(200)
    const view = body<ProjectDashboardView>(res.body)

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

  it('★ 没有任务时 ratio 为 **null**（不是 0），且健康度是 UNAVAILABLE（不是"健康"）', async () => {
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)

    expect(view.progress.total).toBe(0)
    expect(view.progress.ratio).toBeNull()
    expect(view.health.state).toBe('UNAVAILABLE')
    expect(view.health.deviation).toBeNull()
    expect(view.health.note).toBeTruthy()
  })

  it('byStatus 六态齐全，且各项之和等于 total（防止状态漏算）', async () => {
    await seedTask({ status: 'TODO' })
    await seedTask({ status: 'BLOCKED' })
    await seedTask({ status: 'CLOSED' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(Object.keys(view.byStatus).sort()).toEqual(
      ['BLOCKED', 'CLOSED', 'DOING', 'DONE', 'SUSPENDED', 'TODO'].sort(),
    )
    const sum = Object.values(view.byStatus).reduce((a, b) => a + b, 0)
    expect(sum).toBe(view.progress.total)
    expect(view.byStatus.CLOSED).toBe(1)
  })
})

/* ===========================================================================
 * AC2 —— 健康度
 * =========================================================================== */

describe('AC2 健康度三态与边界', () => {
  it('计划窗口由任务推导：min(planStart) ~ max(planEnd)', async () => {
    const today = isoToday()
    await seedTask({ planStart: shiftDays(today, -30), planEnd: shiftDays(today, -20) })
    await seedTask({ planStart: shiftDays(today, -10), planEnd: shiftDays(today, 10) })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planWindow?.start).toBe(shiftDays(today, -30))
    expect(view.basis.planWindow?.end).toBe(shiftDays(today, 10))
  })

  it('全部关闭 + 计划时间过半 ⇒ 健康（偏差 = 1 − 0.5 = 0.5）', async () => {
    await seedTask({ status: 'CLOSED' })
    await seedTask({ status: 'CLOSED' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(0.5)
    expect(view.health.deviation).toBe(0.5)
    expect(view.health.state).toBe('HEALTHY')
  })

  it('★ 边界：偏差正好 −0.10 ⇒ 判「健康」（阈值是 ≥）', async () => {
    // 20 个任务、8 个已关闭 ⇒ 比例 0.4；计划时间 0.5 ⇒ 偏差 −0.1
    await seedMany(20, 8)

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(0.5)
    expect(view.health.deviation).toBe(-0.1)
    expect(view.health.state).toBe('HEALTHY')
  })

  it('偏差 −0.15（−0.10 ~ −0.25 之间）⇒ 预警', async () => {
    // 20 个任务、7 个已关闭 ⇒ 0.35；计划时间 0.5 ⇒ 偏差 −0.15
    await seedMany(20, 7)

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviation).toBe(-0.15)
    expect(view.health.state).toBe('WARNING')
  })

  it('★ 边界：偏差正好 −0.25 ⇒ 判「预警」（阈值是 ≥）', async () => {
    // 20 个任务、5 个已关闭 ⇒ 0.25；计划时间 0.5 ⇒ 偏差 −0.25
    await seedMany(20, 5)

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviation).toBe(-0.25)
    expect(view.health.state).toBe('WARNING')
  })

  it('偏差 −0.40 ⇒ 风险', async () => {
    // 20 个任务、2 个已关闭 ⇒ 0.1；计划时间 0.5 ⇒ 偏差 −0.4
    await seedMany(20, 2)

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.health.deviation).toBe(-0.4)
    expect(view.health.state).toBe('AT_RISK')
  })

  it('今天早于计划开始 ⇒ 计划时间进度为 0（不出现负进度）', async () => {
    const today = isoToday()
    await seedTask({ planStart: shiftDays(today, 5), planEnd: shiftDays(today, 15), status: 'TODO' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(0)
    expect(view.health.deviation).toBe(0)
    expect(view.health.state).toBe('HEALTHY')
  })

  it('今天晚于计划结束 ⇒ 计划时间进度截断为 1（未完成任务 ⇒ 风险）', async () => {
    const today = isoToday()
    await seedTask({ planStart: shiftDays(today, -20), planEnd: shiftDays(today, -10), status: 'TODO' })

    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.planTimeProgress).toBe(1)
    expect(view.health.deviation).toBe(-1)
    expect(view.health.state).toBe('AT_RISK')
  })

  it('阈值随响应返回（C1 定案后只改常量，界面/审查不必猜）', async () => {
    await seedTask()
    const view = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    expect(view.basis.thresholds).toEqual({ healthy: -0.1, warning: -0.25 })
    expect(view.basis.progressMeans).toContain('CLOSED')
    expect(view.basis.timezone).toContain('UTC')
  })
})

/* ===========================================================================
 * AC6 —— 基数口径
 * =========================================================================== */

describe('AC6 基数口径（C6）', () => {
  it('PM 是 global 基数；普通成员是 visible 基数', async () => {
    await seedTask()

    const pmView = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    const memberView = body<ProjectDashboardView>((await getDashboard(member1.id)).body)

    expect(pmView.basis.scope).toBe('global')
    expect(memberView.basis.scope).toBe('visible')
  })

  it('VIEWER 也是 visible 基数，能读到数字（只读）', async () => {
    await seedTask()
    const res = await getDashboard(viewer.id)
    expect(res.status).toBe(200)
    expect(body<ProjectDashboardView>(res.body).basis.scope).toBe('visible')
  })
})

/* ===========================================================================
 * AC7 —— 敏感任务不计入
 * =========================================================================== */

describe('AC7 敏感任务：分子、分母、状态分布都不含', () => {
  it('★ 非白名单成员：分母不含敏感任务，且与 PM 的 total 不同（能看出基数差异）', async () => {
    // 3 个普通任务（1 个已关闭）+ 1 个敏感任务（已关闭，白名单里没有 member1）
    await seedTask({ status: 'CLOSED', title: '普通已关闭' })
    await seedTask({ status: 'TODO', title: '普通待办1' })
    await seedTask({ status: 'TODO', title: '普通待办2' })
    await seedTask({ status: 'CLOSED', isSensitive: true, title: '敏感已关闭' })

    const pmView = body<ProjectDashboardView>((await getDashboard(pm.id)).body)
    const memberView = body<ProjectDashboardView>((await getDashboard(member1.id)).body)

    // PM 看全部
    expect(pmView.progress.total).toBe(4)
    expect(pmView.progress.closed).toBe(2)

    // 非白名单成员：分子分母**都**排除了敏感任务
    expect(memberView.progress.total).toBe(3)
    expect(memberView.progress.closed).toBe(1)
    expect(memberView.progress.ratio).toBe(0.3333)

    // 状态分布同样不含（之和仍等于自己的 total）
    const sum = Object.values(memberView.byStatus).reduce((a, b) => a + b, 0)
    expect(sum).toBe(memberView.progress.total)
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
 * 越权与身份
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
