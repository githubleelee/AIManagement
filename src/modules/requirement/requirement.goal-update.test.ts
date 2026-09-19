/**
 * 端点 12 —— `PATCH /goals/:goalId` 接口测试（T3.2）
 *
 * 为什么另建文件而不是追加到 `requirement.test.ts`
 *   后者是 T3.1 的交付物、头部明确写着「端点 11」，且已被代码审查智能体只读审查过。
 *   新端点的用例放新文件：`requirement.test.ts` = 端点 11，
 *   `requirement.activity.test.ts` = 端点 15，本文件 = 端点 12，
 *   `requirement.adversarial.test.ts` = 检测智能体的独立对抗护栏（不可改）。
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码（`REQUIRED` / `TOO_LONG` / `INVALID_VALUE`）
 *     与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 14 条、反例 21 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员与目标。
 *   - **越权用例必须打接口**：MEMBER / VIEWER / 非成员 / 未登录的拒绝全部真实发请求。
 *
 * 本文件最要紧的一组断言是「**未被提到的字段必须逐字段保持不变**」——
 * 部分更新写错（例如把没传的字段当成 undefined 写回、或先读后整行写回）
 * 通常不会报错，只会静默清空数据，所以必须逐字段比对整行，而不是只看被改字段。
 *
 * 契约依据：决策 I-8 端点 12
 *   请求  { name?: string, description?: string, status?: GoalStatus }
 *   响应  200 BusinessGoal
 *   错误  403 FORBIDDEN / 404 NOT_FOUND
 *         422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG；status: INVALID_VALUE）
 *   说明  部分更新：请求体中未出现的字段保持不变（决策 I-10）
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
let goalId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_GOAL = (id: string) => `/goals/${id}`

/** 一个必然不存在的 uuid，用于「目标不存在」路径。 */
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/**
 * 直接读库取目标整行（6 列），用于「逐字段比对」。
 * 只断言响应体不够：部分更新写错时，响应体可能正确而库里已经被清空。
 */
async function readGoal(id: string) {
  return ctx.db.businessGoal.findUnique({
    where: { id },
    select: { id: true, projectId: true, name: true, description: true, status: true, sortOrder: true },
  })
}

/**
 * beforeEach 造出的目标的基准整行。
 * 每次调用返回**新对象**，避免断言之间互相污染。
 */
function baseline() {
  return {
    id: goalId,
    projectId,
    name: 'T3.2 目标',
    description: '原描述',
    status: 'ACTIVE',
    sortOrder: 0,
  }
}

beforeAll(async () => {
  ctx = await createHttpTestContext()

  // 【重要】不手动 register 本模块插件（坑 2）：buildApp() → registerRoutes()
  // 已通过冻结文件 src/routes.ts 的注册行完成注册；重复注册抛
  // FST_ERR_DUPLICATED_ROUTE，会让本文件全挂。
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  const pmId = await makeUser(ctx.db, 't32-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't32-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't32-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't32-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.2 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  // 带描述的目标：这样才能验证「只改 name 时 description 不被动」。
  // sortOrder 省略 → 夹具按项目内最大值 + 1 取 0。
  goalId = await makeGoal(ctx.db, projectId, 'T3.2 目标', { description: '原描述' })

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例
// ===========================================================================

describe('端点 12 正例：部分更新业务目标', () => {
  it('只改 name → 200，name 更新，其余 5 个字段逐字段不变（含描述与 sortOrder）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '改后的名称' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baseline(), name: '改后的名称' })
    // 反向核对数据库：响应说得对但库里被写坏的情况必须拦住
    expect(await readGoal(goalId)).toEqual({ ...baseline(), name: '改后的名称' })
  })

  it('只改 status → 200，status = DONE，name 与 description 不变', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 'DONE' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baseline(), status: 'DONE' })
    expect(await readGoal(goalId)).toEqual({ ...baseline(), status: 'DONE' })
  })

  it('status 可从 DONE 改回 ACTIVE（状态可逆）', async () => {
    await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 'DONE' })
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 'ACTIVE' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ACTIVE')
  })

  it('只改 description → 200，name 与 status 不变', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ description: '新描述' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baseline(), description: '新描述' })
  })

  it('description 改为空串 → 200，且为 ""（空串与"缺省"必须可区分）', async () => {
    // 缺省 → 保持原值；空串 → 真的改成空串。若实现用 `description || 旧值`
    // 这类真值判断，此处会把空串当成缺省，两者就分不开了。
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ description: '' })

    expect(res.status).toBe(200)
    expect(res.body.description).toBe('')
    expect(await readGoal(goalId)).toEqual({ ...baseline(), description: '' })
  })

  it('三个字段一起改 → 200，三者全部生效', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_GOAL(goalId))
      .send({ name: '一起改', description: '一起改描述', status: 'DONE' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ...baseline(),
      name: '一起改',
      description: '一起改描述',
      status: 'DONE',
    })
  })

  it('请求体为 {} → 200 且资源完全不变（契约未定义该情形，本实现取幂等 no-op，此处按现状钉住）', async () => {
    // 契约 I-10 只说「未出现的字段保持不变」，没说「一个字段都没出现」该怎么办。
    // 本实现取字面语义：什么都没提到 → 什么都没变，返回 200。
    // 这是**契约未定义处的实现选择**，不是契约要求；若将来澄清为 422，改这里即可。
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual(baseline())
    expect(await readGoal(goalId)).toEqual(baseline())
  })

  it('name 两端空白被 trim 后存储（与端点 11 同一口径）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '  有空格  ' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('有空格')
  })

  it('部分更新可累积：先改 name 再改 status，两次改动都留在库里', async () => {
    await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '第一步' })
    const second = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 'DONE' })

    expect(second.body).toEqual({ ...baseline(), name: '第一步', status: 'DONE' })
    expect(await readGoal(goalId)).toEqual({ ...baseline(), name: '第一步', status: 'DONE' })
  })

  it('请求体注入 projectId/sortOrder/id/createdAt → 全部被丢弃，库里归属与序号不变', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_GOAL(goalId))
      .send({ name: '注入测试', projectId: MISSING_ID, sortOrder: 999, id: MISSING_ID, createdAt: '2000-01-01' })

    expect(res.status).toBe(200)
    // projectId 与 sortOrder 不在端点 12 的可改白名单内（决策 I-10）
    expect(res.body).toEqual({ ...baseline(), name: '注入测试' })
    expect(await readGoal(goalId)).toEqual({ ...baseline(), name: '注入测试' })
  })

  it('响应键集合精确等于 BusinessGoal 的 6 个字段（多给或漏给都是契约违规）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '键集合' })

    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual([
      'description',
      'id',
      'name',
      'projectId',
      'sortOrder',
      'status',
    ])
  })

  it('字段类型逐个断言：id/projectId/name 为 string，description 为 string|null，sortOrder 为整数', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '类型' })

    expect(typeof res.body.id).toBe('string')
    expect(typeof res.body.projectId).toBe('string')
    expect(typeof res.body.name).toBe('string')
    expect(res.body.description === null || typeof res.body.description === 'string').toBe(true)
    expect(typeof res.body.status).toBe('string')
    expect(Number.isInteger(res.body.sortOrder)).toBe(true)
  })

  it('只影响被改的那个目标：同项目的另一个目标逐字段不变', async () => {
    const otherGoalId = await makeGoal(ctx.db, projectId, '另一个目标', { description: '别的描述' })
    const otherBefore = await readGoal(otherGoalId)

    await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '只改这个', status: 'DONE' })

    expect(await readGoal(otherGoalId)).toEqual(otherBefore)
  })

  it('name 不唯一：改成与另一目标同名 → 200（契约未规定 name 唯一）', async () => {
    await makeGoal(ctx.db, projectId, '重名目标')

    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '重名目标' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('重名目标')
    expect(await ctx.db.businessGoal.count({ where: { projectId, name: '重名目标' } })).toBe(2)
  })
})

// ===========================================================================
// 反例：权限（401 / 403 / 404）
// ===========================================================================

describe('端点 12 反例：权限（401 / 403 / 404）', () => {
  it('MEMBER 更新 → 403 FORBIDDEN（对象可见，但写类动作不允许；决策 I-5 第 5 条）', async () => {
    const res = await ctx.asUser(memberToken).patch(URL_GOAL(goalId)).send({ name: '成员越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 更新 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).patch(URL_GOAL(goalId)).send({ name: '管理者越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员更新 → 404 NOT_FOUND，且响应体不含目标的任何字段', async () => {
    const res = await ctx.asUser(outsiderToken).patch(URL_GOAL(goalId)).send({ name: '外人越权' })

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('T3.2 目标')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限与校验）', async () => {
    const res = await ctx.asUser(null).patch(URL_GOAL(goalId)).send({ name: '匿名' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser('not-a-real-token').patch(URL_GOAL(goalId)).send({ name: '假令牌' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('goalId 不存在 → 404 NOT_FOUND（与「存在但非成员」同为 404，不泄漏目标是否存在）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(MISSING_ID)).send({ name: '不存在的目标' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('goalId 属于另一个项目 → 404，且那个目标在数据库里逐字段未被修改（防跨项目改写）', async () => {
    const otherPmId = await makeUser(ctx.db, 't32-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标', { description: '别人的描述' })
    const otherBefore = await readGoal(otherGoalId)

    // 调用者是自己项目的 PM，但对另一个项目而言只是外人
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(otherGoalId)).send({ name: '跨项目改写' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    // 这条是本用例的重点：越权请求不得产生任何跨项目副作用
    expect(await readGoal(otherGoalId)).toEqual(otherBefore)
  })

  it('「目标不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const missing = await ctx.asUser(pmToken).patch(URL_GOAL(MISSING_ID)).send({ name: 'x' })
    const notMember = await ctx.asUser(outsiderToken).patch(URL_GOAL(goalId)).send({ name: 'x' })

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })
})

// ===========================================================================
// 反例：字段校验（422 / 400）
// ===========================================================================

describe('端点 12 反例：字段校验（422 / 400）', () => {
  it('name 为空字符串 → 422，name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '' })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 为纯空白 → 422，name: REQUIRED（决策 I-4：REQUIRED 含纯空白）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '     ' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 超长（上限 + 1）→ 422，name: TOO_LONG', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_GOAL(goalId))
      .send({ name: 'a'.repeat(GOAL_NAME_MAX_LENGTH + 1) })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'TOO_LONG' })
  })

  it('name 恰好为上限长度 → 200（边界正例，与 TOO_LONG 反例配对）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_GOAL(goalId))
      .send({ name: 'a'.repeat(GOAL_NAME_MAX_LENGTH) })

    expect(res.status).toBe(200)
    expect(res.body.name).toHaveLength(GOAL_NAME_MAX_LENGTH)
  })

  it('name 类型错误（数字）→ 422，details 定位到 name', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: 123 })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('name')
  })

  it('status 非法枚举值 → 422，details 含 status: INVALID_VALUE（决策 I-4 字段级错误码）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 'FINISHED' })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'status', code: 'INVALID_VALUE' })
  })

  it('status 类型错误（数字）→ 422，details 定位到 status', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 1 })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('status')
  })

  it('description 为 null → 422，details 定位到 description（契约形状是 description?: string）', async () => {
    // 附带记录一个**契约空白**：契约没有提供「把 description 清空为 null」的入口，
    // 因此传 null 只能是 422。本用例钉的是现状，不是需求。
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ description: null })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('description')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_GOAL(goalId))
      .set('content-type', 'application/json')
      .send('{"name": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })
})

// ===========================================================================
// 反例：判定顺序与副作用隔离
// ===========================================================================

describe('端点 12 反例：判定顺序与副作用隔离', () => {
  it('MEMBER + 非法 body → 403（越权先于校验，不泄漏字段规则）', async () => {
    const res = await ctx.asUser(memberToken).patch(URL_GOAL(goalId)).send({ name: '   ' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER + 非法 body → 403（同上，不因字段错误降级为 422）', async () => {
    const res = await ctx.asUser(viewerToken).patch(URL_GOAL(goalId)).send({ status: 'FINISHED' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员 + 非法 body → 404（不泄漏字段规则，也不承认目标存在）', async () => {
    const res = await ctx.asUser(outsiderToken).patch(URL_GOAL(goalId)).send({ name: '' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录 + 非法 body → 401（不能先回 422 泄漏校验细节）', async () => {
    const res = await ctx.asUser(null).patch(URL_GOAL(goalId)).send({ status: 'FINISHED' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('不存在的 goalId + 非法 body → 404（父级存在性先于字段校验）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_GOAL(MISSING_ID)).send({ name: '' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('422 之后目标逐字段完全未被修改（失败的请求必须什么都没发生）', async () => {
    await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: '   ' })
    await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ name: 'a'.repeat(999) })
    await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 'FINISHED' })
    await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ description: null })

    expect(await readGoal(goalId)).toEqual(baseline())
  })

  it('403 / 404 之后目标逐字段完全未被修改', async () => {
    await ctx.asUser(memberToken).patch(URL_GOAL(goalId)).send({ name: '成员越权' })
    await ctx.asUser(viewerToken).patch(URL_GOAL(goalId)).send({ status: 'DONE' })
    await ctx.asUser(outsiderToken).patch(URL_GOAL(goalId)).send({ name: '外人越权' })
    await ctx.asUser(null).patch(URL_GOAL(goalId)).send({ name: '匿名' })

    expect(await readGoal(goalId)).toEqual(baseline())
  })
})
