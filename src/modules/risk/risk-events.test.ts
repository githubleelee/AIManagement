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
import { createRiskEventPort } from './event-port.js'
import { createRisk, patchRisk as patchRiskService } from './service.js'

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

/**
 * 只在**事务外**那次 `risk.findUnique` 上返回给定快照，其余调用原样透传。
 *
 * 用途：确定性地复现"请求手里握着陈旧前值"这一竞态，而不依赖真实调度的时序
 * （真实并发在 SQLite 上是串行的，撞不出来）。`$transaction` 等其余成员一律绑回
 * 真实客户端，所以**事务内**的读取仍然拿库里真实的行 —— 这正是要验证的对比点。
 */
function staleOnceClient<T>(real: T, snapshot: unknown): T {
  let served = false
  return new Proxy(real as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop === 'risk') {
        const delegate = Reflect.get(target, 'risk') as Record<string | symbol, unknown>
        return new Proxy(delegate, {
          get(delegateTarget, delegateProp) {
            if (delegateProp === 'findUnique') {
              const realFindUnique = Reflect.get(delegateTarget, 'findUnique') as (
                args: unknown,
              ) => Promise<unknown>
              return async (args: unknown) => {
                const row = await realFindUnique.call(delegateTarget, args)
                if (!served && row) {
                  served = true
                  return snapshot
                }
                return row
              }
            }
            const value = Reflect.get(delegateTarget, delegateProp)
            return typeof value === 'function'
              ? (value as (...a: unknown[]) => unknown).bind(delegateTarget)
              : value
          },
        })
      }
      const value = Reflect.get(target, prop)
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
  }) as T
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

/* ===========================================================================
 * risk.level-raised（技术负责人 GitHub #20 评论 6357849262 / 6358121473）
 * ===========================================================================
 *
 * 判据只有一条：`LOW < MEDIUM < HIGH` 的**真实上升**才发。
 * 幂等键必须按更新类（带 occurredAt），否则同一风险的第二次真实提级会被永久去重。
 */

describe('risk.level-raised（仅真实提级才发 + 更新类幂等键）', () => {
  it('中 → 高：在 risk.updated 之上**追加**一条 level-raised（不是替代）', async () => {
    const risk = await createRiskOk(pm.id, { level: 'MEDIUM' })
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)

    // ① 粗粒度的 updated 照发
    expect(await eventsByName('risk.updated')).toHaveLength(1)
    // ② 提级事件另外一条
    const raised = await eventsByName('risk.level-raised')
    expect(raised).toHaveLength(1)
    expect(raised[0]).toMatchObject({
      projectId,
      objectType: 'risk',
      objectId: risk.id,
      actorKind: 'USER',
      actorUserId: pm.id,
      sensitive: false,
      payload: {
        fromLevel: 'MEDIUM',
        toLevel: 'HIGH',
        status: 'OPEN',
        ownerUserId: member1.id,
      },
    })
    expect(raised[0]!.idempotencyKey).toBe(
      `risk.level-raised:${risk.id}:${raised[0]!.occurredAt.toISOString()}`,
    )
  })

  it('低 → 高（跨级）：同样发', async () => {
    const risk = await createRiskOk(pm.id, { level: 'LOW' })
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)

    const raised = await eventsByName('risk.level-raised')
    expect(raised).toHaveLength(1)
    expect(raised[0]!.payload).toMatchObject({ fromLevel: 'LOW', toLevel: 'HIGH' })
  })

  it('降级（高 → 低）**不发**提级事件', async () => {
    const risk = await createRiskOk(pm.id, { level: 'HIGH' })
    expect((await patchRisk(pm.id, risk.id, { level: 'LOW' })).status).toBe(200)

    expect(await eventsByName('risk.updated')).toHaveLength(1)
    expect(await eventsByName('risk.level-raised')).toHaveLength(0)
  })

  it('降一级（高 → 中）也不发', async () => {
    const risk = await createRiskOk(pm.id, { level: 'HIGH' })
    expect((await patchRisk(pm.id, risk.id, { level: 'MEDIUM' })).status).toBe(200)

    expect(await eventsByName('risk.level-raised')).toHaveLength(0)
  })

  it('同级（中 → 中）不发', async () => {
    const risk = await createRiskOk(pm.id, { level: 'MEDIUM' })
    expect((await patchRisk(pm.id, risk.id, { level: 'MEDIUM' })).status).toBe(200)

    expect(await eventsByName('risk.updated')).toHaveLength(1)
    expect(await eventsByName('risk.level-raised')).toHaveLength(0)
  })

  it('只改非等级字段（改负责人）不发提级事件', async () => {
    const risk = await createRiskOk(pm.id, { level: 'MEDIUM' })
    expect((await patchRisk(pm.id, risk.id, { ownerUserId: member2.id })).status).toBe(200)

    expect(await eventsByName('risk.level-raised')).toHaveLength(0)
  })

  it('同一风险**两次**真实提级 → 两条事件，幂等键互不相同（不会被永久去重）', async () => {
    const risk = await createRiskOk(pm.id, { level: 'LOW' })
    expect((await patchRisk(pm.id, risk.id, { level: 'MEDIUM' })).status).toBe(200)
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)

    const raised = await eventsByName('risk.level-raised')
    expect(raised).toHaveLength(2)
    expect(raised.map((event) => (event.payload as { toLevel: string }).toLevel)).toEqual([
      'MEDIUM',
      'HIGH',
    ])
    // 若按创建类 `<eventName>:<riskId>` 算，第二条会命中既有幂等记录被永久吞掉
    expect(new Set(raised.map((event) => event.idempotencyKey)).size).toBe(2)
  })

  it('同一笔 PATCH 的 updated 与 level-raised 共用同一个 occurredAt', async () => {
    const risk = await createRiskOk(pm.id, { level: 'LOW' })
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)

    const updated = (await eventsByName('risk.updated'))[0]!
    const raised = (await eventsByName('risk.level-raised'))[0]!
    expect(raised.occurredAt.toISOString()).toBe(updated.occurredAt.toISOString())
  })

  it('敏感关联任务上提级 → 提级事件也按敏感发布（载荷只有 references）', async () => {
    const taskId = await seedTask()
    await makeSensitive('task', taskId, [])

    const risk = await createRiskOk(pm.id, { level: 'LOW', taskId })
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)

    const raised = await eventsByName('risk.level-raised')
    expect(raised).toHaveLength(1)
    expect(raised[0]!.sensitive).toBe(true)
    expect(Object.keys(raised[0]!.payload as object)).toEqual(['references'])
    expect(raised[0]!.payload).toEqual({
      references: [
        { objectType: 'risk', objectId: risk.id },
        { objectType: 'task', objectId: taskId },
      ],
    })
  })

  it('提级事件载荷不含风险标题 / 描述正文', async () => {
    const title = '绝密：核心链路抖动'
    const description = '描述正文不应出现在提级事件里'
    const risk = await createRiskOk(pm.id, { title, description, level: 'LOW' })
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)

    const serialized = JSON.stringify((await eventsByName('risk.level-raised'))[0]!.payload)
    expect(serialized).not.toContain(title)
    expect(serialized).not.toContain(description)
    expect(serialized).not.toContain('title')
    expect(serialized).not.toContain('description')
  })
})

/* ===========================================================================
 * 并发与受控交错（PR #100 独立评审要求的收口）
 * ===========================================================================
 *
 * 评审指出的原始缺陷：`patchRisk` 的 `existing` 在**事务外**读取，于是
 *   ① 提级判定与 `AuditLog.before` 可能基于陈旧前值；
 *   ② 两个同目标并发 PATCH 会各发一次提级（同一次提级重复通知）。
 *
 * 现实例：初始 LOW，两个请求都读到 LOW；第一个提交 HIGH，第二个提交 MEDIUM ——
 * 第二次**实际是 HIGH → MEDIUM 的降级**，却会按旧的 LOW → MEDIUM 发 `risk.level-raised`。
 *
 * 修法：事务内现读 `before` + `where { id, updatedAt }` 的 CAS 写入（命中 0 行 → 409，
 * 不写审计、不发事件）。下面四个用例分别钉住这四件事。
 */

/** 等级序（仅用于测试断言"提级"是否名副其实）。 */
const RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

describe('提级事件的并发正确性（事务内前值 + CAS）', () => {
  it('提级 → 降级 → 再次提级：每次**合法上升**恰好一条，降级不发', async () => {
    const risk = await createRiskOk(pm.id, { level: 'LOW' })

    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200) // 升
    expect((await patchRisk(pm.id, risk.id, { level: 'LOW' })).status).toBe(200) // 降
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200) // 再升

    const raised = await eventsByName('risk.level-raised')
    expect(raised).toHaveLength(2)
    expect(raised.map((event) => {
      const payload = event.payload as { fromLevel: string; toLevel: string }
      return `${payload.fromLevel}->${payload.toLevel}`
    })).toEqual(['LOW->HIGH', 'LOW->HIGH'])
    // 降级那条 `risk.updated` 照发，但绝不带提级
    expect(await eventsByName('risk.updated')).toHaveLength(3)
  })

  it('事件的 fromLevel 与审计 before.level 同源且一致（前值不倒挂）', async () => {
    const risk = await createRiskOk(pm.id, { level: 'LOW' })
    // 先真实提级到 HIGH
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)
    // 再降一级到 MEDIUM（旧实现在这里可能按陈旧前值误判）
    expect((await patchRisk(pm.id, risk.id, { level: 'MEDIUM' })).status).toBe(200)

    // 只有第一次是提级
    const raised = await eventsByName('risk.level-raised')
    expect(raised).toHaveLength(1)
    const payload = raised[0]!.payload as { fromLevel: string; toLevel: string }
    expect(payload).toEqual(expect.objectContaining({ fromLevel: 'LOW', toLevel: 'HIGH' }))

    // 审计的 level 前后值与事件完全一致
    const audits = await ctx.db.auditLog.findMany({
      where: { projectId, objectType: 'risk', objectId: risk.id },
      orderBy: { createdAt: 'asc' },
      select: { before: true, after: true, action: true },
    })
    const levelOf = (json: string | null, key: 'level') =>
      json === null ? null : (JSON.parse(json) as Record<string, string>)[key]

    // 审计①：创建
    expect(levelOf(audits[0]!.before, 'level')).toBeNull()
    expect(levelOf(audits[0]!.after, 'level')).toBe('LOW')
    // 审计②：LOW → HIGH，与提级事件的 fromLevel / toLevel 逐字一致
    expect(levelOf(audits[1]!.before, 'level')).toBe(payload.fromLevel)
    expect(levelOf(audits[1]!.after, 'level')).toBe(payload.toLevel)
    // 审计③：HIGH → MEDIUM —— 前值必须是**真实的 HIGH**，不是陈旧的 LOW
    expect(levelOf(audits[2]!.before, 'level')).toBe('HIGH')
    expect(levelOf(audits[2]!.after, 'level')).toBe('MEDIUM')
  })

  it('并发同目标提级：只产生一条 level-raised（不会重复通知）', async () => {
    const risk = await createRiskOk(pm.id, { level: 'LOW' })

    // 必须 Promise.all：两个请求都要在对方提交之前进入事务，才可能撞上同一次提级
    const [a, b] = await Promise.all([
      patchRisk(pm.id, risk.id, { level: 'HIGH' }),
      patchRisk(pm.id, risk.id, { level: 'HIGH' }),
    ])

    // SQLite 的写是串行的，所以既可能"一个成功一个被 CAS 挡下（409）"，
    // 也可能两个都成功（后到的那个读到 HIGH → HIGH，属于无变化）。
    // 两种都合法；**唯一不合法的是同一次提级发两条通知**。
    for (const res of [a, b]) expect([200, 409]).toContain(res.status)
    expect(await eventsByName('risk.level-raised')).toHaveLength(1)
  })

  it('受控交错（确定性）：事务外前值陈旧时，判定与审计一律用事务内的真实前值', async () => {
    // 这个用例直接复现评审描述的原始缺陷场景：
    //   初始 LOW；请求 A 提交 HIGH；请求 B 手里仍是"LOW"的陈旧前值，却要写 MEDIUM ——
    //   实际是 HIGH → MEDIUM 的**降级**。
    // 旧实现（事务外读 existing）会按 LOW → MEDIUM 发出一条**假提级**。
    const risk = await createRiskOk(pm.id, { level: 'LOW' })

    // ① 快照：请求 B 在并发提交前读到的那一行（LOW）
    const snapshot = await ctx.db.risk.findUniqueOrThrow({ where: { id: risk.id } })

    // ② 请求 A 抢先提交 HIGH（真实提级，合法一条）
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)
    const raisesAfterA = (await eventsByName('risk.level-raised')).length
    expect(raisesAfterA).toBe(1)

    // ③ 请求 B 带着陈旧前值进来：只让**事务外**那次读取返回快照，
    //    事务内的读取（走 tx）仍是库里真实的 HIGH。
    const eventsPort = createRiskEventPort({ repository: new PrismaEventRepository(ctx.db) })
    const stale = staleOnceClient(ctx.db, snapshot) as unknown as Parameters<
      typeof patchRiskService
    >[0]

    const view = await patchRiskService(stale, eventsPort, pm.id, risk.id, { level: 'MEDIUM' })
    expect(view.level).toBe('MEDIUM')

    // ④ 关键：没有冒出第二条提级 —— 尤其不能有"LOW → MEDIUM"这条假提级
    expect((await eventsByName('risk.level-raised')).length).toBe(raisesAfterA)

    // ⑤ 审计的前值必须是**真实的 HIGH**，而不是事务外读到的陈旧 LOW
    const audits = await ctx.db.auditLog.findMany({
      where: { projectId, objectType: 'risk', objectId: risk.id },
      orderBy: { createdAt: 'asc' },
      select: { before: true, after: true },
    })
    expect(audits).toHaveLength(3) // create + A 的提级 + B 的降级
    const levelOf = (json: string | null) =>
      json === null ? null : (JSON.parse(json) as Record<string, string>).level
    expect(levelOf(audits[2]!.before)).toBe('HIGH')
    expect(levelOf(audits[2]!.after)).toBe('MEDIUM')

    // ⑥ 同一次降级的 `risk.updated` 载荷也应记 HIGH → MEDIUM 的事实
    const updatedEvents = await eventsByName('risk.updated')
    const lastUpdated = updatedEvents[updatedEvents.length - 1]!
    expect(lastUpdated.payload).toMatchObject({ level: 'MEDIUM' })
    expect((lastUpdated.payload as { changedFields: string[] }).changedFields).toContain('level')
  })

  it('并发混合（提级 vs 降级）：任何提级事件都必须名副其实（fromLevel 严格小于 toLevel）', async () => {
    const risk = await createRiskOk(pm.id, { level: 'LOW' })

    // 先把风险真实推到 HIGH，使"陈旧前值 LOW"成为可能的错误来源
    expect((await patchRisk(pm.id, risk.id, { level: 'HIGH' })).status).toBe(200)
    const beforeCount = (await eventsByName('risk.level-raised')).length

    // 同时发一个"降到 MEDIUM"和一个"升…已最高的 HIGH"
    await Promise.all([
      patchRisk(pm.id, risk.id, { level: 'MEDIUM' }),
      patchRisk(pm.id, risk.id, { level: 'HIGH' }),
    ])

    // 无论谁先成功，都**不允许**出现一条声称 LOW→MEDIUM 之类的假提级
    const raised = await eventsByName('risk.level-raised')
    for (const event of raised) {
      const payload = event.payload as { fromLevel: string; toLevel: string }
      expect(RANK[payload.fromLevel]).toBeLessThan(RANK[payload.toLevel]!)
    }
    // 且事件数不会因并发而虚增（最多再真实提级一次）
    expect(raised.length).toBeLessThanOrEqual(beforeCount + 1)
  })
})
