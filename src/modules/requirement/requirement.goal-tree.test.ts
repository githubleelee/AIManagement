/**
 * 端点 10 —— `GET /projects/:projectId/goals` 需求层级树接口测试（T3.8 + T3.10）
 *
 * 为什么这两个任务共用一个文件与一个提交
 *   T3.8（层级树组装）与 T3.10（`visibilityScope` 接线）打的是**同一个端点、同一个
 *   handler、同一个查询**：过滤与组装是这一条查询的两半。契约自己的「常见拼装失败与
 *   预防」表明确写着「**不可保留一个未过滤的版本**」，因此不能先提交一个
 *   「树能返回但不过滤敏感对象」的中间态。
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：本文件正例 18 条、反例 8 条、排序与并列 5 条。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员、目标、活动、故事。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 本文件**故意不覆盖**的一条：非 PM 成员读取「敏感故事」时的可见性
 * ---------------------------------------------------------------------------
 *   契约 I-8 端点 10 要求「敏感用户故事按 `visibilityScope(actor, projectId, 'story')`
 *   过滤」。但实测 `src/modules/authz/permissions.ts:179-192` 的现状是：
 *     - 非项目成员 → `{mode:'subset', ids: []}`
 *     - PM        → `{mode:'all'}`
 *     - **非 PM 的成员（MEMBER / VIEWER）→ `{mode:'all'}`**（T2.5 待实现）
 *   而端点 10 会先用 `can()` 把非成员判成 404，**能走到过滤这一步的一定是成员**，
 *   于是永远拿到 `'all'` —— **subset 分支在 T2.5 落地前不可能被 HTTP 请求触发**。
 *
 *   所以「未授权成员看不到敏感故事」这条行为**今天无法通过接口观测**。
 *   若我为它写一条断言：
 *     - 断言「成员能看到」（反映今天的实际行为）→ T2.5 落地后必然变红，
 *       会留下一条**假警报**（与 T3.9 那 2 条夹具错误导致的红灯同类）；
 *     - 断言「成员看不到」（契约要求的最终行为）→ 今天就是红的，
 *       而红的原因是**跨模块未交付**（T2.5），不是本模块的缺陷。
 *   两种写法都会污染回归护栏，故本文件**两条都不写**，改为：
 *     ① 只钉住与 T2.5 无关、永远成立的部分（PM 能看到敏感故事；成员能看到非敏感故事）；
 *     ② 在 service 与 handler 的注释、以及表五记录中说明该边界与依赖。
 *   AC-US-03-08 的完整验证需等 T2.5 落地后，由「端点 10 + 成员 + 敏感故事」的
 *   集成用例补上。
 * ---------------------------------------------------------------------------
 *
 * 契约依据：决策 I-8 端点 10；决策 I-6（列表可见性作用域）
 *   响应  200 ListResponse<GoalNode>
 *   说明  goals 按 sortOrder 升序、activities 按 sortOrder 升序、stories 按 createdAt 升序；
 *         被过滤掉的 story 不出现在 stories 数组中，其父级 activity 与 goal 仍正常返回
 *   错误  404 NOT_FOUND（非项目成员）
 *   类型  GoalNode = BusinessGoal & { activities: ActivityNode[] }
 *         ActivityNode = UserActivity & { stories: StoryNode[] }；StoryNode = UserStory
 *   基线  AC-US-03-04（四层结构一致性）、AC-US-03-09（列表与详情）
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
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let pmId: string
let memberId: string
let projectId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_TREE = (id: string) => `/projects/${id}/goals`

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** BusinessGoal 的 6 个字段名（GoalNode 应恰好是这 6 个 + activities）。 */
const GOAL_KEYS = ['description', 'id', 'name', 'projectId', 'sortOrder', 'status']
/** UserActivity 的 7 个字段名（ActivityNode 应恰好是这 7 个 + stories）。 */
const ACTIVITY_KEYS = [
  'description',
  'goalId',
  'id',
  'name',
  'projectId',
  'sortOrder',
  'status',
]
/** UserStory 的 13 个字段名（StoryNode 应恰好是这 13 个，不得多给）。 */
const STORY_KEYS = [
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
]

/**
 * 把若干故事的 `createdAt` 显式设成**整秒**的不同值。
 *
 * 为什么要显式设置：迁移里 `"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`，
 * SQLite 的 `CURRENT_TIMESTAMP` 只有**秒级精度**，测试在一秒内建出的若干故事
 * `createdAt` 会完全相同 —— 那时「按 createdAt 升序」的期望顺序根本无从断言。
 * 用整秒值还能顺带避开「数据库是否保留毫秒」的不确定性。
 */
async function setCreatedAt(storyId: string, isoSecond: string) {
  await ctx.db.userStory.update({
    where: { id: storyId },
    data: { createdAt: new Date(isoSecond) },
  })
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

  pmId = await makeUser(ctx.db, 't38-pm', '项目经理')
  memberId = await makeUser(ctx.db, 't38-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't38-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't38-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.8 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 正例：层级结构与类型
// ===========================================================================

describe('端点 10 正例：层级树结构', () => {
  it('没有任何目标的项目 → 200，items 为空数组', async () => {
    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(res.status).toBe(200)
    expect(Object.keys(res.body)).toEqual(['items'])
    expect(res.body.items).toEqual([])
  })

  it('单目标 → GoalNode 的键集合精确等于 BusinessGoal 的 6 字段 + activities', async () => {
    await makeGoal(ctx.db, projectId, '唯一目标')

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(Object.keys(res.body.items[0]).sort()).toEqual([...GOAL_KEYS, 'activities'].sort())
    expect(res.body.items[0].activities).toEqual([])
  })

  it('单活动 → ActivityNode 的键集合精确等于 UserActivity 的 7 字段 + stories', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    await makeActivity(ctx.db, projectId, goalId, '唯一活动')

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    const activity = res.body.items[0].activities[0]
    expect(Object.keys(activity).sort()).toEqual([...ACTIVITY_KEYS, 'stories'].sort())
    expect(activity.stories).toEqual([])
  })

  it('单故事 → StoryNode 的键集合精确等于 UserStory 的 13 字段（不得多给任务相关字段）', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
    await makeStory(ctx.db, projectId, activityId, { title: '唯一故事' })

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    const story = res.body.items[0].activities[0].stories[0]
    expect(Object.keys(story).sort()).toEqual([...STORY_KEYS].sort())
    // 任务属 M5，绝不出现在需求层级树里
    expect(story).not.toHaveProperty('ownerUserId')
    expect(story).not.toHaveProperty('planStart')
  })

  it('完整三层：逐字段断言 目标 → 活动 → 故事 的归属与内容', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '提升需求可追溯性', { description: '目标描述' })
    const activityId = await makeActivity(ctx.db, projectId, goalId, '拆解目标', {
      description: '活动描述',
    })
    const storyId = await makeStory(ctx.db, projectId, activityId, {
      title: '建立业务目标',
      roleText: '项目经理',
      capabilityText: '建立业务目标',
      valueText: '结构化梳理需求',
      businessValue: '提升可追溯性',
      priority: 'P1',
      acceptanceCriteria: '保存后可见',
    })

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(res.status).toBe(200)
    const goal = res.body.items[0]
    expect(goal).toEqual({
      id: goalId,
      projectId,
      name: '提升需求可追溯性',
      description: '目标描述',
      status: 'ACTIVE',
      sortOrder: 0,
      activities: [
        {
          id: activityId,
          projectId,
          goalId,
          name: '拆解目标',
          description: '活动描述',
          status: 'ACTIVE',
          sortOrder: 0,
          stories: [
            {
              id: storyId,
              projectId,
              activityId,
              title: '建立业务目标',
              roleText: '项目经理',
              capabilityText: '建立业务目标',
              valueText: '结构化梳理需求',
              businessValue: '提升可追溯性',
              priority: 'P1',
              status: 'DRAFT',
              acceptanceCriteria: '保存后可见',
              isSensitive: false,
              createdAt: expect.any(String),
            },
          ],
        },
      ],
    })
  })

  it('空目标与空活动都正常返回空数组（不省略键）', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '有目标')
    await makeActivity(ctx.db, projectId, goalId, '有活动')
    await makeGoal(ctx.db, projectId, '空目标')

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    const items = res.body.items as Array<{ name: string; activities: unknown[] }>
    const empty = items.find((g) => g.name === '空目标')
    expect(empty?.activities).toEqual([])
    const withActivity = items.find((g) => g.name === '有目标')
    expect((withActivity?.activities[0] as { stories: unknown[] }).stories).toEqual([])
  })

  it('多目标多活动的归属正确：每个活动只出现在它自己的目标下', async () => {
    const goalA = await makeGoal(ctx.db, projectId, '目标 A')
    const goalB = await makeGoal(ctx.db, projectId, '目标 B')
    const a1 = await makeActivity(ctx.db, projectId, goalA, 'A1')
    const a2 = await makeActivity(ctx.db, projectId, goalA, 'A2')
    const b1 = await makeActivity(ctx.db, projectId, goalB, 'B1')

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    const byName = new Map<string, { id: string; activities: Array<{ id: string }> }>(
      (res.body.items as Array<{ name: string; id: string; activities: Array<{ id: string }> }>).map(
        (g) => [g.name, g],
      ),
    )
    expect(byName.get('目标 A')?.activities.map((a) => a.id)).toEqual([a1, a2])
    expect(byName.get('目标 B')?.activities.map((a) => a.id)).toEqual([b1])
  })

  it('状态与优先级保持线上英文常量（决策 I-1：不得返回中文标签）', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
    await makeStory(ctx.db, projectId, activityId, { priority: 'P2', status: 'PLANNING' })

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(res.body.items[0].status).toBe('ACTIVE')
    expect(res.body.items[0].activities[0].status).toBe('ACTIVE')
    expect(res.body.items[0].activities[0].stories[0].priority).toBe('P2')
    expect(res.body.items[0].activities[0].stories[0].status).toBe('PLANNING')
    expect(JSON.stringify(res.body)).not.toContain('进行中')
    expect(JSON.stringify(res.body)).not.toContain('规划中')
  })

  it('只返回本项目：另一个项目的目标与活动不出现在树里', async () => {
    const otherPmId = await makeUser(ctx.db, 't38-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别处绝密目标XYZ')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别处活动')
    await makeStory(ctx.db, otherProjectId, otherActivityId, { title: '别处故事' })

    await makeGoal(ctx.db, projectId, '本项目目标')

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].name).toBe('本项目目标')
    expect(JSON.stringify(res.body)).not.toContain('别处绝密目标XYZ')
    expect(JSON.stringify(res.body)).not.toContain('别处故事')
  })

  it('3 目标 × 3 活动 × 3 故事 → 计数与归属完整', async () => {
    for (let g = 0; g < 3; g += 1) {
      const goalId = await makeGoal(ctx.db, projectId, `目标 ${g}`)
      for (let a = 0; a < 3; a += 1) {
        const activityId = await makeActivity(ctx.db, projectId, goalId, `活动 ${g}-${a}`)
        for (let s = 0; s < 3; s += 1) {
          await makeStory(ctx.db, projectId, activityId, { title: `故事 ${g}-${a}-${s}` })
        }
      }
    }

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(res.body.items).toHaveLength(3)
    for (const goal of res.body.items as Array<{ activities: Array<{ stories: unknown[] }> }>) {
      expect(goal.activities).toHaveLength(3)
      for (const activity of goal.activities) {
        expect(activity.stories).toHaveLength(3)
      }
    }
  })

  it('故事的 createdAt 是 ISO 8601 UTC 字符串（决策 I-7 数据层约定 4）', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
    await makeStory(ctx.db, projectId, activityId)

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    const createdAt = res.body.items[0].activities[0].stories[0].createdAt as string
    const parsed = new Date(createdAt)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
    expect(parsed.toISOString()).toBe(createdAt)
  })
})

// ===========================================================================
// 排序
// ===========================================================================

describe('端点 10：排序口径', () => {
  it('goals 按 sortOrder 升序（与插入顺序无关）', async () => {
    const c = await makeGoal(ctx.db, projectId, 'C', { sortOrder: 5 })
    const a = await makeGoal(ctx.db, projectId, 'A', { sortOrder: 1 })
    const b = await makeGoal(ctx.db, projectId, 'B', { sortOrder: 3 })

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect((res.body.items as Array<{ id: string }>).map((g) => g.id)).toEqual([a, b, c])
  })

  it('sortOrder 有空洞或负数也按升序排列', async () => {
    const neg = await makeGoal(ctx.db, projectId, '负', { sortOrder: -10 })
    const zero = await makeGoal(ctx.db, projectId, '零', { sortOrder: 0 })
    const big = await makeGoal(ctx.db, projectId, '大', { sortOrder: 500 })

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect((res.body.items as Array<{ id: string }>).map((g) => g.id)).toEqual([neg, zero, big])
  })

  it('activities 按 sortOrder 升序（与插入顺序无关）', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const c = await makeActivity(ctx.db, projectId, goalId, 'C', { sortOrder: 5 })
    const a = await makeActivity(ctx.db, projectId, goalId, 'A', { sortOrder: 1 })
    const b = await makeActivity(ctx.db, projectId, goalId, 'B', { sortOrder: 3 })

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(
      (res.body.items[0].activities as Array<{ id: string }>).map((x) => x.id),
    ).toEqual([a, b, c])
  })

  it('stories 按 createdAt 升序（显式设为不同整秒，避开秒级精度的干扰）', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
    const third = await makeStory(ctx.db, projectId, activityId, { title: '第三' })
    const first = await makeStory(ctx.db, projectId, activityId, { title: '第一' })
    const second = await makeStory(ctx.db, projectId, activityId, { title: '第二' })

    await setCreatedAt(third, '2026-01-01T00:00:03.000Z')
    await setCreatedAt(first, '2026-01-01T00:00:01.000Z')
    await setCreatedAt(second, '2026-01-01T00:00:02.000Z')

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(
      (res.body.items[0].activities[0].stories as Array<{ id: string }>).map((s) => s.id),
    ).toEqual([first, second, third])
  })

  it('⚠️ createdAt 完全相同（SQLite CURRENT_TIMESTAMP 只有秒级精度）→ 顺序仍确定且可复现', async () => {
    // 这条用例记录一个**真实存在的口径问题**：迁移里的
    //   "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    // 在 SQLite 上只有秒级精度，同一秒内创建的多条故事 createdAt 完全相同。
    // 契约只说「按 createdAt 升序」，未规定并列时怎么排 —— 若不补次级键，
    // 相对顺序由数据库物理顺序决定，不可预期也不可复现。
    // 本模块在 orderBy 里补了 `{ id: 'asc' }` 次级键，因此顺序确定。
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
    const s1 = await makeStory(ctx.db, projectId, activityId, { title: 'S1' })
    const s2 = await makeStory(ctx.db, projectId, activityId, { title: 'S2' })
    const s3 = await makeStory(ctx.db, projectId, activityId, { title: 'S3' })
    for (const id of [s1, s2, s3]) {
      await setCreatedAt(id, '2026-01-01T00:00:00.000Z')
    }

    const first = await ctx.asUser(pmToken).get(URL_TREE(projectId))
    const second = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    /**
     * 取出「第一个目标的第一个活动」下的故事 id 序列。
     * 用解构 + 可选链而不是 `items[0].activities[0]`：后者在 `noUncheckedIndexedAccess`
     * 下是 `| undefined`，会诱使写非空断言（见 T3.3 的 7 个 TS2345）。
     * 结构缺失时返回空数组，断言会直接失败 —— 不会静默通过。
     */
    const storyIds = (res: { body: unknown }): string[] => {
      const body = res.body as {
        items: Array<{ activities: Array<{ stories: Array<{ id: string }> }> }>
      }
      const [goal] = body.items
      const [activity] = goal?.activities ?? []
      return (activity?.stories ?? []).map((s) => s.id)
    }

    // 次级键是 id 升序（uuid 为小写十六进制 + 连字符，SQLite 的 TEXT 比较与 JS 字符串
    // 比较在 ASCII 上一致，因此可以用 sort() 表达期望值）
    expect(storyIds(first)).toEqual([s1, s2, s3].sort())
    // 两次请求结果完全一致 —— 「确定且可复现」才是本条要钉的东西
    expect(storyIds(second)).toEqual(storyIds(first))
  })

  it('sortOrder 完全相同的目标 → 并列时顺序仍确定（次级键 id 升序）', async () => {
    // sortOrder 并列是真实可达的：端点 14/18 的全量替换存在**合法中间态**
    // （置 A:=1 于 B 尚为 1 之时），且 schema 上没有唯一约束（表五序号 42 已论证为何不能加）。
    const x = await makeGoal(ctx.db, projectId, 'X', { sortOrder: 7 })
    const y = await makeGoal(ctx.db, projectId, 'Y', { sortOrder: 7 })

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect((res.body.items as Array<{ id: string }>).map((g) => g.id)).toEqual([x, y].sort())
  })
})

// ===========================================================================
// 可见性（T3.10）与权限
// ===========================================================================

describe('端点 10 可见性：与 T2.5 无关、永远成立的部分', () => {
  it('PM 读取的树里，被标为敏感的故事照常出现（PM 不受敏感白名单限制）', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
    const safe = await makeStory(ctx.db, projectId, activityId, { title: '普通故事' })
    const sensitive = await makeStory(ctx.db, projectId, activityId, { title: '敏感故事' })
    await ctx.db.userStory.update({ where: { id: sensitive }, data: { isSensitive: true } })
    await makeSensitive(ctx.db, projectId, 'story', sensitive, [memberId])

    const res = await ctx.asUser(pmToken).get(URL_TREE(projectId))

    expect(res.status).toBe(200)
    const ids = (res.body.items[0].activities[0].stories as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toContain(safe)
    expect(ids).toContain(sensitive)
    const node = (res.body.items[0].activities[0].stories as Array<{ id: string; isSensitive: boolean }>).find(
      (s) => s.id === sensitive,
    )
    expect(node?.isSensitive).toBe(true)
  })

  it('非 PM 成员读取含**非敏感**故事的树 → 200，结构完整', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '目标')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '活动')
    const storyId = await makeStory(ctx.db, projectId, activityId, { title: '普通故事' })

    const res = await ctx.asUser(memberToken).get(URL_TREE(projectId))

    expect(res.status).toBe(200)
    const ids = (res.body.items[0].activities[0].stories as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toContain(storyId)
  })

  it('VIEWER 读取 → 200（本轮 VIEWER 为全项目只读）', async () => {
    await makeGoal(ctx.db, projectId, '目标')

    const res = await ctx.asUser(viewerToken).get(URL_TREE(projectId))

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
  })
})

describe('端点 10 反例：权限（401 / 404）', () => {
  it('非项目成员 → 404 NOT_FOUND，且响应体不含任何层级字段', async () => {
    const goalId = await makeGoal(ctx.db, projectId, '绝密目标XYZ')
    const activityId = await makeActivity(ctx.db, projectId, goalId, '绝密活动XYZ')
    await makeStory(ctx.db, projectId, activityId, { title: '绝密故事XYZ' })

    const res = await ctx.asUser(outsiderToken).get(URL_TREE(projectId))

    expect(res.status).toBe(404)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error).not.toHaveProperty('details')
    expect(JSON.stringify(res.body)).not.toContain('绝密目标XYZ')
    expect(JSON.stringify(res.body)).not.toContain('绝密活动XYZ')
    expect(JSON.stringify(res.body)).not.toContain('绝密故事XYZ')
  })

  it('未登录 → 401 UNAUTHENTICATED（鉴权先于权限）', async () => {
    await makeGoal(ctx.db, projectId, '目标')

    const res = await ctx.asUser(null).get(URL_TREE(projectId))

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser('not-a-real-token').get(URL_TREE(projectId))

    expect(res.status).toBe(401)
  })

  it('projectId 不存在 → 404 NOT_FOUND（与「存在但非成员」同为 404）', async () => {
    const res = await ctx.asUser(pmToken).get(URL_TREE(MISSING_ID))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('「项目不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    await makeGoal(ctx.db, projectId, '目标')
    const missing = await ctx.asUser(pmToken).get(URL_TREE(MISSING_ID))
    const notMember = await ctx.asUser(outsiderToken).get(URL_TREE(projectId))

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })

  it('被移出项目的成员立即 404（权限即时生效，决策 I-10 不做进程内缓存）', async () => {
    await makeGoal(ctx.db, projectId, '目标')
    expect((await ctx.asUser(memberToken).get(URL_TREE(projectId))).status).toBe(200)

    await ctx.db.projectMember.delete({ where: { projectId_userId: { projectId, userId: memberId } } })

    const after = await ctx.asUser(memberToken).get(URL_TREE(projectId))
    expect(after.status).toBe(404)
  })

  it('读端点不得出现 403：成员与 VIEWER 都被允许，拒绝只有 404 一种形态', async () => {
    await makeGoal(ctx.db, projectId, '目标')

    const asMember = await ctx.asUser(memberToken).get(URL_TREE(projectId))
    const asViewer = await ctx.asUser(viewerToken).get(URL_TREE(projectId))
    const asOutsider = await ctx.asUser(outsiderToken).get(URL_TREE(projectId))

    expect(asMember.status).toBe(200)
    expect(asViewer.status).toBe(200)
    expect(asOutsider.status).toBe(404)
    for (const res of [asMember, asViewer, asOutsider]) {
      expect(res.status).not.toBe(403)
    }
  })
})
