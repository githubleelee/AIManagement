/**
 * US-08 个人工作台（工单 #28）—— 本页的 HTTP 调用。
 *
 * 与 `pages/task/api.ts` 同构：本模块**只新增**自己的 api 文件，复用骨架的
 * `apiFetch`（`web/src/api.ts`，归 M2 维护），不重复实现 Authorization 与信封解析。
 *
 * 端点：`GET /me/workbench`（本票新增，说明见 docs/us-08-workbench-api.md）。
 */
import type { TaskView } from '../../../../src/shared/types'
import { apiFetch } from '../../api'

/** 工作台 5 块的标识，与服务端一致。 */
export type WorkbenchBlockKey = 'todo' | 'overdue' | 'accept' | 'mention' | 'upcoming'

/**
 * 一块的数据状态：
 *   - `ok`：数据可用，`total` 是精确条数；
 *   - `unavailable`：**数据源还没接入**（如「被提及」的 @提及来源尚未接入），
 *     `total` 为 `null`，界面必须显示「—」而不是 0 —— 不能把"还没接上"说成"没有"。
 */
export type WorkbenchBlockState = 'ok' | 'unavailable'

export type WorkbenchBlockView = {
  key: WorkbenchBlockKey
  state: WorkbenchBlockState
  total: number | null
  rows: TaskView[]
  note?: string
}

/** 服务端随响应返回的计算口径，界面用来把口径写清楚（也便于审查核对）。 */
export type WorkbenchBasis = {
  asOf: string
  todoMeans: string
  overdueMeans: string
  upcomingWindowDays: number
  sixStatesNote: string
}

export type WorkbenchResponse = {
  blocks: WorkbenchBlockView[]
  basis: WorkbenchBasis
}

export function getWorkbench(): Promise<WorkbenchResponse> {
  return apiFetch<WorkbenchResponse>('/me/workbench')
}

/** 明细行要跳到的地方：该任务所属需求的需求详情页（任务区在那里）。 */
export function taskTargetHref(row: TaskView): string {
  return `/projects/${encodeURIComponent(row.projectId)}/requirements/${encodeURIComponent(row.storyId)}`
}
