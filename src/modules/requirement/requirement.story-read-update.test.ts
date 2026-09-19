/**
 * 端点 20 / 21 —— 用户故事详情与编辑接口测试（T3.7）
 *
 * 为什么两个端点共用一个文件
 *   两者都建立在「按 id 取故事（含敏感可见性判定）→ 返回 UserStory」这同一条链路上，
 *   差别只有权限动作（`project.read` vs `requirement.write`）与是否写回。
 *   放在一起更容易看出「读与写在鉴权与 404 语义上的一致性」。
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：端点 20 正 3 反 6、端点 21 正 12 反 22。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员、目标、活动、故事。
 *
 * 本文件独有的四组要点：
 *   ① **端点 20 是读动作，正确结果里没有 403** —— 项目成员读非敏感故事应当 200，
 *      拒绝只有 404 一种形态，且契约明写「不存在 / 非项目成员 / 敏感且未授权，
 *      三者响应一致」，本文件直接对比三者的响应结构与文案；
 *   ② **端点 21 的 `status` 是 `StoryStatus`（DRAFT/PLANNING/DONE），不是
 *      `GoalStatus`（ACTIVE/DONE）** —— 决策 I-1 专门警告过这个陷阱。
 *      传 `'ACTIVE'` 必须 422 而不是被接受，这是本文件最关键的一条反例；
 *   ③ **`isSensitive` 不得通过端点 21 修改**（契约 I-8 端点 21：「不含 isSensitive」）——
 *      请求体注入 `isSensitive: true` 必须被静默丢弃，库内仍为 false；
 *   ④ 部分更新的核心断言：**未被提到的字段逐字段保持不变**（整行比对）。
 *
 * 契约依据：决策 I-8 端点 20 / 21
 *   20: 响应 200 UserStory；错误 404（不存在 / 非项目成员 / 敏感且未授权，三者一致）
 *   21: 请求 { title?, roleText?, capabilityText?, valueText?, businessValue?,
 *              priority?, status?, acceptanceCriteria? }（不含 isSensitive）
 *       响应 200 UserStory；错误 403 / 404 / 422；部分更新
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { makeActivity, makeGoal, makeSensitive, makeStory } from './test-fixtures.js'
import { STORY_TEXT_MAX_LENGTH } from './schemas.js'

let ctx: HttpTestContext
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let memberId: string

let projectId: string
let goalId: string
let activityId: string
let storyId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_STORY = (id: string) => `/stories/${id}`

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 直接读库取故事整行（原始 Prisma 行，含 Date 类型），用于逐字段比对。 */
async function readStoryRow(id: string) {
  return ctx.db.userStory.findUnique({ where: { id } })
}

/**
 * beforeEach 造出的故事的基准整行断言值。
 * 夹具 `makeStory` 已给三段式与业务价值默认值，故这里与契约字段逐一对齐。
 */
function baselineStory() {
  return {
    id: storyId,
    projectId,
    activityId,
    title: '测试故事',
    roleText: '项目经理',
    capabilityText: '建立业务目标',
    valueText: '结构化梳理需求',
    businessValue: '提升需求可追溯性',
    priority: 'P0',
    status: 'DRAFT',
    acceptanceCriteria: null,
    isSensitive: false,
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

  const pmId = await makeUser(ctx.db, 't37-pm', '项目经理')
  memberId = await makeUser(ctx.db, 't37-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't37-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't37-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.7 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  goalId = await makeGoal(ctx.db, projectId, 'T3.7 目标')
  activityId = await makeActivity(ctx.db, projectId, goalId, 'T3.7 活动')
  storyId = await makeStory(ctx.db, projectId, activityId)

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 端点 20 —— GET /stories/:storyId
// ===========================================================================

describe('端点 20 正例：读取用户故事详情', () => {
  it('PM 读取 → 200，返回完整 UserStory（13 字段，含 isSensitive 与 createdAt）', async () => {
    const res = await ctx.asUser(pmToken).get(URL_STORY(storyId))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ...baselineStory(),
      createdAt: expect.any(String),
    })
  })

  it('MEMBER 读取非敏感故事 → 200（读动作允许；端点 20 的正确结果里没有 403）', async () => {
    const res = await ctx.asUser(memberToken).get(URL_STORY(storyId))

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(storyId)
  })

  it('VIEWER 读取 → 200（本轮 VIEWER 为全项目只读）', async () => {
    const res = await ctx.asUser(viewerToken).get(URL_STORY(storyId))

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(storyId)
    expect(Object.keys(res.body).sort()).toEqual([
      'acceptanceCriteria',
      'activityId',
      'businessValue',
      'capabilityText',
      'createdAt',
      'id',
      'isSensitive',
      'priority',
      'projectId',
      'roleText',
      'status',
      'title',
      'valueText',
    ])
  })
})

describe('端点 20 反例：三种 404 必须完全一致', () => {
  it('非项目成员读取 → 404 NOT_FOUND', async () => {
    const res = await ctx.asUser(outsiderToken).get(URL_STORY(storyId))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('storyId 不存在 → 404 NOT_FOUND', async () => {
    const res = await ctx.asUser(pmToken).get(URL_STORY(MISSING_ID))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('敏感且未授权（成员不在可见名单）→ 404 NOT_FOUND', async () => {
    // 把故事标为敏感，白名单只给 PM —— memberId 不在名单内
    await ctx.db.userStory.update({ where: { id: storyId }, data: { isSensitive: true } })
    await makeSensitive(ctx.db, projectId, 'story', storyId, [])

    const res = await ctx.asUser(memberToken).get(URL_STORY(storyId))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('敏感故事对 PM 仍可见 → 200（PM 不受敏感白名单限制）', async () => {
    await ctx.db.userStory.update({ where: { id: storyId }, data: { isSensitive: true } })

    const res = await ctx.asUser(pmToken).get(URL_STORY(storyId))

    expect(res.status).toBe(200)
    expect(res.body.isSensitive).toBe(true)
  })

  it('三种 404（不存在 / 非成员 / 敏感未授权）的状态码、键集合与文案**完全一致**', async () => {
    // 契约 I-8 端点 20 明写：「不存在、非项目成员、或敏感且未授权 —— 三者响应一致」。
    // 这条断言是本端点的核心：任何响应差异都会让调用方探测出「故事是否存在」或
    // 「故事是否敏感」，从而违反 AC-US-02/03 的「不泄漏存在性」。
    await ctx.db.userStory.update({ where: { id: storyId }, data: { isSensitive: true } })

    const missing = await ctx.asUser(pmToken).get(URL_STORY(MISSING_ID))
    const notMember = await ctx.asUser(outsiderToken).get(URL_STORY(storyId))
    const sensitive = await ctx.asUser(memberToken).get(URL_STORY(storyId))

    expect(missing.status).toBe(404)
    expect(notMember.status).toBe(404)
    expect(sensitive.status).toBe(404)

    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect(Object.keys(sensitive.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())

    const message = (missing.body as ErrorBody).error.message
    expect((notMember.body as ErrorBody).error.message).toBe(message)
    expect((sensitive.body as ErrorBody).error.message).toBe(message)

    // 响应体里不得出现故事的标题或活动名
    expect(JSON.stringify(sensitive.body)).not.toContain('测试故事')
    expect(JSON.stringify(sensitive.body)).not.toContain('T3.7 活动')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于存在性）', async () => {
    const res = await ctx.asUser(null).get(URL_STORY(storyId))

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('storyId 属于另一个项目 → 404，且响应体不含那个故事的任何字段', async () => {
    const otherPmId = await makeUser(ctx.db, 't37-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别的活动')
    const otherStoryId = await makeStory(ctx.db, otherProjectId, otherActivityId, { title: '绝密故事XYZ' })

    const res = await ctx.asUser(pmToken).get(URL_STORY(otherStoryId))

    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain('绝密故事XYZ')
  })
})

// ===========================================================================
// 端点 21 —— PATCH /stories/:storyId
// ===========================================================================

describe('端点 21 正例：部分更新用户故事', () => {
  it('只改 title → 200，其余 11 个字段逐字段不变', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ title: '改后的标题' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baselineStory(), title: '改后的标题', createdAt: expect.any(String) })
    // 反向核对数据库整行（createdAt 为 Date 类型，单独取出比对）
    const row = await readStoryRow(storyId)
    expect(row?.title).toBe('改后的标题')
    expect(row?.roleText).toBe('项目经理')
    expect(row?.capabilityText).toBe('建立业务目标')
    expect(row?.valueText).toBe('结构化梳理需求')
    expect(row?.businessValue).toBe('提升需求可追溯性')
    expect(row?.priority).toBe('P0')
    expect(row?.status).toBe('DRAFT')
    expect(row?.acceptanceCriteria).toBeNull()
    expect(row?.isSensitive).toBe(false)
  })

  it('三段式三个字段可各自独立修改（互不影响）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({ roleText: '项目成员', capabilityText: '新建活动', valueText: '保证归属清晰' })

    expect(res.status).toBe(200)
    expect(res.body.roleText).toBe('项目成员')
    expect(res.body.capabilityText).toBe('新建活动')
    expect(res.body.valueText).toBe('保证归属清晰')
    expect(res.body.title).toBe('测试故事')
  })

  it('status 可改为 PLANNING 与 DONE（StoryStatus 的三个取值都被接受）', async () => {
    const planning = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'PLANNING' })
    expect(planning.status).toBe(200)
    expect(planning.body.status).toBe('PLANNING')

    const done = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })
    expect(done.status).toBe(200)
    expect(done.body.status).toBe('DONE')

    const back = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'DRAFT' })
    expect(back.status).toBe(200)
    expect(back.body.status).toBe('DRAFT')
  })

  it('priority 可改为 P1 / P2，businessValue 可修改', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({ priority: 'P2', businessValue: '降低返工成本' })

    expect(res.status).toBe(200)
    expect(res.body.priority).toBe('P2')
    expect(res.body.businessValue).toBe('降低返工成本')
  })

  it('acceptanceCriteria 可填写、可改为空串（空串与"缺省"必须可区分）', async () => {
    const filled = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({ acceptanceCriteria: '当保存时应持久化' })
    expect(filled.status).toBe(200)
    expect(filled.body.acceptanceCriteria).toBe('当保存时应持久化')

    const emptied = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ acceptanceCriteria: '' })
    expect(emptied.status).toBe(200)
    expect(emptied.body.acceptanceCriteria).toBe('')
  })

  it('请求体为 {} → 200 且资源完全不变（契约未定义该情形，按现状钉住幂等 no-op）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...baselineStory(), createdAt: expect.any(String) })
  })

  it('三个文本字段两端空白被 trim 后存储', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({ title: '  有空格  ', roleText: '  角色  ' })

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('有空格')
    expect(res.body.roleText).toBe('角色')
  })

  it('部分更新可累积：多次 PATCH 各改一个字段，全部留在库里', async () => {
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ title: '第一步' })
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ priority: 'P1' })
    const third = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'PLANNING' })

    expect(third.body.title).toBe('第一步')
    expect(third.body.priority).toBe('P1')
    expect(third.body.status).toBe('PLANNING')
    expect(third.body.businessValue).toBe('提升需求可追溯性')
  })

  it('⚠️ isSensitive 不得通过端点 21 修改：注入 isSensitive: true 被静默丢弃', async () => {
    // 契约 I-8 端点 21 明写「不含 isSensitive —— 该字段只能通过端点 23 修改」。
    // 端点 23 属 T2.3/T2.4，尚未实现；若本端点能改敏感标记，
    // 就等于在权限模块到位前开了一条绕过敏感管控的写路径。
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({ title: '顺手改标题', isSensitive: true })

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('顺手改标题')
    expect(res.body.isSensitive).toBe(false)
    expect((await readStoryRow(storyId))?.isSensitive).toBe(false)
  })

  it('请求体注入 projectId/activityId/createdAt → 全部被丢弃，归属与创建时间不变', async () => {
    const before = await readStoryRow(storyId)
    const otherGoalId = await makeGoal(ctx.db, projectId, '另一个目标')
    const otherActivityId = await makeActivity(ctx.db, projectId, otherGoalId, '另一个活动')

    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({
        title: '注入测试',
        projectId: MISSING_ID,
        activityId: otherActivityId,
        createdAt: '2000-01-01T00:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(res.body.projectId).toBe(projectId)
    expect(res.body.activityId).toBe(activityId)
    expect(new Date(res.body.createdAt).getTime()).toBe(before?.createdAt.getTime())
    expect((await readStoryRow(storyId))?.activityId).toBe(activityId)
  })

  it('五个文本字段恰好为长度上限 → 200（边界正例，与 TOO_LONG 反例配对）', async () => {
    const max = 'a'.repeat(STORY_TEXT_MAX_LENGTH)
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .send({ title: max, roleText: max, capabilityText: max, valueText: max, businessValue: max })

    expect(res.status).toBe(200)
    expect(res.body.title).toHaveLength(STORY_TEXT_MAX_LENGTH)
  })

  it('只影响被改的故事：同活动下另一个故事逐字段不变', async () => {
    const otherStoryId = await makeStory(ctx.db, projectId, activityId, { title: '另一个故事' })
    const otherBefore = await readStoryRow(otherStoryId)

    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ title: '只改这个', status: 'DONE' })

    expect(await readStoryRow(otherStoryId)).toEqual(otherBefore)
  })
})

describe('端点 21 反例：权限（401 / 403 / 404）', () => {
  it('MEMBER 更新 → 403 FORBIDDEN', async () => {
    const res = await ctx.asUser(memberToken).patch(URL_STORY(storyId)).send({ title: '成员越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 更新 → 403 FORBIDDEN', async () => {
    const res = await ctx.asUser(viewerToken).patch(URL_STORY(storyId)).send({ title: '管理者越权' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员更新 → 404 NOT_FOUND，且响应体不含故事字段', async () => {
    const res = await ctx.asUser(outsiderToken).patch(URL_STORY(storyId)).send({ title: '外人越权' })

    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain('测试故事')
  })

  it('敏感故事 + 未授权成员更新 → 404（敏感先于写权限判定，不泄漏故事存在）', async () => {
    await ctx.db.userStory.update({ where: { id: storyId }, data: { isSensitive: true } })

    const res = await ctx.asUser(memberToken).patch(URL_STORY(storyId)).send({ title: '试试' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect((await readStoryRow(storyId))?.title).toBe('测试故事')
  })

  it('未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser(null).patch(URL_STORY(storyId)).send({ title: '匿名' })

    expect(res.status).toBe(401)
  })

  it('storyId 不存在 → 404 NOT_FOUND', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(MISSING_ID)).send({ title: '不存在的故事' })

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('storyId 属于另一个项目 → 404，且那个故事逐字段未被修改', async () => {
    const otherPmId = await makeUser(ctx.db, 't37-other-pm2', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别的活动')
    const otherStoryId = await makeStory(ctx.db, otherProjectId, otherActivityId, { title: '别人的故事' })
    const otherBefore = await readStoryRow(otherStoryId)

    const res = await ctx.asUser(pmToken).patch(URL_STORY(otherStoryId)).send({ title: '跨项目改写' })

    expect(res.status).toBe(404)
    expect(await readStoryRow(otherStoryId)).toEqual(otherBefore)
  })
})

describe('端点 21 反例：字段校验（422 / 400）', () => {
  it('⚠️ status 传 GoalStatus 的取值 ACTIVE → 422，details 含 status: INVALID_VALUE', async () => {
    // 决策 I-1 的三 DONE 陷阱：StoryStatus 是 DRAFT/PLANNING/DONE，
    // 与 GoalStatus 的 ACTIVE/DONE 是两个不可互换的类型。
    // 若实现顺手用了 goalStatusSchema，这条会由 422 变成 200 —— 是本端点的关键反例。
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'ACTIVE' })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'status', code: 'INVALID_VALUE' })
    expect((await readStoryRow(storyId))?.status).toBe('DRAFT')
  })

  it('status 非法枚举值（FINISHED）→ 422，status: INVALID_VALUE', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'FINISHED' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'status',
      code: 'INVALID_VALUE',
    })
  })

  it('priority 非法枚举值（P3）→ 422，priority: INVALID_VALUE', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ priority: 'P3' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'priority',
      code: 'INVALID_VALUE',
    })
  })

  for (const field of ['title', 'roleText', 'capabilityText', 'valueText', 'businessValue'] as const) {
    it(`${field} 为空字符串 → 422，${field}: REQUIRED`, async () => {
      const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ [field]: '' })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details).toContainEqual({ field, code: 'REQUIRED' })
    })

    it(`${field} 为纯空白 → 422，${field}: REQUIRED（部分更新只在字段出现时才判空）`, async () => {
      const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ [field]: '   ' })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details).toContainEqual({ field, code: 'REQUIRED' })
    })

    it(`${field} 超长（上限 + 1）→ 422，${field}: TOO_LONG`, async () => {
      const res = await ctx
        .asUser(pmToken)
        .patch(URL_STORY(storyId))
        .send({ [field]: 'a'.repeat(STORY_TEXT_MAX_LENGTH + 1) })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details).toContainEqual({ field, code: 'TOO_LONG' })
    })
  }

  it('acceptanceCriteria 为 null → 422，details 定位到 acceptanceCriteria', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ acceptanceCriteria: null })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('acceptanceCriteria')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .patch(URL_STORY(storyId))
      .set('content-type', 'application/json')
      .send('{"title": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })
})

describe('端点 21 反例：判定顺序与副作用隔离', () => {
  it('MEMBER + 非法 body → 403（越权先于校验）', async () => {
    const res = await ctx.asUser(memberToken).patch(URL_STORY(storyId)).send({ status: 'ACTIVE' })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员 + 非法 body → 404', async () => {
    const res = await ctx.asUser(outsiderToken).patch(URL_STORY(storyId)).send({ title: '' })

    expect(res.status).toBe(404)
  })

  it('未登录 + 非法 body → 401', async () => {
    const res = await ctx.asUser(null).patch(URL_STORY(storyId)).send({ title: '' })

    expect(res.status).toBe(401)
  })

  it('不存在的 storyId + 非法 body → 404（存在性先于字段校验）', async () => {
    const res = await ctx.asUser(pmToken).patch(URL_STORY(MISSING_ID)).send({ title: '' })

    expect(res.status).toBe(404)
  })

  it('422 之后故事逐字段完全未被修改', async () => {
    const before = await readStoryRow(storyId)

    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ title: '   ' })
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ status: 'ACTIVE' })
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ priority: 'P9' })
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ title: 'a'.repeat(999) })
    await ctx.asUser(pmToken).patch(URL_STORY(storyId)).send({ acceptanceCriteria: null })

    expect(await readStoryRow(storyId)).toEqual(before)
  })

  it('403 / 404 之后故事逐字段完全未被修改', async () => {
    const before = await readStoryRow(storyId)

    await ctx.asUser(memberToken).patch(URL_STORY(storyId)).send({ title: '成员越权' })
    await ctx.asUser(viewerToken).patch(URL_STORY(storyId)).send({ status: 'DONE' })
    await ctx.asUser(outsiderToken).patch(URL_STORY(storyId)).send({ title: '外人越权' })
    await ctx.asUser(null).patch(URL_STORY(storyId)).send({ title: '匿名' })

    expect(await readStoryRow(storyId)).toEqual(before)
  })
})
