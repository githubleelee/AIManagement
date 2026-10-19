/**
 * US-06 甘特图（GitHub #26）—— 本页的 HTTP 调用。
 *
 * 与 `pages/workbench/api.ts`、`pages/workload/api.ts` 同构：只**新增**自己的 api
 * 文件，复用骨架的 `apiFetch`（`web/src/api.ts`），不重复实现 Authorization 与信封解析。
 *
 * 这里传的是**契约路径**，不带 `/api` 前缀 —— `apiFetch` 内部统一加 `/api`
 * 并由 Vite 代理 rewrite 掉（见 `web/src/api.ts` 注释）。
 *
 * 端点（读取 + 写路径，写路径后端 #12 已合入 main，字段名冻结）：
 *   GET    /projects/:projectId/gantt               项目内统一时间轴聚合（故事 / 任务 / 里程碑 / 依赖）
 *   POST   /projects/:projectId/milestones          新建里程碑（仅 PM）
 *   PATCH  /milestones/:milestoneId                 修改里程碑（仅 PM；`taskIds` 出现即整体替换）
 *   DELETE /milestones/:milestoneId                 删除里程碑（仅 PM）
 *   POST   /projects/:projectId/task-dependencies   新建 FS 依赖（仅 PM）
 *   DELETE /task-dependencies/:dependencyId         删除依赖（仅 PM）
 */
import { ApiError, apiFetch } from '../../api'
import type {
  GanttView,
  MilestoneCreateInput,
  MilestonePatchInput,
  MilestoneWriteView,
  TaskDependencyCreateInput,
  TaskDependencyWriteView,
} from './types'

/** 项目甘特聚合视图（只读）。 */
export function getGantt(projectId: string): Promise<GanttView> {
  return apiFetch<GanttView>(`/projects/${encodeURIComponent(projectId)}/gantt`)
}

/** 新建里程碑（`POST /projects/:projectId/milestones`，仅 PM → 201 `MilestoneWriteView`）。 */
export function createMilestone(
  projectId: string,
  input: MilestoneCreateInput,
): Promise<MilestoneWriteView> {
  return apiFetch<MilestoneWriteView>(
    `/projects/${encodeURIComponent(projectId)}/milestones`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

/** 修改里程碑（`PATCH /milestones/:milestoneId`）；`input` **只带改动字段**，不含 `taskIds` 即不动关联。 */
export function updateMilestone(
  milestoneId: string,
  input: MilestonePatchInput,
): Promise<MilestoneWriteView> {
  return apiFetch<MilestoneWriteView>(`/milestones/${encodeURIComponent(milestoneId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** 删除里程碑（`DELETE /milestones/:milestoneId` → 204）。 */
export function deleteMilestone(milestoneId: string): Promise<void> {
  return apiFetch<void>(`/milestones/${encodeURIComponent(milestoneId)}`, { method: 'DELETE' })
}

/** 新建 FS 依赖（`POST /projects/:projectId/task-dependencies`，仅 PM → 201 `TaskDependencyView`）。 */
export function createDependency(
  projectId: string,
  input: TaskDependencyCreateInput,
): Promise<TaskDependencyWriteView> {
  return apiFetch<TaskDependencyWriteView>(
    `/projects/${encodeURIComponent(projectId)}/task-dependencies`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

/** 删除依赖（`DELETE /task-dependencies/:dependencyId` → 204）。 */
export function deleteDependency(dependencyId: string): Promise<void> {
  return apiFetch<void>(`/task-dependencies/${encodeURIComponent(dependencyId)}`, {
    method: 'DELETE',
  })
}

/**
 * 写操作错误 → 界面文案。
 *
 * 403 / 404 用页面既定口径（与读侧「项目不存在 / 不是成员」一致，不泄漏存在性）；
 * 其余（含 422 / 500）直接用服务端 `message`，不自行编造。
 */
export function ganttWriteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '只有项目经理可以维护里程碑与依赖。'
    if (error.status === 404) return '项目不存在，或你不是项目成员。'
    return error.message
  }
  return '操作失败，请稍后重试。'
}
