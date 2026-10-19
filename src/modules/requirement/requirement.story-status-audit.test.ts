/**
 * 端点 21 —— 用户故事**状态变更审计**回归（本地 #18 / C13 授权落地）
 *
 * 授权依据：`DECISIONS.md` `legacy.requirement-status-audit-authorization`
 *   仅授权为 `updateUserStory` 补「① `AuditLog` 记录 ② 事件提交点（类型占位、
 *   **本批不接线**）」，**不得**改鉴权、不得改其他行为、不得新增端点。
 * 权限依据：`DECISIONS.md` `permissions.story-status-write`
 *   故事状态写入**不扩权** —— 唯一写路径仍是端点 21，`requirement.write`（**仅 PM**）。
 *
 * 为什么单独一个文件（而不是塞进 `requirement.story-read-update.test.ts`）
 *   授权只覆盖 `service.ts` 的 `updateUserStory` 与「必要测试」；新建文件避免在
 *   已验收的 T3.7 测试里制造无关 diff，也让「审计口径」这一组断言集中可读。
 *
 * 测试约定（同 T3.7）：只走 HTTP seam（supertest）、只断言状态码与响应体/库内行，
 * **不断言中文文案**；每个用例自建项目与故事。
 *
 * 本文件钉住的口径（每条都对应一个「不该写审计」的反例）：
 *   ① `status` 真实变化 → **写一条** `AuditLog`，字段与 before/after 正确；
 *   ② 只改 `title` 等非状态字段 → **不写**审计；
 *   ③ `status` 传相同值 → 更新照旧（200），但**不写**审计；
 *   ④ 空补丁 `{}` → 只读（200 + 行不变），**不写**审计；
 *   ⑤ 目标不存在 → 404，**不写**审计（也没有可记的对象）；
 *   ⑥ MEMBER / VIEWER 调端点 21 → **403**（不得只靠前端隐藏写控件）；
 *   ⑦ 越权 / 404 请求**零副作用**：故事行与审计表都不变。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { makeActivity, makeGoal, makeStory } from './test-fixtures.js'

let ctx: HttpTestContext
let pmId: string
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string

let projectId: string
let activityId: string
let storyId: string

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

const URL_STORY = (id: string) => `/stories/${id}`
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 审计动作名与对象类型（本批新增的唯一一组取值）。 */
const ACTION = 'story.status'
const OBJECT_TYPE = 'story'

/** 读该故事的审计行（按创建时间升序，便于断言「有几条、顺序如何」）。 */
async function auditRows(storyIdToRead: string) {
  return ctx.db.auditLog.findMany({
    where: { objectType: OBJECT_TYPE, objectId: storyIdToRead },
    orderBy: { createdAt: 'asc' },
  })
}

/** 读故事整行（原始 Prisma 行），用于断言「未被改动」。 */
async function readStoryRow(id: string) {
  return ctx.db.userStory.findUnique({ where: { id } })
}

beforeAll(async () => {
  ctx = await createHttpTestContext()
  // 不手动 register 插件：buildApp() → registerRoutes() 已注册（同 T3.7）
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pmId = await makeUser(ctx.db, 't18-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't18-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't18-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't18-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T18 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  const goalId = await makeGoal(ctx.db, projectId, 'T18 目标')
  activityId = await makeActivity(ctx.db, projectId, goalId, 'T18 活动')
  // 表默认 status = 'DRAFT'（决策 I-7），审计的 before 从它起算
  storyId = await makeStory(ctx.db, projectId, activityId)

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

describe('状态变更 → 写审计', () => {
  it('DRAFT → PLANNING：写一条 story.status 审计，who/when/what 与 before/after 均正确', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'PLANNING' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('PLANNING')

    const rows = await auditRows(storyId)
    expect(rows).toHaveLength(1)
    const log = rows[0]!

    // 操作者取自会话（服务端可信，不接受客户端自报）
    expect(log.actorUserId).toBe(pmId)
    // 归属取自故事行本身（不从请求体推导）
    expect(log.projectId).toBe(projectId)
    expect(log.action).toBe(ACTION)
    expect(log.objectType).toBe(OBJECT_TYPE)
    expect(log.objectId).toBe(storyId)
    // before / after 是 JSON 字符串，形如 {"status":"DRAFT"} → {"status":"PLANNING"}
    expect(log.before).toBe(JSON.stringify({ status: 'DRAFT' }))
    expect(log.after).toBe(JSON.stringify({ status: 'PLANNING' }))
    expect(JSON.parse(log.after ?? 'null')).toEqual({ status: 'PLANNING' })
    // when = 库写入时间
    expect(log.createdAt).toBeInstanceOf(Date)
  })

  it('连续两次变更 → 两条审计，前后值首尾相接（DRAFT→PLANNING→DONE）', async () => {
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'PLANNING' })
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })

    const rows = await auditRows(storyId)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.before)).toEqual([
      JSON.stringify({ status: 'DRAFT' }),
      JSON.stringify({ status: 'PLANNING' }),
    ])
    expect(rows.map((row) => row.after)).toEqual([
      JSON.stringify({ status: 'PLANNING' }),
      JSON.stringify({ status: 'DONE' }),
    ])
  })

  it('状态变更 + 同时改其它字段 → 审计只记状态（不为全字段审计扩权）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({ title: '改过的标题', priority: 'P1', status: 'DONE' })

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('改过的标题')

    const rows = await auditRows(storyId)
    expect(rows).toHaveLength(1)
    // before / after 只含 status 键：本批不扩权到「其余 8 字段一并审计」
    expect(Object.keys(JSON.parse(rows[0]!.before ?? '{}'))).toEqual(['status'])
    expect(Object.keys(JSON.parse(rows[0]!.after ?? '{}'))).toEqual(['status'])
  })
})

describe('不该写审计的情形（三个反例）', () => {
  it('只改 title（非状态字段）→ 200，但不写审计', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ title: '只改标题' })

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('只改标题')
    expect(await auditRows(storyId)).toHaveLength(0)
  })

  it('status 传相同值（DRAFT → DRAFT）→ 更新照旧 200，但不写审计', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'DRAFT' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('DRAFT')
    // 审计记录的是「真实发生的变化」，不是「有人发过请求」
    expect(await auditRows(storyId)).toHaveLength(0)
  })

  it('空补丁 {} → 200 + 故事逐字段不变，且不写审计（只读分支）', async () => {
    const before = await readStoryRow(storyId)

    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({})

    expect(res.status).toBe(200)
    expect(await readStoryRow(storyId)).toEqual(before)
    expect(await auditRows(storyId)).toHaveLength(0)
  })

  it('目标不存在 → 404 NOT_FOUND，且不写任何审计（也没有可记的对象）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(MISSING_ID)).send({ status: 'DONE' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await ctx.db.auditLog.count()).toBe(0)
  })
})

describe('越权 / 跨项目：403 与 404 的零副作用（服务端才是权威，不靠前端隐藏控件）', () => {
  it('MEMBER 改状态 → 403 FORBIDDEN，且故事与审计都不变', async () => {
    const before = await readStoryRow(storyId)

    const res = await ctx.asUser(memberToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(await readStoryRow(storyId)).toEqual(before)
    expect(await auditRows(storyId)).toHaveLength(0)
  })

  it('VIEWER 改状态 → 403 FORBIDDEN，且故事与审计都不变', async () => {
    const before = await readStoryRow(storyId)

    const res = await ctx.asUser(viewerToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(await readStoryRow(storyId)).toEqual(before)
    expect(await auditRows(storyId)).toHaveLength(0)
  })

  it('非项目成员改状态 → 404 NOT_FOUND，且故事与审计都不变', async () => {
    const before = await readStoryRow(storyId)

    const res = await ctx.asUser(outsiderToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await readStoryRow(storyId)).toEqual(before)
    expect(await auditRows(storyId)).toHaveLength(0)
  })

  it('status 非法取值（ACTIVE，属 GoalStatus）→ 422，且不写审计', async () => {
    const before = await readStoryRow(storyId)

    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'ACTIVE' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toEqual([
      { field: 'status', code: 'INVALID_VALUE' },
    ])
    expect(await readStoryRow(storyId)).toEqual(before)
    expect(await auditRows(storyId)).toHaveLength(0)
  })
})
