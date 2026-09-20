/**
 * T0-06 —— 骨架冒烟链路收口（「行走骨架验证通过」）
 *
 * ===========================================================================
 * 这个文件要解决的问题
 * ===========================================================================
 *
 * `docs/tickets-t5-task-management.md` §1.1 把「骨架冒烟链路收口（T0-06）」列为
 * **T5 全部工单的硬前提**，并在 §2 断言「T0 链（已完成）」；但**基线 §4.1 的 T0 表里
 * 只有 T0.1–T0.5，没有 T0-06** —— 即它是"别处定义、无人认领、无交付物"的一环。
 *
 * 缺了这一环的代价已经真实发生过：T5 把 7 个端点写在 `src/modules/task/routes.ts` 里，
 * 却**从未在 `src/routes.ts` 注册**，于是生产 app 上端点 24–30 一律 404，
 * 而 **T5 自己的 183 例测试全绿** —— 因为它的测试装置 `_test-harness.ts` **自己**
 * `app.register(taskRoutes)`，走的不是生产注册路径。
 * （该结论由 T5 表五序号 72/87 的独立审查实测确认，本人于序号 63 独立复现。）
 *
 * 因此本文件提供两层护栏，**都打在真实生产装配上**：
 *
 *   ① **路由清单断言**：`buildApp()` → `registerRoutes()` 之后，逐条用
 *      `app.hasRoute()` 检查契约里本分支应交付的端点**是否真的注册上了**。
 *      任何模块「只导出插件、忘了在 `src/routes.ts` 注册」都会在这里红。
 *
 *   ② **行走骨架 HTTP 链路**：用**真实端点**把主链路走通一遍 ——
 *      /health → 登录 → 建项目 → 建业务目标 → 建用户活动 → 建用户故事 → 读层级树 →
 *      读故事详情。它证明的不只是"某个 handler 返回 200"，而是
 *      「表结构 + 路由 + 鉴权 + 校验 + 序列化 + 凭证」整条链在同一进程里是通的。
 *
 * ===========================================================================
 * 与 `test/t0-gap-fix.test.ts` 的分工（不是重复，是互补的两半）
 * ===========================================================================
 * `t0-gap-fix.test.ts` 验证的是**框架能力**：它自行注册 `/__probe__/*` 探针，
 * 并在文件头写明理由 ——「30 个业务端点尚未实现，此处不能也不应往里加路由」。
 * 那是在 M1/M2/M4 落地**之前**写的，因此它**无法**回答"业务模块有没有接上主干"。
 *
 * 本文件验证的是**生产装配**：全部断言打在 `src/routes.ts` 注册出来的真实端点上，
 * 一条探针都没有（也正因如此，它才可能发现"模块只导出插件、忘了注册"）。
 *
 * 副作用：`t0-gap-fix.test.ts` 文件头「30 个业务端点尚未实现」这句**已经过期**
 * （现已实现 22 个）。该文件不属于本次交付范围，故只在表五记录，未改动它。
 *
 * ===========================================================================
 * 维护约定（重要）
 * ===========================================================================
 * **把任何模块接进 `src/routes.ts` 时，必须同步把它的端点加进下面的 `EXPECTED_ROUTES`。**
 * 这份清单是"当前主干应当注册的端点"的**唯一书面声明**；不加进来，护栏就形同虚设。
 * 反向亦然：若某模块被有意移除，应从清单里删掉并说明原因。
 *
 * 未列入的端点（截至本次交付）：契约端点 **23–30，共 8 条**，无一可用 ——
 *   - 端点 23 `PUT /stories/:storyId/sensitivity`（T2.3 / T2.4，属 M3）：未实现；
 *   - 端点 24–29（T5.1–T5.9，属 M5）：代码存在于 `feat/T5-*` 系列分支，
 *     **尚未合入主干，且未在 `src/routes.ts` 注册**；
 *   - 端点 30 `PUT /tasks/:taskId/sensitivity`（T5.8，属 **M5** 而非 M3）：同上。
 * M5 合并时请在本清单补上 24–30 这 7 条，并修掉 T0-06 指出的注册缺口；
 * M3 补端点 23 时同理。
 *
 * 本清单只断言**单向**「清单里的端点一个都不能少」，不断言"app 上没有多余路由"。
 * 之所以不做反向断言：Fastify 会为每条 GET 自动挂 HEAD，`printRoutes()` 的输出
 * 还带约束与嵌套前缀，按它做集合相等会随框架版本变化而脆断；而实际发生过的
 * 故障模式（M5 把插件写在模块里却没注册）恰好只需要单向断言就能拦住。
 */
import type { HTTPMethods } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, TEST_PASSWORD, type HttpTestContext } from './helpers.js'
import { makeUser } from './factories.js'

let ctx: HttpTestContext

// createTempDatabase() 会起子进程应用迁移，首轮超过 vitest 默认的 10s hook 超时
beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

/**
 * 当前主干**应当**已注册的端点（契约决策 I-8）。
 * 每一条都在下方用 `app.hasRoute()` 断言，fail 信息会直接指出是哪一条没注册上。
 */
const EXPECTED_ROUTES: ReadonlyArray<readonly [HTTPMethods, string]> = [
  // 基础设施
  ['GET', '/health'],
  // M1 身份与会话（端点 1、2）
  ['POST', '/auth/login'],
  ['GET', '/auth/me'],
  // M2 项目与成员（端点 3–9）
  ['POST', '/projects'],
  ['GET', '/projects'],
  ['GET', '/projects/:projectId'],
  ['POST', '/projects/:projectId/members'],
  ['GET', '/projects/:projectId/members'],
  ['PATCH', '/projects/:projectId/members/:userId'],
  ['DELETE', '/projects/:projectId/members/:userId'],
  // M4 需求层级（端点 10–22）
  ['GET', '/projects/:projectId/goals'],
  ['POST', '/projects/:projectId/goals'],
  ['PUT', '/projects/:projectId/goals/order'],
  ['PATCH', '/goals/:goalId'],
  ['DELETE', '/goals/:goalId'],
  ['POST', '/goals/:goalId/activities'],
  ['PUT', '/goals/:goalId/activities/order'],
  ['PATCH', '/activities/:activityId'],
  ['DELETE', '/activities/:activityId'],
  ['POST', '/activities/:activityId/stories'],
  ['GET', '/stories/:storyId'],
  ['PATCH', '/stories/:storyId'],
  ['DELETE', '/stories/:storyId'],
]

describe('T0-06 ① 路由清单：模块接进 src/routes.ts 才算真的交付', () => {
  it('契约本分支应交付的端点全部注册在真实 app 上（漏注册会在此逐条报出）', () => {
    const missing = EXPECTED_ROUTES.filter(
      ([method, url]) => !ctx.app.hasRoute({ method, url }),
    ).map(([method, url]) => `${method} ${url}`)

    // 失败时把缺的端点全部列出，而不是只报第一个 —— 便于一次修完
    expect(missing).toEqual([])
  })

  it('清单本身有 23 条（防止有人顺手删断言）', () => {
    expect(EXPECTED_ROUTES).toHaveLength(23)
  })

  it('/health 无需登录即可访问', async () => {
    const res = await ctx.asUser(null).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('未登录访问受保护端点 → 401（证明 requireAuth 真的挂上了）', async () => {
    const res = await ctx.asUser(null).get('/projects')
    expect(res.status).toBe(401)
  })
})

describe('T0-06 ② 行走骨架：表结构 + 路由 + 鉴权 + 校验 + 序列化 + 凭证，整条链走通', () => {
  it('从登录到需求层级树：一条链路端到端可用', async () => {
    // ---- 准备一个账号：用户没有注册端点，只能用数据工厂直接落库 ----
    const account = 'skeleton.smoke'
    await makeUser(account, '骨架冒烟用户')

    // ---- 端点 1：真实登录，拿真令牌（不是 issueToken 直接签）----
    const login = await ctx.asUser(null).post('/auth/login').send({
      account,
      password: TEST_PASSWORD,
    })
    expect(login.status).toBe(200)
    expect(typeof login.body.token).toBe('string')
    expect(login.body.user.account).toBe(account)
    const token = login.body.token as string

    // ---- 端点 2：令牌可用 ----
    const me = await ctx.asUser(token).get('/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.account).toBe(account)

    // ---- 端点 3：建项目（副作用：创建者成为 PM）----
    const created = await ctx.asUser(token).post('/projects').send({
      name: '骨架冒烟项目',
      description: '由 T0-06 冒烟链路创建',
    })
    expect(created.status).toBe(201)
    const projectId = created.body.id as string
    expect(typeof projectId).toBe('string')

    // ---- 端点 7：成员列表（顺带验证端点 3 的 PM 副作用生效）----
    const members = await ctx.asUser(token).get(`/projects/${projectId}/members`)
    expect(members.status).toBe(200)
    expect(members.body.items.map((m: { role: string }) => m.role)).toEqual(['PM'])

    // ---- 端点 11：建业务目标 ----
    const goal = await ctx.asUser(token).post(`/projects/${projectId}/goals`).send({
      name: '骨架冒烟目标',
      description: '端到端链路',
    })
    expect(goal.status).toBe(201)
    const goalId = goal.body.id as string

    // ---- 端点 15：建用户活动（projectId 由 goalId 推导）----
    const activity = await ctx.asUser(token).post(`/goals/${goalId}/activities`).send({
      name: '骨架冒烟活动',
    })
    expect(activity.status).toBe(201)
    const activityId = activity.body.id as string
    // 归属由父级推导，而不是请求体传入
    expect(activity.body.projectId).toBe(projectId)

    // ---- 端点 19：建用户故事（三段式分字段）----
    const story = await ctx.asUser(token).post(`/activities/${activityId}/stories`).send({
      title: '骨架冒烟故事',
      roleText: '项目经理',
      capabilityText: '把整条骨架链路走通',
      valueText: '证明主干真的可运行',
      businessValue: '高',
      priority: 'P0',
      acceptanceCriteria: '本测试通过',
    })
    expect(story.status).toBe(201)
    const storyId = story.body.id as string
    expect(story.body.status).toBe('DRAFT') // 表默认值
    expect(story.body.isSensitive).toBe(false)
    expect(story.body.projectId).toBe(projectId)

    // ---- 端点 10：读层级树，三层归属必须完整可见 ----
    const tree = await ctx.asUser(token).get(`/projects/${projectId}/goals`)
    expect(tree.status).toBe(200)
    expect(tree.body.items).toHaveLength(1)
    const goalNode = tree.body.items[0]
    expect(goalNode.name).toBe('骨架冒烟目标')
    expect(goalNode.activities).toHaveLength(1)
    const activityNode = goalNode.activities[0]
    expect(activityNode.name).toBe('骨架冒烟活动')
    expect(activityNode.stories).toHaveLength(1)
    const storyNode = activityNode.stories[0]
    expect(storyNode.title).toBe('骨架冒烟故事')
    expect(storyNode.roleText).toBe('项目经理')
    expect(storyNode.capabilityText).toBe('把整条骨架链路走通')
    expect(storyNode.valueText).toBe('证明主干真的可运行')

    // ---- 端点 20：读故事详情（与树里的同一条）----
    const detail = await ctx.asUser(token).get(`/stories/${storyId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.id).toBe(storyId)
    expect(detail.body.title).toBe('骨架冒烟故事')
  }, 30_000)

  it('链路对外部访问者封闭：非成员读该项目需求 → 404，且不泄漏对象内容', async () => {
    const owner = await makeUser('skeleton.owner', '项目所有者')
    const outsider = await makeUser('skeleton.outsider', '外部用户')

    const ownerToken = ctx.loginAs(owner.id)
    const created = await ctx.asUser(ownerToken).post('/projects').send({ name: '隔离项目' })
    expect(created.status).toBe(201)
    const projectId = created.body.id as string

    const outsiderToken = ctx.loginAs(outsider.id)
    const res = await ctx.asUser(outsiderToken).get(`/projects/${projectId}/goals`)
    // 契约 I-3：非成员与"不存在"必须完全一致，且响应体不含对象字段
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('隔离项目')
  }, 30_000)
})
