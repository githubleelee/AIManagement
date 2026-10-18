/**
 * US-07 成员任务图与负载（GitHub #27）—— 本页的 HTTP 调用。
 *
 * 与 `pages/workbench/api.ts`、`pages/task/api.ts` 同构：只**新增**自己的 api 文件，
 * 复用骨架的 `apiFetch`（`web/src/api.ts`），不重复实现 Authorization 与信封解析。
 *
 * 注意：这里传的是**契约路径**，不带 `/api` 前缀 —— `apiFetch` 内部统一加
 * `/api` 并由 Vite 代理 rewrite 掉（见 `web/src/api.ts` 注释）。
 *
 * 端点（设计 §3，待公共骨架挂载后生效）：
 *   GET /projects/:projectId/workload            项目成员负载总览
 *   GET /projects/:projectId/workload/:userId     单成员未关闭任务清单
 */
import { apiFetch } from '../../api'
import type { MemberWorkloadView, WorkloadView } from './types'

/** 项目成员负载总览（成员 + 非 CLOSED 计数 + 可见范围标签）。 */
export function getWorkload(projectId: string): Promise<WorkloadView> {
  return apiFetch<WorkloadView>(`/projects/${encodeURIComponent(projectId)}/workload`)
}

/** 单成员的未关闭任务清单（状态、计划起止）。 */
export function getMemberWorkload(
  projectId: string,
  userId: string,
): Promise<MemberWorkloadView> {
  return apiFetch<MemberWorkloadView>(
    `/projects/${encodeURIComponent(projectId)}/workload/${encodeURIComponent(userId)}`,
  )
}
