import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import Fastify, { type FastifyInstance } from 'fastify'
import request from 'supertest'
import { registerErrorHandler } from '../../error-handler.js'
import { registerActorResolver } from '../../auth/actor.js'
import { hashToken } from '../../auth/token.js'
import { createTempDatabase, resetDatabase, type TestDatabase } from '../../db/test-support.js'
import { makeUser } from '../../../test/http-support.js'
import { InMemoryNotificationRepository } from './in-memory-repository.js'
import { registerNotificationRoutes } from './plugin.js'
import { NotificationService } from './service.js'

/**
 * 本文件用**独立 bare Fastify 实例**承载 D 的通知插件，而不是 `createHttpTestContext()`。
 *
 * 原因（B 批次的公共注册已落地）：`createHttpTestContext()` → `buildApp()` 现在会在
 * `src/routes.ts` 里注册真实的 `registerNotificationRoutes`，本文件若再注册一次同一插件
 * 会抛 `FST_ERR_DUPLICATED_ROUTE`。这是**测试装配**的调整，不改 D 的任何业务实现。
 *
 * 仍然走真实鉴权链路：临时库 + `registerActorResolver` + 真实会话令牌（与
 * `test/http-support.ts` 的 `loginAs` 同款直写 `sessionTokenHash`），**不伪造**
 * `request.actorUserId`，因此 401 覆盖保持真实。
 */
type BareNotificationContext = {
  app: FastifyInstance
  db: TestDatabase['prisma']
  reset: () => Promise<void>
  loginAs: (userId: string) => string
  asUser: (token: string | null) => {
    get: (url: string) => request.Test
    post: (url: string) => request.Test
    patch: (url: string) => request.Test
    put: (url: string) => request.Test
    delete: (url: string) => request.Test
  }
  dispose: () => Promise<void>
}

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')

async function createBareNotificationContext(): Promise<BareNotificationContext> {
  const tempDb = createTempDatabase()

  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  registerActorResolver(app, tempDb.prisma)

  const sqlite = new DatabaseSync(tempDb.file)
  const setSession = sqlite.prepare(
    'UPDATE "User" SET "sessionTokenHash" = ?, "sessionTokenExpiresAt" = ? WHERE "id" = ?',
  )

  const asUser = (token: string | null) => {
    const st = request(app.server)
    const withAuth = <T extends request.Test>(t: T): T => {
      if (token) t.set('Authorization', `Bearer ${token}`)
      return t
    }
    return {
      get: (url: string) => withAuth(st.get(url)),
      post: (url: string) => withAuth(st.post(url)),
      patch: (url: string) => withAuth(st.patch(url)),
      put: (url: string) => withAuth(st.put(url)),
      delete: (url: string) => withAuth(st.delete(url)),
    }
  }

  return {
    app,
    db: tempDb.prisma,
    reset: () => resetDatabase(tempDb.prisma),
    // 与 `test/http-support.ts` 的 `loginAs` 同款：直接影响同一临时库的会话列。
    loginAs: (userId: string) => {
      const token = `test-token-${userId}`
      setSession.run(
        hashToken(token),
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        userId,
      )
      return token
    },
    asUser,
    dispose: async () => {
      sqlite.close()
      await app.close()
      await tempDb.dispose()
    },
  }
}

let ctx: BareNotificationContext
let service: NotificationService
let repository: InMemoryNotificationRepository
let recipientUserId: string
let outsiderUserId: string
let idSequence = 0

beforeAll(async () => {
  ctx = await createBareNotificationContext()
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
