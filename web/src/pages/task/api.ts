/**
 * M5 任务（US-05）—— 本模块的 HTTP 调用
 *
 * 为什么本模块自己有一个 `api.ts` 而不是往 `web/src/api.ts` 里加：
 * `docs/frontend-routes.md` 冻结规定「前端骨架（含 web/src/api.ts）归 M2 独占维护，
 * 其他模块只往 web/src/pages/ 下新增自己的页面」。与 US-03 的 `pages/requirement/api.ts`
 * 同构，本文件只**新增**、并复用 M2 的 `apiFetch`，不重复实现 Authorization + 信封解析。
 *
 * 端点覆盖（契约决策 I-8，本模块 7 个全到位）：
 *   24 GET    /stories/:storyId/tasks           故事下的任务列表
 *   25 POST   /stories/:storyId/tasks           建任务
 *   26 GET    /projects/:projectId/tasks        项目级任务列表（?ownerUserId=）
 *   27 GET    /tasks/:taskId                    任务详情
 *   28 PATCH  /tasks/:taskId                    编辑（部分更新）
 *   29 DELETE /tasks/:taskId                    删除
 *   30 PUT    /tasks/:taskId/sensitivity        任务敏感可见（M3 共用端点，UI 复用 SensitivityEditor）
 *
 * ⚠️ 契约约束（与后端一致，前端不越权、只发请求）：
 *   - `isSensitive` / `visibleMemberIds` 只能经端点 30 改，不在 create/update 的入参里
 *   - 负责人/验收人必填、验收人 ≠ 负责人、成员 ≥ 2，均由后端 `assertTaskAssignment` 强制
 *   - 计划起止用 `YYYY-MM-DD`（<input type="date"> 的输出正好是这个格式）
 */
import type {
  ListResponse,
  SensitivityInput,
  SensitivityView,
  TaskStatus,
  TaskView,
} from '../../../../src/shared/types'
import { apiFetch } from '../../api'

/* ===========================================================================
 * 端点 24 / 26 —— 任务列表
 * =========================================================================== */

/** 端点 24：某条故事下的任务列表。排序由后端保证（planStart 升序，再 createdAt 升序）。 */
export function listStoryTasks(storyId: string): Promise<TaskView[]> {
  return apiFetch<ListResponse<TaskView>>(
    `/stories/${encodeURIComponent(storyId)}/tasks`,
  ).then((payload) => payload.items)
}

/** 端点 26：项目级任务总表，可按负责人过滤。 */
export function listProjectTasks(projectId: string, ownerUserId?: string): Promise<TaskView[]> {
  const query = ownerUserId ? `?ownerUserId=${encodeURIComponent(ownerUserId)}` : ''
  return apiFetch<ListResponse<TaskView>>(
    `/projects/${encodeURIComponent(projectId)}/tasks${query}`,
  ).then((payload) => payload.items)
}

/* ===========================================================================
 * 端点 25 —— 建任务
 * =========================================================================== */

/** 端点 25 的请求体：`status` 默认 TODO、`isSensitive` 默认 false，均由后端保证，这里不传。 */
export type CreateTaskInput = {
  title: string
  description?: string
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
}

export function createTask(storyId: string, input: CreateTaskInput): Promise<TaskView> {
  return apiFetch<TaskView>(`/stories/${encodeURIComponent(storyId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/* ===========================================================================
 * 端点 27 / 28 / 29 —— 任务详情 / 编辑 / 删除
 * =========================================================================== */

export function getTask(taskId: string): Promise<TaskView> {
  return apiFetch<TaskView>(`/tasks/${encodeURIComponent(taskId)}`)
}

/** 端点 28 的入参（**部分更新**：只提交改过的字段；不含 `isSensitive`）。 */
export type UpdateTaskInput = {
  title?: string
  description?: string
  ownerUserId?: string
  acceptorUserId?: string
  planStart?: string
  planEnd?: string
  status?: TaskStatus
}

export function updateTask(taskId: string, patch: UpdateTaskInput): Promise<TaskView> {
  return apiFetch<TaskView>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteTask(taskId: string): Promise<void> {
  return apiFetch<void>(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
}

/* ===========================================================================
 * 端点 30 —— 任务敏感可见（与 SensitivityEditor 配套）
 * =========================================================================== */

export function saveTaskSensitivity(taskId: string, input: SensitivityInput): Promise<SensitivityView> {
  return apiFetch<SensitivityView>(`/tasks/${encodeURIComponent(taskId)}/sensitivity`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}
