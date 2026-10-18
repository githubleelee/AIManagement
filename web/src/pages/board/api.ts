/**
 * US-04 故事看板（GitHub #25）—— 本页的 HTTP 调用。
 *
 * 与 `pages/workload/api.ts`、`pages/gantt/api.ts` 同构：只**新增**自己的 api 文件，
 * 复用骨架的 `apiFetch`（`web/src/api.ts`），不重复实现 Authorization 与信封解析。
 *
 * 这里传的是**契约路径**，不带 `/api` 前缀 —— `apiFetch` 内部统一加
 * `/api` 并由 Vite 代理 rewrite 掉（见 `web/src/api.ts` 注释）。
 *
 * 端点（主代理已冻结，后端并行实现中；本批**只读**，无写请求）：
 *   GET /projects/:projectId/board   故事看板三列聚合（DRAFT → PLANNING → DONE）
 */
import { apiFetch } from '../../api'
import type { BoardView } from './types'

/** 项目故事看板（三列聚合，只读）。 */
export function getBoard(projectId: string): Promise<BoardView> {
  return apiFetch<BoardView>(`/projects/${encodeURIComponent(projectId)}/board`)
}
