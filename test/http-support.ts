/**
 * HTTP 层测试框架（T0 缺口修补：为契约要求的「接口层唯一 seam」提供基建）
 *
 * ===========================================================================
 * 为什么需要本文件
 * ===========================================================================
 *
 * 契约「Testing Decisions」规定：**HTTP 接口层是唯一测试 seam**，且
 * 「越权用例必须打接口，不能用『前端不渲染按钮』代替」。
 *
 * 但 T0 交付的 `buildApp()` 不接收数据库，而 `src/db/client.ts` 是绑定
 * `DATABASE_URL` 的模块级单例——因此**无法构造一个连临时库的 app**。
 * 结果：所有 HTTP 测试要么污染 dev.db，要么无法隔离。
 *
 * 本文件配合 `src/app.ts` 新增的 `prisma` 注入参数解决该问题：
 *   `buildApp({ prisma: tempDb.prisma })`
 *
 * 每个测试文件调用一次 `createHttpTestContext()`，得到：
 *   - 独立的临时 SQLite 库（已应用全部迁移，不与 dev.db 及其它测试文件互相污染）
 *   - 指向该库的 app 实例
 *   - `loginAs(userId)`：为任意用户签发令牌，**不依赖端点 1**
 *     （端点 1 `/auth/login` 属 M1 范围，尚未实现；本函数直接签发令牌，
 *      使接口测试在 M1 完成前即可编写）
 *   - `asUser(token)`：以该身份发请求
 *
 * 与 `src/db/test-support.ts` 的关系：复用其 `createTempDatabase()` /
 * `resetDatabase()`，不重复实现建库逻辑。
 * ===========================================================================
 */
import type { FastifyInstance } from 'fastify'
import request from 'supertest'
import { createRequire } from 'node:module'
import { buildApp } from '../src/app.js'
import { createTempDatabase, resetDatabase, type TestDatabase } from '../src/db/test-support.js'
import { hashToken } from '../src/auth/token.js'
import { hashPassword } from '../src/auth/password.js'

// `node:sqlite` 不在（本仓 Vite 6 的）node 内置模块名单里，静态 import 会被误解析为
// 裸模块 `sqlite`。用 createRequire 在运行时加载，绕开构建期解析。
const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')

export type HttpTestContext = {
  app: FastifyInstance
  db: TestDatabase['prisma']
  /** 清空全部表（按外键逆序），在 beforeEach 调用。 */
  reset: () => Promise<void>
  /** 为指定用户签发令牌（不经过 /auth/login，故不依赖 M1）。 */
  loginAs: (userId: string) => string
  /** 以某令牌身份发请求；传 null 表示不带 Authorization 头。 */
  asUser: (token: string | null) => {
    get: (url: string) => request.Test
    post: (url: string) => request.Test
    patch: (url: string) => request.Test
    put: (url: string) => request.Test
    delete: (url: string) => request.Test
  }
  /** 收尾：关闭 app、断开并删除临时库。 */
  dispose: () => Promise<void>
}

/** 测试用统一密码（明文）。工厂函数会用真实 scrypt 哈希写入。 */
export const TEST_PASSWORD = 'Test@12345'

/** `createHttpTestContext` 的可选注入（仅透传必要接口，避免测试全局 env 偷改）。 */
export type HttpTestContextOptions = {
  /**
   * 附件实体文件存储根。
   *
   * 传 `mkdtemp` 独占临时目录可使附件测试与真实 `var/uploads/` 隔离；
   * 不传时生产默认仍为项目根 `var/uploads/`。
   */
  uploadRoot?: string
}

export async function createHttpTestContext(
  options: HttpTestContextOptions = {},
): Promise<HttpTestContext> {
  const tempDb = createTempDatabase()

  // 关键：把临时库注入 app，使其不读 dev.db 单例
  const app = buildApp({ logger: false, prisma: tempDb.prisma, uploadRoot: options.uploadRoot })

  // 同步写会话表：契约 I-8 要求令牌「存库校验」，而 `loginAs` 必须保持同步签名
  // （200+ 调用点直接 `ctx.asUser(ctx.loginAs(x))`）。Prisma 无同步 API，故用
  // Node 内置 `node:sqlite` 的 DatabaseSync 直连同一临时库写入哈希。
  const sqlite = new DatabaseSync(tempDb.file)
  // 这条连接是 Prisma 之外的**第二条连接**。SQLite 默认 `busy_timeout = 0`，一旦 Prisma 那边
  // 恰好持有写锁（并行跑、机器被超订时很容易发生），这里会立刻抛 `database is locked`
  // —— 这正是此前在 `beforeEach` 的 `ctx.loginAs` 上偶发失败的原因。
  // 调大等待时间即可让它在锁释放后继续，而不是把测试判成失败。
  sqlite.exec('PRAGMA busy_timeout = 30000;')
  const setSession = sqlite.prepare(
    'UPDATE "User" SET "sessionTokenHash" = ?, "sessionTokenExpiresAt" = ? WHERE "id" = ?',
  )

  // 注意：此处**不调用** app.ready()。
  // Fastify 一旦 booted 就不允许再注册路由（会抛 "Root plugin has already booted"），
  // 而调用方通常需要在 ready 之前注册自己的探针端点。
  // 因此把 ready 的责任交给调用方：注册完探针后再 await app.ready()。
  // supertest 在每次请求时（而非构造时）读取地址，因此 ready 晚于本函数是安全的。

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
    // 为指定用户签发**存库**的会话令牌（不经过 /auth/login，故不依赖 M1）。
    // 确定性令牌，使同一用户的多次 loginAs 不会互相作废。
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

// ---------------------------------------------------------------------------
// 数据工厂（仅本骨架所需的最小集合）
//
// 契约「测试数据工厂」列出的 8 个函数属 T0.5 交付范围，由成员 2 / 成员 4 在
// 各自模块内使用时补齐。本文件只提供 HTTP 层测试自建数据所需的最小函数，
// **不覆盖、不替代** test/ 下可能出现的其它工厂定义。
// ---------------------------------------------------------------------------

/** 造一个用户（密码用真实 scrypt 哈希，便于将来接入端点 1 后可直接登录）。 */
export async function makeUser(
  db: HttpTestContext['db'],
  account: string,
  displayName = account,
): Promise<string> {
  const user = await db.user.create({
    data: { account, displayName, passwordHash: await hashPassword(TEST_PASSWORD) },
    select: { id: true },
  })
  return user.id
}

/** 造一个项目，并把 ownerUserId 设为该项目 PM（与端点 3 的副作用一致）。 */
export async function makeProject(
  db: HttpTestContext['db'],
  ownerUserId: string,
  name = '测试项目',
): Promise<string> {
  const project = await db.project.create({
    data: {
      name,
      ownerUserId,
      members: { create: { userId: ownerUserId, role: 'PM' } },
    },
    select: { id: true },
  })
  return project.id
}

/** 往项目里加成员并指定角色。 */
export async function makeMember(
  db: HttpTestContext['db'],
  projectId: string,
  userId: string,
  role: 'PM' | 'MEMBER' | 'VIEWER' = 'MEMBER',
): Promise<void> {
  await db.projectMember.create({ data: { projectId, userId, role } })
}
