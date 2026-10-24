/**
 * US-09 验收域**领域事件生产**（#37 接线）测试。
 *
 * 口径来源：`DECISIONS.md` `events.notification-catalog-exceptions`（冻结的九个精确
 * 事件名）与 `events.business-domain-production`（同事务 / 敏感 / 回滚规则），
 * 以及技术负责人 GitHub #20 评论 6358121473（收件人不进载荷）。
 *
 * 覆盖：
 *   - 通过 / 驳回各产出**恰好一条**事件：名字 / object / payload / actor / occurredAt；
 *   - 载荷**不含** `reason` 与收件人（自由文本与收件人都不是结构信息）；
 *   - 幂等键按更新类（带 `occurredAt`）：同一任务**第二次**同结论验收仍发得出去；
 *   - 业务失败（非 DONE → 409 / CAS 落空）→ 事件表零新增；
 *   - 发布失败 → 状态流转与验收记录同事务回滚；
 *   - 敏感任务（契约 I-6）→ 敏感事件，载荷只有 `references`，MEMBER 查不到 / PM 查得到。
 *
 * 唯一 seam 是 HTTP 接口层；只有「注入必定失败的端口」这一例直接调 service
 * （HTTP 层无法注入失败），与甘特 / 风险域的做法一致。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeSensitive,
  makeStory,
  makeUser,
} from '../../../test/factories.js'
import { PrismaEventRepository } from '../../db/event-repository.js'
import { submitAcceptance } from './service.js'

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

  const created = await makeProject(pm.id, '验收事件测试项目')
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

/** 造一个任务；默认已提交验收（`DONE`），可直接被验收。 */
async function seedTask(
  options: { status?: string; isSensitive?: boolean; title?: string } = {},
): Promise<string> {
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: options.title ?? '待验收任务',
      description: null,
      ownerUserId: owner.id,
      acceptorUserId: acceptor.id,
      planStart: '2026-11-01',
      planEnd: '2026-11-10',
      status: options.status ?? 'DONE',
      isSensitive: options.isSensitive ?? false,
    },
    select: { id: true },
  })
  return task.id
}

function postAcceptance(taskId: string, body: unknown, actorUserId: string = acceptor.id) {
  return ctx
    .asUser(ctx.loginAs(actorUserId))
    .post(`/tasks/${taskId}/acceptance`)
    .send(body as object)
}

/** 读本项目某事件名的全部事件行（按 storedAt 升序）。 */
async function eventsByName(eventName: string) {
  return ctx.db.domainEvent.findMany({
    where: { projectId, eventName },
    orderBy: { storedAt: 'asc' },
  })
}

function eventCount() {
  return ctx.db.domainEvent.count({ where: { projectId } })
}

describe('验收域领域事件（同事务追加 + 幂等键 + 敏感判定）', () => {
  it('验收通过 → 恰好一条 acceptance.approved：object / payload / actor / 时间格式', async () => {
    const taskId = await seedTask()
    const res = await postAcceptance(taskId, { conclusion: 'PASS' })
    expect(res.status).toBe(200)
    const recordId = (res.body as { record: { id: string } }).record.id

    expect(await eventCount()).toBe(1)

    const event = (await eventsByName('acceptance.approved'))[0]!
    expect(event).toMatchObject({
      schemaVersion: 1,
      projectId,
      // object 指向**任务**（验收结果是关于某个任务的），不是验收记录
      objectType: 'task',
      objectId: taskId,
      actorKind: 'USER',
      actorUserId: acceptor.id,
      sensitive: false,
      payload: {
        conclusion: 'PASS',
        statusBefore: 'DONE',
        statusAfter: 'CLOSED',
        recordId,
      },
    })
    expect(event.occurredAt.toISOString()).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(event.storedAt.toISOString()).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    // 更新类幂等键：带 occurredAt
    expect(event.idempotencyKey).toBe(
      `acceptance.approved:${taskId}:${event.occurredAt.toISOString()}`,
    )
  })

  it('验收驳回 → acceptance.rejected，statusAfter 回到 DOING', async () => {
    const taskId = await seedTask()
    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '验收标准未达成' })
    expect(res.status).toBe(200)

    const event = (await eventsByName('acceptance.rejected'))[0]!
    expect(event).toMatchObject({
      objectType: 'task',
      objectId: taskId,
      actorUserId: acceptor.id,
      sensitive: false,
      payload: {
        conclusion: 'REJECT',
        statusBefore: 'DONE',
        statusAfter: 'DOING',
      },
    })
    expect((await eventsByName('acceptance.approved'))).toHaveLength(0)
  })

  it('载荷**不含**驳回原因，也不含任何收件人字段', async () => {
    const reason = '这段驳回理由不应进入事件载荷'
    const taskId = await seedTask()
    expect((await postAcceptance(taskId, { conclusion: 'REJECT', reason })).status).toBe(200)

    const event = (await eventsByName('acceptance.rejected'))[0]!
    const serialized = JSON.stringify(event.payload)
    expect(serialized).not.toContain(reason)
    expect(serialized).not.toContain('reason')
    // 收件人由权威适配器读 Task.ownerUserId / acceptorUserId 解析，载荷里不出现
    expect(serialized).not.toContain('ownerUserId')
    expect(serialized).not.toContain('acceptorUserId')
    expect(Object.keys(event.payload as object).sort()).toEqual(
      ['conclusion', 'recordId', 'statusAfter', 'statusBefore'].sort(),
    )
  })

  it('同一任务**第二次**同结论验收仍发得出去（幂等键不是创建类）', async () => {
    const taskId = await seedTask()

    // 第一次驳回
    expect((await postAcceptance(taskId, { conclusion: 'REJECT', reason: '第一次驳回' })).status)
      .toBe(200)
    // 执行人整改后重新提交
    await ctx.db.task.update({ where: { id: taskId }, data: { status: 'DONE' } })
    // 第二次驳回
    expect((await postAcceptance(taskId, { conclusion: 'REJECT', reason: '第二次驳回' })).status)
      .toBe(200)

    const rejects = await eventsByName('acceptance.rejected')
    expect(rejects).toHaveLength(2)
    // 若幂等键按 `<eventName>:<taskId>` 计算，第二条会命中既有记录被永久去重 ——
    // 这里显式钉住两条键互不相同。
    expect(new Set(rejects.map((event) => event.idempotencyKey)).size).toBe(2)
  })

  it('业务失败（任务不是 DONE → 409）→ 事件表零新增', async () => {
    const taskId = await seedTask({ status: 'DOING' })
    const baseline = await eventCount()

    const res = await postAcceptance(taskId, { conclusion: 'PASS' })
    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('CONFLICT')

    expect(await eventCount()).toBe(baseline)
  })

  it('驳回缺原因（422）→ 事件表零新增', async () => {
    const taskId = await seedTask()
    const baseline = await eventCount()

    const res = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '   ' })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.[0]?.field).toBe('reason')

    expect(await eventCount()).toBe(baseline)
  })

  it('CAS 落空（重复验收）→ 409 且不多发事件', async () => {
    const taskId = await seedTask()
    expect((await postAcceptance(taskId, { conclusion: 'PASS' })).status).toBe(200)
    // 第二次：任务已 CLOSED，不是 DONE → 409，不产生第二条事件
    expect((await postAcceptance(taskId, { conclusion: 'PASS' })).status).toBe(409)

    expect(await eventsByName('acceptance.approved')).toHaveLength(1)
    expect(await eventCount()).toBe(1)
  })

  it('事件发布失败 → 状态流转与验收记录同事务回滚', async () => {
    const taskId = await seedTask()
    const taskRow = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    const failingEvents = {
      async publish(): Promise<void> {
        throw new Error('event-store-down')
      },
    }
    // 本用例走 PASS（目标 CLOSED），FS 守卫不应被调用；一旦被调用就说明接线错了。
    const unusedGuard = {
      async assertCanEnterDoing(): Promise<void> {
        throw new Error('PASS 不应触发 FS 守卫')
      },
    }

    await expect(
      submitAcceptance(ctx.db, failingEvents, unusedGuard, acceptor.id, taskRow, {
        conclusion: 'PASS',
      }),
    ).rejects.toThrow('event-store-down')

    // 任务仍是 DONE（状态流转回滚），且没有留下验收记录与事件
    const after = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(after.status).toBe('DONE')
    expect(await ctx.db.acceptanceRecord.count({ where: { projectId } })).toBe(0)
    expect(await eventCount()).toBe(0)
  })

  it('敏感任务 → 敏感事件（载荷只有 references）+ MEMBER 查不到 / PM 查得到', async () => {
    const taskId = await seedTask({ isSensitive: true })
    // 白名单为空 → 非 PM 不可见
    await makeSensitive('task', taskId, [])

    expect((await postAcceptance(taskId, { conclusion: 'PASS' }, pm.id)).status).toBe(200)

    const event = (await eventsByName('acceptance.approved'))[0]!
    expect(event.sensitive).toBe(true)
    expect(Object.keys(event.payload as object)).toEqual(['references'])
    expect(event.payload).toEqual({
      references: [{ objectType: 'task', objectId: taskId }],
    })

    // 真实查询层过滤：无关成员查不到，PM 查得到
    const repo = new PrismaEventRepository(ctx.db)
    const memberView = await repo.query({
      projectId,
      eventName: 'acceptance.approved',
      actorUserId: bystander.id,
    })
    expect(memberView).toHaveLength(0)
    const pmView = await repo.query({
      projectId,
      eventName: 'acceptance.approved',
      actorUserId: pm.id,
    })
    expect(pmView.map((item) => item.id)).toEqual([event.id])
  })

  it('非敏感任务事件：普通成员也能查到（查询层过滤不误伤）', async () => {
    const taskId = await seedTask()
    expect((await postAcceptance(taskId, { conclusion: 'PASS' })).status).toBe(200)

    const repo = new PrismaEventRepository(ctx.db)
    const view = await repo.query({
      projectId,
      eventName: 'acceptance.approved',
      actorUserId: bystander.id,
    })
    expect(view.map((item) => item.object.objectId)).toEqual([taskId])
  })
})
