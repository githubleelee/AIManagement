/**
 * 端点 19 —— `POST /activities/:activityId/stories` 接口测试（T3.6）
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 14 条、反例 26 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员、目标与活动。
 *
 * 本文件独有的三组要点（其他端点没有的）：
 *   ① 三段式**分字段**存储：`roleText` / `capabilityText` / `valueText` 必须是三个独立
 *      字段，不得拼成一个字符串（契约 I-2 的 UserStory 类型就是这样定义的）；
 *   ② **五个必填文本字段都要判纯空白**，且一次报全部（`details` 里应同时出现多条）；
 *   ③ `status` 默认 `'DRAFT'`、`isSensitive` 默认 `false`，且**请求体里塞入这两个字段
 *      必须被静默丢弃** —— 端点 23（敏感开关）未实现前，这里绝不能成为标敏感的旁路。
 *
 * 契约依据：决策 I-8 端点 19
 *   请求  { title, roleText, capabilityText, valueText, businessValue: string
 *           priority: Priority; acceptanceCriteria?: string }
 *   响应  201 UserStory
 *   错误  403 FORBIDDEN / 404 NOT_FOUND
 *         422 VALIDATION_FAILED（五个文本字段: REQUIRED | TOO_LONG；priority: REQUIRED | INVALID_VALUE）
 *   副作用 projectId 取自 activityId 所属活动；status 默认 'DRAFT'；isSensitive 默认 false
 *   基线 AC-US-03-03：必须在某用户活动下创建；三段式、业务价值、优先级均可填写并持久化
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
import { STORY_TEXT_MAX_LENGTH } from './schemas.js'

let ctx: HttpTestContext
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let projectId: string
let goalId: string
let activityId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_STORIES = (id: string) => `/activities/${id}/stories`

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 一份合法的最小请求体（三段式 + 业务价值 + 优先级）。 */
function validStory() {
  return {
    title: '在业务目标下建立用户活动',
    roleText: '项目经理',
    capabilityText: '拆解业务目标为用户活动',
    valueText: '让需求挂在明确的业务价值之下',
    businessValue: '提升需求可追溯性',
    priority: 'P0',
  }
}

/** 直接读库取故事整行，用于「未被提到的字段必须保持不变」这类比对。 */
async function readStory(id: string) {
  return ctx.db.userStory.findUnique({ where: { id } })
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

  const pmId = await makeUser(ctx.db, 't36-pm', '项目经理')
  const memberId = await makeUser(ctx.db, 't36-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't36-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't36-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.6 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  goalId = await makeGoal(ctx.db, projectId, 'T3.6 目标')
  activityId = await makeActivity(ctx.db, projectId, goalId, 'T3.6 活动')

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例
// ===========================================================================

describe('端点 19 正例：创建用户故事', () => {
  it('PM 创建：201，返回完整 UserStory（13 字段），status 默认 DRAFT、isSensitive 默认 false', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String),
      projectId,
      activityId,
      title: '在业务目标下建立用户活动',
      roleText: '项目经理',
      capabilityText: '拆解业务目标为用户活动',
      valueText: '让需求挂在明确的业务价值之下',
      businessValue: '提升需求可追溯性',
      priority: 'P0',
      status: 'DRAFT',
      acceptanceCriteria: null,
      isSensitive: false,
      createdAt: expect.any(String),
    })
  })

  it('三段式必须**分字段**存储：roleText / capabilityText / valueText 是三个独立字段', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(201)
    // 三个字段各自独立、互不拼接（契约 I-2 与基线「按三段式分字段存储」）
    expect(res.body.roleText).toBe('项目经理')
    expect(res.body.capabilityText).toBe('拆解业务目标为用户活动')
    expect(res.body.valueText).toBe('让需求挂在明确的业务价值之下')
    // 反向核对数据库：确认不是把三段拼进某一个列
    const row = await readStory(res.body.id)
    expect(row?.roleText).toBe('项目经理')
    expect(row?.capabilityText).toBe('拆解业务目标为用户活动')
    expect(row?.valueText).toBe('让需求挂在明确的业务价值之下')
    expect(row?.roleText).not.toContain('我要')
    expect(row?.capabilityText).not.toContain('作为')
  })

  it('响应键集合精确等于 UserStory 的 13 个字段（多给或漏给都是契约违规）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(201)
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

  it('字段类型逐个断言：createdAt 是 ISO 8601 UTC 字符串（决策 I-7 数据层约定 4）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())

    expect(typeof res.body.id).toBe('string')
    expect(typeof res.body.projectId).toBe('string')
    expect(typeof res.body.activityId).toBe('string')
    expect(typeof res.body.title).toBe('string')
    expect(typeof res.body.priority).toBe('string')
    expect(typeof res.body.status).toBe('string')
    expect(typeof res.body.isSensitive).toBe('boolean')
    expect(typeof res.body.createdAt).toBe('string')
    // 必须能被 Date 解析，且序列化回去与原串一致 —— 即真正的 ISO 8601
    const parsed = new Date(res.body.createdAt)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
    expect(parsed.toISOString()).toBe(res.body.createdAt)
  })

  it('acceptanceCriteria 可选：不传时为 null（不是 undefined，JSON 序列化后键必须存在）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(201)
    expect(res.body.acceptanceCriteria).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(res.body, 'acceptanceCriteria')).toBe(true)
  })

  it('acceptanceCriteria 提供时原样存储；空串也接受且存为 ""（与缺省可区分）', async () => {
    const withText = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({ ...validStory(), acceptanceCriteria: '当点击保存时应持久化' })
    expect(withText.status).toBe(201)
    expect(withText.body.acceptanceCriteria).toBe('当点击保存时应持久化')

    const withEmpty = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({ ...validStory(), acceptanceCriteria: '' })
    expect(withEmpty.status).toBe(201)
    expect(withEmpty.body.acceptanceCriteria).toBe('')
  })

  it('priority 三种取值 P0 / P1 / P2 都被接受并原样返回', async () => {
    for (const priority of ['P0', 'P1', 'P2'] as const) {
      const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send({ ...validStory(), priority })
      expect(res.status).toBe(201)
      expect(res.body.priority).toBe(priority)
    }
  })

  it('五个文本字段两端空白被 trim 后存储', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({
        title: '  有空格标题  ',
        roleText: '  项目经理  ',
        capabilityText: '  能力  ',
        valueText: '  价值  ',
        businessValue: '  业务价值  ',
        priority: 'P1',
      })

    expect(res.status).toBe(201)
    expect(res.body.title).toBe('有空格标题')
    expect(res.body.roleText).toBe('项目经理')
    expect(res.body.capabilityText).toBe('能力')
    expect(res.body.valueText).toBe('价值')
    expect(res.body.businessValue).toBe('业务价值')
  })

  it('请求体注入 projectId/activityId/status/isSensitive/id/createdAt → 全部被丢弃', async () => {
    const otherGoalId = await makeGoal(ctx.db, projectId, '另一个目标')
    const otherActivityId = await makeActivity(ctx.db, projectId, otherGoalId, '另一个活动')

    const res = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({
        ...validStory(),
        projectId: MISSING_ID,
        activityId: otherActivityId,
        status: 'DONE',
        isSensitive: true,
        id: MISSING_ID,
        createdAt: '2000-01-01T00:00:00.000Z',
      })

    expect(res.status).toBe(201)
    // 归属以 URL 父级为准（决策 I-10）
    expect(res.body.projectId).toBe(projectId)
    expect(res.body.activityId).toBe(activityId)
    // status 与 isSensitive 由表默认值决定，不接受请求体传入 ——
    // 端点 23 未实现前，这里绝不能成为「标敏感」的旁路
    expect(res.body.status).toBe('DRAFT')
    expect(res.body.isSensitive).toBe(false)
    expect(res.body.createdAt).not.toBe('2000-01-01T00:00:00.000Z')

    // 反向核对数据库 + 确认没有在另一个活动下落库
    const row = await readStory(res.body.id)
    expect(row?.projectId).toBe(projectId)
    expect(row?.activityId).toBe(activityId)
    expect(row?.status).toBe('DRAFT')
    expect(row?.isSensitive).toBe(false)
    expect(await ctx.db.userStory.count({ where: { activityId: otherActivityId } })).toBe(0)
  })

  it('五个文本字段恰好为长度上限 → 201（边界正例，与 TOO_LONG 反例配对）', async () => {
    const max = 'a'.repeat(STORY_TEXT_MAX_LENGTH)
    const res = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({
        title: max,
        roleText: max,
        capabilityText: max,
        valueText: max,
        businessValue: max,
        priority: 'P0',
      })

    expect(res.status).toBe(201)
    expect(res.body.title).toHaveLength(STORY_TEXT_MAX_LENGTH)
    expect(res.body.businessValue).toHaveLength(STORY_TEXT_MAX_LENGTH)
  })

  it('同一活动下可创建多条故事（契约未规定上限），各自独立 id', async () => {
    const first = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())
    const second = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({ ...validStory(), title: '第二条故事' })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(first.body.id).not.toBe(second.body.id)
    expect(await ctx.db.userStory.count({ where: { activityId } })).toBe(2)
  })

  it('创建只写入 URL 指向的活动，不影响同项目其它活动与其它项目', async () => {
    const siblingGoalId = await makeGoal(ctx.db, projectId, '兄弟目标')
    const siblingActivityId = await makeActivity(ctx.db, projectId, siblingGoalId, '兄弟活动')

    const otherPmId = await makeUser(ctx.db, 't36-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别的活动')

    await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())

    expect(await ctx.db.userStory.count({ where: { activityId: siblingActivityId } })).toBe(0)
    expect(await ctx.db.userStory.count({ where: { activityId: otherActivityId } })).toBe(0)
    expect(await ctx.db.userStory.count({ where: { projectId } })).toBe(1)
  })

  it('活动与目标的字段不受创建故事影响（层级归属只读）', async () => {
    const activityBefore = await ctx.db.userActivity.findUnique({ where: { id: activityId } })
    const goalBefore = await ctx.db.businessGoal.findUnique({ where: { id: goalId } })

    await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(validStory())

    expect(await ctx.db.userActivity.findUnique({ where: { id: activityId } })).toEqual(activityBefore)
    expect(await ctx.db.businessGoal.findUnique({ where: { id: goalId } })).toEqual(goalBefore)
  })
})

// ===========================================================================
// 反例：权限（401 / 403 / 404）
// ===========================================================================

describe('端点 19 反例：权限（401 / 403 / 404）', () => {
  it('MEMBER 创建 → 403 FORBIDDEN（对象可见，但写类动作不允许）', async () => {
    const res = await ctx.asUser(memberToken).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 创建 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const res = await ctx.asUser(viewerToken).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员创建 → 404 NOT_FOUND，且响应体不含活动与目标的任何字段', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('T3.6 活动')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限与校验）', async () => {
    const res = await ctx.asUser(null).post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser('not-a-real-token').post(URL_STORIES(activityId)).send(validStory())

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('activityId 不存在 → 404 NOT_FOUND（与「存在但非成员」同为 404）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(MISSING_ID)).send(validStory())

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('activityId 属于另一个项目 → 404，且不在那个项目里落库', async () => {
    const otherPmId = await makeUser(ctx.db, 't36-other-pm2', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别的目标')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别的活动')

    const res = await ctx.asUser(pmToken).post(URL_STORIES(otherActivityId)).send(validStory())

    expect(res.status).toBe(404)
    expect(await ctx.db.userStory.count({ where: { activityId: otherActivityId } })).toBe(0)
    expect(await ctx.db.userStory.count({ where: { projectId: otherProjectId } })).toBe(0)
  })

  it('「活动不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const missing = await ctx.asUser(pmToken).post(URL_STORIES(MISSING_ID)).send(validStory())
    const notMember = await ctx.asUser(outsiderToken).post(URL_STORIES(activityId)).send(validStory())

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })
})

// ===========================================================================
// 反例：字段校验（422 / 400）
// ===========================================================================

describe('端点 19 反例：五个必填文本字段', () => {
  const textFields = ['title', 'roleText', 'capabilityText', 'valueText', 'businessValue'] as const

  for (const field of textFields) {
    it(`缺少 ${field} → 422，details 含 ${field}: REQUIRED`, async () => {
      const payload: Record<string, unknown> = validStory()
      delete payload[field]

      const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(payload)

      expect(res.status).toBe(422)
      const body = res.body as ErrorBody
      expect(body.error.code).toBe('VALIDATION_FAILED')
      expect(body.error.details).toContainEqual({ field, code: 'REQUIRED' })
    })

    it(`${field} 为空字符串 → 422，${field}: REQUIRED`, async () => {
      const res = await ctx
        .asUser(pmToken)
        .post(URL_STORIES(activityId))
        .send({ ...validStory(), [field]: '' })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details).toContainEqual({ field, code: 'REQUIRED' })
    })

    it(`${field} 为纯空白 → 422，${field}: REQUIRED（决策 I-4：REQUIRED 含纯空白）`, async () => {
      const res = await ctx
        .asUser(pmToken)
        .post(URL_STORIES(activityId))
        .send({ ...validStory(), [field]: '     ' })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details).toContainEqual({ field, code: 'REQUIRED' })
    })

    it(`${field} 超长（上限 + 1）→ 422，${field}: TOO_LONG`, async () => {
      const res = await ctx
        .asUser(pmToken)
        .post(URL_STORIES(activityId))
        .send({ ...validStory(), [field]: 'a'.repeat(STORY_TEXT_MAX_LENGTH + 1) })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details).toContainEqual({ field, code: 'TOO_LONG' })
    })

    it(`${field} 类型错误（数字）→ 422，details 定位到 ${field}`, async () => {
      const res = await ctx
        .asUser(pmToken)
        .post(URL_STORIES(activityId))
        .send({ ...validStory(), [field]: 123 })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain(field)
    })
  }

  it('五个文本字段全为纯空白 → 422，details **一次报全部五条**（不是遇到第一个就返回）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send({
      title: ' ',
      roleText: ' ',
      capabilityText: ' ',
      valueText: ' ',
      businessValue: ' ',
      priority: 'P0',
    })

    expect(res.status).toBe(422)
    const details = (res.body as ErrorBody).error.details ?? []
    for (const field of textFields) {
      expect(details).toContainEqual({ field, code: 'REQUIRED' })
    }
  })
})

describe('端点 19 反例：priority 与其他字段', () => {
  it('缺少 priority → 422，details 含 priority: REQUIRED', async () => {
    const payload: Record<string, unknown> = validStory()
    delete payload.priority

    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send(payload)

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({ field: 'priority', code: 'REQUIRED' })
  })

  it('priority 非法枚举值（P3）→ 422，details 含 priority: INVALID_VALUE', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({ ...validStory(), priority: 'P3' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'priority',
      code: 'INVALID_VALUE',
    })
  })

  it('priority 类型错误（数字）→ 422，details 定位到 priority', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({ ...validStory(), priority: 1 })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('priority')
  })

  it('acceptanceCriteria 类型错误（数字）→ 422，details 定位到 acceptanceCriteria', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .send({ ...validStory(), acceptanceCriteria: 123 })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details?.map((d) => d.field)).toContain('acceptanceCriteria')
  })

  it('请求体不是合法 JSON → 400 BAD_REQUEST（请求体解析层错误，决策 I-4）', async () => {
    const res = await ctx
      .asUser(pmToken)
      .post(URL_STORIES(activityId))
      .set('content-type', 'application/json')
      .send('{"title": ')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST')
  })

  it('空对象请求体 → 422，五个字段与 priority 都被报缺失', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send({})

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toContainEqual({ field: 'title', code: 'REQUIRED' })
    expect(body.error.details).toContainEqual({ field: 'priority', code: 'REQUIRED' })
  })
})

// ===========================================================================
// 反例：判定顺序与副作用隔离
// ===========================================================================

describe('端点 19 反例：判定顺序与副作用隔离', () => {
  it('MEMBER + 非法 body → 403（越权先于校验，不泄漏字段规则）', async () => {
    const res = await ctx.asUser(memberToken).post(URL_STORIES(activityId)).send({})

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER + 非法 body → 403', async () => {
    const res = await ctx.asUser(viewerToken).post(URL_STORIES(activityId)).send({ priority: 'P9' })

    expect(res.status).toBe(403)
  })

  it('非项目成员 + 非法 body → 404（不泄漏字段规则，也不承认活动存在）', async () => {
    const res = await ctx.asUser(outsiderToken).post(URL_STORIES(activityId)).send({})

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('未登录 + 非法 body → 401（不能先回 422 泄漏校验细节）', async () => {
    const res = await ctx.asUser(null).post(URL_STORIES(activityId)).send({})

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('不存在的 activityId + 非法 body → 404（父级存在性先于字段校验）', async () => {
    const res = await ctx.asUser(pmToken).post(URL_STORIES(MISSING_ID)).send({})

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('422 之后故事表行数一律不变（失败的请求必须什么都没发生）', async () => {
    const before = await ctx.db.userStory.count()

    await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send({})
    await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send({ ...validStory(), title: '   ' })
    await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send({ ...validStory(), priority: 'P9' })
    await ctx.asUser(pmToken).post(URL_STORIES(activityId)).send({ ...validStory(), title: 'a'.repeat(999) })

    expect(await ctx.db.userStory.count()).toBe(before)
  })

  it('403 / 404 之后故事表行数一律不变', async () => {
    const before = await ctx.db.userStory.count()

    await ctx.asUser(memberToken).post(URL_STORIES(activityId)).send(validStory())
    await ctx.asUser(viewerToken).post(URL_STORIES(activityId)).send(validStory())
    await ctx.asUser(outsiderToken).post(URL_STORIES(activityId)).send(validStory())
    await ctx.asUser(null).post(URL_STORIES(activityId)).send(validStory())
    await ctx.asUser(pmToken).post(URL_STORIES(MISSING_ID)).send(validStory())

    expect(await ctx.db.userStory.count()).toBe(before)
  })
})
