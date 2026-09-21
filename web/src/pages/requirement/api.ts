/**
 * US-03（M4）需求层级 —— 本模块的 HTTP 调用
 *
 * 为什么本模块自己有一个 `api.ts` 而不是往 `web/src/api.ts` 里加：
 * `docs/frontend-routes.md` 冻结规定「前端骨架（含 `web/src/api.ts`）归 M2 独占维护，
 * 其他模块只往 `web/src/pages/` 下新增自己的页面」。所以本文件只**新增**，
 * 并且**复用** M2 的 `apiFetch`（US-03 只对它加了一个 `export`，见该文件注释），
 * 从而不重复实现「Authorization 头 + 契约 I-3 信封解析」这套逻辑。
 *
 * ⚠️ 两个必须遵守的约定（踩过才知道）
 *   1. **路径一律带 `/api` 前缀**：`web/vite.config.ts` 只代理 `/api` 并 rewrite 去掉前缀。
 *      原因是 SPA 的 History 路由（`/projects/:id/requirements`）与后端契约路径
 *      （`/projects`）**同名**，若直接代理根路径会把前端深链也转给后端，导致刷新/直达 404。
 *   2. **权限不做前端判断**：契约 I-9 要求通过后端 `can()` 的判定结果行事。
 *      本文件只发请求、只带令牌；403 / 404 由后端给出，界面负责显示原因。
 *
 * 端点覆盖（契约决策 I-8，本模块 13 个全部到位）
 *   10 GET    /projects/:projectId/goals                读层级树
 *   11 POST   /projects/:projectId/goals                建业务目标
 *   12 PATCH  /goals/:goalId                            改业务目标（部分更新）
 *   13 DELETE /goals/:goalId                            删业务目标
 *   14 PUT    /projects/:projectId/goals/order          目标排序（全量替换）
 *   15 POST   /goals/:goalId/activities                 建用户活动
 *   16 PATCH  /activities/:activityId                   改用户活动（部分更新）
 *   17 DELETE /activities/:activityId                   删用户活动
 *   18 PUT    /goals/:goalId/activities/order           活动排序（全量替换）
 *   19 POST   /activities/:activityId/stories           建用户需求
 *   20 GET    /stories/:storyId                         读需求详情
 *   21 PATCH  /stories/:storyId                         改需求（部分更新）
 *   22 DELETE /stories/:storyId                         删需求
 *
 * 属别的模块、本文件**不碰**：端点 23（敏感，M3）、24–30（任务，M5）。
 */
import type {
  BusinessGoal,
  GoalNode,
  GoalStatus,
  ListResponse,
  Priority,
  StoryStatus,
  UserActivity,
  UserStory,
} from '../../../../src/shared/types'
import { apiFetch } from '../../api'

/* ===========================================================================
 * 端点 10 —— 读层级树
 * =========================================================================== */

/**
 * 响应 `ListResponse<GoalNode>`：`{ items: GoalNode[] }`，元素是
 * `BusinessGoal + activities[]`，活动里再嵌 `stories[]`。
 * 排序是**响应序**（目标/活动按 `sortOrder` 升序、需求按 `createdAt` 升序），
 * 界面只渲染不重排 —— 重排会掩盖后端排序缺陷。
 */
export async function getGoalTree(projectId: string): Promise<GoalNode[]> {
  const payload = await apiFetch<ListResponse<GoalNode>>(
    `/projects/${encodeURIComponent(projectId)}/goals`,
  )
  // 轻量结构校验：只钉住「有 items 数组」这一条。逐字段窄化解析的版本更安全，
  // 但会与 M2 的 apiFetch 重复，故此处从简；契约漂移由
  // `pages/requirement/shared-types.typecheck.ts` 在编译期兜住。
  //
  // ⚠️ 抛出文案会经 `{error.message}` 渲染到界面上，所以**不写端点号与契约编号** ——
  // 那些是给开发者看的，留在本注释里就够了。
  if (!Array.isArray(payload.items)) {
    throw new Error('服务端返回的数据格式不正确（缺少需求列表）')
  }
  return payload.items
}

/* ===========================================================================
 * 端点 11 / 12 / 13 / 14 —— 业务目标
 * =========================================================================== */

/** 端点 11：建业务目标。副作用：status 默认 ACTIVE，sortOrder 排在末位。 */
export function createGoal(
  projectId: string,
  input: { name: string; description?: string },
): Promise<BusinessGoal> {
  return apiFetch<BusinessGoal>(`/projects/${encodeURIComponent(projectId)}/goals`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 端点 12：改业务目标（部分更新）。
 *
 * ⚠️ 只把**改过的字段**放进来。后端本身就是「只写请求体出现的字段」，
 * 前端若把整行提交回去，会把别人在这期间改的其它字段覆盖掉（丢失更新）。
 */
export function updateGoal(
  goalId: string,
  patch: { name?: string; description?: string; status?: GoalStatus },
): Promise<BusinessGoal> {
  return apiFetch<BusinessGoal>(`/goals/${encodeURIComponent(goalId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** 端点 13：删业务目标。仍有用户活动时后端返回 409 CONFLICT / HAS_CHILDREN。 */
export function deleteGoal(goalId: string): Promise<void> {
  return apiFetch<void>(`/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' })
}

/**
 * 端点 14：目标排序（全量替换）。
 *
 * 语义是「第 i 个 id 的 sortOrder 置为 i」——所以界面上的「上移 / 下移」必须
 * 提交**交换后的完整顺序**，而不是「把某一个挪一下」。集合与现有目标对不上时
 * 后端整单拒绝（422），一个序号都不会变。
 */
export function reorderGoals(projectId: string, orderedIds: string[]): Promise<BusinessGoal[]> {
  return apiFetch<ListResponse<BusinessGoal>>(
    `/projects/${encodeURIComponent(projectId)}/goals/order`,
    { method: 'PUT', body: JSON.stringify({ orderedIds }) },
  ).then((payload) => payload.items)
}

/* ===========================================================================
 * 端点 15 / 16 / 17 / 18 —— 用户活动
 * =========================================================================== */

/** 端点 15：建用户活动。归属（projectId）由 goalId 所属目标推导，请求体里没有该字段。 */
export function createActivity(
  goalId: string,
  input: { name: string; description?: string },
): Promise<UserActivity> {
  return apiFetch<UserActivity>(`/goals/${encodeURIComponent(goalId)}/activities`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** 端点 16：改用户活动（部分更新，只提交改过的字段）。 */
export function updateActivity(
  activityId: string,
  patch: { name?: string; description?: string; status?: GoalStatus },
): Promise<UserActivity> {
  return apiFetch<UserActivity>(`/activities/${encodeURIComponent(activityId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** 端点 17：删用户活动。仍有用户需求时后端返回 409 CONFLICT / HAS_CHILDREN。 */
export function deleteActivity(activityId: string): Promise<void> {
  return apiFetch<void>(`/activities/${encodeURIComponent(activityId)}`, { method: 'DELETE' })
}

/** 端点 18：活动排序（全量替换），范围限定在该目标下的活动。 */
export function reorderActivities(goalId: string, orderedIds: string[]): Promise<UserActivity[]> {
  return apiFetch<ListResponse<UserActivity>>(
    `/goals/${encodeURIComponent(goalId)}/activities/order`,
    { method: 'PUT', body: JSON.stringify({ orderedIds }) },
  ).then((payload) => payload.items)
}

/* ===========================================================================
 * 端点 19 / 20 / 21 / 22 —— 用户需求
 * =========================================================================== */

/** 端点 19 的请求体：三段式分开传，不是拼成一句话。 */
export type CreateStoryInput = {
  title: string
  roleText: string
  capabilityText: string
  valueText: string
  businessValue: string
  priority: Priority
  acceptanceCriteria?: string
}

/** 端点 19：建用户需求。副作用：status 默认 DRAFT、isSensitive 默认 false。 */
export function createStory(activityId: string, input: CreateStoryInput): Promise<UserStory> {
  return apiFetch<UserStory>(`/activities/${encodeURIComponent(activityId)}/stories`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 端点 20：读用户需求详情。
 *
 * 契约 I-8 端点 20 明写：不存在 / 非项目成员 / 敏感且未授权，**三者响应完全一致**。
 * 所以界面拿到 404 时无法（也不应该）区分原因。
 */
export function getStory(storyId: string): Promise<UserStory> {
  return apiFetch<UserStory>(`/stories/${encodeURIComponent(storyId)}`)
}

/**
 * 端点 21：改用户需求（部分更新，只提交改过的字段）。
 *
 * ⚠️ 这里**刻意没有** `isSensitive`：契约 I-8 明文规定该字段只能通过端点 23 修改。
 * 少写一个字段就是在编译期钉住这条约束，而不是靠注释提醒。
 */
export function updateStory(
  storyId: string,
  patch: {
    title?: string
    roleText?: string
    capabilityText?: string
    valueText?: string
    businessValue?: string
    priority?: Priority
    status?: StoryStatus
    acceptanceCriteria?: string
  },
): Promise<UserStory> {
  return apiFetch<UserStory>(`/stories/${encodeURIComponent(storyId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** 端点 22：删用户需求。仍有任务时后端返回 409 CONFLICT / HAS_CHILDREN。 */
export function deleteStory(storyId: string): Promise<void> {
  return apiFetch<void>(`/stories/${encodeURIComponent(storyId)}`, { method: 'DELETE' })
}

/* ===========================================================================
 * 本地助手
 * =========================================================================== */

/** 把三层树摊平成「需求 + 它所属的目标与活动」，供列表页签与深链查找使用。 */
export type StoryRow = { goal: GoalNode; activity: GoalNode['activities'][number]; story: UserStory }

export function collectStoryRows(goals: GoalNode[]): StoryRow[] {
  const rows: StoryRow[] = []
  for (const goal of goals) {
    for (const activity of goal.activities) {
      for (const story of activity.stories) rows.push({ goal, activity, story })
    }
  }
  return rows
}

/** 在树里按 id 找一条需求及其上级，找不到返回 null（深链落空时的正常路径）。 */
export function findStoryRow(goals: GoalNode[], storyId: string): StoryRow | null {
  for (const row of collectStoryRows(goals)) {
    if (row.story.id === storyId) return row
  }
  return null
}

