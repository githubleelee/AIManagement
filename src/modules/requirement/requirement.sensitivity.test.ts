/**
 * 端点 10（层级树）与端点 20/23 联动 —— 敏感用户故事的可见性链路
 * （T2.5 已合入后的回归补齐）
 *
 * 为什么新增本文件
 * ---------------------------------------------------------------------------
 * `requirement.goal-tree.test.ts` 开头曾记录：T2.5 落地前 `visibilityScope()`
 * 对非 PM 成员返回 `{mode:'all'}`，subset 分支不可能被 HTTP 请求触发，因此
 * 「未授权成员看不到敏感故事」这条行为**当时无法通过接口观测**，被有意跳开。
 *
 * 现在 T2.5 已在 `main`（`permissions.ts` 的 `visibilityScope()` 已实现 subset），
 * 该前提消失。本文件补齐这条链路的接口回归覆盖，把「层级列表、详情、计数、变更即时生效」
 * 四类读取路径一次性钉住。
 *
 * 覆盖的契约面（决策 I-3 / I-5 / I-6、端点 10 / 20 / 23）
 *   ① 层级树按 `visibilityScope(actor, projectId, 'story')` 过滤敏感故事，
 *      被过滤的故事不出现在 `stories`，其父级 activity 与 goal 仍正常返回；
 *   ② 过滤在查询层完成 —— 未授权成员看到的 `stories` **数量**不泄漏敏感故事的存在性；
 *   ③ 敏感范围变更**立即生效**（每次请求都读库，无进程内缓存），且 `PUT .../sensitivity`
 *      为**全量覆盖**；
 *   ④ 同一条敏感故事在「层级列表隐藏」与「详情 404」两条路径上一致，404 响应不可区分；
 *   ⑤ 白名单只授予读权限，不授予写权限（MEMBER 对白名单内敏感故事仍 403）；
 *   ⑥ 关闭敏感后全项目成员恢复可见，且保留原可见名单以备重新开启。
 *
 * 测试约定（契约「Testing Decisions」）
 *   - 只经 HTTP seam（supertest），只断言状态码与响应体；
 *   - 断言契约字段与错误码，不断言中文文案；
 *   - 测试数据全部自建，不依赖全局种子。
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

let ctx: HttpTestContext
let pmId: string
let allowedId: string
let blockedId: string
let viewerId: string
let outsiderId: string
let projectId: string
let goalId: string
let activityId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }
type StoryNode = { id: string; title: string; isSensitive: boolean }
type ActivityNode = { id: string; stories: StoryNode[] }
type GoalNode = { id: string; activities: ActivityNode[] }

const URL_TREE = (id: string) => `/projects/${id}/goals`
const URL_STORY = (id: string) => `/stories/${id}`
const URL_SENSITIVITY = (id: string) => `/stories/${id}/sensitivity`
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 从层级树响应里取出某活动下的故事数组（缺失时返回空数组，让断言直接失败）。 */
function storiesOf(body: unknown, wantActivityId: string): StoryNode[] {
  const items = (body as { items: GoalNode[] }).items ?? []
  for (const goal of items) {
    for (const activity of goal.activities ?? []) {
      if (activity.id === wantActivityId) return activity.stories ?? []
    }
  }
  return []
}

/** 按 PM 身份写入敏感设置（全量覆盖语义）。 */
async function putSensitivity(
  storyId: string,
  body: { isSensitive: boolean; visibleMemberIds: string[] },
  token = ctx.loginAs(pmId),
) {
  return ctx.asUser(token).put(URL_SENSITIVITY(storyId)).send(body)
}

beforeAll(async () => {
  ctx = await createHttpTestContext()
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pmId = await makeUser(ctx.db, 't3vis-pm', '项目经理')
  allowedId = await makeUser(ctx.db, 't3vis-allowed', '被授权成员')
  blockedId = await makeUser(ctx.db, 't3vis-blocked', '未授权成员')
  viewerId = await makeUser(ctx.db, 't3vis-viewer', '管理者')
  outsiderId = await makeUser(ctx.db, 't3vis-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3 可见性项目')
  await makeMember(ctx.db, projectId, allowedId, 'MEMBER')
  await makeMember(ctx.db, projectId, blockedId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  goalId = await makeGoal(ctx.db, projectId, '目标')
  activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
}, 120_000)

describe('端点 10：敏感故事在层级列表中的可见性', () => {
  it('PM 与白名单成员可见敏感故事；未授权成员与 VIEWER 不可见，父级目标/活动仍在', async () => {
    const safe = await makeStory(ctx.db, projectId, activityId, { title: '普通故事AAA' })
    const secret = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ' })
    await ctx.db.userStory.update({ where: { id: secret }, data: { isSensitive: true } })
    await makeSensitive(ctx.db, projectId, 'story', secret, [allowedId])

    const asPm = await ctx.asUser(ctx.loginAs(pmId)).get(URL_TREE(projectId))
    const asAllowed = await ctx.asUser(ctx.loginAs(allowedId)).get(URL_TREE(projectId))
    const asBlocked = await ctx.asUser(ctx.loginAs(blockedId)).get(URL_TREE(projectId))
    const asViewer = await ctx.asUser(ctx.loginAs(viewerId)).get(URL_TREE(projectId))

    for (const res of [asPm, asAllowed, asBlocked, asViewer]) {
      expect(res.status).toBe(200)
    }

    const pmIds = storiesOf(asPm.body, activityId).map((s) => s.id)
    expect(pmIds).toContain(safe)
    expect(pmIds).toContain(secret)
    expect(storiesOf(asAllowed.body, activityId).map((s) => s.id)).toContain(secret)

    for (const res of [asBlocked, asViewer]) {
      const ids = storiesOf(res.body, activityId).map((s) => s.id)
      expect(ids).toContain(safe)
      expect(ids).not.toContain(secret)
      // 被过滤的故事不得以任何形式出现在响应里
      expect(JSON.stringify(res.body)).not.toContain('敏感故事ZZZ')
    }

    // 契约：被过滤的故事不出现在 stories 数组中，其父级 activity 与 goal 仍正常返回
    const blockedGoal = (asBlocked.body as { items: GoalNode[] }).items.find((g) => g.id === goalId)
    expect(blockedGoal).toBeDefined()
    expect(blockedGoal?.activities.map((a) => a.id)).toContain(activityId)
  })

  it('未授权成员看到的 stories 数量不含敏感故事（计数不泄漏存在性）', async () => {
    const safe = await makeStory(ctx.db, projectId, activityId, { title: '普通故事AAA' })
    const secret = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ' })
    await ctx.db.userStory.update({ where: { id: secret }, data: { isSensitive: true } })
    await makeSensitive(ctx.db, projectId, 'story', secret, [allowedId])

    const asPm = await ctx.asUser(ctx.loginAs(pmId)).get(URL_TREE(projectId))
    const asBlocked = await ctx.asUser(ctx.loginAs(blockedId)).get(URL_TREE(projectId))

    expect(storiesOf(asPm.body, activityId)).toHaveLength(2)
    // 关键：过滤发生在查询层，不是「取出全量再内存过滤」——否则这里是 2
    const blockedStories = storiesOf(asBlocked.body, activityId)
    expect(blockedStories).toHaveLength(1)
    expect(blockedStories.map((s) => s.id)).toEqual([safe])
  })

  it('非项目成员读取层级树 → 404，且响应体不含任何故事标题', async () => {
    await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ', isSensitive: true })

    const res = await ctx.asUser(ctx.loginAs(outsiderId)).get(URL_TREE(projectId))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('敏感故事ZZZ')
  })
})

describe('端点 23 × 端点 10：敏感范围变更即时生效且为全量覆盖', () => {
  it('同一令牌无需重新登录：授权→取消→改授权对象，层级树随每次请求立即变化', async () => {
    const secret = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ' })
    const allowedToken = ctx.loginAs(allowedId)
    const blockedToken = ctx.loginAs(blockedId)

    // 初始非敏感：两名成员都能看到
    expect(storiesOf((await ctx.asUser(allowedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).toContain(secret)
    expect(storiesOf((await ctx.asUser(blockedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).toContain(secret)

    // 设为敏感、白名单只给 allowed：blocked 立即不可见（沿用同一令牌，无重新登录）
    const on = await putSensitivity(secret, { isSensitive: true, visibleMemberIds: [allowedId] })
    expect(on.status).toBe(200)
    expect(storiesOf((await ctx.asUser(allowedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).toContain(secret)
    expect(storiesOf((await ctx.asUser(blockedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).not.toContain(secret)

    // 全量覆盖：白名单换成 blocked 后，allowed 立即失去、blocked 立即获得
    const replaced = await putSensitivity(secret, { isSensitive: true, visibleMemberIds: [blockedId] })
    expect(replaced.status).toBe(200)
    expect(replaced.body.visibleMemberIds).toEqual([blockedId])
    expect(storiesOf((await ctx.asUser(allowedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).not.toContain(secret)
    expect(storiesOf((await ctx.asUser(blockedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).toContain(secret)
  })

  it('关闭敏感后全项目成员恢复可见，且保留原可见名单以便重新开启', async () => {
    const secret = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ' })
    const blockedToken = ctx.loginAs(blockedId)

    await putSensitivity(secret, { isSensitive: true, visibleMemberIds: [allowedId] })
    expect(storiesOf((await ctx.asUser(blockedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).not.toContain(secret)

    // isSensitive=false 时忽略传入名单，保留旧名单
    const off = await putSensitivity(secret, { isSensitive: false, visibleMemberIds: [outsiderId] })
    expect(off.status).toBe(200)
    expect(off.body.visibleMemberIds).toEqual([allowedId])
    expect(storiesOf((await ctx.asUser(blockedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).toContain(secret)
    // 详情同样恢复
    expect((await ctx.asUser(blockedToken).get(URL_STORY(secret))).status).toBe(200)
  })
})

describe('层级列表与详情两条读取路径对同一条敏感故事保持一致', () => {
  it('未授权成员：列表隐藏、详情 404，且 404 响应与「不存在」完全一致', async () => {
    const secret = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ' })
    await ctx.db.userStory.update({ where: { id: secret }, data: { isSensitive: true } })
    await makeSensitive(ctx.db, projectId, 'story', secret, [allowedId])

    const blockedToken = ctx.loginAs(blockedId)
    const allowedToken = ctx.loginAs(allowedId)

    // 列表：未授权隐藏
    expect(storiesOf((await ctx.asUser(blockedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).not.toContain(secret)
    // 详情：未授权 404
    const hidden = await ctx.asUser(blockedToken).get(URL_STORY(secret))
    const missing = await ctx.asUser(blockedToken).get(URL_STORY(MISSING_ID))
    expect(hidden.status).toBe(404)
    expect(hidden.body).toEqual(missing.body)
    expect(JSON.stringify(hidden.body)).not.toContain('敏感故事ZZZ')

    // 白名单成员：列表可见 + 详情 200
    expect(storiesOf((await ctx.asUser(allowedToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).toContain(secret)
    expect((await ctx.asUser(allowedToken).get(URL_STORY(secret))).status).toBe(200)
  })

  it('白名单只授予读权限：MEMBER 对白名单内敏感故事读 200、写与删仍 403', async () => {
    const secret = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ' })
    await putSensitivity(secret, { isSensitive: true, visibleMemberIds: [allowedId] })
    const allowedToken = ctx.loginAs(allowedId)

    expect((await ctx.asUser(allowedToken).get(URL_STORY(secret))).status).toBe(200)
    expect((await ctx.asUser(allowedToken).patch(URL_STORY(secret)).send({ title: '越权改' })).status).toBe(403)
    expect((await ctx.asUser(allowedToken).delete(URL_STORY(secret))).status).toBe(403)
    // 故事未被改动
    expect((await ctx.db.userStory.findUniqueOrThrow({ where: { id: secret } })).title).toBe('敏感故事ZZZ')
  })

  it('VIEWER 被加入白名单后可见敏感故事，但写仍 403', async () => {
    const secret = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事ZZZ' })
    await putSensitivity(secret, { isSensitive: true, visibleMemberIds: [viewerId] })
    const viewerToken = ctx.loginAs(viewerId)

    expect(storiesOf((await ctx.asUser(viewerToken).get(URL_TREE(projectId))).body, activityId).map((s) => s.id)).toContain(secret)
    expect((await ctx.asUser(viewerToken).get(URL_STORY(secret))).status).toBe(200)
    expect((await ctx.asUser(viewerToken).patch(URL_STORY(secret)).send({ title: '越权改' })).status).toBe(403)
  })
})
