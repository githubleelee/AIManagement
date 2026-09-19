/**
 * 端点 18 —— `PUT /goals/:goalId/activities/order` 接口测试（T3.5）
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 12 条、反例 23 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员、目标与活动。
 *
 * 本文件最要紧的三组断言：
 *   ① **序号连续性**：全量替换后，该目标下所有活动的 `sortOrder` 必须恰好是
 *      `0..n-1`（契约 I-8 端点 14/18「第 i 个 id 的 sortOrder 置为 i」）；
 *   ② **作用域**：只影响该目标下的活动，同项目其它目标、其它项目的活动序号不动；
 *   ③ **失败零副作用**：422 之后所有活动序号逐行不变 —— 校验必须在写入之前完成。
 *
 * 契约依据：决策 I-8 端点 18（「语义 同端点 14，范围限定在该目标下的用户活动」）
 *   请求  { orderedIds: string[] }
 *   响应  200 ListResponse<UserActivity>
 *   错误  403 FORBIDDEN / 404 NOT_FOUND
 *         422 VALIDATION_FAILED（orderedIds: INVALID_VALUE
 *                              —— 集合与该目标下现有活动集合不一致）
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
let goalId: string
/** 该目标下预置的 4 个活动，`ids[0..3]` 初始 sortOrder 分别为 0..3。 */
let ids: string[]

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_ORDER = (id: string) => `/goals/${id}/activities/order`

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 按 sortOrder 升序读回某目标下全部活动的 `[id, sortOrder]` 序列，用于逐行比对。 */
async function orderOf(id: string) {
  const rows = await ctx.db.userActivity.findMany({
    where: { goalId: id },
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

  const pmId = await makeUser(ctx.db, 't35o-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't35o-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't35o-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't35o-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.5 排序项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  goalId = await makeGoal(ctx.db, projectId, 'T3.5 排序目标')

  // 夹具自动取「该目标内最大值 + 1」，因此 4 条的序号依次为 0,1,2,3
  ids = []
  for (const name of ['活动 A', '活动 B', '活动 C', '活动 D']) {
    ids.push(await makeActivity(ctx.db, projectId, goalId, name))
  }

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例
// ===========================================================================

describe('端点 18 正例：全量替换用户活动顺序', () => {
  it('把 [A,B,C,D] 换成 [D,C,B,A] → 200，响应的 items 按新顺序、sortOrder 为 0..3', async () => {
    const reversed = [...ids].reverse()
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: reversed })

    expect(res.status).toBe(200)
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual(reversed)
    expect(res.body.items.map((a: { sortOrder: number }) => a.sortOrder)).toEqual([0, 1, 2, 3])
  })

  it('落库的序号与响应一致，且恰好是连续的 0..3（不重复、无空洞）', async () => {
    const reversed = [...ids].reverse()
    await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: reversed })

    expect(await orderOf(goalId)).toEqual([
      [reversed[0], 0],
      [reversed[1], 1],
      [reversed[2], 2],
      [reversed[3], 3],
    ])
  })

  it('只交换前两个的顺序 → 200，后面两个的序号不变（全量替换不等于整体重排）', async () => {
    const swapped = [ids[1], ids[0], ids[2], ids[3]]
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: swapped })

    expect(res.status).toBe(200)
    expect(await orderOf(goalId)).toEqual([
      [ids[1], 0],
      [ids[0], 1],
      [ids[2], 2],
      [ids[3], 3],
    ])
  })

  it('幂等：同样的请求连发两次 → 两次都 200，结果完全相同', async () => {
    const requested = [ids[2], ids[0], ids[3], ids[1]]

    const first = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: requested })
    const second = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: requested })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.items.map((a: { id: string }) => a.id)).toEqual(
      first.body.items.map((a: { id: string }) => a.id),
    )
    expect(await orderOf(goalId)).toEqual([
      [ids[2], 0],
      [ids[0], 1],
      [ids[3], 2],
      [ids[1], 3],
    ])
  })

  it('原顺序原样提交 → 200 且序号不变（恒等替换是合法的）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(res.status).toBe(200)
    expect(await orderOf(goalId)).toEqual([
      [ids[0], 0],
      [ids[1], 1],
      [ids[2], 2],
      [ids[3], 3],
    ])
  })

  it('单条活动的目标：[A] → [A] → 200，sortOrder 为 0', async () => {
    const soloGoalId = await makeGoal(ctx.db, projectId, '只有一个活动的目标')
    const soloId = await makeActivity(ctx.db, projectId, soloGoalId, '唯一活动')

    const res = await ctx.asUser(pmToken).put(URL_ORDER(soloGoalId)).send({ orderedIds: [soloId] })

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: soloId, sortOrder: 0, goalId: soloGoalId, status: 'ACTIVE' }),
    ])
  })

  it('空目标 + orderedIds: [] → 200，items 为空数组（空集合与空集合是一致的）', async () => {
    const emptyGoalId = await makeGoal(ctx.db, projectId, '没有活动的目标')

    const res = await ctx.asUser(pmToken).put(URL_ORDER(emptyGoalId)).send({ orderedIds: [] })

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  it('10 条活动逆序 → 200，序号为 0..9（全量替换的可扩展性）', async () => {
    const bigGoalId = await makeGoal(ctx.db, projectId, '大目标')
    const bigIds: string[] = []
    for (let i = 0; i < 10; i += 1) {
      bigIds.push(await makeActivity(ctx.db, projectId, bigGoalId, `大活动 ${i}`))
    }

    const requested = [...bigIds].reverse()
    const res = await ctx.asUser(pmToken).put(URL_ORDER(bigGoalId)).send({ orderedIds: requested })

    expect(res.status).toBe(200)
    expect(res.body.items.map((a: { sortOrder: number }) => a.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual(requested)
  })

  it('与端点 15 协同：新活动拿到末位序号后，可被全量替换排到最前', async () => {
    // 通过端点 15 新建一条 → 应拿到 sortOrder = 4（该目标内最大值 + 1）
    const created = await ctx
      .asUser(pmToken)
      .post(`/goals/${goalId}/activities`)
      .send({ name: '新活动 E' })
    expect(created.status).toBe(201)
    expect(created.body.sortOrder).toBe(4)

    // 把它排到最前
    const requested = [created.body.id, ...ids]
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: requested })

    expect(res.status).toBe(200)
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual(requested)
    expect(res.body.items.map((a: { sortOrder: number }) => a.sortOrder)).toEqual([0, 1, 2, 3, 4])
  })

  it('响应是契约 I-3 的 ListResponse 包装：键集合只有 items', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(res.status).toBe(200)
    expect(Object.keys(res.body)).toEqual(['items'])
    expect(res.body.items).toHaveLength(4)
  })

  it('每个 item 的键集合精确等于 UserActivity 的 7 个字段（多给 createdAt 也是契约违规）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'description',
      'goalId',
      'id',
      'name',
      'projectId',
      'sortOrder',
      'status',
    ])
  })

  it('只重排该目标：同项目另一个目标的活动序号逐行不变', async () => {
    const siblingGoalId = await makeGoal(ctx.db, projectId, '兄弟目标')
    await makeActivity(ctx.db, projectId, siblingGoalId, '兄弟活动 A')
    await makeActivity(ctx.db, projectId, siblingGoalId, '兄弟活动 B')
    const siblingBefore = await orderOf(siblingGoalId)

    await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: [...ids].reverse() })

    expect(await orderOf(siblingGoalId)).toEqual(siblingBefore)
  })

  it('不越界到其它项目：另一个项目的活动序号逐行不变', async () => {
    const otherPmId = await makeUser(ctx.db, 't35o-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 A')
    await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 B')
    const otherBefore = await orderOf(otherGoalId)

    await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: [...ids].reverse() })

    expect(await orderOf(otherGoalId)).toEqual(otherBefore)
  })
})

// ===========================================================================
// 反例：权限（401 / 403 / 404）
// ===========================================================================

describe('端点 18 反例：权限（401 / 403 / 404）', () => {
  it('MEMBER 重排 → 403 FORBIDDEN（对象可见，但写类动作不允许）', async () => {
    const res = await ctx.asUser(memberToken).put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 重排 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员重排 → 404 NOT_FOUND，且响应体不含目标的任何字段', async () => {
    const res = await ctx.asUser(outsiderToken).put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('T3.5 排序目标')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限与校验）', async () => {
    const res = await ctx.asUser(null).put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser('not-a-real-token').put(URL_ORDER(goalId)).send({ orderedIds: ids })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('goalId 不存在 → 404 NOT_FOUND（与「存在但非成员」同为 404）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(MISSING_ID)).send({ orderedIds: [] })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('goalId 属于另一个项目 → 404，且那个目标的活动序号逐行不变（防跨项目重排）', async () => {
    const otherPmId = await makeUser(ctx.db, 't35o-other-pm2', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    const a = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 A')
    const b = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动 B')
    const otherBefore = await orderOf(otherGoalId)

    const res = await ctx.asUser(pmToken).put(URL_ORDER(otherGoalId)).send({ orderedIds: [b, a] })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await orderOf(otherGoalId)).toEqual(otherBefore)
  })

  it('「目标不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const missing = await ctx.asUser(pmToken).put(URL_ORDER(MISSING_ID)).send({ orderedIds: [] })
    const notMember = await ctx.asUser(outsiderToken).put(URL_ORDER(goalId)).send({ orderedIds: [] })

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })
})

// ===========================================================================
// 反例：集合一致性（422 orderedIds: INVALID_VALUE）
// ===========================================================================

describe('端点 18 反例：orderedIds 集合与该目标下活动集合不一致 → 422', () => {
  it('少给一个 id → 422，orderedIds: INVALID_VALUE', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: ids.slice(0, 3) })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'orderedIds', code: 'INVALID_VALUE' })
  })

  it('多给一个 id（混入另一个目标的活动）→ 422', async () => {
    const siblingGoalId = await makeGoal(ctx.db, projectId, '兄弟目标')
    const foreign = await makeActivity(ctx.db, projectId, siblingGoalId, '兄弟活动')

    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: [...ids, foreign] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('混入另一个项目的活动 id → 422', async () => {
    const otherPmId = await makeUser(ctx.db, 't35o-other-pm3', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    const foreign = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动')

    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: [foreign, ...ids.slice(1)] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('同样的长度但替换掉一个不存在的 id → 422（长度相同不足以通过）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .put(URL_ORDER(goalId))
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
      .put(URL_ORDER(goalId))
      .send({ orderedIds: [ids[0], ids[0], ids[2], ids[3]] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('全部 id 重复同一个 → 422（长度相同、无重复判定必须生效）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .put(URL_ORDER(goalId))
      .send({ orderedIds: [ids[0], ids[0], ids[0], ids[0]] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
  })

  it('目标下有活动但提交空数组 → 422', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: [] })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'orderedIds',
      code: 'INVALID_VALUE',
    })
  })

  it('集合不一致时**不得发生任何写入**：所有活动序号逐行不变', async () => {
    const before = await orderOf(goalId)

    await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: ids.slice(0, 3) })
    await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: [MISSING_ID, ...ids.slice(1)] })
    await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: [ids[0], ids[0], ids[2], ids[3]] })

    expect(await orderOf(goalId)).toEqual(before)
  })

  it('orderedIds 缺失 → 422，details 定位到 orderedIds', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({})

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map((d) => d.field)).toContain('orderedIds')
  })

  it('orderedIds 不是数组（字符串）→ 422，details 定位到 orderedIds', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(goalId)).send({ orderedIds: 'not-an-array' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('orderedIds')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .put(URL_ORDER(goalId))
      .set('content-type', 'application/json')
      .send('{"orderedIds": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })
})

// ===========================================================================
// 反例：判定顺序
// ===========================================================================

describe('端点 18 反例：判定顺序', () => {
  it('MEMBER + 集合非法 → 403（越权先于集合校验，不泄漏现有集合）', async () => {
    const res = await ctx.asUser(memberToken).put(URL_ORDER(goalId)).send({ orderedIds: ids.slice(0, 3) })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER + 集合非法 → 403', async () => {
    const res = await ctx.asUser(viewerToken).put(URL_ORDER(goalId)).send({ orderedIds: [] })

    expect(res.status).toBe(403)
  })

  it('非项目成员 + 集合非法 → 404（不泄漏现有集合，也不承认目标存在）', async () => {
    const res = await ctx.asUser(outsiderToken).put(URL_ORDER(goalId)).send({ orderedIds: ids.slice(0, 3) })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录 + 集合非法 → 401（不能先回 422 泄漏集合信息）', async () => {
    const res = await ctx.asUser(null).put(URL_ORDER(goalId)).send({ orderedIds: [] })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('不存在的 goalId + 集合非法 → 404（父级存在性先于集合校验）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_ORDER(MISSING_ID)).send({ orderedIds: [MISSING_ID] })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('403 / 404 之后所有活动序号逐行不变', async () => {
    const before = await orderOf(goalId)

    await ctx.asUser(memberToken).put(URL_ORDER(goalId)).send({ orderedIds: [...ids].reverse() })
    await ctx.asUser(viewerToken).put(URL_ORDER(goalId)).send({ orderedIds: [...ids].reverse() })
    await ctx.asUser(outsiderToken).put(URL_ORDER(goalId)).send({ orderedIds: [...ids].reverse() })
    await ctx.asUser(null).put(URL_ORDER(goalId)).send({ orderedIds: [...ids].reverse() })

    expect(await orderOf(goalId)).toEqual(before)
  })
})
