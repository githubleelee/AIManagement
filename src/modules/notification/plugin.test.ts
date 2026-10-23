import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { InMemoryNotificationRepository } from './in-memory-repository.js'
import { registerNotificationRoutes } from './plugin.js'
import { NotificationService } from './service.js'

let ctx: HttpTestContext
let service: NotificationService
let repository: InMemoryNotificationRepository
let recipientUserId: string
let outsiderUserId: string
let idSequence = 0

beforeAll(async () => {
  ctx = await createHttpTestContext()
  repository = new InMemoryNotificationRepository()
  service = new NotificationService({
    repository,
    recipientResolver: {
      resolve: async () => ({
        state: 'AVAILABLE',
        recipients: [
          {
            userId: recipientUserId,
            content: { kind: 'TEXT', title: '新任务', summary: null },
          },
        ],
      }),
    },
    sourceState: () => ({ state: 'AVAILABLE', note: null, sourceCapabilities: [] }),
    now: () => new Date('2026-10-21T10:00:30.000Z'),
    createId: () => `http-notification-${++idSequence}`,
  })
  registerNotificationRoutes(ctx.app, service)
  await ctx.app.ready()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  recipientUserId = await makeUser(ctx.db, 'recipient', '接收者')
  outsiderUserId = await makeUser(ctx.db, 'outsider-notification', '外部用户')
})

async function seedNotification(): Promise<string> {
  const result = await service.consume({
    id: `http-event-${idSequence + 1}`,
    eventName: 'task.assigned',
    projectId: 'project-1',
    object: { objectType: 'task', objectId: 'task-1' },
    occurredAt: '2026-10-21T10:00:00.000Z',
    sensitive: false,
    payload: {},
  })
  if (result.state !== 'DELIVERED') throw new Error('测试通知未生成')
  return result.notifications[0]!.id
}

describe('US-14 通知 HTTP 端点', () => {
  it('未登录访问列表返回 401', async () => {
    const response = await ctx.asUser(null).get('/me/notifications')
    expect(response.status).toBe(401)
  })

  it('接收者可以列出自己的通知', async () => {
    await seedNotification()
    const response = await ctx
      .asUser(ctx.loginAs(recipientUserId))
      .get('/me/notifications')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ state: 'AVAILABLE', total: 1, unreadCount: 1 })
  })

  it('接收者可标记已读并用 unreadOnly 过滤', async () => {
    const id = await seedNotification()
    const marked = await ctx
      .asUser(ctx.loginAs(recipientUserId))
      .patch(`/notifications/${id}/read`)
      .send({})
    expect(marked.status).toBe(200)
    expect(marked.body.isRead).toBe(true)

    const unread = await ctx
      .asUser(ctx.loginAs(recipientUserId))
      .get('/me/notifications?unreadOnly=true')
    expect(unread.status).toBe(200)
    expect(unread.body.total).toBe(0)
  })

  it('非接收者读取和标记已读均返回相同 404', async () => {
    const id = await seedNotification()
    const token = ctx.loginAs(outsiderUserId)
    const read = await ctx.asUser(token).get(`/notifications/${id}`)
    const write = await ctx.asUser(token).patch(`/notifications/${id}/read`).send({})
    expect(read.status).toBe(404)
    expect(write.status).toBe(404)
    expect(read.body).toEqual(write.body)
  })

  it('非法 unreadOnly 返回 422', async () => {
    const response = await ctx
      .asUser(ctx.loginAs(recipientUserId))
      .get('/me/notifications?unreadOnly=yes')
    expect(response.status).toBe(422)
  })
})
