/**
 * US-10 风险域**领域事件生产**（#37 公共事件基础设施接线）测试。
 *
 * 授权与口径来源：GitHub #20 评论 `role-b-risk-event-production-request` /
 * `role-b-risk-event-request-refresh`（技术负责人给出的七条统一口径）。
 *
 * 覆盖：
 *   - 创建 / 修改各产出**恰好一条**事件：事件名 / object / payload / actor / occurredAt；
 *   - 确定性幂等键：创建 `<name>:<riskId>`、更新 `<name>:<riskId>:<occurredAt ISO>`；
 *   - 「已解决 / 已关闭」是**状态流转**（`risk.updated`），不是删除；
 *   - 业务校验失败 → 事件表零新增（同一事务，不产生孤事件）；
 *   - 发布失败 → 业务写入同事务回滚（不产生「业务成功但事件丢失」）；
 *   - 敏感规则（契约 I-6）：关联敏感任务 → 敏感事件，载荷**只有** `references`，
 *     MEMBER 查不到 / PM 查得到；改绑前后任一任务敏感即按敏感处理；
 *   - 非敏感事件：MEMBER 也能查到（查询层过滤不误伤）。
 *
 * 唯一 seam 是 HTTP 接口层；只有「注入必定失败的端口」这一例直接调 service
 * （HTTP 层无法注入失败），与甘特域 `gantt-write.test.ts` 的做法一致。
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
import { createRisk } from './service.js'

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

let ctx: HttpTestContext
let pm: { id: string }
let member1: { id: string }
let member2: { id: string }
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

  const created = await makeProject(pm.id, '风险事件测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '管风险',
    valueText: '可控交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, member1.id, 'MEMBER')
  await makeMember(projectId, member2.id, 'MEMBER')
})

async function seedTask(options: { isSensitive?: boolean } = {}): Promise<string> {
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: '任务',
      description: null,
      ownerUserId: member1.id,
      acceptorUserId: member2.id,
      planStart: '2026-11-01',
      planEnd: '2026-11-10',
      status: 'TODO',
      isSensitive: options.isSensitive ?? false,
    },
    select: { id: true },
  })
  return task.id
}

function postRisk(actorUserId: string, body: Record<string, unknown>) {
  return ctx.asUser(ctx.loginAs(actorUserId)).post(`/projects/${projectId}/risks`).send(body)
}

function patchRisk(actorUserId: string, riskId: string, body: Record<string, unknown>) {
  return ctx.asUser(ctx.loginAs(actorUserId)).patch(`/risks/${riskId}`).send(body)
}

/** 建一条风险并返回它的视图（断言创建成功，避免后续用例在 null 上打转）。 */
async function createRiskOk(actorUserId: string, body: Record<string, unknown>) {
  const res = await postRisk(actorUserId, {
    title: '风险',
    level: 'MEDIUM',
    ownerUserId: member1.id,
    ...body,
  })
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

/** 读本项目某事件名的全部事件行（按 storedAt 升序）。 */
async function eventsByName(eventName: string) {
  return ctx.db.domainEvent.findMany({
    where: { projectId, eventName },
    orderBy: { storedAt: 'asc' },
  })
}

/** 本项目事件总数。 */
function eventCount() {
  return ctx.db.domainEvent.count({ where: { projectId } })
}

describe('风险域领域事件（同事务追加 + 幂等键 + 敏感判定）', () => {
  it('创建风险 → 恰好一条 risk.created：object / payload / actor / 时间格式', async () => {
    const risk = await createRiskOk(pm.id, { title: '核心服务不稳定', level: 'HIGH' })

    expect(await eventCount()).toBe(1)

    const created = (await eventsByName('risk.created'))[0]!
    expect(created).toMatchObject({
      schemaVersion: 1,
      projectId,
      objectType: 'risk',
      objectId: risk.id,
      actorKind: 'USER',
      actorUserId: pm.id,
      sensitive: false,
      payload: {
        status: 'OPEN',
        level: 'HIGH',
        ownerUserId: member1.id,
        taskId: null,
      },
      // 创建类事件的幂等键确定性且不带 occurredAt
      idempotencyKey: `risk.created:${risk.id}`,
    })
    // ISO 8601 UTC 带毫秒
    expect(created.occurredAt.toISOString()).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(created.storedAt.toISOString()).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    // 创建事件不带 changedFields
    expect(Object.keys(created.payload as object).sort()).toEqual(
      ['level', 'ownerUserId', 'status', 'taskId'].sort(),
    )
  })

  it('事件载荷**不含**风险标题 / 描述正文（只放结构与标识）', async () => {
    const title = '绝密：数据库主从延迟超标'
    const description = '这条描述正文不应出现在事件载荷里'
    await createRiskOk(pm.id, { title, description })

    const created = (await eventsByName('risk.created'))[0]!
    const serialized = JSON.stringify(created.payload)
    expect(serialized).not.toContain(title)
    expect(serialized).not.toContain(description)
    expect(serialized).not.toContain('title')
    expect(serialized).not.toContain('description')
  })

  it('「已解决」是状态流转 → 落在 risk.updated（带 status 与 changedFields），不是删除', async () => {
    const risk = await createRiskOk(pm.id, {})

    const res = await patchRisk(pm.id, risk.id, { status: 'RESOLVED', resolution: '已切换备用链路' })
    expect(res.status).toBe(200)

    // 全程只有 create + update 两条，不存在任何 deleted 类事件
    const all = await ctx.db.domainEvent.findMany({ where: { projectId } })
    expect(all).toHaveLength(2)
    expect(all.map((event) => event.eventName).sort()).toEqual(['risk.created', 'risk.updated'])

    const updated = (await eventsByName('risk.updated'))[0]!
    expect(updated).toMatchObject({
      objectType: 'risk',
      objectId: risk.id,
      sensitive: false,
      payload: {
        status: 'RESOLVED',
        level: 'MEDIUM',
        ownerUserId: member1.id,
        taskId: null,
      },
    })
    const payload = updated.payload as { changedFields: string[] }
    expect(payload.changedFields).toEqual(expect.arrayContaining(['status', 'resolution']))
    // 解决说明正文同样是受保护内容，不进载荷
    expect(JSON.stringify(updated.payload)).not.toContain('已切换备用链路')
  })

  it('更新类事件幂等键确定性携带 occurredAt', async () => {
    const risk = await createRiskOk(pm.id, {})
    expect((await patchRisk(pm.id, risk.id, { level: 'LOW' })).status).toBe(200)

    const updated = (await eventsByName('risk.updated'))[0]!
    expect(updated.idempotencyKey).toBe(
      `risk.updated:${risk.id}:${updated.occurredAt.toISOString()}`,
    )
  })

  it('两次独立修改 → 两条 risk.updated（幂等键互不相同）', async () => {
    const risk = await createRiskOk(pm.id, {})
    expect((await patchRisk(pm.id, risk.id, { level: 'LOW' })).status).toBe(200)
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)

    const updated = await eventsByName('risk.updated')
    expect(updated).toHaveLength(2)
    expect(new Set(updated.map((event) => event.idempotencyKey)).size).toBe(2)
  })

  it('业务校验失败（422）→ 事件表零新增', async () => {
    const baseline = await eventCount()

    // 创建时状态只能是 OPEN
    const badCreate = await postRisk(pm.id, {
      title: '风险',
      level: 'MEDIUM',
      ownerUserId: member1.id,
      status: 'CLOSED',
    })
    expect(badCreate.status).toBe(422)
    expect((badCreate.body as ErrorBody).error.details?.[0]?.field).toBe('status')

    expect(await eventCount()).toBe(baseline)
  })

  it('事件发布失败 → 业务写入同事务回滚（HTTP 层无法注入失败，故直接调 service）', async () => {
    const failingEvents = {
      async publish(): Promise<void> {
        throw new Error('event-store-down')
      },
    }

    await expect(
      createRisk(ctx.db, failingEvents, pm.id, projectId, {
        title: '回滚风险',
        level: 'MEDIUM',
        ownerUserId: member1.id,
      }),
    ).rejects.toThrow('event-store-down')

    // 风险行与审计行都随事务回滚
    expect(await ctx.db.risk.count({ where: { projectId } })).toBe(0)
    expect(await ctx.db.auditLog.count({ where: { projectId } })).toBe(0)
    expect(await eventCount()).toBe(0)
  })

  it('关联**敏感任务** → 敏感事件（载荷只有 references）+ MEMBER 查不到 / PM 查得到', async () => {
    const taskId = await seedTask()
    // 标记任务敏感，白名单为空 → MEMBER 不可见（仅 PM 全量可见）
    await makeSensitive('task', taskId, [])

    const risk = await createRiskOk(pm.id, { taskId })

    const event = (await eventsByName('risk.created'))[0]!
    expect(event.objectId).toBe(risk.id)
    expect(event.sensitive).toBe(true)
    expect(Object.keys(event.payload as object)).toEqual(['references'])
    expect(event.payload).toEqual({
      references: [
        { objectType: 'risk', objectId: risk.id },
        { objectType: 'task', objectId: taskId },
      ],
    })

    // 真实查询层过滤：MEMBER 查不到，PM 查得到
    const repo = new PrismaEventRepository(ctx.db)
    const memberView = await repo.query({
      projectId,
      eventName: 'risk.created',
      actorUserId: member1.id,
    })
    expect(memberView).toHaveLength(0)
    const pmView = await repo.query({
      projectId,
      eventName: 'risk.created',
      actorUserId: pm.id,
    })
    expect(pmView.map((event) => event.id)).toEqual([event.id])
  })

  it('改绑到敏感任务 → 更新事件按敏感处理（覆盖改绑前后两个任务）', async () => {
    const plainTask = await seedTask()
    const sensitiveTask = await seedTask()
    await makeSensitive('task', sensitiveTask, [])

    const risk = await createRiskOk(pm.id, { taskId: plainTask })
    // 建时关联的是非敏感任务 → 创建事件非敏感
    expect((await eventsByName('risk.created'))[0]!.sensitive).toBe(false)

    expect((await patchRisk(pm.id, risk.id, { taskId: sensitiveTask })).status).toBe(200)

    const updated = (await eventsByName('risk.updated'))[0]!
    expect(updated.sensitive).toBe(true)
    expect(Object.keys(updated.payload as object)).toEqual(['references'])
    // 前后两个任务都在引用里：旧关联同样属于受保护内容
    expect(updated.payload).toEqual({
      references: [
        { objectType: 'risk', objectId: risk.id },
        { objectType: 'task', objectId: plainTask },
        { objectType: 'task', objectId: sensitiveTask },
      ],
    })
  })

  it('非敏感风险事件：MEMBER 也能查到（查询层过滤不误伤）', async () => {
    const risk = await createRiskOk(member1.id, {})

    const repo = new PrismaEventRepository(ctx.db)
    const memberView = await repo.query({
      projectId,
      eventName: 'risk.created',
      actorUserId: member1.id,
    })
    expect(memberView.map((event) => event.object.objectId)).toEqual([risk.id])
  })
})
