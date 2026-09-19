/**
 * 端点 14 —— `PUT /projects/:projectId/goals/order` 接口测试（T3.3）
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 12 条、反例 23 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员与目标。
 *
 * 本文件与 `requirement.activity-order.test.ts`（端点 18）同型 —— 契约 I-8 端点 18
 * 明写「语义同端点 14」，差别只有作用域（这里是「项目内所有目标」）与响应类型
 * （`ListResponse<BusinessGoal>`）。三组核心断言同样适用：
 *   ① 序号必须恰好是连续的 `0..n-1`；
 *   ② 只影响本项目内目标（其它项目、以及目标下的活动都不受影响）；
 *   ③ 422 时零写入。
 *
 * 契约依据：决策 I-8 端点 14
 *   请求  { orderedIds: string[] }
 *   响应  200 ListResponse<BusinessGoal>
 *   错误  403 FORBIDDEN / 404 NOT_FOUND
 *         422 VALIDATION_FAILED（orderedIds: INVALID_VALUE
 *                              —— 集合与本项目现有目标集合不一致）
 *   语义  第 i 个 id 的 sortOrder 置为 i；幂等，可重复调用
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

let ctx: HttpTestContext
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let projectId: string
/** 本项目预置的 4 个目标，`ids[0..3]` 初始 sortOrder 分别为 0..3。 */
let ids: string[]

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_ORDER = (id: string) => `/projects/${id}/goals/order`

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 按 sortOrder 升序读回某项目内全部目标的 `[id, sortOrder]` 序列，用于逐行比对。 */
async function orderOf(id: string) {
  const rows = await ctx.db.businessGoal.findMany({
    where: { projectId: id },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  })
  return rows.map((row) => [row.id, row.sortOrder])
}

/** 读回某目标下活动的 `[id, sortOrder]` 序列，用于验证重排目标不影响活动。 */
async function activityOrderOf(goalId: string) {
  const rows = await ctx.db.userActivity.findMany({
    where: { goalId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  })
  return rows.map((row) => [row.id, row.sortOrder])
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

  const pmId = await makeUser(ctx.db, 't33-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't33-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't33-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't33-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.3 排序项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  // 夹具自动取「项目内最大值 + 1」，因此 4 条的序号依次为 0,1,2,3
  ids = []
  for (const name of ['目标 A', '目标 B', '目标 C', '目标 D']) {
    ids.push(await makeGoal(ctx.db, projectId, name))
  }

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例
// ===========================================================================

describe('端点 14 正例：全量替换业务目标顺序', () => {
  it('把 [A,B,C,D] 换成 [D,C,B,A] → 200，响应的 items 按新顺序、sortOrder 为 0..3', async () => {
    const reversed = [...ids].reverse()
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: reversed })

    expect(res.status).toBe(200)
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual(reversed)
    expect(res.body.items.map((g: { sortOrder: number }) => g.sortOrder)).toEqual([0, 1, 2, 3])
  })

  it('落库的序号与响应一致，且恰好是连续的 0..3（不重复、无空洞）', async () => {
    const reversed = [...ids].reverse()
    await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: reversed })

    expect(await orderOf(projectId)).toEqual([
      [reversed[0], 0],
      [reversed[1], 1],
      [reversed[2], 2],
      [reversed[3], 3],
    ])
  })

  it('只交换前两个的顺序 → 200，后面两个的序号不变', async () => {
    const swapped = [ids[1], ids[0], ids[2], ids[3]]
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: swapped })

    expect(res.status).toBe(200)
    expect(await orderOf(projectId)).toEqual([
      [ids[1], 0],
      [ids[0], 1],
      [ids[2], 2],
      [ids[3], 3],
    ])
  })

  it('幂等：同样的请求连发两次 → 两次都 200，结果完全相同', async () => {
    const requested = [ids[2], ids[0], ids[3], ids[1]]

    const first = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: requested })
    const second = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: requested })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.items.map((g: { id: string }) => g.id)).toEqual(
      first.body.items.map((g: { id: string }) => g.id),
    )
    expect(await orderOf(projectId)).toEqual([
      [ids[2], 0],
      [ids[0], 1],
      [ids[3], 2],
      [ids[1], 3],
    ])
  })

  it('原顺序原样提交 → 200 且序号不变（恒等替换是合法的）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(res.status).toBe(200)
    expect(await orderOf(projectId)).toEqual([
      [ids[0], 0],
      [ids[1], 1],
      [ids[2], 2],
      [ids[3], 3],
    ])
  })

  it('只有一个目标的项目：[A] → [A] → 200，sortOrder 为 0', async () => {
    const soloPmId = await makeUser(ctx.db, 't33-solo-pm', '独立 PM')
    const soloProjectId = await makeProject(ctx.db, soloPmId, '只有一个目标的项目')
    const soloGoalId = await makeGoal(ctx.db, soloProjectId, '唯一目标')

    const res = await ctx
      .asUser(ctx.loginAs(soloPmId))
      .put(URL_ORDER(soloProjectId))
      .send({ orderedIds: [soloGoalId] })

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: soloGoalId, sortOrder: 0, projectId: soloProjectId, status: 'ACTIVE' }),
    ])
  })

  it('没有任何目标的项目 + orderedIds: [] → 200，items 为空数组', async () => {
    const emptyPmId = await makeUser(ctx.db, 't33-empty-pm', '空项目 PM')
    const emptyProjectId = await makeProject(ctx.db, emptyPmId, '没有目标的项目')

    const res = await ctx.asUser(ctx.loginAs(emptyPmId)).put(URL_ORDER(emptyProjectId)).send({ orderedIds: [] })

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  it('10 个目标逆序 → 200，序号为 0..9', async () => {
    const bigPmId = await makeUser(ctx.db, 't33-big-pm', '大项目 PM')
    const bigProjectId = await makeProject(ctx.db, bigPmId, '大项目')
    const bigIds: string[] = []
    for (let i = 0; i < 10; i += 1) {
      bigIds.push(await makeGoal(ctx.db, bigProjectId, `大目标 ${i}`))
    }

    const requested = [...bigIds].reverse()
    const res = await ctx.asUser(ctx.loginAs(bigPmId)).put(URL_ORDER(bigProjectId)).send({ orderedIds: requested })

    expect(res.status).toBe(200)
    expect(res.body.items.map((g: { sortOrder: number }) => g.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual(requested)
  })

  it('与端点 11 协同：新建目标拿到末位序号后，可被全量替换排到最前', async () => {
    const created = await ctx.asUser(pmToken).post(`/projects/${projectId}/goals`).send({ name: '新目标 E' })
    expect(created.status).toBe(201)
    expect(created.body.sortOrder).toBe(4)

    const requested = [created.body.id, ...ids]
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: requested })

    expect(res.status).toBe(200)
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual(requested)
    expect(res.body.items.map((g: { sortOrder: number }) => g.sortOrder)).toEqual([0, 1, 2, 3, 4])
  })

  it('响应是契约 I-3 的 ListResponse 包装：键集合只有 items', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(res.status).toBe(200)
    expect(Object.keys(res.body)).toEqual(['items'])
    expect(res.body.items).toHaveLength(4)
  })

  it('每个 item 的键集合精确等于 BusinessGoal 的 6 个字段（多给 createdAt 也是契约违规）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'description',
      'id',
      'name',
      'projectId',
      'sortOrder',
      'status',
    ])
  })

  it('只重排目标，不影响目标下的活动（活动顺序与归属逐行不变）', async () => {
    // ⚠️ 这里刻意用 `for...of` 遍历而不是 `ids[0]` / `ids[1]`：
    // tsconfig 开了 `noUncheckedIndexedAccess`，下标访问的类型是 `string | undefined`，
    // 直接传给 `makeActivity` 会报 TS2345（vitest 运行时不会暴露，只有 tsc 会）——
    // 这就是「typecheck 与 test 两步都不可省」的活例。
    // 避开下标后既过类型检查，也不必写非空断言。
    for (const goalId of ids) {
      await makeActivity(ctx.db, projectId, goalId, `${goalId} 的活动 1`)
      await makeActivity(ctx.db, projectId, goalId, `${goalId} 的活动 2`)
    }

    const before: Array<[string, (string | number)[][]]> = []
    for (const goalId of ids) {
      before.push([goalId, await activityOrderOf(goalId)])
    }

    await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: [...ids].reverse() })

    for (const [goalId, snapshot] of before) {
      expect(await activityOrderOf(goalId)).toEqual(snapshot)
    }
  })

  it('不越界到其它项目：另一个项目的目标序号逐行不变', async () => {
    const otherPmId = await makeUser(ctx.db, 't33-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    await makeGoal(ctx.db, otherProjectId, '别处目标 A')
    await makeGoal(ctx.db, otherProjectId, '别处目标 B')
    const otherBefore = await orderOf(otherProjectId)

    await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: [...ids].reverse() })

    expect(await orderOf(otherProjectId)).toEqual(otherBefore)
  })
})

// ===========================================================================
// 反例：权限（401 / 403 / 404）
// ===========================================================================

describe('端点 14 反例：权限（401 / 403 / 404）', () => {
  it('MEMBER 重排 → 403 FORBIDDEN（对象可见，但写类动作不允许）', async () => {
    const res = await ctx.asUser(memberToken).put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 重排 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员重排 → 404 NOT_FOUND，且响应体不含目标的任何字段', async () => {
    const res = await ctx.asUser(outsiderToken).put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('T3.3 排序项目')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限与校验）', async () => {
    const res = await ctx.asUser(null).put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser('not-a-real-token').put(URL_ORDER(projectId)).send({ orderedIds: ids })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('projectId 不存在 → 404 NOT_FOUND（与「存在但非成员」同为 404）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(MISSING_ID)).send({ orderedIds: [] })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('「项目不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const missing = await ctx.asUser(pmToken).put(URL_ORDER(MISSING_ID)).send({ orderedIds: [] })
    const notMember = await ctx.asUser(outsiderToken).put(URL_ORDER(projectId)).send({ orderedIds: [] })

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })
})

// ===========================================================================
// 反例：集合一致性（422 orderedIds: INVALID_VALUE）
// ===========================================================================

describe('端点 14 反例：orderedIds 集合与本项目目标集合不一致 → 422', () => {
  it('少给一个 id → 422，orderedIds: INVALID_VALUE', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: ids.slice(0, 3) })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'orderedIds', code: 'INVALID_VALUE' })
  })

  it('多给一个 id（混入另一个项目的目标）→ 422', async () => {
    const otherPmId = await makeUser(ctx.db, 't33-other-pm2', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const foreign = await makeGoal(ctx.db, otherProjectId, '别处目标')

    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: [...ids, foreign] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('同样的长度但替换掉一个不存在的 id → 422（长度相同不足以通过）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .put(URL_ORDER(projectId))
      .send({ orderedIds: [MISSING_ID, ids[1], ids[2], ids[3]] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('含重复 id（长度相同但漏掉一个）→ 422', async () => {
    const res = await ctx
      .asUser(pmToken)
      .put(URL_ORDER(projectId))
      .send({ orderedIds: [ids[0], ids[0], ids[2], ids[3]] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('项目下有目标但提交空数组 → 422', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: [] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('集合不一致时**不得发生任何写入**：所有目标序号逐行不变', async () => {
    const before = await orderOf(projectId)

    await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: ids.slice(0, 3) })
    await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: [MISSING_ID, ...ids.slice(1)] })
    await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: [ids[0], ids[0], ids[2], ids[3]] })

    expect(await orderOf(projectId)).toEqual(before)
  })

  it('orderedIds 缺失 → 422，details 定位到 orderedIds', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({})

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('orderedIds')
  })

  it('orderedIds 不是数组（字符串）→ 422，details 定位到 orderedIds', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(projectId)).send({ orderedIds: 'not-an-array' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('orderedIds')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .put(URL_ORDER(projectId))
      .set('content-type', 'application/json')
      .send('{"orderedIds": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })
})

// ===========================================================================
// 反例：判定顺序
// ===========================================================================

describe('端点 14 反例：判定顺序', () => {
  it('MEMBER + 集合非法 → 403（越权先于集合校验，不泄漏现有集合）', async () => {
    const res = await ctx.asUser(memberToken).put(URL_ORDER(projectId)).send({ orderedIds: ids.slice(0, 3) })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER + 集合非法 → 403', async () => {
    const res = await ctx.asUser(viewerToken).put(URL_ORDER(projectId)).send({ orderedIds: [] })

    expect(res.status).toBe(403)
  })

  it('非项目成员 + 集合非法 → 404（不泄漏现有集合，也不承认项目存在）', async () => {
    const res = await ctx.asUser(outsiderToken).put(URL_ORDER(projectId)).send({ orderedIds: ids.slice(0, 3) })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录 + 集合非法 → 401（不能先回 422 泄漏集合信息）', async () => {
    const res = await ctx.asUser(null).put(URL_ORDER(projectId)).send({ orderedIds: [] })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('不存在的 projectId + 集合非法 → 404（父级存在性先于集合校验）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(MISSING_ID)).send({ orderedIds: [MISSING_ID] })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('403 / 404 之后所有目标序号逐行不变', async () => {
    const before = await orderOf(projectId)

    await ctx.asUser(memberToken).put(URL_ORDER(projectId)).send({ orderedIds: [...ids].reverse() })
    await ctx.asUser(viewerToken).put(URL_ORDER(projectId)).send({ orderedIds: [...ids].reverse() })
    await ctx.asUser(outsiderToken).put(URL_ORDER(projectId)).send({ orderedIds: [...ids].reverse() })
    await ctx.asUser(null).put(URL_ORDER(projectId)).send({ orderedIds: [...ids].reverse() })

    expect(await orderOf(projectId)).toEqual(before)
  })
})
