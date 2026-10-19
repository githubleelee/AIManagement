/**
 * US-04 故事看板（GitHub #25 / 本地 #17 只读、#18 写入口）—— 本页的 HTTP 调用。
 *
 * 与 `pages/workload/api.ts`、`pages/gantt/api.ts` 同构：只**新增**自己的 api 文件，
 * 复用骨架的 `apiFetch`（`web/src/api.ts`），不重复实现 Authorization 与信封解析。
 *
 * 这里传的是**契约路径**，不带 `/api` 前缀 —— `apiFetch` 内部统一加
 * `/api` 并由 Vite 代理 rewrite 掉（见 `web/src/api.ts` 注释）。
 *
 * 端点：
 *   GET   /projects/:projectId/board   故事看板三列聚合（DRAFT → PLANNING → DONE）
 *   PATCH /stories/:storyId            改故事状态（**只带 `{ status }`**）
 *
 * ⚠️ 写路径**不新增端点、不新增动作**（`DECISIONS.md` `permissions.story-status-write`）：
 *   看板的状态写入就是既有端点 21，鉴权沿用 `requirement.write`（**仅 PM**）。
 *   前端隐藏控件只是体验层，MEMBER / VIEWER 直连接口仍会被服务端 403 拒绝。
 */
import { ApiError, apiFetch } from '../../api'
import type { BoardView, StoryStatusValue } from './types'

/** 项目故事看板（三列聚合）。 */
export function getBoard(projectId: string): Promise<BoardView> {
  return apiFetch<BoardView>(`/projects/${encodeURIComponent(projectId)}/board`)
}

/**
 * 端点 21：改故事状态。
 *
 * **只提交 `{ status }`**：后端是部分更新（只写请求体出现的字段），把整张卡片
 * 或其它字段一起提交回去会覆盖别人在这期间的改动（丢失更新）；且审计口径只认
 * 真实发生的状态变化，多余字段只会让请求体与审计口径不一致。
 *
 * 返回值**刻意声明为 `unknown` 且调用方不使用**：本页的唯一真相是随后重新拉取的
 * `GET /projects/:projectId/board`，不用写响应做本地乐观改写（设计 §9）。
 */
export function updateStoryStatus(storyId: string, status: StoryStatusValue): Promise<unknown> {
  return apiFetch<unknown>(`/stories/${encodeURIComponent(storyId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

/**
 * 写失败的就近提示文案（与 `pages/gantt/api.ts` 的 `ganttWriteErrorMessage` 同构）。
 *
 * 口径：
 *   - 403 → 权限事实（`permissions.story-status-write`：只有 PM 能改故事状态）；
 *   - 404 → 与页面既有口径一致：不存在 / 非项目成员 / 敏感且未授权**三者不可区分**，
 *     故不区分原因（决策 I-3 的不泄漏存在性）。文案与需求详情页同口径，不自行推测原因。
 *   - 其它（含 422）→ 服务端 `message` 原样展示，不自造文案。
 */
export function boardWriteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '只有项目经理可以调整故事状态。'
    if (error.status === 404) return '这条需求可能已被删除，或者你不在这个项目里。'
    return error.message
  }
  return '操作失败，请稍后重试。'
}
