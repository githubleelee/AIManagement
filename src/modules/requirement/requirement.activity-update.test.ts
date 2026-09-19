/**
 * 端点 16 —— `PATCH /activities/:activityId` 接口测试（T3.5）
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 14 条、反例 25 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员与目标/活动。
 *
 * 本文件与 `requirement.goal-update.test.ts`（端点 12）同型：端点 16 的契约明确写着
 * 「错误 同端点 12」。核心断言同样是「**未被提到的字段逐字段保持不变**」——
 * 部分更新写错通常不报错，只会静默清空数据。
 *
 * 与端点 12 的**差异点**（也是本文件独有的用例）：
 *   ① 响应是 `UserActivity`（7 字段，含 `goalId`，**没有** `createdAt`）；
 *   ② 归属字段是 `goalId`，同样不可改；
 *   ③ 改活动的名称**不得**影响其父级目标。
 *
 * 契约依据：决策 I-8 端点 16
 *   请求  { name?: string, description?: string, status?: GoalStatus }
 *   响应  200 UserActivity
 *   错误  同端点 12
 *   说明  部分更新：请求体中未出现的字段保持不变
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
let activityId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_ACTIVITY = (id: string) => `/activities/${id}`

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 直接读库取活动整行（7 列），用于「逐字段比对」。 */
async function readActivity(id: string) {
  return ctx.db.userActivity.findUnique({
    where: { id },
    select: { id: true, projectId: true, goalId: true, name: true, description: true, status: true, sortOrder: true },
  })
}

/** 直接读库取目标整行，用于验证「改活动不影响父级目标」。 */
async function readGoal(id: string) {
  return ctx.db.businessGoal.findUnique({
    where: { id },
    select: { id: true, projectId: true, name: true, description: true, status: true, sortOrder: true },
  })
}

/** beforeEach 造出的活动的基准整行。每次调用返回新对象。 */
function baseline() {
  return {
    id: activityId,
    projectId,
    goalId,
    name: 'T3.5 活动',
    description: '活动原描述',
    status: 'ACTIVE',
    sortOrder: 0,
  }
}

beforeAll(async () => {
  ctx = await createHttpTestContext()
  // 不手动 register 插件（坑 2）：buildApp() → registerRoutes() 已注册
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  const pmId = await makeUser(ctx.db, 't35-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't35-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't35-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't35-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.5 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  goalId = await makeGoal(ctx.db, projectId, 'T3.5 目标', { description: '目标描述' })
  activityId = await makeActivity(ctx.db, projectId, goalId, 'T3.5 活动', { description: '活动原描述' })

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例
// ===========================================================================

describe('端点 16 正例：部分更新用户活动', () => {
  it('只改 name → 200，name 更新，其余 6 个字段逐字段不变（含 goalId 与 sortOrder）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '改后的活动名' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baseline(), name: '改后的活动名' })
    expect(await readActivity(activityId)).toEqual({ ...baseline(), name: '改后的活动名' })
  })

  it('只改 status → 200，status = DONE，name 与 description 不变', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ status: 'DONE' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baseline(), status: 'DONE' })
    expect(await readActivity(activityId)).toEqual({ ...baseline(), status: 'DONE' })
  })

  it('status 可从 DONE 改回 ACTIVE（状态可逆）', async () => {
    await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ status: 'DONE' })
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ status: 'ACTIVE' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ACTIVE')
  })

  it('只改 description → 200，name 与 status 不变', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ description: '新活动描述' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baseline(), description: '新活动描述' })
  })

  it('description 改为空串 → 200，且为 ""（空串与"缺省"必须可区分）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ description: '' })

    expect(res.status).toBe(200)
    expect(res.body.description).toBe('')
    expect(await readActivity(activityId)).toEqual({ ...baseline(), description: '' })
  })

  it('三个字段一起改 → 200，三者全部生效', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_ACTIVITY(activityId))
      .send({ name: '一起改', description: '一起改描述', status: 'DONE' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ...baseline(),
      name: '一起改',
      description: '一起改描述',
      status: 'DONE',
    })
  })

  it('请求体为 {} → 200 且资源完全不变（契约未定义该情形，按现状钉住幂等 no-op）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual(baseline())
    expect(await readActivity(activityId)).toEqual(baseline())
  })

  it('name 两端空白被 trim 后存储（与端点 11/15 同一口径）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '  有空格  ' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('有空格')
  })

  it('部分更新可累积：先改 name 再改 status，两次改动都留在库里', async () => {
    await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '第一步' })
    const second = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ status: 'DONE' })

    expect(second.body).toEqual({ ...baseline(), name: '第一步', status: 'DONE' })
    expect(await readActivity(activityId)).toEqual({ ...baseline(), name: '第一步', status: 'DONE' })
  })

  it('请求体注入 projectId/goalId/sortOrder/id → 全部被丢弃，库里归属与序号不变', async () => {
    const otherGoalId = await makeGoal(ctx.db, projectId, '另一个目标')

    const res = await ctx
      .asUser(pmToken)
      .patch(URL_ACTIVITY(activityId))
      .send({
        name: '注入测试',
        projectId: MISSING_ID,
        goalId: otherGoalId,
        sortOrder: 999,
        id: MISSING_ID,
      })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baseline(), name: '注入测试' })
    expect(await readActivity(activityId)).toEqual({ ...baseline(), name: '注入测试' })
  })

  it('响应键集合精确等于 UserActivity 的 7 个字段（多给 createdAt 也是契约违规）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '键集合' })

    expect(res.status).toBe(200)
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

  it('字段类型逐个断言：sortOrder 为整数、description 为 string|null、status 为 string', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '类型' })

    expect(typeof res.body.id).toBe('string')
    expect(typeof res.body.projectId).toBe('string')
    expect(typeof res.body.goalId).toBe('string')
    expect(typeof res.body.name).toBe('string')
    expect(res.body.description === null || typeof res.body.description === 'string').toBe(true)
    expect(typeof res.body.status).toBe('string')
    expect(Number.isInteger(res.body.sortOrder)).toBe(true)
  })

  it('只影响被改的那个活动：同目标下的另一个活动逐字段不变', async () => {
    const otherActivityId = await makeActivity(ctx.db, projectId, goalId, '另一个活动', {
      description: '别的描述',
    })
    const otherBefore = await readActivity(otherActivityId)

    await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '只改这个', status: 'DONE' })

    expect(await readActivity(otherActivityId)).toEqual(otherBefore)
  })

  it('改活动不影响其父级目标（层级归属与父级字段都不被动）', async () => {
    const goalBefore = await readGoal(goalId)

    await ctx
      .asUser(pmToken)
      .patch(URL_ACTIVITY(activityId))
      .send({ name: '改了活动', description: '改了描述', status: 'DONE' })

    expect(await readGoal(goalId)).toEqual(goalBefore)
  })

  it('name 不唯一：改成与同目标下另一活动同名 → 200（契约未规定活动名唯一）', async () => {
    await makeActivity(ctx.db, projectId, goalId, '重名活动')

    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '重名活动' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('重名活动')
    expect(await ctx.db.userActivity.count({ where: { goalId, name: '重名活动' } })).toBe(2)
  })
})

// ===========================================================================
// 反例：权限（401 / 403 / 404）
// ===========================================================================

describe('端点 16 反例：权限（401 / 403 / 404）', () => {
  it('MEMBER 更新 → 403 FORBIDDEN（对象可见，但写类动作不允许）', async () => {
    const res = await ctx.asUser(memberToken).patch(URL_ACTIVITY(activityId)).send({ name: '成员越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 更新 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).patch(URL_ACTIVITY(activityId)).send({ name: '管理者越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员更新 → 404 NOT_FOUND，且响应体不含活动的任何字段', async () => {
    const res = await ctx.asUser(outsiderToken).patch(URL_ACTIVITY(activityId)).send({ name: '外人越权' })

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('T3.5 活动')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限与校验）', async () => {
    const res = await ctx.asUser(null).patch(URL_ACTIVITY(activityId)).send({ name: '匿名' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser('not-a-real-token').patch(URL_ACTIVITY(activityId)).send({ name: '假令牌' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('activityId 不存在 → 404 NOT_FOUND（与「存在但非成员」同为 404）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(MISSING_ID)).send({ name: '不存在的活动' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('activityId 属于另一个项目 → 404，且那个活动在数据库里逐字段未被修改（防跨项目改写）', async () => {
    const otherPmId = await makeUser(ctx.db, 't35-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别的活动', {
      description: '别人的描述',
    })
    const otherBefore = await readActivity(otherActivityId)

    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(otherActivityId)).send({ name: '跨项目改写' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await readActivity(otherActivityId)).toEqual(otherBefore)
  })

  it('「活动不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const missing = await ctx.asUser(pmToken).patch(URL_ACTIVITY(MISSING_ID)).send({ name: 'x' })
    const notMember = await ctx.asUser(outsiderToken).patch(URL_ACTIVITY(activityId)).send({ name: 'x' })

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })
})

// ===========================================================================
// 反例：字段校验（422 / 400）
// ===========================================================================

describe('端点 16 反例：字段校验（422 / 400）', () => {
  it('name 为空字符串 → 422，name: REQUIRED', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '' })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 为纯空白 → 422，name: REQUIRED（决策 I-4：REQUIRED 含纯空白）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '     ' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'REQUIRED' })
  })

  it('name 超长（上限 + 1）→ 422，name: TOO_LONG', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_ACTIVITY(activityId))
      .send({ name: 'a'.repeat(ACTIVITY_NAME_MAX_LENGTH + 1) })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'name', code: 'TOO_LONG' })
  })

  it('name 恰好为上限长度 → 200（边界正例，与 TOO_LONG 反例配对）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_ACTIVITY(activityId))
      .send({ name: 'a'.repeat(ACTIVITY_NAME_MAX_LENGTH) })

    expect(res.status).toBe(200)
    expect(res.body.name).toHaveLength(ACTIVITY_NAME_MAX_LENGTH)
  })

  it('name 类型错误（数字）→ 422，details 定位到 name', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: 123 })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('name')
  })

  it('status 非法枚举值 → 422，details 含 status: INVALID_VALUE', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ status: 'FINISHED' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'status', code: 'INVALID_VALUE' })
  })

  it('status 类型错误（数字）→ 422，details 定位到 status', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ status: 1 })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('status')
  })

  it('description 为 null → 422，details 定位到 description（契约形状是 description?: string）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ description: null })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('description')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_ACTIVITY(activityId))
      .set('content-type', 'application/json')
      .send('{"name": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })
})

// ===========================================================================
// 反例：判定顺序与副作用隔离
// ===========================================================================

describe('端点 16 反例：判定顺序与副作用隔离', () => {
  it('MEMBER + 非法 body → 403（越权先于校验）', async () => {
    const res = await ctx.asUser(memberToken).patch(URL_ACTIVITY(activityId)).send({ name: '   ' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER + 非法 body → 403（不因字段错误降级为 422）', async () => {
    const res = await ctx.asUser(viewerToken).patch(URL_ACTIVITY(activityId)).send({ status: 'FINISHED' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员 + 非法 body → 404（不泄漏字段规则，也不承认活动存在）', async () => {
    const res = await ctx.asUser(outsiderToken).patch(URL_ACTIVITY(activityId)).send({ name: '' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录 + 非法 body → 401（不能先回 422 泄漏校验细节）', async () => {
    const res = await ctx.asUser(null).patch(URL_ACTIVITY(activityId)).send({ status: 'FINISHED' })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('不存在的 activityId + 非法 body → 404（父级存在性先于字段校验）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(MISSING_ID)).send({ name: '' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('422 之后活动逐字段完全未被修改（失败的请求必须什么都没发生）', async () => {
    await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: '   ' })
    await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ name: 'a'.repeat(999) })
    await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ status: 'FINISHED' })
    await ctx.asUser(pmToken).patch(URL_ACTIVITY(activityId)).send({ description: null })

    expect(await readActivity(activityId)).toEqual(baseline())
  })

  it('403 / 404 之后活动逐字段完全未被修改', async () => {
    await ctx.asUser(memberToken).patch(URL_ACTIVITY(activityId)).send({ name: '成员越权' })
    await ctx.asUser(viewerToken).patch(URL_ACTIVITY(activityId)).send({ status: 'DONE' })
    await ctx.asUser(outsiderToken).patch(URL_ACTIVITY(activityId)).send({ name: '外人越权' })
    await ctx.asUser(null).patch(URL_ACTIVITY(activityId)).send({ name: '匿名' })

    expect(await readActivity(activityId)).toEqual(baseline())
  })
})
