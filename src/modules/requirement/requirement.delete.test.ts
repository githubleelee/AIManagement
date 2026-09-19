/**
 * 端点 13 / 17 / 22 —— 删除与 `HAS_CHILDREN` 接口测试（T3.9）
 *
 * 为什么三个端点共用一个文件
 *   它们是**同一条规则**（决策 I-7 的外键 RESTRICT、契约 I-8 的 409 CONFLICT）
 *   在三个层级上的同一实现，共用一个文件比拆三份更容易看出「三处行为一致」。
 *   端点 22 另有独有的副作用（同事务清理 `ObjectVisibility`），在本文件末尾单列。
 *
 * 测试约定（契约「Testing Decisions」）
 *   - **只测外部行为**：全部经 HTTP seam（supertest）发起请求，只断言状态码与响应体。
 *   - **断言契约而非实现**：断言错误码与字段名，**不断言中文文案**。
 *   - **每端点至少一正一反**：端点 13 正 2 反 11、端点 17 正 2 反 9、端点 22 正 3 反 9。
 *   - **测试自建数据**：每个用例用夹具造自己的项目、成员、目标、活动、故事、任务。
 *
 * 本文件最关键的三组断言：
 *   ① **409 之后什么都没发生**：目标/活动/故事仍在，而且**可见性记录也一条不少**
 *      —— 这是「删除与清理同事务」这一设计的直接证据（若清理不在事务里，
 *      或 delete 与 deleteMany 的顺序写反，这条会红）；
 *   ② **清理只针对该故事的 story 类型记录**：别的故事、以及 task 类型的记录逐行不变
 *      （`ObjectVisibility` 是多态列，过滤条件少一个维度就会误删）；
 *   ③ **HAS_CHILDREN 是可解除的**：移除子项后同一次删除必须成功，
 *      证明 409 不是把对象永久锁死。
 *
 * 契约依据：决策 I-8 端点 13 / 17 / 22
 *   响应  204（无响应体）
 *   错误  403 FORBIDDEN / 404 NOT_FOUND / 409 CONFLICT（HAS_CHILDREN）
 *   端点 22 副作用：同一事务内清理 ObjectVisibility(objectType='story', objectId=storyId)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from '../../../test/http-support.js'
import { makeActivity, makeGoal, makeSensitive, makeStory, makeTask } from './test-fixtures.js'

let ctx: HttpTestContext
let pmToken: string
let memberToken: string
let viewerToken: string
let outsiderToken: string
let pmId: string
let memberId: string

let projectId: string
let goalId: string
let activityId: string
let storyId: string

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; code: string }> } }

const URL_GOAL = (id: string) => `/goals/${id}`
const URL_ACTIVITY = (id: string) => `/activities/${id}`
const URL_STORY = (id: string) => `/stories/${id}`

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/** 某个对象在 ObjectVisibility 里的记录数。 */
async function visibilityCount(objectType: 'story' | 'task', objectId: string) {
  return ctx.db.objectVisibility.count({ where: { objectType, objectId } })
}

/** 某故事是否仍存在。 */
async function storyExists(id: string) {
  return (await ctx.db.userStory.count({ where: { id } })) === 1
}

/** 某活动是否仍存在。 */
async function activityExists(id: string) {
  return (await ctx.db.userActivity.count({ where: { id } })) === 1
}

/** 某目标是否仍存在。 */
async function goalExists(id: string) {
  return (await ctx.db.businessGoal.count({ where: { id } })) === 1
}

/**
 * 造一条**完整链路**：目标 → 活动 → 故事。
 *
 * ⚠️ 命名陷阱的教训（T3.9 首轮 2 条红用例的根因，已记入提交与表五）
 *   本函数原先叫 `makeEmptyChain`、注释写「无子项」，但它**显式造了一个故事** ——
 *   于是返回的 `goal` 有子活动、`activity` 有子故事，**两者都不是「无下级」**。
 *   两条正例（「PM 删除无下级的目标 → 204」「PM 删除无下级故事的活动 → 204」）
 *   拿它当可删除对象用，删除时实现**正确地**返回了 409，却被报成缺陷。
 *
 *   修法不是放宽断言（断言仍是契约要求的 204，一个字没改），而是**让数据匹配用例的前提**：
 *   需要「无下级、可删除」的对象时，请用下面的 `makeDeletableGoal` /
 *   `makeDeletableActivity`，不要再靠本函数猜自己有没有子项。
 *
 * 本链路中故事下没有任务，因此 `story` 是可删除的（端点 22 的正例用它）。
 */
async function makeFullChain() {
  const g = await makeGoal(ctx.db, projectId, '链路目标')
  const a = await makeActivity(ctx.db, projectId, g, '链路活动')
  const s = await makeStory(ctx.db, projectId, a)
  return { goal: g, activity: a, story: s }
}

/**
 * 造一个**下无活动**的目标 —— 端点 13 的删除成功路径（204）用它。
 * 与 `makeFullChain` 的唯一区别：不造子活动。
 */
async function makeDeletableGoal(): Promise<string> {
  return makeGoal(ctx.db, projectId, '可删除的目标')
}

/**
 * 造一条「目标 → 活动」且**活动下无故事**的链路 —— 端点 17 的删除成功路径（204）用它。
 * 与 `makeFullChain` 的唯一区别：不造子故事。
 */
async function makeDeletableActivity(): Promise<{ goal: string; activity: string }> {
  const goal = await makeGoal(ctx.db, projectId, '可删除的目标')
  const activity = await makeActivity(ctx.db, projectId, goal, '可删除的活动')
  return { goal, activity }
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

  pmId = await makeUser(ctx.db, 't39-pm', '项目经理')
  memberId = await makeUser(ctx.db, 't39-member', '项目成员')
  const viewerId = await makeUser(ctx.db, 't39-viewer', '管理者')
  const outsiderId = await makeUser(ctx.db, 't39-outsider', '外部用户')

  projectId = await makeProject(ctx.db, pmId, 'T3.9 项目')
  await makeMember(ctx.db, projectId, memberId, 'MEMBER')
  await makeMember(ctx.db, projectId, viewerId, 'VIEWER')

  // 主链条：目标 → 活动 → 故事（无任务，因此三者都可删）
  goalId = await makeGoal(ctx.db, projectId, 'T3.9 目标')
  activityId = await makeActivity(ctx.db, projectId, goalId, 'T3.9 活动')
  storyId = await makeStory(ctx.db, projectId, activityId)

  pmToken = ctx.loginAs(pmId)
  memberToken = ctx.loginAs(memberId)
  viewerToken = ctx.loginAs(viewerId)
  outsiderToken = ctx.loginAs(outsiderId)
})

// ===========================================================================
// 端点 13 —— DELETE /goals/:goalId
// ===========================================================================

describe('端点 13 正例：删除业务目标', () => {
  it('PM 删除无下级的目标 → 204，响应体为空，库中已不存在', async () => {
    // 用 makeDeletableGoal（该目标下没有任何活动）——
    // 不能用含子活动的链路，否则实现会正确返回 409（见 makeFullChain 的注释）
    const deletableGoalId = await makeDeletableGoal()
    const res = await ctx.asUser(pmToken).delete(URL_GOAL(deletableGoalId))

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(await goalExists(deletableGoalId)).toBe(false)
  })

  it('删除只作用于该目标：同项目其它目标逐行不变', async () => {
    const deletableGoalId = await makeDeletableGoal()
    const survivorBefore = await ctx.db.businessGoal.findUnique({
      where: { id: goalId },
      select: { id: true, projectId: true, name: true, description: true, status: true, sortOrder: true },
    })

    const res = await ctx.asUser(pmToken).delete(URL_GOAL(deletableGoalId))

    // ⚠️ 必须先断言删除**真的成功了**：否则若上一步被 409 拒绝，
    // 后面的「其它目标不变」会在「什么都没发生」的前提下平凡成立，用例就失去了意义。
    expect(res.status).toBe(204)
    expect(await goalExists(deletableGoalId)).toBe(false)
    expect(await goalExists(goalId)).toBe(true)
    expect(
      await ctx.db.businessGoal.findUnique({
        where: { id: goalId },
        select: { id: true, projectId: true, name: true, description: true, status: true, sortOrder: true },
      }),
    ).toEqual(survivorBefore)
  })
})

describe('端点 13 反例：HAS_CHILDREN 与权限', () => {
  it('目标下仍有用户活动 → 409 CONFLICT，details 含 HAS_CHILDREN', async () => {
    // beforeEach 的 goalId 下有 activityId
    const res = await ctx.asUser(pmToken).delete(URL_GOAL(goalId))

    expect(res.status).toBe(409)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.details).toContainEqual({ field: 'goalId', code: 'HAS_CHILDREN' })
  })

  it('409 之后目标与下级活动都仍在（失败的删除必须什么都没发生）', async () => {
    await ctx.asUser(pmToken).delete(URL_GOAL(goalId))

    expect(await goalExists(goalId)).toBe(true)
    expect(await activityExists(activityId)).toBe(true)
    expect(await storyExists(storyId)).toBe(true)
  })

  it('HAS_CHILDREN 可解除：移除子活动后同一次删除成功（409 不是永久锁死）', async () => {
    const first = await ctx.asUser(pmToken).delete(URL_GOAL(goalId))
    expect(first.status).toBe(409)

    // 自下而上清空：故事 → 活动
    await ctx.db.userStory.delete({ where: { id: storyId } })
    await ctx.db.userActivity.delete({ where: { id: activityId } })

    const second = await ctx.asUser(pmToken).delete(URL_GOAL(goalId))
    expect(second.status).toBe(204)
    expect(await goalExists(goalId)).toBe(false)
  })

  it('MEMBER 删除 → 403 FORBIDDEN', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(memberToken).delete(URL_GOAL(chain.goal))

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 删除 → 403 FORBIDDEN（本轮 VIEWER 与 MEMBER 同待遇）', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(viewerToken).delete(URL_GOAL(chain.goal))

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员删除 → 404 NOT_FOUND，且目标仍在', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(outsiderToken).delete(URL_GOAL(chain.goal))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await goalExists(chain.goal)).toBe(true)
  })

  it('未登录 → 401 UNAUTHENTICATED，且目标仍在', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(null).delete(URL_GOAL(chain.goal))

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
    expect(await goalExists(chain.goal)).toBe(true)
  })

  it('Authorization 头是垃圾令牌 → 401 UNAUTHENTICATED', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser('not-a-real-token').delete(URL_GOAL(chain.goal))

    expect(res.status).toBe(401)
  })

  it('goalId 不存在 → 404 NOT_FOUND（不是 409，也不产生 500）', async () => {
    const res = await ctx.asUser(pmToken).delete(URL_GOAL(MISSING_ID))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('goalId 属于另一个项目 → 404，且那个目标仍在（防跨项目删除）', async () => {
    const otherPmId = await makeUser(ctx.db, 't39-other-pm', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别人的目标')

    const res = await ctx.asUser(pmToken).delete(URL_GOAL(otherGoalId))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await goalExists(otherGoalId)).toBe(true)
  })

  it('「目标不存在」与「存在但非成员」的响应结构完全相同（不可区分，防存在性探测）', async () => {
    const missing = await ctx.asUser(pmToken).delete(URL_GOAL(MISSING_ID))
    const notMember = await ctx.asUser(outsiderToken).delete(URL_GOAL(goalId))

    expect(missing.status).toBe(notMember.status)
    expect(Object.keys(missing.body.error).sort()).toEqual(Object.keys(notMember.body.error).sort())
    expect((missing.body as ErrorBody).error.message).toBe((notMember.body as ErrorBody).error.message)
  })
})

// ===========================================================================
// 端点 17 —— DELETE /activities/:activityId
// ===========================================================================

describe('端点 17 正例：删除用户活动', () => {
  it('PM 删除无下级故事的活动 → 204，库中已不存在', async () => {
    // 用 makeDeletableActivity（该活动下没有任何故事）——
    // 不能用完整链路，否则实现会正确返回 409（见 makeFullChain 的注释）
    const deletable = await makeDeletableActivity()
    const res = await ctx.asUser(pmToken).delete(URL_ACTIVITY(deletable.activity))

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(await activityExists(deletable.activity)).toBe(false)
  })

  it('删除活动不影响其父目标：目标的 6 个字段逐字段不变', async () => {
    const deletable = await makeDeletableActivity()
    const goalBefore = await ctx.db.businessGoal.findUnique({
      where: { id: deletable.goal },
      select: { id: true, projectId: true, name: true, description: true, status: true, sortOrder: true },
    })

    const res = await ctx.asUser(pmToken).delete(URL_ACTIVITY(deletable.activity))

    // ⚠️ 同样必须先断言删除真的成功，否则「父目标不变」会在未发生删除时平凡成立
    expect(res.status).toBe(204)
    expect(await activityExists(deletable.activity)).toBe(false)
    expect(await goalExists(deletable.goal)).toBe(true)
    expect(
      await ctx.db.businessGoal.findUnique({
        where: { id: deletable.goal },
        select: { id: true, projectId: true, name: true, description: true, status: true, sortOrder: true },
      }),
    ).toEqual(goalBefore)
  })
})

describe('端点 17 反例：HAS_CHILDREN 与权限', () => {
  it('活动下仍有用户故事 → 409 CONFLICT，details 含 HAS_CHILDREN', async () => {
    const res = await ctx.asUser(pmToken).delete(URL_ACTIVITY(activityId))

    expect(res.status).toBe(409)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.details).toContainEqual({ field: 'activityId', code: 'HAS_CHILDREN' })
  })

  it('409 之后活动与下级故事都仍在', async () => {
    await ctx.asUser(pmToken).delete(URL_ACTIVITY(activityId))

    expect(await activityExists(activityId)).toBe(true)
    expect(await storyExists(storyId)).toBe(true)
  })

  it('HAS_CHILDREN 可解除：移除故事后同一次删除成功', async () => {
    expect((await ctx.asUser(pmToken).delete(URL_ACTIVITY(activityId))).status).toBe(409)

    await ctx.db.userStory.delete({ where: { id: storyId } })

    expect((await ctx.asUser(pmToken).delete(URL_ACTIVITY(activityId))).status).toBe(204)
    expect(await activityExists(activityId)).toBe(false)
  })

  it('MEMBER 删除 → 403 FORBIDDEN', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(memberToken).delete(URL_ACTIVITY(chain.activity))

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 删除 → 403 FORBIDDEN', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(viewerToken).delete(URL_ACTIVITY(chain.activity))

    expect(res.status).toBe(403)
  })

  it('非项目成员删除 → 404，且活动仍在', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(outsiderToken).delete(URL_ACTIVITY(chain.activity))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await activityExists(chain.activity)).toBe(true)
  })

  it('未登录 → 401，且活动仍在', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(null).delete(URL_ACTIVITY(chain.activity))

    expect(res.status).toBe(401)
    expect(await activityExists(chain.activity)).toBe(true)
  })

  it('activityId 不存在 → 404 NOT_FOUND', async () => {
    const res = await ctx.asUser(pmToken).delete(URL_ACTIVITY(MISSING_ID))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('activityId 属于另一个项目 → 404，且那个活动仍在', async () => {
    const otherPmId = await makeUser(ctx.db, 't39-other-pm2', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别人的目标')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别人的活动')

    const res = await ctx.asUser(pmToken).delete(URL_ACTIVITY(otherActivityId))

    expect(res.status).toBe(404)
    expect(await activityExists(otherActivityId)).toBe(true)
  })

  it('403 / 404 / 409 之后活动逐字段完全未被修改', async () => {
    const before = await ctx.db.userActivity.findUnique({
      where: { id: activityId },
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

    await ctx.asUser(memberToken).delete(URL_ACTIVITY(activityId))
    await ctx.asUser(viewerToken).delete(URL_ACTIVITY(activityId))
    await ctx.asUser(outsiderToken).delete(URL_ACTIVITY(activityId))
    await ctx.asUser(null).delete(URL_ACTIVITY(activityId))
    await ctx.asUser(pmToken).delete(URL_ACTIVITY(activityId)) // 409

    expect(
      await ctx.db.userActivity.findUnique({
        where: { id: activityId },
        select: {
          id: true,
          projectId: true,
          goalId: true,
          name: true,
          description: true,
          status: true,
          sortOrder: true,
        },
      }),
    ).toEqual(before)
  })
})

// ===========================================================================
// 端点 22 —— DELETE /stories/:storyId
// ===========================================================================

describe('端点 22 正例：删除用户故事', () => {
  it('PM 删除无任务的故事 → 204，库中已不存在', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(pmToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(await storyExists(chain.story)).toBe(false)
  })

  it('删除故事不影响其父活动与目标', async () => {
    const chain = await makeFullChain()

    await ctx.asUser(pmToken).delete(URL_STORY(chain.story))

    expect(await activityExists(chain.activity)).toBe(true)
    expect(await goalExists(chain.goal)).toBe(true)
  })

  it('PM 可以删除敏感故事（PM 对自己项目内的敏感对象可见，不受敏感白名单限制）', async () => {
    const chain = await makeFullChain()
    await makeSensitive(ctx.db, projectId, 'story', chain.story, [memberId])

    const res = await ctx.asUser(pmToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(204)
    expect(await storyExists(chain.story)).toBe(false)
  })
})

describe('端点 22 副作用：同一事务内清理 ObjectVisibility', () => {
  it('删除故事后，该故事的可见性记录必须被清理为 0（决策 I-7 的多态列无外键）', async () => {
    const chain = await makeFullChain()
    await makeSensitive(ctx.db, projectId, 'story', chain.story, [memberId])
    expect(await visibilityCount('story', chain.story)).toBe(1)

    const res = await ctx.asUser(pmToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(204)
    expect(await storyExists(chain.story)).toBe(false)
    // 悬挂记录会静默损坏将来的可见性判定，因此这条断言是端点 22 的核心
    expect(await visibilityCount('story', chain.story)).toBe(0)
  })

  it('清理只针对该故事的 story 记录：别的故事与 task 类型的记录逐行不变', async () => {
    const doomed = await makeFullChain()
    const survivor = await makeFullChain()
    // 幸存故事下挂一个任务，并给任务也写可见性记录（多态列的另一维）
    const taskId = await makeTask(ctx.db, projectId, survivor.story, pmId, memberId)

    await makeSensitive(ctx.db, projectId, 'story', doomed.story, [memberId])
    await makeSensitive(ctx.db, projectId, 'story', survivor.story, [memberId])
    await makeSensitive(ctx.db, projectId, 'task', taskId, [memberId])

    const survivorRowsBefore = await ctx.db.objectVisibility.findMany({
      where: { objectType: 'story', objectId: survivor.story },
    })
    const taskRowsBefore = await ctx.db.objectVisibility.findMany({
      where: { objectType: 'task', objectId: taskId },
    })

    await ctx.asUser(pmToken).delete(URL_STORY(doomed.story))

    expect(await visibilityCount('story', doomed.story)).toBe(0)
    expect(
      await ctx.db.objectVisibility.findMany({ where: { objectType: 'story', objectId: survivor.story } }),
    ).toEqual(survivorRowsBefore)
    expect(
      await ctx.db.objectVisibility.findMany({ where: { objectType: 'task', objectId: taskId } }),
    ).toEqual(taskRowsBefore)
  })

  it('故事仍有任务 → 409 时**可见性记录一条都不能少**（同事务回滚的直接证据）', async () => {
    const chain = await makeFullChain()
    await makeTask(ctx.db, projectId, chain.story, pmId, memberId)
    await makeSensitive(ctx.db, projectId, 'story', chain.story, [memberId])
    const before = await ctx.db.objectVisibility.findMany({
      where: { objectType: 'story', objectId: chain.story },
    })
    expect(before).toHaveLength(1)

    const res = await ctx.asUser(pmToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(409)
    // 若清理不在事务里（或先清理后删除），此处会变成 0 —— 即「擅自清空了敏感名单」
    expect(
      await ctx.db.objectVisibility.findMany({ where: { objectType: 'story', objectId: chain.story } }),
    ).toEqual(before)
    expect(await storyExists(chain.story)).toBe(true)
  })

  it('HAS_CHILDREN 可解除：移除任务后再删 → 204，且可见性一并被清理', async () => {
    const chain = await makeFullChain()
    const taskId = await makeTask(ctx.db, projectId, chain.story, pmId, memberId)
    await makeSensitive(ctx.db, projectId, 'story', chain.story, [memberId])

    expect((await ctx.asUser(pmToken).delete(URL_STORY(chain.story))).status).toBe(409)

    await ctx.db.task.delete({ where: { id: taskId } })

    const second = await ctx.asUser(pmToken).delete(URL_STORY(chain.story))
    expect(second.status).toBe(204)
    expect(await visibilityCount('story', chain.story)).toBe(0)
  })
})

describe('端点 22 反例：HAS_CHILDREN 与权限', () => {
  it('故事下仍有任务 → 409 CONFLICT，details 含 HAS_CHILDREN', async () => {
    const chain = await makeFullChain()
    await makeTask(ctx.db, projectId, chain.story, pmId, memberId)

    const res = await ctx.asUser(pmToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(409)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.details).toContainEqual({ field: 'storyId', code: 'HAS_CHILDREN' })
  })

  it('409 之后故事与任务都仍在', async () => {
    const chain = await makeFullChain()
    const taskId = await makeTask(ctx.db, projectId, chain.story, pmId, memberId)

    await ctx.asUser(pmToken).delete(URL_STORY(chain.story))

    expect(await storyExists(chain.story)).toBe(true)
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
  })

  it('MEMBER 删除 → 403 FORBIDDEN', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(memberToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 删除 → 403 FORBIDDEN', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(viewerToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(403)
  })

  it('非项目成员删除 → 404，且故事与可见性记录都不变', async () => {
    const chain = await makeFullChain()
    await makeSensitive(ctx.db, projectId, 'story', chain.story, [memberId])

    const res = await ctx.asUser(outsiderToken).delete(URL_STORY(chain.story))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(await storyExists(chain.story)).toBe(true)
    expect(await visibilityCount('story', chain.story)).toBe(1)
  })

  it('未登录 → 401，且故事仍在', async () => {
    const chain = await makeFullChain()
    const res = await ctx.asUser(null).delete(URL_STORY(chain.story))

    expect(res.status).toBe(401)
    expect(await storyExists(chain.story)).toBe(true)
  })

  it('storyId 不存在 → 404 NOT_FOUND', async () => {
    const res = await ctx.asUser(pmToken).delete(URL_STORY(MISSING_ID))

    expect(res.status).toBe(404)
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('storyId 属于另一个项目 → 404，且那个故事仍在', async () => {
    const otherPmId = await makeUser(ctx.db, 't39-other-pm3', '别的 PM')
    const otherProjectId = await makeProject(ctx.db, otherPmId, '另一个项目')
    const otherGoalId = await makeGoal(ctx.db, otherProjectId, '别人的目标')
    const otherActivityId = await makeActivity(ctx.db, otherProjectId, otherGoalId, '别人的活动')
    const otherStoryId = await makeStory(ctx.db, otherProjectId, otherActivityId)

    const res = await ctx.asUser(pmToken).delete(URL_STORY(otherStoryId))

    expect(res.status).toBe(404)
    expect(await storyExists(otherStoryId)).toBe(true)
  })

  it('403 / 404 之后故事逐字段完全未被修改', async () => {
    const before = await ctx.db.userStory.findUnique({ where: { id: storyId } })

    await ctx.asUser(memberToken).delete(URL_STORY(storyId))
    await ctx.asUser(viewerToken).delete(URL_STORY(storyId))
    await ctx.asUser(outsiderToken).delete(URL_STORY(storyId))
    await ctx.asUser(null).delete(URL_STORY(storyId))

    expect(await ctx.db.userStory.findUnique({ where: { id: storyId } })).toEqual(before)
  })
})
