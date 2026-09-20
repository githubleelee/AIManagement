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
 * 端点归属（契约决策 I-8）：端点 10 `GET /projects/:projectId/goals`（权限 `project.read`）、
 * 端点 20 `GET /stories/:storyId`（权限 `project.read`）。写路径（11–22）属后续功能块。
 *
 * 本文件替换了此前基于 `main` 写的版本。旧版本自带一整套「逐字段窄化 + 无断言」的
 * 信封解析，安全性更高，但与 M2 的 `apiFetch` **完全重复**，且旧版本用的是根路径
 * （在他们的 `/api` 代理方案下必然 404）。取舍已在表五记录。
 */
import type { GoalNode, ListResponse, UserStory } from '../../../../src/shared/types'
import { apiFetch } from '../../api'

/**
 * 端点 10：需求层级树。
 *
 * 响应 `ListResponse<GoalNode>`：`{ items: GoalNode[] }`，元素是
 * `BusinessGoal + activities[]`，活动里再嵌 `stories[]`。
 * 排序是**响应序**（目标/活动按 `sortOrder` 升序、故事按 `createdAt` 升序），
 * 界面只渲染不重排 —— 重排会掩盖后端排序缺陷。
 */
export async function getGoalTree(projectId: string): Promise<GoalNode[]> {
  const payload = await apiFetch<ListResponse<GoalNode>>(
    `/projects/${encodeURIComponent(projectId)}/goals`,
  )
  // 轻量结构校验：只钉住「有 items 数组」这一条。逐字段窄化解析的版本更安全，
  // 但会与 M2 的 apiFetch 重复，故此处从简；契约漂移由
  // `pages/requirement/shared-types.typecheck.ts` 在编译期兜住。
  if (!Array.isArray(payload.items)) {
    throw new Error('端点 10 的响应不是契约 I-3 的 ListResponse 形状（缺少 items 数组）')
  }
  return payload.items
}

/** 端点 20：用户故事的详情。 */
export function getStory(storyId: string): Promise<UserStory> {
  return apiFetch<UserStory>(`/stories/${encodeURIComponent(storyId)}`)
}
