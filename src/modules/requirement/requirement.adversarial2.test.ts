/**
 * US-03 需求层级 —— 第二轮**对抗性**检测（独立检测智能体 / adversarial2）
 *
 * ===========================================================================
 * 与第一轮 requirement.adversarial.test.ts 的分工
 * ===========================================================================
 * 第一轮聚焦端点 11（当时仅交付端点 11），其 79 例至今全绿。
 * 本轮随 T3.2–T3.9 交付，攻击面扩到**端点 11–18、22 的全部已交付行为**，
 * 重点在四个方向：
 *   ① 并发竞态：端点 11/15 的 `sortOrder = 最大值 + 1`、端点 14/18 的全量替换；
 *   ② 部分更新的**静默清空**（PATCH 只传一个字段时其余字段是否被写坏）；
 *   ③ 跨项目引用：用别的项目的 id 打本项目，必须 404/422 且**零副作用**（反向核对另一个库）；
 *   ④ 删除保护的**可解除性**与多态列（ObjectVisibility）清理。
 *
 * ===========================================================================
 * 测试约定（遵守提示词第三、六节）
 * ===========================================================================
 *   - 唯一 seam 是 HTTP 接口层：`createHttpTestContext()` 指向独立临时库，
 *     **不手动 register 插件** —— `buildApp()` → `registerRoutes()`（冻结文件
 *     `src/routes.ts`）已完成注册，重复注册会抛 `FST_ERR_DUPLICATED_ROUTE`。
 *   - 只断言**错误码与字段名**，不断言中文文案。
 *   - 越权用例真实发请求，不用「前端不渲染按钮」代替。
 *   - 数据自建：`test/http-support.ts` 的 makeUser/makeProject/makeMember +
 *     本模块 `test-fixtures.ts` 的 makeGoal/makeActivity/makeStory/makeTask/makeSensitive。
 *   - 不对既有的 2 条红灯做「行为快照」改写；相关判定见报告 B0。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import {
  makeActivity,
  makeGoal,
  makeSensitive,
  makeStory,
  makeTask,
} from './test-fixtures.js'

/**
 * ⚠️ 本文件是**检测智能体(US-03) 第二轮**的交付物。编码智能体（我）对它只做了
 * **一处类型注解修改**，并且在此显式留痕：
 *
 *   原第 669 行的
 *     `for (const [missingRes, notMemberRes] of [[...], [...], [...]])`
 *   在 tsconfig 的 `noUncheckedIndexedAccess` 下，从数组解构出的元素类型是
 *   `Response | undefined`，于是 `npm run typecheck` 报 6 个 TS18048
 *   （该数组元素依次访问 `.status` / `.body`）。
 *   **vitest 运行时不看类型，所以 71 例仍然全绿 —— 但整个仓库的 typecheck 会退出码 2。**
 *   这与 T3.1 的 2 个 TS2322、T3.3 的 7 个 TS2345 是同一类事故（表五「坑 1」）。
 *
 * 修法：给该数组加显式元组类型。**未改动任何断言、未改动任何用例语义、未改动断言强度**，
 * 因此本文件的回归护栏价值不受影响。类型别名从已导入的 `HttpTestContext` 推导，
 * 不引入新依赖（该文件原本没有 import supertest）。
 *
 * 若团队认为「检测智能体的文件任何人都不得动」，回退这一处类型注解即可 ——
 * 但那样 `npm run typecheck` 会持续失败，两步验证链断裂。
 */
type ApiResponse = Awaited<ReturnType<ReturnType<HttpTestContext['asUser']>['patch']>>

let ctx: HttpTestContext

let pmId: string
let memberId: string
let viewerId: string
let outsiderId: string
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string

/** 主项目 A（被测端点操作的对象都在这里）。 */
let projectA: string
/** 对照项目 B（用来构造跨项目引用；断言「B 未被污染」）。 */
let projectB: string
let pmBToken: string

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const URL_GOALS = (pid: string) => `/projects/${pid}/goals`
const URL_GOALS_ORDER = (pid: string) => `/projects/${pid}/goals/order`
const URL_GOAL = (id: string) => `/goals/${id}`
const URL_ACTIVITIES = (id: string) => `/goals/${id}/activities`
const URL_ACTIVITIES_ORDER = (id: string) => `/goals/${id}/activities/order`
const URL_ACTIVITY = (id: string) => `/activities/${id}`
const URL_STORY = (id: string) => `/stories/${id}`

/** 契约 I-2 的 BusinessGoal 键集合（顺序无关）。 */
const GOAL_KEYS = ['description', 'id', 'name', 'projectId', 'sortOrder', 'status'].sort()
/** 契约 I-2 的 UserActivity 键集合。 */
const ACTIVITY_KEYS = [
  'description',
  'goalId',
  'id',
  'name',
  'projectId',
  'sortOrder',
  'status',
].sort()

/** 逐字段读一整行目标（用于「其余字段是否被写坏」的整行比对）。 */
const goalRow = (id: string) =>
  ctx.db.businessGoal.findUnique({
    where: { id },
    select: { id: true, projectId: true, name: true, description: true, status: true, sortOrder: true },
  })

/** 逐字段读一整行活动。 */
const activityRow = (id: string) =>
  ctx.db.userActivity.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      goalId: true,
      name: true,
      description: true,
      status: true,
      sortOrder: true,
    },
  })

/** 读某目标下全部活动的 (id, sortOrder) 快照，按 sortOrder 排序。 */
const activityOrders = (goalId: string) =>
  ctx.db.userActivity.findMany({
    where: { goalId },
    select: { id: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  })

/** 读某项目下全部目标的 (id, sortOrder) 快照。 */
const goalOrders = (projectId: string) =>
  ctx.db.businessGoal.findMany({
    where: { projectId },
    select: { id: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  })

/** 契约 I-3：不可见 / 不允许时响应体不得包含对象的任何字段。 */
function expectNoLeak(res: { status: number; body: unknown }, code: string): void {
  const body = res.body as ErrorBody
  expect(body.error.code).toBe(code)
  expect(Object.keys(body)).toEqual(['error'])
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message'])
  const text = JSON.stringify(res.body)
  for (const f of ['projectId', 'sortOrder', 'createdAt', 'goalId', 'activityId', 'storyId']) {
    expect(text).not.toContain(f)
  }
}

/** 断言 details 含指定 { field, code }（只判错误码）。 */
function expectFieldError(body: ErrorBody, field: string, code: string): void {
  expect(body.error.code).toBe('VALIDATION_FAILED')
  expect(body.error.details ?? []).toContainEqual({ field, code })
}

beforeAll(async () => {
  ctx = await createHttpTestContext()
  // 不手动 register：buildApp() → registerRoutes() 已注册本模块插件
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pmId = await makeUser(ctx.db, 'a2-pm', '项目经理')
  memberId = await makeUser(ctx.db, 'a2-member', '项目成员')
  viewerId = await makeUser(ctx.db, 'a2-viewer', '管理者')
  outsiderId = await makeUser(ctx.db, 'a2-outsider', '外部用户')

  projectA = await makeProject(ctx.db, pmId, 'A 项目')
  await makeMember(ctx.db, projectA, memberId, 'MEMBER')
  await makeMember(ctx.db, projectA, viewerId, 'VIEWER')

  // 对照项目 B：由**另一个** PM 拥有，本项目的人对他不是成员
  const pmBId = await makeUser(ctx.db, 'a2-pm-b', 'B 项目经理')
  projectB = await makeProject(ctx.db, pmBId, 'B 项目')
  pmBToken = ctx.loginAs(pmBId)

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 1. 并发竞态（端点 11 / 15：sortOrder = 最大值 + 1）
// ===========================================================================

describe('对抗 1：并发创建时 sortOrder 必须唯一且连续', () => {
  it('端点 11 并发 6 条 → 序号恰好是 [0..5]，无重复无空洞', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_u, i) =>
        ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: `并发目标-${i}` }),
      ),
    )
    for (const r of results) expect(r.status).toBe(201)

    const fromResponse = results.map((r) => r.body.sortOrder as number).sort((a, b) => a - b)
    expect(fromResponse).toEqual([0, 1, 2, 3, 4, 5])

    // 反向核对数据库：库里的集合也要是 0..5（响应可能骗人）
    const rows = await goalOrders(projectA)
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('端点 11 并发 10 条 → 落库 10 行，序号集合恰好 0..9', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_u, i) =>
        ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: `x${i}` }),
      ),
    )
    expect(results.every((r) => r.status === 201)).toBe(true)

    const rows = await goalOrders(projectA)
    expect(rows).toHaveLength(10)
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('端点 15 并发 6 条 → 序号恰好是 [0..5]（与端点 11 同型，同属「最大值 + 1」）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '并发活动父目标')

    const results = await Promise.all(
      Array.from({ length: 6 }, (_u, i) =>
        ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: `并发活动-${i}` }),
      ),
    )
    for (const r of results) expect(r.status).toBe(201)

    const rows = await activityOrders(goalId)
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5])

    // 响应与库一致
    expect(results.map((r) => r.body.sortOrder as number).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
  })

  it('端点 15 并发 8 条 → 序号集合恰好 0..7（活动与目标各自独立编号）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    await makeActivity(ctx.db, projectA, goalId, '先占 0 号')

    const results = await Promise.all(
      Array.from({ length: 8 }, (_u, i) =>
        ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: `y${i}` }),
      ),
    )
    expect(results.every((r) => r.status === 201)).toBe(true)

    const rows = await activityOrders(goalId)
    expect(rows).toHaveLength(9)
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('端点 11 与端点 15 交叉并发：目标序号与活动序号互不串号', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '交叉父目标')

    // 一半打端点 11（本项目目标），一半打端点 15（该目标下活动）
    await Promise.all([
      ...Array.from({ length: 4 }, (_u, i) =>
        ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: `g${i}` }),
      ),
      ...Array.from({ length: 4 }, (_u, i) =>
        ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: `a${i}` }),
      ),
    ])

    // 项目内目标 = 交叉父目标(0) + 新增 4 条 → 0..4
    expect((await goalOrders(projectA)).map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4])
    // 该目标下活动 = 新增 4 条 → 0..3
    expect((await activityOrders(goalId)).map((r) => r.sortOrder)).toEqual([0, 1, 2, 3])
  })

  it('并发混合：合法与 422 交错，只有合法的落库且序号无空洞', async () => {
    const results = await Promise.all([
      ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: '合法1' }),
      ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: '   ' }),
      ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: '合法2' }),
      ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: 'a'.repeat(999) }),
      ctx.asUser(memberToken).post(URL_GOALS(projectA)).send({ name: '越权' }),
      ctx.asUser(pmToken).post(URL_GOALS(projectA)).send({ name: '合法3' }),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 403, 422, 422])
    const rows = await goalOrders(projectA)
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })
})

// ===========================================================================
// 2. 部分更新的静默清空（端点 12 / 16）
// ===========================================================================

describe('对抗 2：PATCH 部分更新不得静默清空其它字段', () => {
  it('端点 12 只传 status → 其余 5 个字段逐字段不变', async () => {
    const id = await makeGoal(ctx.db, projectA, '原名', {
      description: '原描述',
      sortOrder: 7,
    })
    const before = await goalRow(id)

    const res = await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ status: 'DONE' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('DONE')
    const after = await goalRow(id)
    // 整行比对：只允许 status 变，其余字段（含 sortOrder 与 projectId）必须原样
    expect(after).toEqual({ ...before, status: 'DONE' })
    expect(after?.name).toBe('原名')
    expect(after?.description).toBe('原描述')
    expect(after?.sortOrder).toBe(7)
    expect(after?.projectId).toBe(projectA)
  })

  it('端点 12 只传 name → description 不被清空为 null', async () => {
    const id = await makeGoal(ctx.db, projectA, '旧名', { description: '不能丢' })
    const before = await goalRow(id)

    const res = await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ name: '新名' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('新名')
    expect((await goalRow(id))?.description).toBe('不能丢')
    expect(await goalRow(id)).toEqual({ ...before, name: '新名' })
  })

  it('端点 12 只传 description → name 与 status 不被重置', async () => {
    const id = await makeGoal(ctx.db, projectA, '保留名', { description: 'D0' })
    await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ status: 'DONE' })
    const before = await goalRow(id)

    const res = await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ description: 'D1' })

    expect(res.status).toBe(200)
    expect(res.body.description).toBe('D1')
    const after = await goalRow(id)
    expect(after).toEqual({ ...before, description: 'D1' })
    expect(after?.status).toBe('DONE')
    expect(after?.name).toBe('保留名')
  })

  it('端点 12 空 body → 200 幂等 no-op，整行完全不变', async () => {
    const id = await makeGoal(ctx.db, projectA, '不变名', { description: '不变描述' })
    const before = await goalRow(id)

    const res = await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({})

    expect(res.status).toBe(200)
    expect(await goalRow(id)).toEqual(before)
  })

  it('端点 12 连续 3 次只改单字段 → 每步都只动那一个字段（累积不漂移）', async () => {
    const id = await makeGoal(ctx.db, projectA, 'n0', { description: 'd0' })

    await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ name: 'n1' })
    expect(await goalRow(id)).toMatchObject({ name: 'n1', description: 'd0', status: 'ACTIVE' })

    await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ description: 'd1' })
    expect(await goalRow(id)).toMatchObject({ name: 'n1', description: 'd1', status: 'ACTIVE' })

    await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ status: 'DONE' })
    expect(await goalRow(id)).toMatchObject({ name: 'n1', description: 'd1', status: 'DONE' })
  })

  it('端点 16 只传 status → 活动的 goalId/projectId/sortOrder/name/description 全不变', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    const id = await makeActivity(ctx.db, projectA, goalId, '原活动名', {
      description: '原活动描述',
    })
    const before = await activityRow(id)

    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(id)).send({ status: 'DONE' })

    expect(res.status).toBe(200)
    await expect(activityRow(id)).resolves.toEqual({ ...before, status: 'DONE' })
    const after = await activityRow(id)
    expect(after?.goalId).toBe(goalId)
    expect(after?.projectId).toBe(projectA)
    expect(after?.name).toBe('原活动名')
    expect(after?.description).toBe('原活动描述')
  })

  it('端点 16 只传 name → description 与 status 不被重置', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    const id = await makeActivity(ctx.db, projectA, goalId, '旧活动名', { description: '保留' })
    await ctx.asUser(pmToken).patch(URL_ACTIVITY(id)).send({ status: 'DONE' })
    const before = await activityRow(id)

    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(id)).send({ name: '新活动名' })

    expect(res.status).toBe(200)
    await expect(activityRow(id)).resolves.toEqual({ ...before, name: '新活动名' })
  })

  it('端点 12/16 的 PATCH 不接受 sortOrder 注入（排序只能走端点 14/18）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '排序目标', { sortOrder: 3 })
    const actId = await makeActivity(ctx.db, projectA, goalId, '排序活动', { sortOrder: 5 })

    const r1 = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ sortOrder: 99, name: '改名' })
    expect(r1.status).toBe(200)
    expect((await goalRow(goalId))?.sortOrder).toBe(3)

    const r2 = await ctx.asUser(pmToken).patch(URL_ACTIVITY(actId)).send({ sortOrder: 99 })
    expect(r2.status).toBe(200)
    expect((await activityRow(actId))?.sortOrder).toBe(5)
  })
})

// ===========================================================================
// 3. 跨项目引用（决策 I-10）：必须 404/422 且零副作用
// ===========================================================================

describe('对抗 3：跨项目引用必须被拒绝且不污染另一个项目', () => {
  it('端点 12：PATCH B 项目的目标 → 404，且 B 的行逐字段不变', async () => {
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标', { description: 'B 描述' })
    const before = await goalRow(goalB)

    const res = await ctx.asUser(pmToken).patch(URL_GOAL(goalB)).send({ name: '被篡改' })

    expect(res.status).toBe(404)
    expectNoLeak(res, 'NOT_FOUND')
    expect(await goalRow(goalB)).toEqual(before)
  })

  it('端点 13：DELETE B 项目的目标 → 404，且 B 的行仍在', async () => {
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')

    const res = await ctx.asUser(pmToken).delete(URL_GOAL(goalB))

    expect(res.status).toBe(404)
    expect(await goalRow(goalB)).not.toBeNull()
  })

  it('端点 16：PATCH B 项目的活动 → 404，且 B 的行逐字段不变', async () => {
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const actB = await makeActivity(ctx.db, projectB, goalB, 'B 活动', { description: 'B 活动描述' })
    const before = await activityRow(actB)

    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(actB)).send({ name: '篡改' })

    expect(res.status).toBe(404)
    await expect(activityRow(actB)).resolves.toEqual(before)
  })

  it('端点 17：DELETE B 项目的活动 → 404，且 B 的行仍在', async () => {
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const actB = await makeActivity(ctx.db, projectB, goalB, 'B 活动')

    const res = await ctx.asUser(pmToken).delete(URL_ACTIVITY(actB))

    expect(res.status).toBe(404)
    expect(await activityRow(actB)).not.toBeNull()
  })

  it('端点 15：往 B 项目的目标下挂活动 → 404（跨项目挂载被拒），A 与 B 都零新增', async () => {
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const beforeA = await ctx.db.userActivity.count({ where: { projectId: projectA } })
    const beforeB = await ctx.db.userActivity.count({ where: { projectId: projectB } })

    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalB)).send({ name: '跨项目活动' })

    expect(res.status).toBe(404)
    expect(await ctx.db.userActivity.count({ where: { projectId: projectA } })).toBe(beforeA)
    expect(await ctx.db.userActivity.count({ where: { projectId: projectB } })).toBe(beforeB)
  })

  it('端点 22：DELETE B 项目的故事 → 404，且 B 的故事仍在', async () => {
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const actB = await makeActivity(ctx.db, projectB, goalB, 'B 活动')
    const storyB = await makeStory(ctx.db, projectB, actB)

    const res = await ctx.asUser(pmToken).delete(URL_STORY(storyB))

    expect(res.status).toBe(404)
    expect(await ctx.db.userStory.count({ where: { id: storyB } })).toBe(1)
  })

  it('端点 14：orderedIds 掺入 B 项目的目标 id → 422，且 A 的序号一个都不变', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A1', { sortOrder: 0 })
    const a2 = await makeGoal(ctx.db, projectA, 'A2', { sortOrder: 1 })
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const beforeA = await goalOrders(projectA)
    const beforeB = await goalOrders(projectB)

    // 长度正确（2 个），但其中一个是别的项目的 → 集合不一致
    const res = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [a2, goalB] })

    expect(res.status).toBe(422)
    expectFieldError(res.body as ErrorBody, 'orderedIds', 'INVALID_VALUE')
    expect(await goalOrders(projectA)).toEqual(beforeA)
    expect(await goalOrders(projectB)).toEqual(beforeB)
    // 明确断言：a2 没有被改成 0
    expect((await goalRow(a2))?.sortOrder).toBe(1)
    expect((await goalRow(a1))?.sortOrder).toBe(0)
  })

  it('端点 14：orderedIds 用 B 项目的 id 替换掉 A 的一个 → 422，A 全部序号不变', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A1', { sortOrder: 0 })
    await makeGoal(ctx.db, projectA, 'A2', { sortOrder: 1 })
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const beforeA = await goalOrders(projectA)

    const res = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [a1, goalB] })

    expect(res.status).toBe(422)
    expect(await goalOrders(projectA)).toEqual(beforeA)
  })

  it('端点 18：orderedIds 掺入其它目标的活动 id → 422，序号零变化', async () => {
    const goalA = await makeGoal(ctx.db, projectA, '父目标A')
    const goalOther = await makeGoal(ctx.db, projectA, '父目标Other')
    const a1 = await makeActivity(ctx.db, projectA, goalA, 'A-1', { sortOrder: 0 })
    const a2 = await makeActivity(ctx.db, projectA, goalA, 'A-2', { sortOrder: 1 })
    const foreign = await makeActivity(ctx.db, projectA, goalOther, '别的目标下的活动')
    const before = await activityOrders(goalA)

    const res = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(goalA))
      .send({ orderedIds: [a2, foreign] })

    expect(res.status).toBe(422)
    expectFieldError(res.body as ErrorBody, 'orderedIds', 'INVALID_VALUE')
    expect(await activityOrders(goalA)).toEqual(before)
    void a1
  })

  it('端点 18：orderedIds 掺入 B 项目的活动 id → 422，双方零变化', async () => {
    const goalA = await makeGoal(ctx.db, projectA, '父目标A')
    const actA = await makeActivity(ctx.db, projectA, goalA, 'A 活动', { sortOrder: 0 })
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const actB = await makeActivity(ctx.db, projectB, goalB, 'B 活动', { sortOrder: 0 })
    const beforeA = await activityOrders(goalA)
    const beforeB = await activityOrders(goalB)

    const res = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(goalA))
      .send({ orderedIds: [actB, actA] })

    expect(res.status).toBe(422)
    expect(await activityOrders(goalA)).toEqual(beforeA)
    expect(await activityOrders(goalB)).toEqual(beforeB)
  })

  it('端点 14：orderedIds 长度正确但含重复 id → 422，零副作用', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A1', { sortOrder: 0 })
    await makeGoal(ctx.db, projectA, 'A2', { sortOrder: 1 })
    const before = await goalOrders(projectA)

    const res = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [a1, a1] })

    expect(res.status).toBe(422)
    expect(await goalOrders(projectA)).toEqual(before)
  })

  it('端点 18：orderedIds 缺一个 → 422，零副作用', async () => {
    const goalA = await makeGoal(ctx.db, projectA, '父目标A')
    const a1 = await makeActivity(ctx.db, projectA, goalA, 'A-1', { sortOrder: 0 })
    await makeActivity(ctx.db, projectA, goalA, 'A-2', { sortOrder: 1 })
    const before = await activityOrders(goalA)

    const res = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(goalA))
      .send({ orderedIds: [a1] })

    expect(res.status).toBe(422)
    expect(await activityOrders(goalA)).toEqual(before)
  })

  it('端点 15：请求体注入 projectId 不被采信，归属仍取自父级目标', async () => {
    const goalA = await makeGoal(ctx.db, projectA, '父目标A')

    const res = await ctx.asUser(pmToken)
      .post(URL_ACTIVITIES(goalA))
      .send({ name: '注入归属', projectId: projectB, goalId: MISSING_ID, sortOrder: 999 })

    expect(res.status).toBe(201)
    expect(res.body.projectId).toBe(projectA)
    expect(res.body.goalId).toBe(goalA)
    expect(res.body.sortOrder).toBe(0)
    // 反向核对数据库
    const row = await activityRow(res.body.id)
    expect(row?.projectId).toBe(projectA)
    expect(row?.goalId).toBe(goalA)
  })
})

// ===========================================================================
// 4. 越权与信息泄漏（端点 12–18、22）
// ===========================================================================

describe('对抗 4：越权拒绝与不可区分性', () => {
  it('端点 12：MEMBER/VIEWER → 403；非成员 → 404；未登录 → 401', async () => {
    const id = await makeGoal(ctx.db, projectA, '目标')

    const asMember = await ctx.asUser(memberToken).patch(URL_GOAL(id)).send({ name: 'x' })
    const asViewer = await ctx.asUser(viewerToken).patch(URL_GOAL(id)).send({ name: 'x' })
    const asOutsider = await ctx.asUser(outsiderToken).patch(URL_GOAL(id)).send({ name: 'x' })
    const anon = await ctx.asUser(null).patch(URL_GOAL(id)).send({ name: 'x' })

    expect(asMember.status).toBe(403)
    expect(asViewer.status).toBe(403)
    expect(asOutsider.status).toBe(404)
    expect(anon.status).toBe(401)
    expectNoLeak(asOutsider, 'NOT_FOUND')
    expect((await goalRow(id))?.name).toBe('目标')
  })

  it('端点 15：MEMBER → 403；非成员 → 404；未登录 → 401，且零写入', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    const before = await ctx.db.userActivity.count()

    expect((await ctx.asUser(memberToken).post(URL_ACTIVITIES(goalId)).send({ name: 'x' })).status).toBe(403)
    expect((await ctx.asUser(outsiderToken).post(URL_ACTIVITIES(goalId)).send({ name: 'x' })).status).toBe(404)
    expect((await ctx.asUser(null).post(URL_ACTIVITIES(goalId)).send({ name: 'x' })).status).toBe(401)
    expect(await ctx.db.userActivity.count()).toBe(before)
  })

  it('端点 13/17/22：MEMBER/VIEWER → 403，非成员 → 404，未登录 → 401，且三行全在', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '目标')
    const actId = await makeActivity(ctx.db, projectA, goalId, '活动')
    const storyId = await makeStory(ctx.db, projectA, actId)

    const urls = [URL_GOAL(goalId), URL_ACTIVITY(actId), URL_STORY(storyId)]
    for (const u of urls) {
      expect((await ctx.asUser(memberToken).delete(u)).status).toBe(403)
      expect((await ctx.asUser(viewerToken).delete(u)).status).toBe(403)
      expect((await ctx.asUser(outsiderToken).delete(u)).status).toBe(404)
      expect((await ctx.asUser(null).delete(u)).status).toBe(401)
    }

    expect(await goalRow(goalId)).not.toBeNull()
    expect(await activityRow(actId)).not.toBeNull()
    expect(await ctx.db.userStory.count({ where: { id: storyId } })).toBe(1)
  })

  it('端点 14/18：MEMBER → 403，非成员 → 404，未登录 → 401（先判定权限而非校验形状）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '目标')

    // 故意给非法 body：越权必须先短路，不得用 422 泄漏形状规则
    const m = await ctx.asUser(memberToken).put(URL_GOALS_ORDER(projectA)).send({ orderedIds: 'nope' })
    const o = await ctx.asUser(outsiderToken).put(URL_GOALS_ORDER(projectA)).send({ orderedIds: 'nope' })
    const a = await ctx.asUser(null).put(URL_GOALS_ORDER(projectA)).send({ orderedIds: 'nope' })
    expect(m.status).toBe(403)
    expect(o.status).toBe(404)
    expect(a.status).toBe(401)

    const m2 = await ctx.asUser(memberToken).put(URL_ACTIVITIES_ORDER(goalId)).send({ orderedIds: 'nope' })
    const o2 = await ctx.asUser(outsiderToken).put(URL_ACTIVITIES_ORDER(goalId)).send({ orderedIds: 'nope' })
    const a2 = await ctx.asUser(null).put(URL_ACTIVITIES_ORDER(goalId)).send({ orderedIds: 'nope' })
    expect(m2.status).toBe(403)
    expect(o2.status).toBe(404)
    expect(a2.status).toBe(401)
  })

  it('未登录 + 非法 body → 401（不得先回 422 泄漏字段规则）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '目标')

    expect((await ctx.asUser(null).patch(URL_GOAL(goalId)).send({ name: 123 })).status).toBe(401)
    expect((await ctx.asUser(null).patch(URL_ACTIVITY(MISSING_ID)).send({ name: 123 })).status).toBe(401)
    expect((await ctx.asUser(null).post(URL_GOALS(projectA)).send({})).status).toBe(401)
  })

  it('MEMBER/非成员 + 非法 body → 403/404（不得先回 422）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '目标')

    expect((await ctx.asUser(memberToken).patch(URL_GOAL(goalId)).send({ name: 123 })).status).toBe(403)
    expect((await ctx.asUser(outsiderToken).patch(URL_GOAL(goalId)).send({ name: 123 })).status).toBe(404)
  })

  it('「id 不存在」与「存在但非本成员」的响应结构完全一致（防存在性探测）', async () => {
    const id = await makeGoal(ctx.db, projectA, '秘密目标名')

    const pairs: Array<[ApiResponse, ApiResponse]> = [
      [
        await ctx.asUser(pmToken).patch(URL_GOAL(MISSING_ID)).send({ name: 'x' }),
        await ctx.asUser(outsiderToken).patch(URL_GOAL(id)).send({ name: 'x' }),
      ],
      [
        await ctx.asUser(pmToken).delete(URL_GOAL(MISSING_ID)),
        await ctx.asUser(outsiderToken).delete(URL_GOAL(id)),
      ],
      [
        await ctx.asUser(pmToken).post(URL_ACTIVITIES(MISSING_ID)).send({ name: 'x' }),
        await ctx.asUser(outsiderToken).post(URL_ACTIVITIES(id)).send({ name: 'x' }),
      ],
    ]

    for (const [missingRes, notMemberRes] of pairs) {
      expect(missingRes.status).toBe(notMemberRes.status)
      expect(Object.keys(missingRes.body.error).sort()).toEqual(
        Object.keys(notMemberRes.body.error).sort(),
      )
      // 文案必须逐字相同（契约 I-3：与「对象不存在」完全一致）
      expect(missingRes.body.error.message).toBe(notMemberRes.body.error.message)
    }
  })

  it('403/404 响应体不得泄漏对象名称（含 403 这种「对象可见」的情况）', async () => {
    const id = await makeGoal(ctx.db, projectA, '绝密目标名XYZ')

    const m = await ctx.asUser(memberToken).patch(URL_GOAL(id)).send({ name: 'x' })
    const o = await ctx.asUser(outsiderToken).patch(URL_GOAL(id)).send({ name: 'x' })

    expect(JSON.stringify(m.body)).not.toContain('绝密目标名XYZ')
    expect(JSON.stringify(o.body)).not.toContain('绝密目标名XYZ')
    expect(JSON.stringify(o.body)).not.toContain(id)
  })
})

// ===========================================================================
// 5. 删除保护：409 的可解除性与多态列清理（端点 13/17/22）
// ===========================================================================

describe('对抗 5：删除保护的完整生命周期', () => {
  /**
   * 【重要】本组夹具显式命名为 makeChainNoTask，与既有 requirement.delete.test.ts
   * 的 makeEmptyChain 区分开：后者名为「空链」但实际会造出故事，其活动**有子项**。
   * 本组的名字精确表达「已造到故事、但故事下没有任务」。
   */
  async function makeChainNoTask(tag = '') {
    const goal = await makeGoal(ctx.db, projectA, `目标${tag}`)
    const activity = await makeActivity(ctx.db, projectA, goal, `活动${tag}`)
    const story = await makeStory(ctx.db, projectA, activity)
    return { goal, activity, story }
  }

  it('409 可解除（自下而上）：删故事 → 删活动 → 删目标，三步都 204', async () => {
    const c = await makeChainNoTask()

    // 故事下无任务 → 直接可删
    const dStory = await ctx.asUser(pmToken).delete(URL_STORY(c.story))
    expect(dStory.status).toBe(204)
    expect(dStory.text).toBe('')
    expect(await ctx.db.userStory.count({ where: { id: c.story } })).toBe(0)

    // 活动已无子项 → 可删
    const dAct = await ctx.asUser(pmToken).delete(URL_ACTIVITY(c.activity))
    expect(dAct.status).toBe(204)
    expect(dAct.text).toBe('')
    expect(await activityRow(c.activity)).toBeNull()

    // 目标已无子项 → 可删
    const dGoal = await ctx.asUser(pmToken).delete(URL_GOAL(c.goal))
    expect(dGoal.status).toBe(204)
    expect(dGoal.text).toBe('')
    expect(await goalRow(c.goal)).toBeNull()
  })

  it('每一层的 409 都先于删除发生：三次被拒后三行一条不少', async () => {
    const c = await makeChainNoTask()

    expect((await ctx.asUser(pmToken).delete(URL_GOAL(c.goal))).status).toBe(409)
    expect((await ctx.asUser(pmToken).delete(URL_ACTIVITY(c.activity))).status).toBe(409)

    expect(await goalRow(c.goal)).not.toBeNull()
    expect(await activityRow(c.activity)).not.toBeNull()
    expect(await ctx.db.userStory.count({ where: { id: c.story } })).toBe(1)

    // 409 的 details 必须机器可读地指出是哪个子项关系
    const res = await ctx.asUser(pmToken).delete(URL_GOAL(c.goal))
    expect((res.body as ErrorBody).error.code).toBe('CONFLICT')
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'goalId',
      code: 'HAS_CHILDREN',
    })
  })

  it('三层的 HAS_CHILDREN 各自带对应字段名（goalId / activityId / storyId）', async () => {
    const c = await makeChainNoTask()
    const other = await makeUser(ctx.db, 'a2-tasker', '任务负责人')
    await makeTask(ctx.db, projectA, c.story, pmId, other)

    const dGoal = await ctx.asUser(pmToken).delete(URL_GOAL(c.goal))
    const dAct = await ctx.asUser(pmToken).delete(URL_ACTIVITY(c.activity))
    const dStory = await ctx.asUser(pmToken).delete(URL_STORY(c.story))

    expect((dGoal.body as ErrorBody).error.details).toContainEqual({
      field: 'goalId',
      code: 'HAS_CHILDREN',
    })
    expect((dAct.body as ErrorBody).error.details).toContainEqual({
      field: 'activityId',
      code: 'HAS_CHILDREN',
    })
    expect((dStory.body as ErrorBody).error.details).toContainEqual({
      field: 'storyId',
      code: 'HAS_CHILDREN',
    })
  })

  it('端点 22：故事有任务时 409；删掉任务后同一次删除变 204（409 可解除）', async () => {
    const c = await makeChainNoTask()
    const other = await makeUser(ctx.db, 'a2-tasker2', '任务负责人2')
    const taskId = await makeTask(ctx.db, projectA, c.story, pmId, other)

    const blocked = await ctx.asUser(pmToken).delete(URL_STORY(c.story))
    expect(blocked.status).toBe(409)
    expect(await ctx.db.userStory.count({ where: { id: c.story } })).toBe(1)

    // 解除条件：删掉那个任务
    await ctx.db.task.delete({ where: { id: taskId } })

    const ok = await ctx.asUser(pmToken).delete(URL_STORY(c.story))
    expect(ok.status).toBe(204)
    expect(await ctx.db.userStory.count({ where: { id: c.story } })).toBe(0)
  })

  it('端点 22：连删两次 → 第一次 204，第二次 404（不是 500，也不是 409）', async () => {
    const c = await makeChainNoTask()

    expect((await ctx.asUser(pmToken).delete(URL_STORY(c.story))).status).toBe(204)
    const second = await ctx.asUser(pmToken).delete(URL_STORY(c.story))
    expect(second.status).toBe(404)
    expect((second.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('端点 13/17：连删两次同样 204 → 404', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '可删目标')
    expect((await ctx.asUser(pmToken).delete(URL_GOAL(goalId))).status).toBe(204)
    expect((await ctx.asUser(pmToken).delete(URL_GOAL(goalId))).status).toBe(404)

    const g2 = await makeGoal(ctx.db, projectA, '父目标')
    const a2 = await makeActivity(ctx.db, projectA, g2, '可删活动')
    expect((await ctx.asUser(pmToken).delete(URL_ACTIVITY(a2))).status).toBe(204)
    expect((await ctx.asUser(pmToken).delete(URL_ACTIVITY(a2))).status).toBe(404)
  })

  it('删除故事时清空 ObjectVisibility(story) —— 本故事的记录归零', async () => {
    const c = await makeChainNoTask()
    await makeSensitive(ctx.db, projectA, 'story', c.story, [memberId, viewerId])
    expect(await ctx.db.objectVisibility.count({
      where: { objectType: 'story', objectId: c.story },
    })).toBe(2)

    expect((await ctx.asUser(pmToken).delete(URL_STORY(c.story))).status).toBe(204)

    expect(await ctx.db.objectVisibility.count({
      where: { objectType: 'story', objectId: c.story },
    })).toBe(0)
  })

  it('删除故事**不**牵连其它对象：别 story 的 story 记录、同 story id 的 task 记录逐行不变', async () => {
    const doomed = await makeChainNoTask('D')
    const survivor = await makeChainNoTask('S')

    // doomed 故事：story 白名单 2 条
    await makeSensitive(ctx.db, projectA, 'story', doomed.story, [memberId, viewerId])
    // survivor 故事：story 白名单 1 条（必须原样保留）
    await makeSensitive(ctx.db, projectA, 'story', survivor.story, [memberId])
    // 陷阱：用**同一个 id** 但 objectType='task' 造一条记录，
    // 删除 story 时的清理必须只匹配 objectType='story'，不能把这个多态列记录误删
    await makeSensitive(ctx.db, projectA, 'task', doomed.story, [viewerId])

    const beforeOthers = await ctx.db.objectVisibility.findMany({
      where: { NOT: { objectType: 'story', objectId: doomed.story } },
      select: { projectId: true, objectType: true, objectId: true, userId: true },
      orderBy: [{ objectId: 'asc' }, { userId: 'asc' }],
    })
    expect(beforeOthers).toHaveLength(2)

    expect((await ctx.asUser(pmToken).delete(URL_STORY(doomed.story))).status).toBe(204)

    const afterOthers = await ctx.db.objectVisibility.findMany({
      where: { NOT: { objectType: 'story', objectId: doomed.story } },
      select: { projectId: true, objectType: true, objectId: true, userId: true },
      orderBy: [{ objectId: 'asc' }, { userId: 'asc' }],
    })
    expect(afterOthers).toEqual(beforeOthers)
    // 同 id 的 task 类型记录必须还在
    expect(await ctx.db.objectVisibility.count({
      where: { objectType: 'task', objectId: doomed.story },
    })).toBe(1)
    // survivor 的记录必须还在
    expect(await ctx.db.objectVisibility.count({
      where: { objectType: 'story', objectId: survivor.story },
    })).toBe(1)
  })

  it('删除活动/目标不触碰任何 ObjectVisibility（清理只属于 story 删除）', async () => {
    const c = await makeChainNoTask()
    await makeSensitive(ctx.db, projectA, 'story', c.story, [memberId])
    const before = await ctx.db.objectVisibility.count()
    expect(before).toBe(1)

    // 先删故事会清记录，所以这里先造一个不相关的 story 记录来守住计数
    const keeper = await makeChainNoTask('K')
    await makeSensitive(ctx.db, projectA, 'story', keeper.story, [viewerId])
    const withKeeper = await ctx.db.objectVisibility.count()
    expect(withKeeper).toBe(2)

    // 删活动被 409 拒绝 → 记录不变
    expect((await ctx.asUser(pmToken).delete(URL_ACTIVITY(c.activity))).status).toBe(409)
    expect(await ctx.db.objectVisibility.count()).toBe(withKeeper)

    // 删故事（c.story）→ 只减 1（c 的记录），keeper 的仍在
    expect((await ctx.asUser(pmToken).delete(URL_STORY(c.story))).status).toBe(204)
    expect(await ctx.db.objectVisibility.count()).toBe(withKeeper - 1)
    expect(await ctx.db.objectVisibility.count({
      where: { objectType: 'story', objectId: keeper.story },
    })).toBe(1)

    // 删活动 → 204，keeper 记录仍不变
    expect((await ctx.asUser(pmToken).delete(URL_ACTIVITY(c.activity))).status).toBe(204)
    expect(await ctx.db.objectVisibility.count()).toBe(withKeeper - 1)

    // 删目标 → 204，keeper 记录仍不变
    expect((await ctx.asUser(pmToken).delete(URL_GOAL(c.goal))).status).toBe(204)
    expect(await ctx.db.objectVisibility.count()).toBe(withKeeper - 1)
  })

  it('删除只作用于该行：同项目其它层级的行逐字段不变', async () => {
    const doomed = await makeChainNoTask('X')
    const survivor = await makeChainNoTask('Y')
    const sGoal = await goalRow(survivor.goal)
    const sAct = await activityRow(survivor.activity)

    expect((await ctx.asUser(pmToken).delete(URL_STORY(doomed.story))).status).toBe(204)

    expect(await goalRow(survivor.goal)).toEqual(sGoal)
    expect(await activityRow(survivor.activity)).toEqual(sAct)
  })

  it('删除目标不影响另一个项目的任何行（跨项目隔离）', async () => {
    const goalA = await makeGoal(ctx.db, projectA, 'A 目标')
    const goalB = await makeGoal(ctx.db, projectB, 'B 目标')
    const beforeB = await goalRow(goalB)

    expect((await ctx.asUser(pmToken).delete(URL_GOAL(goalA))).status).toBe(204)

    expect(await goalRow(goalB)).toEqual(beforeB)
  })
})

// ===========================================================================
// 6. 排序端点的幂等与语义（端点 14 / 18）
// ===========================================================================

describe('对抗 6：全量替换排序的幂等与边界', () => {
  it('端点 14：重排后序号是 0..n-1，响应 items 顺序与入参一致', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A')
    const a2 = await makeGoal(ctx.db, projectA, 'B')
    const a3 = await makeGoal(ctx.db, projectA, 'C')

    const res = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [a3, a1, a2] })

    expect(res.status).toBe(200)
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual([a3, a1, a2])
    expect(res.body.items.map((g: { sortOrder: number }) => g.sortOrder)).toEqual([0, 1, 2])
    expect(await goalOrders(projectA)).toEqual([
      { id: a3, sortOrder: 0 },
      { id: a1, sortOrder: 1 },
      { id: a2, sortOrder: 2 },
    ])
  })

  it('端点 14：重复调用同一入参是幂等的（两次结果完全相同）', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A')
    const a2 = await makeGoal(ctx.db, projectA, 'B')

    const first = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [a2, a1] })
    const second = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [a2, a1] })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.items.map((g: { id: string }) => g.id)).toEqual(
      first.body.items.map((g: { id: string }) => g.id),
    )
    expect(await goalOrders(projectA)).toEqual([
      { id: a2, sortOrder: 0 },
      { id: a1, sortOrder: 1 },
    ])
  })

  it('端点 14：反向排列（[A,B] → [B,A]）不会因唯一性约束而失败', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A')
    const a2 = await makeGoal(ctx.db, projectA, 'B')

    const res = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [a2, a1] })

    expect(res.status).toBe(200)
    expect(await goalOrders(projectA)).toEqual([
      { id: a2, sortOrder: 0 },
      { id: a1, sortOrder: 1 },
    ])
  })

  it('端点 14：空项目 + 空数组 → 200 且 items 为空（不是 422）', async () => {
    const res = await ctx.asUser(pmToken).put(URL_GOALS_ORDER(projectA)).send({ orderedIds: [] })

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  it('端点 14：空项目 + 非空数组 → 422，不写入任何行', async () => {
    const res = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [MISSING_ID] })

    expect(res.status).toBe(422)
    expect(await goalOrders(projectA)).toEqual([])
  })

  it('端点 14：orderedIds 缺字段 / 非数组 / 含非字符串 → 422，零副作用', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A', { sortOrder: 0 })
    const before = await goalOrders(projectA)

    for (const body of [
      {},
      { orderedIds: 'nope' },
      { orderedIds: [1, 2] },
      { orderedIds: null },
      { orderedIds: [null] },
    ]) {
      const res = await ctx.asUser(pmToken).put(URL_GOALS_ORDER(projectA)).send(body)
      expect(res.status).toBe(422)
    }
    expect(await goalOrders(projectA)).toEqual(before)
    expect((await goalRow(a1))?.sortOrder).toBe(0)
  })

  it('端点 18：重排后序号 0..n-1 且只影响该目标下的活动', async () => {
    const goalA = await makeGoal(ctx.db, projectA, '父目标A')
    const goalOther = await makeGoal(ctx.db, projectA, '父目标Other')
    const a1 = await makeActivity(ctx.db, projectA, goalA, 'A-1')
    const a2 = await makeActivity(ctx.db, projectA, goalA, 'A-2')
    const otherAct = await makeActivity(ctx.db, projectA, goalOther, '别的活动')
    const beforeOther = await activityOrders(goalOther)

    const res = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(goalA))
      .send({ orderedIds: [a2, a1] })

    expect(res.status).toBe(200)
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual([a2, a1])
    expect(await activityOrders(goalA)).toEqual([
      { id: a2, sortOrder: 0 },
      { id: a1, sortOrder: 1 },
    ])
    // 另一个目标下的活动完全不受影响
    expect(await activityOrders(goalOther)).toEqual(beforeOther)
    expect((await activityRow(otherAct))?.sortOrder).toBe(0)
  })

  it('端点 18：幂等（重复同一入参两次结果相同）', async () => {
    const goalA = await makeGoal(ctx.db, projectA, '父目标A')
    const a1 = await makeActivity(ctx.db, projectA, goalA, 'A-1')
    const a2 = await makeActivity(ctx.db, projectA, goalA, 'A-2')

    await ctx.asUser(pmToken).put(URL_ACTIVITIES_ORDER(goalA)).send({ orderedIds: [a2, a1] })
    const again = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(goalA))
      .send({ orderedIds: [a2, a1] })

    expect(again.status).toBe(200)
    expect(await activityOrders(goalA)).toEqual([
      { id: a2, sortOrder: 0 },
      { id: a1, sortOrder: 1 },
    ])
  })

  it('端点 18：目标下无活动 + 空数组 → 200；非空数组 → 422', async () => {
    const goalA = await makeGoal(ctx.db, projectA, '空父目标')

    const ok = await ctx.asUser(pmToken).put(URL_ACTIVITIES_ORDER(goalA)).send({ orderedIds: [] })
    expect(ok.status).toBe(200)
    expect(ok.body.items).toEqual([])

    const bad = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(goalA))
      .send({ orderedIds: [MISSING_ID] })
    expect(bad.status).toBe(422)
    expect(await activityOrders(goalA)).toEqual([])
  })

  it('端点 14/18：目标不存在 → 404（不是 422，也不产生 500）', async () => {
    const g = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(MISSING_ID))
      .send({ orderedIds: [] })
    expect(g.status).toBe(404)
    expect((g.body as ErrorBody).error.code).toBe('NOT_FOUND')

    const a = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(MISSING_ID))
      .send({ orderedIds: [] })
    expect(a.status).toBe(404)
    expect((a.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('端点 14/18：并发同权重排不产生重复序号（同一项目被同时重排）', async () => {
    const a1 = await makeGoal(ctx.db, projectA, 'A')
    const a2 = await makeGoal(ctx.db, projectA, 'B')
    const a3 = await makeGoal(ctx.db, projectA, 'C')

    const results = await Promise.all([
      ctx.asUser(pmToken).put(URL_GOALS_ORDER(projectA)).send({ orderedIds: [a1, a2, a3] }),
      ctx.asUser(pmToken).put(URL_GOALS_ORDER(projectA)).send({ orderedIds: [a3, a2, a1] }),
      ctx.asUser(pmToken).put(URL_GOALS_ORDER(projectA)).send({ orderedIds: [a2, a1, a3] }),
    ])

    // 无论以哪种顺序串行化，最终序号集合必须是 {0,1,2} 且互不重复
    expect(results.every((r) => r.status === 200)).toBe(true)
    const final = await goalOrders(projectA)
    expect(final.map((r) => r.sortOrder)).toEqual([0, 1, 2])
    expect(new Set(final.map((r) => r.id)).size).toBe(3)
  })
})

// ===========================================================================
// 7. 响应形状（契约 I-2 / I-3）
// ===========================================================================

describe('对抗 7：响应形状精确匹配契约类型', () => {
  it('端点 12 响应键集合精确等于 BusinessGoal（不得多给 createdAt/sortOrder 以外的字段）', async () => {
    const id = await makeGoal(ctx.db, projectA, '目标')

    const res = await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ name: '新名' })

    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(GOAL_KEYS)
    expect(res.body).not.toHaveProperty('createdAt')
    expect(res.body).not.toHaveProperty('activities')
  })

  it('端点 16 响应键集合精确等于 UserActivity', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    const id = await makeActivity(ctx.db, projectA, goalId, '活动')

    const res = await ctx.asUser(pmToken).patch(URL_ACTIVITY(id)).send({ name: '新活动名' })

    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(ACTIVITY_KEYS)
  })

  it('端点 15 响应键集合精确等于 UserActivity，status 默认 ACTIVE、description 为 null', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')

    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '活动' })

    expect(res.status).toBe(201)
    expect(Object.keys(res.body).sort()).toEqual(ACTIVITY_KEYS)
    expect(res.body.status).toBe('ACTIVE')
    expect(res.body.description).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(res.body, 'description')).toBe(true)
  })

  it('端点 14/18 响应是 { items: [...] } 列表包装，元素键集合精确', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    const actId = await makeActivity(ctx.db, projectA, goalId, '活动')

    const goals = await ctx.asUser(pmToken)
      .put(URL_GOALS_ORDER(projectA))
      .send({ orderedIds: [goalId] })
    expect(Object.keys(goals.body)).toEqual(['items'])
    expect(Object.keys(goals.body.items[0]).sort()).toEqual(GOAL_KEYS)

    const acts = await ctx.asUser(pmToken)
      .put(URL_ACTIVITIES_ORDER(goalId))
      .send({ orderedIds: [actId] })
    expect(Object.keys(acts.body)).toEqual(['items'])
    expect(Object.keys(acts.body.items[0]).sort()).toEqual(ACTIVITY_KEYS)
  })

  it('端点 13/17/22 成功响应为 204 且响应体为空（契约 I-3）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '目标')
    const actId = await makeActivity(ctx.db, projectA, goalId, '活动')
    const storyId = await makeStory(ctx.db, projectA, actId)

    const ds = await ctx.asUser(pmToken).delete(URL_STORY(storyId))
    const da = await ctx.asUser(pmToken).delete(URL_ACTIVITY(actId))
    const dg = await ctx.asUser(pmToken).delete(URL_GOAL(goalId))

    for (const r of [ds, da, dg]) {
      expect(r.status).toBe(204)
      expect(r.text).toBe('')
      expect(r.body).toEqual({})
    }
  })

  it('端点 12/16：PATCH 响应里的 projectId 与 sortOrder 与库中一致（不返回伪造值）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '目标', { sortOrder: 4 })
    const actId = await makeActivity(ctx.db, projectA, goalId, '活动', { sortOrder: 9 })

    const g = await ctx.asUser(pmToken).patch(URL_GOAL(goalId)).send({ status: 'DONE' })
    expect(g.body.projectId).toBe(projectA)
    expect(g.body.sortOrder).toBe(4)

    const a = await ctx.asUser(pmToken).patch(URL_ACTIVITY(actId)).send({ status: 'DONE' })
    expect(a.body.projectId).toBe(projectA)
    expect(a.body.goalId).toBe(goalId)
    expect(a.body.sortOrder).toBe(9)
  })
})

// ===========================================================================
// 8. 字段校验边界（端点 15 / 12 / 16）
// ===========================================================================

describe('对抗 8：校验边界与零副作用', () => {
  it('端点 15：name 纯空白 → 422 REQUIRED，且不写入任何行', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    const before = await ctx.db.userActivity.count()

    for (const bad of ['   ', '\t', '\u3000', '\n']) {
      const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: bad })
      expect(res.status).toBe(422)
      expectFieldError(res.body as ErrorBody, 'name', 'REQUIRED')
    }
    expect(await ctx.db.userActivity.count()).toBe(before)
  })

  it('端点 15：name 超长 → 422 TOO_LONG；合法边界值被接受', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')

    const tooLong = await ctx.asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .send({ name: 'a'.repeat(999) })
    expect(tooLong.status).toBe(422)
    expectFieldError(tooLong.body as ErrorBody, 'name', 'TOO_LONG')

    const okBoundary = await ctx.asUser(pmToken)
      .post(URL_ACTIVITIES(goalId))
      .send({ name: 'a'.repeat(50) })
    expect(okBoundary.status).toBe(201)
  })

  it('端点 15：name 类型错误 → 422，details 定位到 name', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')

    for (const bad of [123, null, true, ['x'], { a: 1 }] as unknown[]) {
      const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: bad })
      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('name')
    }
  })

  it('端点 12：status 非法值 → 422 INVALID_VALUE；合法值 ACTIVE/DONE 被接受', async () => {
    const id = await makeGoal(ctx.db, projectA, '目标')

    const bad = await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ status: 'FINISHED' })
    expect(bad.status).toBe(422)
    expectFieldError(bad.body as ErrorBody, 'status', 'INVALID_VALUE')

    expect((await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ status: 'ACTIVE' })).status).toBe(200)
    expect((await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ status: 'DONE' })).status).toBe(200)
  })

  it('端点 12：name 出现但为纯空白 → 422；name 完全缺席才是合法 no-op', async () => {
    const id = await makeGoal(ctx.db, projectA, '原名')

    const blank = await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ name: '  ' })
    expect(blank.status).toBe(422)
    expectFieldError(blank.body as ErrorBody, 'name', 'REQUIRED')
    expect((await goalRow(id))?.name).toBe('原名')

    // 缺席 → 合法（部分更新最易写错处）
    expect((await ctx.asUser(pmToken).patch(URL_GOAL(id)).send({ status: 'DONE' })).status).toBe(200)
    expect((await goalRow(id))?.name).toBe('原名')
  })

  it('端点 16：name 出现但为纯空白 → 422；status 非法 → 422 INVALID_VALUE', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')
    const id = await makeActivity(ctx.db, projectA, goalId, '原名')

    const blank = await ctx.asUser(pmToken).patch(URL_ACTIVITY(id)).send({ name: '\t\t' })
    expect(blank.status).toBe(422)
    expectFieldError(blank.body as ErrorBody, 'name', 'REQUIRED')

    const badStatus = await ctx.asUser(pmToken).patch(URL_ACTIVITY(id)).send({ status: 'X' })
    expect(badStatus.status).toBe(422)
    expectFieldError(badStatus.body as ErrorBody, 'status', 'INVALID_VALUE')

    expect((await activityRow(id))?.name).toBe('原名')
  })

  it('端点 11/15：校验失败后首次成功创建仍拿到 sortOrder = 0（失败不占号）', async () => {
    const goalId = await makeGoal(ctx.db, projectA, '父目标')

    await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '   ' })
    await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: 'a'.repeat(999) })
    await ctx.asUser(memberToken).post(URL_ACTIVITIES(goalId)).send({ name: 'x' })

    const res = await ctx.asUser(pmToken).post(URL_ACTIVITIES(goalId)).send({ name: '第一次成功' })
    expect(res.status).toBe(201)
    expect(res.body.sortOrder).toBe(0)
  })

  it('端点 12/16：PATCH 不存在的 id → 404，且不产生任何写入', async () => {
    const before = await ctx.db.businessGoal.count()

    const g = await ctx.asUser(pmToken).patch(URL_GOAL(MISSING_ID)).send({ name: 'x' })
    const a = await ctx.asUser(pmToken).patch(URL_ACTIVITY(MISSING_ID)).send({ name: 'x' })

    expect(g.status).toBe(404)
    expect(a.status).toBe(404)
    expect(await ctx.db.businessGoal.count()).toBe(before)
  })
})
