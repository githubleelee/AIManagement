/**
 * US-10 风险台账与项目关闭（工单 #30）—— 本页的 HTTP 调用与界面侧类型。
 *
 * 与服务端 `src/modules/risk/{types,service,closure}.ts` 对应。
 *
 * 授权（批复）：`risk.write` = PM + MEMBER（VIEWER 只读）；`project.close` = 仅 PM。
 */
import type { TaskView, UserBrief } from '../../../../src/shared/types'
import { apiFetch } from '../../api'

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export type RiskStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

export const RISK_LEVELS: readonly RiskLevel[] = ['HIGH', 'MEDIUM', 'LOW']
export const RISK_STATUSES: readonly RiskStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
}

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  OPEN: '未处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
}

/** 会阻断项目关闭的状态（与后端 `BLOCKING_RISK_STATUSES` 一致）。 */
export const BLOCKING_STATUSES: readonly RiskStatus[] = ['OPEN', 'IN_PROGRESS']

/** 改为这两个状态时必须填写解决说明（否则服务端 422）。 */
export const NEEDS_RESOLUTION: readonly RiskStatus[] = ['RESOLVED', 'CLOSED']

export type RiskView = {
  id: string
  projectId: string
  title: string
  description: string | null
  level: RiskLevel
  status: RiskStatus
  ownerUserId: string
  owner: UserBrief
  taskId: string | null
  resolution: string | null
  createdAt: string
  updatedAt: string
}

export type RiskCreateInput = {
  title: string
  level: RiskLevel
  ownerUserId: string
  description?: string | null
  taskId?: string | null
}

export type RiskPatchInput = Partial<RiskCreateInput> & {
  status?: RiskStatus
  resolution?: string | null
}

export type ClosureVerdictState = 'blocked' | 'clear' | 'unavailable'

export type BlockingSide<T> = {
  state: 'ok' | 'unavailable'
  total: number | null
  rows: T[]
  note?: string
}

export type ClosureCheckView = {
  project: { id: string; name: string }
  verdict: { state: ClosureVerdictState; canClose: boolean | null; note: string }
  blockingTasks: BlockingSide<TaskView>
  blockingRisks: BlockingSide<RiskView>
  basis: {
    asOf: string
    scope: 'global' | 'visible'
    blockingMeans: string
    riskSideNote: string
    closeActionNote: string
  }
}

export type ProjectLifecycleView = {
  project: { id: string; name: string; status: 'ACTIVE' | 'CLOSED' }
}

export function listRisks(projectId: string): Promise<RiskView[]> {
  return apiFetch<{ items: RiskView[] }>(`/projects/${encodeURIComponent(projectId)}/risks`).then(
    (payload) => payload.items,
  )
}

export function createRisk(projectId: string, input: RiskCreateInput): Promise<RiskView> {
  return apiFetch<RiskView>(`/projects/${encodeURIComponent(projectId)}/risks`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function patchRisk(riskId: string, patch: RiskPatchInput): Promise<RiskView> {
  return apiFetch<RiskView>(`/risks/${encodeURIComponent(riskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function getClosureCheck(projectId: string): Promise<ClosureCheckView> {
  return apiFetch<ClosureCheckView>(
    `/projects/${encodeURIComponent(projectId)}/closure-check`,
  )
}

export function closeProject(projectId: string): Promise<ProjectLifecycleView> {
  return apiFetch<ProjectLifecycleView>(`/projects/${encodeURIComponent(projectId)}/close`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function reopenProject(projectId: string): Promise<ProjectLifecycleView> {
  return apiFetch<ProjectLifecycleView>(`/projects/${encodeURIComponent(projectId)}/reopen`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/** ISO 8601 → 本地可读时间（`YYYY-MM-DD HH:mm`）。 */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
