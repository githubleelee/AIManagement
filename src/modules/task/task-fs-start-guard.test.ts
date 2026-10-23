/**
 * #13 / C2 —— 真实任务写入口的 FS 开工守卫（`DECISIONS.md`
 * `scheduling.fs-release-closed-natural-days`、`legacy.task-start-guard-authorization`）。
 *
 * 唯一 seam 仍是 HTTP：除「共享核心 / 调用方事务」一节外，全部通过 `createTestContext()`
 * 的**生产装配**（`buildApp`）直接打 `PATCH /tasks/:taskId`，证明绕过甘特 UI 直接调用接口
 * 也会被拦，而不是只在界面上禁用按钮。
 *
 * 覆盖：
 *   - TODO→DOING：前置 `DONE` / 未关闭阻断；全部 `CLOSED` 放行；无依赖放行；多前置；
 *   - 计划边界：后继 `planStart` 等于前置 `planEnd`（同日）拒绝、次日放行（自然日含首尾）；
 *   - 不误伤：TODO 只改计划日期、已在 DOING 的任务编辑 → 不触发守卫；
 *   - 混合字段因守卫失败 → 一次 UPDATE 未执行，标题 / 进度 / 状态全部不变；
 *   - 权限先于守卫；隐藏（敏感）前置参与校验但响应不泄露其 ID / 标题；
 *   - 守卫位于共享核心：`applyTaskPlanDates` 不改状态故不属于开工；直接经共享核心写 `DOING`
 *     同样被拦；调用方事务回滚不落部分写；根客户端批量不能绕过事务要求。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../shared/types.js'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeUser,
} from '../../../test/factories.js'
import { applyTaskPlanDates, writeAssignedTask } from './rules.js'

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

let ctx: HttpTestContext
let pm: { id: string }
let owner: { id: string }
let acceptor: { id: string }
let bystander: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string

/** 前置计划结束日；后继 `planStart` 的边界都相对它定义。 */
const PRED_END = '2026-11-10'
const NEXT_DAY = '2026-11-11'
const SAME_DAY = '2026-11-10'

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser('fs-pm@example.com', '虚构项目经理')
  owner = await makeUser('fs-owner@example.com', '虚构负责人')
  acceptor = await makeUser('fs-acceptor@example.com', '虚构验收人')
  bystander = await makeUser('fs-bystander@example.com', '虚构无关成员')
  outsider = await makeUser('fs-outsider@example.com', '虚构外部人')

  const created = await makeProject(pm.id, 'FS 开工守卫项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '拆分任务',
    valueText: '推进交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, owner.id, 'MEMBER')
  await makeMember(projectId, acceptor.id, 'MEMBER')
  await makeMember(projectId, bystander.id, 'MEMBER')
})

async function seedTask(overrides: {
  title?: string
  status?: string
  planStart?: string
  planEnd?: string
  ownerUserId?: string
  acceptorUserId?: string
  isSensitive?: boolean
  blockedReason?: string | null
} = {}) {
  return ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: overrides.title ?? '虚构任务',
      description: null,
      ownerUserId: overrides.ownerUserId ?? owner.id,
      acceptorUserId: overrides.acceptorUserId ?? acceptor.id,
      planStart: overrides.planStart ?? NEXT_DAY,
      planEnd: overrides.planEnd ?? '2026-11-20',
      status: overrides.status ?? 'TODO',
      isSensitive: overrides.isSensitive ?? false,
      blockedReason: overrides.blockedReason ?? null,
    },
  })
}

function addFs(predecessorTaskId: string, successorTaskId: string) {
  return ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId, successorTaskId, type: 'FS' } })
}

function patch(taskId: string, body: Record<string, unknown>, actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).patch(`/tasks/${taskId}`).send(body)
}

function invalidValueFields(res: { body: unknown }): string[] {
  const body = res.body as ErrorBody
  expect(body.error.code).toBe('VALIDATION_FAILED')
  return (body.error.details ?? []).filter((detail) => detail.code === 'INVALID_VALUE').map((detail) => detail.field)
}

describe('FS 开工守卫：TODO→DOING 的前置放行', () => {
  it('前置为 CLOSED：允许开工', async () => {
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const successor = await seedTask()
    await addFs(predecessor.id, successor.id)

    const res = await patch(successor.id, { status: 'DOING' }, pm.id)
    expect(res.status).toBe(200)
    expect((res.body as TaskView).status).toBe('DOING')
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('DOING')
  })

  it.each(['DONE', 'TODO', 'DOING', 'BLOCKED', 'SUSPENDED'])(
    '前置为 %s（DONE 不算 CLOSED / 未验收关闭）：422 阻断且状态不变',
    async (status) => {
      const predecessor = await seedTask({ status, planEnd: PRED_END })
      const successor = await seedTask()
      await addFs(predecessor.id, successor.id)

      const res = await patch(successor.id, { status: 'DOING' }, pm.id)
      expect(res.status).toBe(422)
      expect(invalidValueFields(res)).toContain('status')
      expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('TODO')
    },
  )

  it('无 FS 前置：允许开工（守卫不误伤无依赖任务）', async () => {
    const successor = await seedTask()
    const res = await patch(successor.id, { status: 'DOING' }, pm.id)
    expect(res.status).toBe(200)
  })

  it('多前置：任一未关闭即阻断，全部 CLOSED 才放行', async () => {
    const closed = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const done = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask()
    await addFs(closed.id, successor.id)
    await addFs(done.id, successor.id)

    expect((await patch(successor.id, { status: 'DOING' }, pm.id)).status).toBe(422)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('TODO')

    await ctx.db.task.update({ where: { id: done.id }, data: { status: 'CLOSED' } })
    expect((await patch(successor.id, { status: 'DOING' }, pm.id)).status).toBe(200)
  })

  it('BLOCKED→DOING 同属开工：前置未关闭仍阻断', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ status: 'BLOCKED', blockedReason: '等外部接口' })
    await addFs(predecessor.id, successor.id)

    expect((await patch(successor.id, { status: 'DOING' }, pm.id)).status).toBe(422)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('BLOCKED')
  })
})

describe('FS 计划边界：自然日含首尾（Asia/Shanghai，日期不落时区）', () => {
  it('planStart 等于前置 planEnd（同日）→ 422，错误指向 planStart', async () => {
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const successor = await seedTask({ planStart: SAME_DAY, planEnd: '2026-11-20' })
    await addFs(predecessor.id, successor.id)

    const res = await patch(successor.id, { status: 'DOING' }, pm.id)
    expect(res.status).toBe(422)
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: '后继计划开始不得早于前置计划结束的次日',
        details: [{ field: 'planStart', code: 'INVALID_VALUE' }],
      },
    })
  })

  it('planStart 为前置次日 → 放行', async () => {
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const successor = await seedTask({ planStart: NEXT_DAY, planEnd: '2026-11-20' })
    await addFs(predecessor.id, successor.id)

    expect((await patch(successor.id, { status: 'DOING' }, pm.id)).status).toBe(200)
  })

  it('同一次 PATCH 把 planStart 调到同日 → 拒绝；调到次日 → 放行', async () => {
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const successor = await seedTask({ planStart: NEXT_DAY, planEnd: '2026-11-20' })
    await addFs(predecessor.id, successor.id)

    const sameDay = await patch(successor.id, { status: 'DOING', planStart: SAME_DAY }, pm.id)
    expect(sameDay.status).toBe(422)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('TODO')

    const nextDay = await patch(successor.id, { status: 'DOING', planStart: NEXT_DAY }, pm.id)
    expect(nextDay.status).toBe(200)
  })
})

describe('守卫不误伤非开工写入', () => {
  it('TODO 只改计划日期：前置未 CLOSED 也可规划，状态仍 TODO', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ planStart: NEXT_DAY, planEnd: '2026-11-20' })
    await addFs(predecessor.id, successor.id)

    const res = await patch(successor.id, { planStart: '2026-11-18', planEnd: '2026-11-19' }, pm.id)
    expect(res.status).toBe(200)
    const row = await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })
    expect(row).toMatchObject({ planStart: '2026-11-18', planEnd: '2026-11-19', status: 'TODO' })
  })

  it('已在 DOING 的任务编辑（含重复写 status=DOING）：不重复校验历史前置', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ status: 'DOING', planStart: NEXT_DAY })
    await addFs(predecessor.id, successor.id)

    expect((await patch(successor.id, { title: '进行中改名' }, pm.id)).status).toBe(200)
    expect((await patch(successor.id, { status: 'DOING' }, pm.id)).status).toBe(200)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).title).toBe('进行中改名')
  })
})

describe('混合字段写入的原子性', () => {
  it('守卫失败：一次 UPDATE 未执行，标题 / 进度 / 状态全部不变', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ title: '原标题', planStart: NEXT_DAY })
    await addFs(predecessor.id, successor.id)

    const res = await patch(
      successor.id,
      { status: 'DOING', title: '不能留下', progress: 50 },
      pm.id,
    )
    expect(res.status).toBe(422)
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).toMatchObject({
      title: '原标题',
      progress: null,
      status: 'TODO',
    })
  })

  it('守卫放行：混合字段经同一写核心一次落库', async () => {
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const successor = await seedTask({ title: '原标题', planStart: NEXT_DAY })
    await addFs(predecessor.id, successor.id)

    const res = await patch(
      successor.id,
      { status: 'DOING', title: '已开工', progress: 30 },
      pm.id,
    )
    expect(res.status).toBe(200)
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).toMatchObject({
      title: '已开工',
      progress: 30,
      status: 'DOING',
    })
  })
})

describe('权限先于守卫、隐藏前置不泄露', () => {
  it('非项目成员：404（不是守卫的 422），响应不含任务字段', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ title: '不可泄露标题', planStart: NEXT_DAY })
    await addFs(predecessor.id, successor.id)

    const res = await patch(successor.id, { status: 'DOING' }, outsider.id)
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain('不可泄露标题')
  })

  it('无授权成员（非负责人 / 验收人）进度写：403（不是守卫的 422）', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ planStart: NEXT_DAY })
    await addFs(predecessor.id, successor.id)

    expect((await patch(successor.id, { status: 'DOING' }, bystander.id)).status).toBe(403)
  })

  it('隐藏（敏感）前置参与服务端校验，但响应不暴露其 ID / 标题', async () => {
    const hidden = await seedTask({
      title: 'HIDDEN-PREDECESSOR-TITLE',
      status: 'DONE',
      planEnd: PRED_END,
      isSensitive: true,
    })
    const successor = await seedTask({ ownerUserId: owner.id, planStart: NEXT_DAY })
    await addFs(hidden.id, successor.id)

    // 负责人只有 task.progress（progress-only），且看不到敏感的隐藏前置。
    const res = await patch(successor.id, { status: 'DOING' }, owner.id)
    expect(res.status).toBe(422)
    // 错误契约：只用决策 I-4 冻结表内的顶层 / 字段码，文案不引用任何前置。
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: '存在未关闭（CLOSED）的前置任务，不能开工',
        details: [{ field: 'status', code: 'INVALID_VALUE' }],
      },
    })
    const text = JSON.stringify(res.body)
    for (const leaked of [hidden.id, 'HIDDEN-PREDECESSOR-TITLE', PRED_END]) {
      expect(text).not.toContain(leaked)
    }
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('TODO')
  })

  it('未认证：401', async () => {
    const successor = await seedTask()
    const res = await ctx.asUser(null).patch(`/tasks/${successor.id}`).send({ status: 'DOING' })
    expect(res.status).toBe(401)
  })
})

describe('守卫位于共享写核心与调用方事务', () => {
  it('applyTaskPlanDates 只改日期不改状态：不属于开工，前置未 CLOSED 也可批量改期', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ planStart: NEXT_DAY, planEnd: '2026-11-20' })
    await addFs(predecessor.id, successor.id)

    const result = await ctx.db.$transaction((tx) =>
      applyTaskPlanDates(tx, projectId, [
        { taskId: successor.id, planStart: '2026-11-12', planEnd: '2026-11-21' },
      ]),
    )
    expect(result).toEqual([
      { taskId: successor.id, planStart: '2026-11-12', planEnd: '2026-11-21' },
    ])
    const row = await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })
    expect(row).toMatchObject({ planStart: '2026-11-12', status: 'TODO' })
  })

  it('直接经共享核心写 DOING 同样被拦（不是仅 PATCH 的镜像），事务回滚不落部分写', async () => {
    const predecessor = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ title: '原标题', planStart: NEXT_DAY })
    await addFs(predecessor.id, successor.id)

    await expect(
      ctx.db.$transaction((tx) =>
        writeAssignedTask(tx, projectId, successor.id, {
          ownerUserId: owner.id,
          acceptorUserId: acceptor.id,
          planStart: NEXT_DAY,
          planEnd: '2026-11-20',
          status: 'DOING',
          title: '不能留下',
        }),
      ),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' })

    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).toMatchObject({
      title: '原标题',
      status: 'TODO',
    })
  })

  it('调用方事务内批量改期后抛出：整体回滚，不落部分写', async () => {
    const first = await seedTask({ planStart: NEXT_DAY, planEnd: '2026-11-20' })
    const second = await seedTask({ planStart: NEXT_DAY, planEnd: '2026-11-20' })

    await expect(
      ctx.db.$transaction(async (tx) => {
        await applyTaskPlanDates(tx, projectId, [
          { taskId: first.id, planStart: '2026-11-12', planEnd: '2026-11-21' },
          { taskId: second.id, planStart: '2026-11-13', planEnd: '2026-11-22' },
        ])
        throw new Error('deliberate rollback')
      }),
    ).rejects.toThrow('deliberate rollback')

    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ planStart: NEXT_DAY })
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ planStart: NEXT_DAY })
  })

  it('根客户端批量不能绕过调用方事务要求', async () => {
    const task = await seedTask()
    await expect(
      applyTaskPlanDates(ctx.db, projectId, [
        { taskId: task.id, planStart: '2026-11-12', planEnd: '2026-11-21' },
      ]),
    ).rejects.toThrow('caller transaction')
  })
})
