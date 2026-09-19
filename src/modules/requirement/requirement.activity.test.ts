/**
 * 端点 15 —— `POST /goals/:goalId/activities` 接口测试（T3.4）
 *
 * 为什么另建文件而不是追加到 `requirement.test.ts`
 *   后者是 T3.1 的交付物、头部明确写着「端点 11」，且已被代码审查智能体只读审查过。
 *   按红线「不得修改已有测试文件」的精神，新端点的用例放新文件，两者的边界清晰：
 *   `requirement.test.ts` = 端点 11，本文件 = 端点 15，
 *   `requirement.adversarial.test.ts` = 检测智能体的独立对抗护栏（不可改）。
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体；
 *     不断言内部函数调用次数、不 mock 内部模块。
 *   - **断言契约而非实现**：断言错误码（`REQUIRED` / `TOO_LONG`）与字段名，
 *     **不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 13 条、反例 21 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员与目标，不依赖全局种子。
 *   - **越权用例必须打接口**：MEMBER / VIEWER / 非成员 / 未登录的拒绝全部真实发请求断言状态码。
 *
 * 关于路由挂载位置（决策 I-0）
 *   生产注册行位于冻结文件 `src/routes.ts`，本模块只导出插件、不自挂路由。
 *   测试**不手动 register 插件**：`createHttpTestContext()` 内部的 `buildApp()` →
 *   `registerRoutes()` → `registerRequirementRoutes()` 已完成注册；再注册一次会抛
 *   Fastify 的 `FST_ERR_DUPLICATED_ROUTE`，全套件挂掉（T3.1 的坑 2）。
 *   因此本测试走的是**真实生产注册路径**。
 *
 * 契约依据：决策 I-8 端点 15
 *   请求  { name: string, description?: string }
 *   响应  201 UserActivity
 *   错误  403 FORBIDDEN（MEMBER / VIEWER）
 *         404 NOT_FOUND（非项目成员）
 *         422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）
 *   副作用 projectId 取自 goalId 所属目标（不接受请求体传入，防止 CROSS_PROJECT_REF）
 *         status 默认 'ACTIVE'；sortOrder = 该目标下最大值 + 1
 *   基线 AC-US-03-02：必须在某业务目标下创建；不允许无归属的用户活动。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { makeActivity, makeGoal } from './test-fixtures.js'
import { ACTIVITY_NAME_MAX_LENGTH } from './schemas.js'

let ctx: HttpTestContext
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let projectId: string
let goalId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_ACTIVITIES = (id: string) => `/goals/${id}/activities`

/** 一个必然不存在的 uuid，用于「目标不存在」路径。 */
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

beforeAll(async () => {
  ctx = await createHttpTestContext()

  // 【重要】这里**不**手动 register 本模块插件。
  // `buildApp()` → `registerRoutes()` 已通过冻结文件 `src/routes.ts` 的注册行
  // 完成注册；重复注册会抛 FST_ERR_DUPLICATED_ROUTE，让本文件全挂。
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  const pmId = await makeUser(ctx.db, 't34-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't34-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't34-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't34-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.4 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  // 端点的 URL 父级：一个真实的业务目标（AC-US-03-02 的「必须有归属」）
  goalId = await makeGoal(ctx.db, projectId, 'T3.4 目标')

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例
// ===========================================================================

describe('端点 15 正例：创建用户活动', () => {
  it('PM 创建：201，返回完整 UserActivity，status 默认 ACTIVE，首条 sortOrder = 0', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({
      name: '梳理目标下的关键行为',
      description: '把目标拆解为用户活动',
    })

    expect(res.status).toBe(201)
    // 逐字段断言响应形状 —— 字段名就是其它模块依赖的东西（契约 I-2）
    expect(res.body).toEqual({
      id: expect.any(String),
      projectId,
      goalId,
      name: '梳理目标下的关键行为',
      description: '把目标拆解为用户活动',
      status: 'ACTIVE',
      sortOrder: 0,
    })
  })

  it('响应键集合精确等于 UserActivity 的 7 个字段（多给 createdAt 也是契约违规）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '键集合' })

    expect(res.status).toBe(201)
    // 契约 I-2 的 UserActivity 没有 createdAt（与 UserStory / Task 不同），不得多给
    expect(Object.keys(res.body).sort()).toEqual([
      'description',
      'goalId',
      'id',
      'name',
      'projectId',
      'sortOrder',
      'status',
    ])
  })

  it('字段类型逐个断言：id/projectId/goalId/name 为 string，description 为 string|null，sortOrder 为整数', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '类型' })

    expect(typeof res.body.id).toBe('string')
    expect(typeof res.body.projectId).toBe('string')
    expect(typeof res.body.goalId).toBe('string')
    expect(typeof res.body.name).toBe('string')
    expect(res.body.description === null || typeof res.body.description === 'string').toBe(true)
    expect(typeof res.body.status).toBe('string')
    expect(Number.isInteger(res.body.sortOrder)).toBe(true)
  })

  it('description 缺省时必须为 null 而非 undefined（JSON 序列化后键必须存在）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '无描述活动' })

    expect(res.status).toBe(201)
    expect(res.body.description).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(res.body, 'description')).toBe(true)
  })

  it('新目标下首条活动的 sortOrder = 0（空集合最大值视作 -1，与端点 18 从 0 开始的下标同源）', async () => {
    const freshGoalId = await makeGoal(ctx.db, projectId, '另一个空目标')

    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(freshGoalId)).send({ name: '第一条' })

    expect(res.status).toBe(201)
    expect(res.body.sortOrder).toBe(0)
    expect(res.body.goalId).toBe(freshGoalId)
  })

  it('连续创建 3 条 → sortOrder 为 [0,1,2]（序号连续递增）', async () => {
    const first = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '第一条' })
    const second = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '第二条' })
    const third = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '第三条' })

    expect([first.body.sortOrder, second.body.sortOrder, third.body.sortOrder]).toEqual([0, 1, 2])
  })

  it('sortOrder 只在**该目标内**递增：同项目其它目标、其它项目的活动都不影响', async () => {
    // 同一项目下的兄弟目标，先造 3 条活动把它自己的「目标内最大值」抬到 2
    const siblingGoalId = await makeGoal(ctx.db, projectId, '同项目的兄弟目标')
    await makeActivity(ctx.db, projectId, siblingGoalId, '兄弟目标活动 A', { sortOrder: 0 })
    await makeActivity(ctx.db, projectId, siblingGoalId, '兄弟目标活动 B', { sortOrder: 1 })
    await makeActivity(ctx.db, projectId, siblingGoalId, '兄弟目标活动 C', { sortOrder: 2 })

    // 另一个项目：把「全局最大值」抬得更高
    const otherPmId = await makeUser(ctx.db, 't34-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 A', { sortOrder: 0 })
    await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 B', { sortOrder: 1 })
    await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 C', { sortOrder: 2 })
    await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 D', { sortOrder: 3 })
    await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 E', { sortOrder: 4 })

    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '本目标第一条' })

    expect(res.status).toBe(201)
    // 若实现误取「项目内最大值」此处会是 3，误取「全局最大值」此处会是 5
    expect(res.body.sortOrder).toBe(0)
  })

  it('name 两端空白被 trim 后存储（避免"看起来相同"的重名）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '  有空格的活动  ' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('有空格的活动')
  })

  it('name 被换行符包裹 → 201，且换行被 trim 掉（不会写入孤立换行）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '\n 换行活动 \n' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('换行活动')
  })

  it('projectId 只由 goalId 所属目标推导：请求体注入 projectId/goalId/status/sortOrder 全部被丢弃', async () => {
    const otherPmId = await makeUser(ctx.db, 't34-other-pm2', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')

    const res = await ctx
      .asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .send({
        name: '试图跨项目',
        projectId: otherProjectId,
        goalId: otherGoalId,
        status: 'DONE',
        sortOrder: 999,
      })

    expect(res.status).toBe(201)
    // 归属以 URL 父级为准（决策 I-10：子对象 projectId 一律从父对象推导）
    expect(res.body.projectId).toBe(projectId)
    expect(res.body.goalId).toBe(goalId)
    // status 与 sortOrder 是服务端决定的值，同样不接受请求体传入
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.sortOrder).toBe(0)

    // 反向核对数据库：确实落在 URL 目标所属项目下，且未污染另一个项目
    const created = await ctx.db.userActivity.findUnique({
      where: { id: res.body.id },
      select: { projectId: true, goalId: true, status: true, sortOrder: true },
    })
    expect(created).toEqual({ projectId, goalId, status: 'ACTIVE', sortOrder: 0 })
    expect(await ctx.db.userActivity.count({ where: { goalId: otherGoalId } })).toBe(0)
    expect(await ctx.db.userActivity.count({ where: { projectId: otherProjectId } })).toBe(0)
  })

  it('恰好取到长度上限（50）的名称被接受（边界正例，与 TOO_LONG 反例配对）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .send({ name: 'a'.repeat(ACTIVITY_NAME_MAX_LENGTH) })

    expect(res.status).toBe(201)
    expect(res.body.name).toHaveLength(ACTIVITY_NAME_MAX_LENGTH)
  })

  // -------------------------------------------------------------------------
  // 并发不变量（T3.1 的 B1 缺陷同型，本任务主动带上，不等检测智能体再抓）
  // -------------------------------------------------------------------------

  it('并发创建 5 条 → sortOrder 必须是 0..4 且互不重复（读-改-写竞态的回归护栏）', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: `并发活动 ${i}` }),
      ),
    )

    for (const res of results) {
      expect(res.status).toBe(201)
    }

    // 「该目标下最大值 + 1」在同一事务内完成时，第 N 个事务能读到前 N-1 个已提交值，
    // 因此序号集合必须是严格连续的 0..4。竞态未修时的形态是 [0,0,1,1,1]。
    const orders = results.map((res) => res.body.sortOrder as number).sort((a, b) => a - b)
    expect(orders).toEqual([0, 1, 2, 3, 4])
  })

  it('并发落库的序号与响应一致，且数据库中无重复（竞态的最强证据）', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: `并发落库 ${i}` }),
      ),
    )

    const rows = await ctx.db.userActivity.findMany({
      where: { goalId },
      select: { id: true, sortOrder: true },
    })

    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.sortOrder).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])

    const byId = new Map(rows.map((row) => [row.id, row.sortOrder]))
    for (const res of results) {
      expect(byId.get(res.body.id as string)).toBe(res.body.sortOrder)
    }
  })
})

// ===========================================================================
// 反例：权限（401 / 403 / 404）
// ===========================================================================

describe('端点 15 反例：权限（401 / 403 / 404）', () => {
  it('MEMBER 创建 → 403 FORBIDDEN（对象可见，但写类动作不允许；决策 I-5 第 5 条）', async () => {
    const res = await ctx.asUser(memberToken).post(URL_ACTIVITIES(goalId)).send({ name: '成员越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 创建 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).post(URL_ACTIVITIES(goalId)).send({ name: '管理者越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员创建 → 404 NOT_FOUND，且响应体不含目标与项目的任何字段', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_ACTIVITIES(goalId)).send({ name: '外人越权' })

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    // 契约决策 I-3：不可见时响应体不得包含对象的任何字段
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('T3.4 目标')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限与校验）', async () => {
    const res = await ctx.asUser(null).post(URL_ACTIVITIES(goalId)).send({ name: '匿名' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED（凭证是不透明串，验不过即未登录）', async () => {
    const res = await ctx.asUser('not-a-real-token').post(URL_ACTIVITIES(goalId)).send({ name: '假令牌' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('goalId 不存在 → 404 NOT_FOUND（与「存在但非成员」同为 404，不泄漏目标是否存在）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(MISSING_ID)).send({ name: '不存在的目标' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('goalId 属于另一个项目的目标 → 404，且不得在另一个项目里落库（CROSS_PROJECT_REF 结构性消除）', async () => {
    const otherPmId = await makeUser(ctx.db, 't34-other-pm3', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')

    // 调用者是自己项目的 PM，但对另一个项目而言只是外人 → 404
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(otherGoalId)).send({ name: '跨项目挂载' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await ctx.db.userActivity.count({ where: { goalId: otherGoalId } })).toBe(0)
    expect(await ctx.db.userActivity.count({ where: { projectId: otherProjectId } })).toBe(0)
  })

  it('「目标不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const missing = await ctx.asUser(pmToken).post(URL_ACTIVITIES(MISSING_ID)).send({ name: 'x' })
    const notMember = await ctx.asUser(outsiderToken).post(URL_ACTIVITIES(goalId)).send({ name: 'x' })

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })
})

// ===========================================================================
// 反例：字段校验（422 / 400）
// ===========================================================================

describe('端点 15 反例：字段校验（422 / 400）', () => {
  it('缺少 name → 422，details 含 name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({})

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 为空字符串 → 422，name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 为纯空白 → 422，name: REQUIRED（决策 I-4：REQUIRED 含纯空白）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '     ' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 超长（上限 + 1）→ 422，name: TOO_LONG', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .send({ name: 'a'.repeat(ACTIVITY_NAME_MAX_LENGTH + 1) })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'TOO_LONG' })
  })

  it('name 类型错误（数字）→ 422，details 定位到 name', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: 123 })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('name')
  })

  it('description 类型错误（数字）→ 422，details 定位到 description', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .send({ name: '合法名称', description: 123 })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('description')
  })

  it('description = null → 422（契约 I-8 端点 15 的请求形状是 description?: string，null 不在其中）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .send({ name: '合法名称', description: null })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('description')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .set('content-type', 'application/json')
      .send('{"name": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })
})

// ===========================================================================
// 反例：判定顺序与副作用隔离
// ===========================================================================

describe('端点 15 反例：判定顺序与副作用隔离', () => {
  it('MEMBER + 非法 body → 403（越权先于校验，不泄漏字段规则）', async () => {
    const res = await ctx.asUser(memberToken).post(URL_ACTIVITIES(goalId)).send({})

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER + 非法 body → 403（同上，不因字段错误降级为 422）', async () => {
    const res = await ctx.asUser(viewerToken).post(URL_ACTIVITIES(goalId)).send({ name: 123 })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员 + 非法 body → 404（不泄漏字段规则，也不承认目标存在）', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_ACTIVITIES(goalId)).send({})

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录 + 非法 body → 401（不能先回 422 泄漏校验细节）', async () => {
    const res = await ctx.asUser(null).post(URL_ACTIVITIES(goalId)).send({})

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('不存在的 goalId + 非法 body → 404（父级存在性先于字段校验）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(MISSING_ID)).send({})

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('401 / 403 / 404 / 422 四类失败之后活动行数一律不变，且失败不占用序号', async () => {
    await ctx.asUser(null).post(URL_ACTIVITIES(goalId)).send({ name: '匿名' })
    await ctx.asUser(memberToken).post(URL_ACTIVITIES(goalId)).send({ name: '成员越权' })
    await ctx.asUser(outsiderToken).post(URL_ACTIVITIES(goalId)).send({ name: '外人越权' })
    await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '   ' })
    await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: 'a'.repeat(999) })

    expect(await ctx.db.userActivity.count({ where: { goalId } })).toBe(0)

    // 失败不占用序号：第一次成功创建仍必须拿到 sortOrder = 0
    const ok = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '第一次成功' })
    expect(ok.status).toBe(201)
    expect(ok.body.sortOrder).toBe(0)
  })
})
