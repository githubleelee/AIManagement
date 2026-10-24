/**
 * US-09 验收 **REJECT 的 FS 开工守卫**测试（#29 / `legacy.task-start-guard-authorization`）。
 *
 * 背景：项目负责人 2026-10-23 裁定「**所有从非 `DOING` 进入 `DOING` 都校验 FS**」，
 * 验收 `REJECT`（`DONE → DOING`）也算「进入 DOING」。独立探针在接线前实测出真实绕过：
 * 前置未 `CLOSED` 时 `REJECT` 仍返回 `http 200`、任务进 `DOING`。本文件钉住该缺口已关闭。
 *
 * 守卫本体在 `src/modules/task/rules.ts`（B 单写），本模块只经
 * `src/shared/task-execution.ts` 的 `TaskStartGuardPort` 消费，**不 import 实现**（契约 I-9）。
 *
 * 覆盖（技术负责人 #29 comment `6368427989` 点的回归清单）：
 *   1. 无依赖 `REJECT` 仍成功；
 *   2. 前置 `TODO`（未 CLOSED）拒绝，且任务仍 `DONE`、验收记录 / 领域事件零新增；
 *   3. 前置 `DONE`（已提交但未验收）同样拒绝 —— `DONE` 不算 `CLOSED`；
 *   4. 前置 `CLOSED` 且 `planStart` 晚于前置 `planEnd` → 允许；
 *   5. 前置 `CLOSED` 但同日（`planStart === planEnd`）→ 拒绝（字段码 `planStart`）；
 *   6. 失败响应**不含**前置的 ID / 标题 / 日期 / 数量（契约 I-3）；
 *   7. `PASS`（目标 `CLOSED`）不触发守卫，既有行为不退化；
 *   8. 鉴权先于守卫：非验收人 `REJECT` 仍是 403，不因接线改变错误顺序。
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

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

let ctx: HttpTestContext
let pm: { id: string }
let owner: { id: string }
let acceptor: { id: string }
let bystander: { id: string }
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
  owner = await makeUser('owner@example.com', '负责人')
  acceptor = await makeUser('acceptor@example.com', '验收人')
  bystander = await makeUser('bystander@example.com', '无关成员')

  const created = await makeProject(pm.id, '验收 FS 守卫测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '验收任务',
    valueText: '闭环交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, owner.id, 'MEMBER')
  await makeMember(projectId, acceptor.id, 'MEMBER')
  await makeMember(projectId, bystander.id, 'MEMBER')
})

/** 造一个任务（默认已提交验收 = `DONE`，可直接被验收）。 */
async function seedTask(
  options: {
    status?: string
    title?: string
    planStart?: string
    planEnd?: string
  } = {},
): Promise<string> {
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: options.title ?? '待验收任务',
      description: null,
      ownerUserId: owner.id,
      acceptorUserId: acceptor.id,
      planStart: options.planStart ?? '2026-11-01',
      planEnd: options.planEnd ?? '2026-11-10',
      status: options.status ?? 'DONE',
      isSensitive: false,
    },
    select: { id: true },
  })
  return task.id
}

/** 建一条 FS 依赖：predecessor → successor。 */
async function linkFs(predecessorTaskId: string, successorTaskId: string): Promise<void> {
  await ctx.db.taskDependency.create({
    data: { projectId, predecessorTaskId, successorTaskId, type: 'FS' },
  })
}

function postAcceptance(taskId: string, body: unknown, actorUserId: string = acceptor.id) {
  return ctx
    .asUser(ctx.loginAs(actorUserId))
    .post(`/tasks/${taskId}/acceptance`)
    .send(body as object)
}

function recordCount() {
  return ctx.db.acceptanceRecord.count({ where: { projectId } })
}

function eventCount() {
  return ctx.db.domainEvent.count({ where: { projectId } })
}

describe('验收 REJECT 的 FS 开工守卫', () => {
  it('① 无 FS 依赖：REJECT 仍成功（守卫不误伤）', async () => {
    const taskId = await seedTask()

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '未达标' })
    expect(res.status).toBe(200)

    const task = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(task.status).toBe('DOING')
    expect(await recordCount()).toBe(1)
    expect(await eventCount()).toBe(1)
  })

  it('② 前置未 CLOSED（TODO）：REJECT 被拒 422，任务仍 DONE，记录与事件零新增', async () => {
    const predecessorId = await seedTask({ status: 'TODO', title: '前置任务' })
    const taskId = await seedTask({ planStart: '2026-11-20' })
    await linkFs(predecessorId, taskId)

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '未达标' })
    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    // 条件类别：前置状态不满足
    expect(body.error.details).toEqual([{ field: 'status', code: 'INVALID_VALUE' }])

    // 整笔回滚：任务没被打回 DOING，也没留记录 / 事件
    const task = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(task.status).toBe('DONE')
    expect(await recordCount()).toBe(0)
    expect(await eventCount()).toBe(0)
  })

  it('③ 前置 DONE（已提交但未验收）：仍拒绝 —— DONE 不算 CLOSED', async () => {
    const predecessorId = await seedTask({ status: 'DONE', title: '前置任务' })
    const taskId = await seedTask({ planStart: '2026-11-20' })
    await linkFs(predecessorId, taskId)

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '未达标' })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toEqual([
      { field: 'status', code: 'INVALID_VALUE' },
    ])
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('DONE')
    expect(await recordCount()).toBe(0)
    expect(await eventCount()).toBe(0)
  })

  it('④ 前置 CLOSED 且计划开始晚于前置结束日：允许 REJECT', async () => {
    const predecessorId = await seedTask({
      status: 'CLOSED',
      title: '前置任务',
      planStart: '2026-11-01',
      planEnd: '2026-11-05',
    })
    // 严格晚于前置 planEnd（自然日次日）
    const taskId = await seedTask({ planStart: '2026-11-06' })
    await linkFs(predecessorId, taskId)

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '未达标' })
    expect(res.status).toBe(200)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('DOING')
    expect(await recordCount()).toBe(1)
    expect(await eventCount()).toBe(1)
  })

  it('⑤ 前置 CLOSED 但同日（planStart === 前置 planEnd）：拒绝，字段码 planStart', async () => {
    const predecessorId = await seedTask({
      status: 'CLOSED',
      title: '前置任务',
      planStart: '2026-11-01',
      planEnd: '2026-11-05',
    })
    const taskId = await seedTask({ planStart: '2026-11-05' })
    await linkFs(predecessorId, taskId)

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '未达标' })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toEqual([
      { field: 'planStart', code: 'INVALID_VALUE' },
    ])
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('DONE')
    expect(await recordCount()).toBe(0)
    expect(await eventCount()).toBe(0)
  })

  it('⑥ 失败响应不泄漏前置的 ID / 标题 / 日期 / 数量', async () => {
    const predecessorId = await seedTask({
      status: 'TODO',
      title: '绝密前置任务标题',
      planStart: '2026-11-01',
      planEnd: '2026-11-05',
    })
    const taskId = await seedTask({ planStart: '2026-11-20' })
    await linkFs(predecessorId, taskId)

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '未达标' })
    expect(res.status).toBe(422)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(predecessorId)
    expect(serialized).not.toContain('绝密前置任务标题')
    expect(serialized).not.toContain('2026-11-05')
    // 只有冻结的类别文案与字段码，没有逐项清单、没有条数
    expect(serialized).not.toContain('count')
    expect(serialized).not.toContain('predecessor')
    expect((res.body as ErrorBody).error.message).toBe('当前条件不允许开始执行')
  })

  it('⑦ PASS（目标 CLOSED）不触发守卫：前置未 CLOSED 也能通过', async () => {
    const predecessorId = await seedTask({ status: 'TODO', title: '前置任务' })
    const taskId = await seedTask({ planStart: '2026-11-01' })
    await linkFs(predecessorId, taskId)

    const res = await postAcceptance(taskId, { conclusion: 'PASS' })
    expect(res.status).toBe(200)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('CLOSED')
    expect(await recordCount()).toBe(1)
  })

  it('⑧ 鉴权先于守卫：非验收人 REJECT 仍是 403，不因接线改变错误顺序', async () => {
    const predecessorId = await seedTask({ status: 'TODO', title: '前置任务' })
    const taskId = await seedTask({ planStart: '2026-11-20' })
    await linkFs(predecessorId, taskId)

    // 无关成员既不是验收人、也没有 task.accept 资格 → 403（而不是守卫的 422）
    const denied = await postAcceptance(
      taskId,
      { conclusion: 'REJECT', reason: '未达标' },
      bystander.id,
    )
    expect(denied.status).toBe(403)
    expect((denied.body as ErrorBody).error.code).toBe('FORBIDDEN')

    // 项目外的人：404，不泄漏存在性
    const outsider = await makeUser('outsider@example.com', '外部用户')
    const notFoundRes = await postAcceptance(
      taskId,
      { conclusion: 'REJECT', reason: '未达标' },
      outsider.id,
    )
    expect(notFoundRes.status).toBe(404)
  })

  it('⑨ 多个前置任一未 CLOSED 即拒绝（不是「全部未关闭」才拒）', async () => {
    const closedPredecessor = await seedTask({
      status: 'CLOSED',
      title: '已完成前置',
      planStart: '2026-11-01',
      planEnd: '2026-11-03',
    })
    const openPredecessor = await seedTask({ status: 'DOING', title: '进行中前置' })
    const taskId = await seedTask({ planStart: '2026-11-20' })
    await linkFs(closedPredecessor, taskId)
    await linkFs(openPredecessor, taskId)

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '未达标' })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toEqual([
      { field: 'status', code: 'INVALID_VALUE' },
    ])
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('DONE')
  })
})
