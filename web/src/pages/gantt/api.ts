/**
 * US-06 甘特图（GitHub #26）—— 本页的 HTTP 调用。
 *
 * 与 `pages/workbench/api.ts`、`pages/workload/api.ts` 同构：只**新增**自己的 api
 * 文件，复用骨架的 `apiFetch`（`web/src/api.ts`），不重复实现 Authorization 与信封解析。
 *
 * 这里传的是**契约路径**，不带 `/api` 前缀 —— `apiFetch` 内部统一加 `/api`
 * 并由 Vite 代理 rewrite 掉（见 `web/src/api.ts` 注释）。
 *
 * 端点（设计 §7 候选，后端并行实现中，路由由主代理另批挂载）：
 *   GET /projects/:projectId/gantt   项目内统一时间轴聚合（故事 / 任务 / 里程碑 / 依赖）
 */
import { apiFetch } from '../../api'
import type { GanttView } from './types'

/** 项目甘特聚合视图（只读）。 */
export function getGantt(projectId: string): Promise<GanttView> {
  return apiFetch<GanttView>(`/projects/${encodeURIComponent(projectId)}/gantt`)
}
