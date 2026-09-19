/**
 * 端点 11 —— `POST /projects/:projectId/goals` 接口测试（T3.1）
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体；
 *     不断言内部函数调用次数、不 mock 内部模块。
 *   - **断言契约而非实现**：断言错误码（`REQUIRED`）与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 8 条、反例 8 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目与成员，不依赖全局种子。
 *   - **越权用例必须打接口**：MEMBER / VIEWER / 非成员的拒绝全部真实发请求断言状态码。
 *
 * 关于路由挂载位置（决策 I-0）
 *   生产注册行位于 `src/routes.ts`（冻结文件），本模块只导出插件、不自挂路由。
 *   T3.1 收尾时该注册行已由技术负责人授权补上：
 *       registerRoutes(app, context) → registerRequirementRoutes(app, context)
 *   因此本测试**不再手动 register 插件**——`createHttpTestContext()` 内部的
 *   `buildApp()` 已经完成注册。手动再注册一次会触发 Fastify 的
 *   `FST_ERR_DUPLICATED_ROUTE`（已在 fastify/lib/route.js:365 核实该行为）。
 *   副作用是本测试走的是**真实生产注册路径**，而非测试自搭的旁路。
 *
 * 契约依据：决策 I-8 端点 11
 *   请求  { name: string, description?: string }
 *   响应  201 BusinessGoal
 *   错误  403 FORBIDDEN（MEMBER / VIEWER）
 *         404 NOT_FOUND（非项目成员）
 *         422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
 *   副作用 status 默认 'ACTIVE'；sortOrder = 当前项目内最大值 + 1
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { makeGoal } from './test-fixtures.js'
import { GOAL_NAME_MAX_LENGTH } from './schemas.js'

let ctx: HttpTestContext
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let projectId: string

/** 契约的 ListResponse 包装（后续端点 10 会用；此处先用于类型参考）。 */
type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_GOALS = (id: string) => `/projects/${id}/goals`

beforeAll(async () => {
  ctx = await createHttpTestContext()

  // 【重要】这里**不再**手动 register 本模块插件。
  //
  // 原因：`createHttpTestContext()` 内部调用 `buildApp({ prisma: tempDb.prisma })`，
  // 而 `buildApp` → `registerRoutes(app, context)` → `registerRequirementRoutes(app, context)`
  // 已经完成了注册（T3.1 收尾时在冻结文件 `src/routes.ts` 中接上）。
  // Fastify 对重复路由会抛 `FST_ERR_DUPLICATED_ROUTE`，再手动注册一次会让本文件全挂。
  //
  // 这个变化带来一个额外好处：测试现在走的是**真实生产注册路径**
  // （routes.ts 里那一行），而不是测试自己搭的旁路，因此能顺带验证该注册行确实生效。
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  const pmId = await makeUser(ctx.db, 't31-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't31-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't31-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't31-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.1 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例
// ===========================================================================

describe('端点 11 正例：创建业务目标', () => {
  it('PM 创建：201，返回完整 BusinessGoal，status 默认 ACTIVE', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({
      name: '提升需求可追溯性',
      description: '把需求挂到明确的业务价值之下',
    })

    expect(res.status).toBe(201)
    // 逐字段断言响应形状 —— 字段名就是其它模块依赖的东西（契约 I-2）
    expect(res.body).toEqual({
      id: expect.any(String),
      projectId,
      name: '提升需求可追溯性',
      description: '把需求挂到明确的业务价值之下',
      status: 'ACTIVE',
      sortOrder: 0,
    })
  })

  it('description 可选：不传时响应为 null（契约 I-2 类型为 string | null）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '无描述目标' })

    expect(res.status).toBe(201)
    expect(res.body.description).toBeNull()
    expect(res.body.name).toBe('无描述目标')
  })

  it('首条目标 sortOrder = 0（空集合最大值视作 -1，与端点 14 从 0 开始的下标同源）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '第一条' })

    expect(res.status).toBe(201)
    expect(res.body.sortOrder).toBe(0)
  })

  it('sortOrder = 当前项目内最大值 + 1（序号连续递增）', async () => {
    const first = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '第一条' })
    const second = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '第二条' })
    const third = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '第三条' })

    expect([first.body.sortOrder, second.body.sortOrder, third.body.sortOrder]).toEqual([0, 1, 2])
  })

  it('sortOrder 只在**本项目内**递增，不受其它项目已有目标影响', async () => {
    // 另一个项目先造 3 条目标，把「全局最大值」抬高到 2
    const otherPmId = await makeUser(ctx.db, 't31-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    await makeGoal(ctx.db, otherProjectId, '别的目标 A', { sortOrder: 0 })
    await makeGoal(ctx.db, otherProjectId, '别的目标 B', { sortOrder: 1 })
    await makeGoal(ctx.db, otherProjectId, '别的目标 C', { sortOrder: 2 })

    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '本项目第一条' })

    expect(res.status).toBe(201)
    // 若实现误取全局最大值，此处会是 3
    expect(res.body.sortOrder).toBe(0)
  })

  it('name 两端空白被 trim 后存储（避免"看起来相同"的重名）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '  有空格的目标  ' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('有空格的目标')
  })

  it('projectId 由 URL 父级推导：请求体里伪造 projectId 不被采信（决策 I-10）', async () => {
    const otherPmId = await makeUser(ctx.db, 't31-other-pm2', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')

    const res = await ctx.asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '试图跨项目', projectId: otherProjectId })

    expect(res.status).toBe(201)
    // 归属仍是 URL 里的项目，请求体里的 projectId 被忽略
    expect(res.body.projectId).toBe(projectId)
    expect(res.body.projectId).not.toBe(otherProjectId)

    // 反向核对数据库：目标确实落在 URL 的项目下
    const created = await ctx.db.businessGoal.findUnique({
      where: { id: res.body.id },
      select: { projectId: true },
    })
    expect(created?.projectId).toBe(projectId)
  })

  it('恰好取到长度上限的名称被接受（边界正例，与 TOO_LONG 反例配对）', async () => {
    const res = await ctx.asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: 'a'.repeat(GOAL_NAME_MAX_LENGTH) })

    expect(res.status).toBe(201)
    expect(res.body.name).toHaveLength(GOAL_NAME_MAX_LENGTH)
  })
})

// ===========================================================================
// 反例
// ===========================================================================

describe('端点 11 反例：权限（403 / 404）', () => {
  it('MEMBER 创建 → 403 FORBIDDEN（对象可见，但操作不允许；决策 I-5 第 5 条）', async () => {
    const res = await ctx.asUser(memberToken).post(URL_GOALS(projectId)).send({ name: '成员越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 创建 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).post(URL_GOALS(projectId)).send({ name: '管理者越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员创建 → 404 NOT_FOUND，且响应体不含目标与项目的任何字段', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_GOALS(projectId)).send({ name: '外人越权' })

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    // 契约决策 I-3：不可见时响应体不得包含对象的任何字段
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('T3.1 项目')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限与校验）', async () => {
    const res = await ctx.asUser(null).post(URL_GOALS(projectId)).send({ name: '匿名' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('projectId 不存在 → 404 NOT_FOUND（与"存在但非成员"同为 404，不泄漏项目是否存在）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS('00000000-0000-4000-8000-000000000000'))
      .send({ name: '不存在的项目' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录且 projectId 不存在 → 仍是 401（鉴权在最前，不先泄漏项目存在性）', async () => {
    const res = await ctx
      .asUser(null)
      .post(URL_GOALS('00000000-0000-4000-8000-000000000000'))
      .send({ name: 'x' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })
})

describe('端点 11 反例：字段校验（422 VALIDATION_FAILED）', () => {
  it('缺少 name → 422，details 含 name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({})

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 为空字符串 → 422，name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 为纯空白 → 422，name: REQUIRED（决策 I-4：REQUIRED 含纯空白）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '     ' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 超长 → 422，name: TOO_LONG', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: 'a'.repeat(GOAL_NAME_MAX_LENGTH + 1) })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'TOO_LONG' })
  })

  it('name 类型错误（数字）→ 422，name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 123 })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('description 类型错误（数字）→ 422，details 定位到 description', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .send({ name: '合法名称', description: 123 })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('description')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_GOALS(projectId))
      .set('content-type', 'application/json')
      .send('{"name": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })

  it('校验失败时不得产生任何写入（422 必须是"什么都没发生"）', async () => {
    const before = await ctx.db.businessGoal.count({ where: { projectId } })

    await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: '   ' })
    await ctx.asUser(pmToken).post(URL_GOALS(projectId)).send({ name: 'a'.repeat(999) })

    const after = await ctx.db.businessGoal.count({ where: { projectId } })
    expect(after).toBe(before)
  })
})
