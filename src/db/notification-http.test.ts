/**
 * #34 通知三端点 HTTP 集成测试（ROLE-B）—— 真实 DB 仓储 + `buildApp` 真实路由。
 *
 * 覆盖：
 *   - 未登录 401；收件人可见；越权 / 不存在同一条 404（读取与标记已读同形）；
 *   - 三端点统一投影，**不外发** recipientUserId / dedupeKey / sourceEventId / sourceEventName /
 *     occurredAt / latencyMs / withinDeliveryTarget 等内部字段；
 *   - `latencyMs` 保留原始负值（DB 中直接断言），且不在响应里出现；
 *   - `unreadOnly` 与 `readAt` 首次写入语义；列表 sourceCapabilities 诚实降级。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  createHttpTestContext,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../test/http-support.js'
import type { NotificationRecord } from '../modules/notification/contracts.js'
import { buildDomainEventEnvelope } from '../shared/events.js'
import { PrismaEventRepository } from './event-repository.js'
import { PrismaNotificationRepository } from './notification-repository.js'

let ctx: HttpTestContext
let repository: PrismaNotificationRepository
let eventRepository: PrismaEventRepository
let recipientUserId: string
let outsiderUserId: string
let projectId: string
let notificationId: string

const INTERNAL_KEYS = [
  'recipientUserId',
  'dedupeKey',
  'sourceEventId',
  'sourceEventName',
  'occurredAt',
  'latencyMs',
  'withinDeliveryTarget',
]

beforeAll(async () => {
  ctx = await createHttpTestContext()
  repository = new PrismaNotificationRepository(ctx.db)
  eventRepository = new PrismaEventRepository(ctx.db)
  await ctx.app.ready()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  recipientUserId = await makeUser(ctx.db, 'recipient-http', '接收者')
  outsiderUserId = await makeUser(ctx.db, 'outsider-http', '外部用户')
  projectId = await makeProject(ctx.db, recipientUserId, '通知项目')

  const riskId = randomUUID()
  await ctx.db.risk.create({
    data: { id: riskId, projectId, title: '风险R', level: 'HIGH', ownerUserId: recipientUserId },
  })
  const event = await eventRepository.appendIfAbsent(
    buildDomainEventEnvelope(
      {
        eventName: 'risk.created',
        projectId,
        object: { objectType: 'risk', objectId: riskId },
        actor: { kind: 'SYSTEM', component: 'test' },
        occurredAt: '2026-10-23T10:00:00.000Z',
        idempotencyKey: `risk.created:${riskId}`,
        sensitive: false,
        payload: {},
      },
      { id: randomUUID(), storedAt: new Date().toISOString() },
    ),
  )

  const record: NotificationRecord = {
    id: randomUUID(),
    projectId,
    recipientUserId,
    type: 'RISK_ALERT',
    sourceEventId: event.event.id,
    sourceEventName: 'risk.created',
    dedupeKey: `dedupe:${event.event.id}:${recipientUserId}`,
    reference: { objectType: 'risk', objectId: riskId },
    content: { kind: 'TEXT', title: '新增风险', summary: '风险R' },
    sensitive: false,
    occurredAt: '2026-10-23T10:00:00.000Z',
    storedAt: new Date(Date.now() - 5_000).toISOString(),
    latencyMs: -5_000,
    withinDeliveryTarget: false,
    isRead: false,
    readAt: null,
  }
  notificationId = (await repository.appendIfAbsent(record)).record.id
})

function assertNoInternalFields(value: unknown): void {
  const json = JSON.stringify(value)
  for (const key of INTERNAL_KEYS) {
    expect(json).not.toContain(`"${key}"`)
  }
}

describe('#34 通知 HTTP 端点', () => {
  it('未登录访问列表 / 详情 / 已读均返回 401', async () => {
    expect((await ctx.asUser(null).get('/me/notifications')).status).toBe(401)
    expect((await ctx.asUser(null).get(`/notifications/${notificationId}`)).status).toBe(401)
    expect((await ctx.asUser(null).patch(`/notifications/${notificationId}/read`).send({})).status).toBe(401)
  })

  it('收件人可列出并读取，响应不外发内部字段', async () => {
    const token = ctx.loginAs(recipientUserId)
    const list = await ctx.asUser(token).get('/me/notifications')
    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({ state: 'AVAILABLE', total: 1, unreadCount: 1, limit: 200 })
    assertNoInternalFields(list.body)
    assertNoInternalFields(list.body.items)

    const detail = await ctx.asUser(token).get(`/notifications/${notificationId}`)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({ id: notificationId, isRead: false, sensitive: false })
    assertNoInternalFields(detail.body)
  })

  it('标记已读保留首次 readAt，unreadOnly 过滤生效', async () => {
    const token = ctx.loginAs(recipientUserId)
    const first = await ctx.asUser(token).patch(`/notifications/${notificationId}/read`).send({})
    expect(first.status).toBe(200)
    expect(first.body.isRead).toBe(true)
    const firstReadAt = first.body.readAt as string
    const replay = await ctx.asUser(token).patch(`/notifications/${notificationId}/read`).send({})
    expect(replay.body.readAt).toBe(firstReadAt)

    const unread = await ctx.asUser(token).get('/me/notifications?unreadOnly=true')
    expect(unread.body.total).toBe(0)
    assertNoInternalFields(unread.body)
  })

  it('越权与不存在读取 / 已读返回同一条 404', async () => {
    const outsider = ctx.loginAs(outsiderUserId)
    const unauthorizedRead = await ctx.asUser(outsider).get(`/notifications/${notificationId}`)
    const unauthorizedWrite = await ctx.asUser(outsider).patch(`/notifications/${notificationId}/read`).send({})
    const missingRead = await ctx.asUser(outsider).get('/notifications/does-not-exist')
    const recipientMissing = await ctx.asUser(ctx.loginAs(recipientUserId)).get('/notifications/does-not-exist')

    expect(unauthorizedRead.status).toBe(404)
    expect(unauthorizedWrite.status).toBe(404)
    expect(missingRead.status).toBe(404)
    expect(recipientMissing.status).toBe(404)
    expect(unauthorizedRead.body).toEqual(unauthorizedWrite.body)
    expect(unauthorizedRead.body).toEqual(missingRead.body)
    expect(unauthorizedRead.body).toEqual(recipientMissing.body)
  })

  it('非法 unreadOnly 返回 422', async () => {
    const res = await ctx.asUser(ctx.loginAs(recipientUserId)).get('/me/notifications?unreadOnly=yes')
    expect(res.status).toBe(422)
  })

  it('latencyMs 负值原样落库（不在响应投影内）', async () => {
    const row = await ctx.db.notification.findUniqueOrThrow({ where: { id: notificationId } })
    expect(row.latencyMs).toBe(-5_000)
    expect(row.withinDeliveryTarget).toBe(false)
    const detail = await ctx.asUser(ctx.loginAs(recipientUserId)).get(`/notifications/${notificationId}`)
    assertNoInternalFields(detail.body)
  })

  it('列表 sourceCapabilities 诚实：已接来源 AVAILABLE，未接与未启动调度如实 UNAVAILABLE', async () => {
    const list = await ctx.asUser(ctx.loginAs(recipientUserId)).get('/me/notifications')
    const capabilities = list.body.sourceCapabilities as Array<{ eventName: string; state: string }>
    expect(capabilities).toHaveLength(9)
    const stateOf = (name: string) => capabilities.find((cap) => cap.eventName === name)?.state
    // 真实生产方已在（A 的风险/验收域），核心事实不因测试环境降级。
    for (const name of ['risk.created', 'risk.level-raised', 'acceptance.approved', 'acceptance.rejected']) {
      expect(stateOf(name)).toBe('AVAILABLE')
    }
    // 测试环境（NODE_ENV === 'test'）不自动启调度：B 自产的两类如实降级。
    expect(stateOf('task.overdue')).toBe('UNAVAILABLE')
    expect(stateOf('milestone.due')).toBe('UNAVAILABLE')
    // 未接来源不伪造可用。
    for (const name of ['task.assigned', 'task.mentioned', 'acceptance.submitted']) {
      expect(stateOf(name)).toBe('UNAVAILABLE')
    }
  })

})
