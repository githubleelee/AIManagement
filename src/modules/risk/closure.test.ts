/**
 * US-10 关闭阻断校验（工单 #30）测试 —— `GET /projects/:projectId/closure-check`。
 *
 * 覆盖 AC4 的**任务侧**（风险侧要等 `Risk` 表落地）：
 *   - 有未关闭任务 ⇒ 确定不能关（blocked / canClose=false）+ 清单
 *   - 任务侧没阻断时**不能**说"能关"：风险侧未接线 ⇒ unavailable / canClose=null
 *   - 敏感任务对非白名单成员不进清单、也不进计数 ⇒ 它看到的是 unavailable 而不是 blocked，
 *     **更不是 clear**（"看不到"不等于"能关"）
 *   - 计数与清单同源（total 精确，rows 有上限）
 *   - 越权：非成员 404（与项目不存在逐字一致）、未登录 401
 *
 * ⚠️ 前置：端点需在冻结文件 `src/routes.ts` 注册 1 行才能真跑；注册前本文件会 404（未接线）。
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
import type { ClosureCheckView } from './types.js'

let ctx: HttpTestContext
let pm: { id: string }
let member1: { id: string }
let member2: { id: string }
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
  outsider = await makeUser('outsider@example.com', '外部用户')

  const created = await makeProject(pm.id, '关闭阻断测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '关项目',
    valueText: '有据可依',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, member1.id, 'MEMBER')
  await makeMember(projectId, member2.id, 'MEMBER')
})

async function seedTask(
  options: { status?: string; isSensitive?: boolean; title?: string; planEnd?: string } = {},
): Promise<string> {
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: options.title ?? '任务',
      description: null,
      ownerUserId: member1.id,
      acceptorUserId: member2.id,
      planStart: '2026-11-01',
      planEnd: options.planEnd ?? '2026-11-10',
      status: options.status ?? 'TODO',
      isSensitive: options.isSensitive ?? false,
    },
    select: { id: true },
  })
  return task.id
}

function getClosure(actorUserId: string, targetProjectId = projectId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${targetProjectId}/closure-check`)
}

/* ===========================================================================
 * 任务侧阻断
 * =========================================================================== */

describe('AC4 任务侧阻断', () => {
  it('有未关闭任务 ⇒ 确定不能关（blocked / canClose=false），并列出清单', async () => {
    const taskId = await seedTask({ status: 'DOING', title: '还没做完' })

    const res = await getClosure(pm.id)
    expect(res.status).toBe(200)
    const view = res.body as ClosureCheckView

    expect(view.verdict.state).toBe('blocked')
    expect(view.verdict.canClose).toBe(false)
    expect(view.blockingTasks.state).toBe('ok')
    expect(view.blockingTasks.total).toBe(1)
    expect(view.blockingTasks.rows.map((task) => task.id)).toEqual([taskId])
  })

  it('`DONE` 也仍算未关闭（要等验收关闭）⇒ 同样阻断', async () => {
    await seedTask({ status: 'DONE', title: '已提交待验收' })

    const view = (await getClosure(pm.id)).body as ClosureCheckView
    expect(view.verdict.state).toBe('blocked')
    expect(view.blockingTasks.total).toBe(1)
  })

  it('★【前提已变】任务全部 CLOSED 且无未处理风险 ⇒ clear / canClose=true', async () => {
    // US-10 阶段 B：`Risk` 表与风险台账已落地，风险侧不再 unavailable。
    // 原断言（"任务清了也只能判 unavailable，绝不能说能关"）的**前提消失**；
    // 改为断言"两侧都干净才 clear"。这是语义收紧而不是放宽 ——
    // 只要还有未处理/处理中的风险，下面的用例仍会判 blocked。
    await seedTask({ status: 'CLOSED' })
    await seedTask({ status: 'CLOSED' })

    const view = (await getClosure(pm.id)).body as ClosureCheckView
    expect(view.blockingTasks.total).toBe(0)
    expect(view.blockingRisks.total).toBe(0)
    expect(view.verdict.state).toBe('clear')
    expect(view.verdict.canClose).toBe(true)
  })

  it('项目下没有任何任务、也没有风险 ⇒ clear', async () => {
    const view = (await getClosure(pm.id)).body as ClosureCheckView
    expect(view.blockingTasks.total).toBe(0)
    expect(view.blockingRisks.total).toBe(0)
    expect(view.verdict.state).toBe('clear')
    expect(view.verdict.canClose).toBe(true)
  })

  it('风险侧已接线：没有风险时 state=ok、total=0（不再是 null）', async () => {
    await seedTask()

    const view = (await getClosure(pm.id)).body as ClosureCheckView
    expect(view.blockingRisks.state).toBe('ok')
    expect(view.blockingRisks.total).toBe(0)
    expect(view.blockingRisks.rows).toEqual([])
  })

  it('清单按计划结束日升序（最该处理的先看）', async () => {
    await seedTask({ title: '晚', planEnd: '2026-12-31' })
    await seedTask({ title: '早', planEnd: '2026-11-05' })

    const view = (await getClosure(pm.id)).body as ClosureCheckView
    expect(view.blockingTasks.rows.map((task) => task.title)).toEqual(['早', '晚'])
  })

  it('计数精确、清单有上限：55 个未关闭任务 ⇒ total=55、rows=50', async () => {
    for (let i = 0; i < 55; i += 1) {
      await seedTask({ title: `任务${i}` })
    }

    const view = (await getClosure(pm.id)).body as ClosureCheckView
    expect(view.blockingTasks.total).toBe(55)
    expect(view.blockingTasks.rows).toHaveLength(50)
  })
})

/* ===========================================================================
 * 基线口径与敏感
 * =========================================================================== */

describe('基数口径与敏感任务', () => {
  it('PM 是 global 基数；普通成员是 visible 基数', async () => {
    await seedTask()
    const pmView = (await getClosure(pm.id)).body as ClosureCheckView
    const memberView = (await getClosure(member1.id)).body as ClosureCheckView
    expect(pmView.basis.scope).toBe('global')
    expect(memberView.basis.scope).toBe('visible')
  })

  it('★ 敏感任务：非白名单成员的清单与计数都不含它（他的判定只是"自己可见范围"的结论）', async () => {
    // 唯一一个未关闭任务，且是敏感的、白名单里只有 PM（成员看不到）
    await seedTask({ status: 'DOING', isSensitive: true, title: '敏感未关闭' })

    const pmView = (await getClosure(pm.id)).body as ClosureCheckView
    expect(pmView.verdict.state).toBe('blocked')
    expect(pmView.blockingTasks.total).toBe(1)

    const memberView = (await getClosure(member1.id)).body as ClosureCheckView
    expect(memberView.blockingTasks.total).toBe(0)
    expect(memberView.blockingTasks.rows).toEqual([])
    // 成员看不到这一项 ⇒ 他自己的可见范围里是"干净"的；但两点必须同时成立：
    //   ① 敏感任务的存在性没有泄漏（计数 0，不出现）；
    //   ② 他不能因此就认为"项目可以关"——关闭动作仅 PM，basis 已写明。
    expect(memberView.verdict.state).toBe('clear')
    expect(memberView.basis.closeActionNote).toContain('仅 PM')
  })

  it('白名单内的成员能看到该敏感任务计入阻断', async () => {
    const taskId = await seedTask({ status: 'DOING', isSensitive: true, title: '敏感未关闭' })
    await ctx.db.objectVisibility.create({
      data: { projectId, objectType: 'task', objectId: taskId, userId: member1.id },
    })

    const view = (await getClosure(member1.id)).body as ClosureCheckView
    expect(view.blockingTasks.total).toBe(1)
    expect(view.verdict.state).toBe('blocked')
  })
})

/* ===========================================================================
 * 越权
 * =========================================================================== */

describe('越权与身份', () => {
  it('非项目成员 → 404，且与"项目不存在"的响应逐字一致', async () => {
    await seedTask()
    const notMember = await getClosure(outsider.id)
    const missing = await getClosure(outsider.id, '00000000-0000-0000-0000-000000000000')
    expect(notMember.status).toBe(404)
    expect(notMember.body).toEqual(missing.body)
  })

  it('未登录 → 401', async () => {
    const res = await ctx.asUser(null).get(`/projects/${projectId}/closure-check`)
    expect(res.status).toBe(401)
  })
})
