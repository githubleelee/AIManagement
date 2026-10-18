/**
 * US-08 个人工作台（工单 #28）—— 接口测试
 *
 * 唯一 seam 是 HTTP 接口层（契约 Testing Decisions）：全部通过 supertest 发请求、
 * 断言状态码与响应体，不断言内部实现。
 *
 * 覆盖：5 块结构 / 各块口径与边界 / 非成员隔离 / 敏感任务的**计数**不泄漏 / 未登录 401。
 *
 * **明确不测**（本票后续阶段才实现，写了就是假绿）：
 *   - 任务状态 / 进度**写路径**、阻塞原因必填（AC7 / AC8，属第 3 步，依赖六状态落地）；
 *   - 「被提及」的真实通知数据（AC5，依赖通知模块）；
 *   - 协作人可见范围（AC7 的"协作人"，当前 `Task` 无该字段，属待确认项 C12）。
 *
 * 日期的处理：「今天」由**服务端**按 **Asia/Shanghai 自然日**取（端点不提供覆盖参数），
 * 因此这里用「相对今天的偏移」构造数据，并把边界（今天 / 今天-1 / 今天+7 / 今天+8）都钉住。
 * 测试侧的「今天」必须与端点同口径（见下方 `isoToday()`），否则每天 08:00 之前会错位一天。
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
import type { TaskStatus } from '../../shared/types.js'
import type { WorkbenchView } from './types.js'

/**
 * 与端点内部一致的"今天"（**Asia/Shanghai 自然日**）。
 *
 * C3 于 2026-10-18 批复定案后，服务端从 UTC 改为 Asia/Shanghai；
 * 测试这侧必须同步，否则"今天到期"这类用例会在 UTC 与上海日期不同天时错位
 * （每天 08:00 之前，上海比 UTC 早一天）。
 */
function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** 在 ISO 日期上加减天数。 */
function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

let ctx: HttpTestContext
let pm: { id: string }
let member: { id: string }
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
  member = await makeUser('member@example.com', '项目成员')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const { projectId: createdProjectId } = await makeProject(pm.id, '工作台测试项目')
  projectId = createdProjectId
  const goalId = await makeGoal(projectId, '测试目标')
  const activityId = await makeActivity(goalId, '测试活动')
  storyId = await makeStory(activityId, {
    title: '测试用户故事',
    capabilityText: '拆任务',
    valueText: '推进交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, member.id, 'MEMBER')
})

type TaskSeed = {
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
  status?: TaskStatus
  isSensitive?: boolean
  title?: string
}

/** 直接插任务行（工厂不允许构造任意状态 / 日期组合，故走 ctx.db）。 */
async function seedTask(seed: TaskSeed): Promise<string> {
  const row = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: seed.title ?? '任务',
      description: null,
      ownerUserId: seed.ownerUserId,
      acceptorUserId: seed.acceptorUserId,
      planStart: seed.planStart,
      planEnd: seed.planEnd,
      status: seed.status ?? 'TODO',
      isSensitive: seed.isSensitive ?? false,
    },
    select: { id: true },
  })
  return row.id
}

function getWorkbench(actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get('/me/workbench')
}

async function fetchWorkbench(actorUserId: string): Promise<WorkbenchView> {
  const res = await getWorkbench(actorUserId)
  expect(res.status).toBe(200)
  return res.body as WorkbenchView
}

function blockOf(view: WorkbenchView, key: WorkbenchView['blocks'][number]['key']) {
  const found = view.blocks.find((block) => block.key === key)
  if (!found) throw new Error(`响应里缺少块 ${key}`)
  return found
}

describe('GET /me/workbench —— 结构与口径', () => {
  it('返回固定 5 块，顺序固定，并带回计算口径', async () => {
    const view = await fetchWorkbench(pm.id)
    expect(view.blocks.map((block) => block.key)).toEqual([
      'todo',
      'overdue',
      'accept',
      'mention',
      'upcoming',
    ])
    expect(view.basis.asOf).toBe(isoToday())
    expect(view.basis.upcomingWindowDays).toBeGreaterThan(0)
  })

  it('「被提及」返回 unavailable 且 total 为 null —— 不得用 0 冒充"没有"', async () => {
    const view = await fetchWorkbench(pm.id)
    const mention = blockOf(view, 'mention')
    expect(mention.state).toBe('unavailable')
    expect(mention.total).toBeNull()
    expect(mention.rows).toEqual([])
    expect(typeof mention.note).toBe('string')
  })

  it('未登录访问 → 401', async () => {
    const res = await ctx.asUser(null).get('/me/workbench')
    expect(res.status).toBe(401)
  })
})

describe('GET /me/workbench —— 各块口径与边界', () => {
  it('我的待办 = 我是负责人且还没验收关闭：已提交待验收的算，已验收的不算', async () => {
    const today = isoToday()
    const end = shiftDays(today, 3)
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: today, planEnd: end, title: '在做', status: 'DOING' })
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: today, planEnd: end, title: '待办', status: 'TODO' })
    // 已提交验收：还没关闭，仍属我的待办（六状态落地后的正确口径）
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: today, planEnd: end, title: '已提交待验收', status: 'DONE' })
    // 已验收关闭：不再出现在待办里
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: today, planEnd: end, title: '已验收', status: 'CLOSED' })

    const view = await fetchWorkbench(pm.id)
    const todo = blockOf(view, 'todo')
    expect(todo.state).toBe('ok')
    expect(todo.total).toBe(3)
    expect(todo.rows.map((row) => row.title).sort()).toEqual(['在做', '已提交待验收', '待办'])
  })

  it('我的待办不含他人负责的任务', async () => {
    await seedTask({ ownerUserId: member.id, acceptorUserId: pm.id, planStart: isoToday(), planEnd: shiftDays(isoToday(), 3), title: '别人的' })
    const view = await fetchWorkbench(pm.id)
    expect(blockOf(view, 'todo').total).toBe(0)
  })

  it('逾期 = planEnd 早于今天；planEnd 等于今天的**不算**逾期', async () => {
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: shiftDays(isoToday(), -10), planEnd: shiftDays(isoToday(), -1), title: '昨天到期' })
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: shiftDays(isoToday(), -5), planEnd: isoToday(), title: '今天到期' })

    const view = await fetchWorkbench(pm.id)
    const overdue = blockOf(view, 'overdue')
    expect(overdue.total).toBe(1)
    expect(overdue.rows[0]?.title).toBe('昨天到期')
  })

  it('待验收 = 我是验收人且执行人已提交（DONE）；未提交的不算', async () => {
    await seedTask({ ownerUserId: member.id, acceptorUserId: pm.id, planStart: isoToday(), planEnd: shiftDays(isoToday(), 2), title: '等我验收', status: 'DONE' })
    await seedTask({ ownerUserId: member.id, acceptorUserId: pm.id, planStart: isoToday(), planEnd: shiftDays(isoToday(), 2), title: '还在做', status: 'DOING' })

    const view = await fetchWorkbench(pm.id)
    const accept = blockOf(view, 'accept')
    expect(accept.total).toBe(1)
    expect(accept.rows[0]?.title).toBe('等我验收')
  })

  it('近期计划窗口：今天 ~ 今天+7 内进；今天+8 不进', async () => {
    const today = isoToday()
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: today, planEnd: shiftDays(today, 2), title: '今天开始' })
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: shiftDays(today, 7), planEnd: shiftDays(today, 9), title: '第 7 天开始' })
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: shiftDays(today, 8), planEnd: shiftDays(today, 10), title: '第 8 天开始' })

    const view = await fetchWorkbench(pm.id)
    const upcoming = blockOf(view, 'upcoming')
    expect(upcoming.total).toBe(2)
    expect(upcoming.rows.map((row) => row.title)).not.toContain('第 8 天开始')
  })
})

describe('GET /me/workbench —— 隔离与敏感', () => {
  it('非项目成员看不到该项目任何内容（各块为 0、且没有明细）', async () => {
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: shiftDays(isoToday(), -6), planEnd: shiftDays(isoToday(), -2), title: '别人项目里的' })

    const view = await fetchWorkbench(outsider.id)
    for (const block of view.blocks) {
      if (block.key === 'mention') continue
      expect(block.total).toBe(0)
      expect(block.rows).toEqual([])
    }
  })

  it('敏感任务对未授权成员不出现，且**计数也是 0**（不得泄漏存在性）', async () => {
    // 对照组：非敏感、负责人就是 member 自己 → 应出现在 member 的「我的待办」
    await seedTask({ ownerUserId: member.id, acceptorUserId: pm.id, planStart: isoToday(), planEnd: shiftDays(isoToday(), 2), title: '普通任务' })
    const beforeSensitive = await fetchWorkbench(member.id)
    expect(blockOf(beforeSensitive, 'todo').total).toBe(1)

    // 实验组：同样的形状，但标记敏感，且**没有**给 member 白名单
    await seedTask({ ownerUserId: member.id, acceptorUserId: pm.id, planStart: isoToday(), planEnd: shiftDays(isoToday(), 2), title: '敏感任务', isSensitive: true })

    const afterSensitive = await fetchWorkbench(member.id)
    const todo = blockOf(afterSensitive, 'todo')
    expect(todo.total).toBe(1) // 仍然只有那一条非敏感任务
    expect(todo.rows.map((row) => row.title)).not.toContain('敏感任务')
  })

  it('PM 可见敏感任务（权限入口允许 PM）', async () => {
    await seedTask({ ownerUserId: pm.id, acceptorUserId: member.id, planStart: isoToday(), planEnd: shiftDays(isoToday(), 2), title: 'PM 的敏感任务', isSensitive: true })
    const view = await fetchWorkbench(pm.id)
    expect(blockOf(view, 'todo').total).toBe(1)
  })
})
