/**
 * US-10 项目仪表盘（工单 #30）—— 本页的 HTTP 调用与界面侧类型。
 *
 * 与服务端 `src/modules/analytics/types.ts` 一一对应（类型按仓库既有做法各自声明；
 * 漂移风险由本票的编译期护栏在后续补齐）。
 *
 * 口径（批复冻结）：计划时间进度**含首尾**、时区 Asia/Shanghai；
 * 偏差 = 计划 − 实际，单位**百分点**；≤10pp 健康 / ≤25pp 预警 / >25pp 风险。
 */
import type { TaskStatus } from '../../../../src/shared/types'
import { apiFetch } from '../../api'

export type HealthState = 'HEALTHY' | 'WARNING' | 'AT_RISK' | 'UNAVAILABLE'

/** 健康度四态的中文标签（线上常量与展示文案分离，契约 I-1）。 */
export const HEALTH_STATE_LABEL: Record<HealthState, string> = {
  HEALTHY: '健康',
  WARNING: '预警',
  AT_RISK: '风险',
  UNAVAILABLE: '无法计算',
}

export type ProjectDashboardView = {
  project: { id: string; name: string }
  progress: { closed: number; total: number; ratio: number | null }
  health: { state: HealthState; deviationPp: number | null; note?: string }
  byStatus: Record<TaskStatus, number>
  basis: {
    asOf: string
    scope: 'global' | 'visible'
    planWindow: { start: string; end: string } | null
    planTimeProgress: number | null
    thresholds: { healthyPp: number; warningPp: number }
    progressMeans: string
    planTimeProgressMeans: string
    healthMeans: string
    timezone: string
  }
}

export function getDashboard(projectId: string): Promise<ProjectDashboardView> {
  return apiFetch<ProjectDashboardView>(`/projects/${encodeURIComponent(projectId)}/dashboard`)
}

/** 比例 → 百分比文案；`null` 时显示「—」而不是 0%（"没数据"≠"0%"）。 */
export function percentText(ratio: number | null): string {
  if (ratio === null) return '—'
  return `${Math.round(ratio * 1000) / 10}%`
}

/** 偏差（pp）→ 带符号文案。 */
export function deviationText(pp: number | null): string {
  if (pp === null) return '—'
  return `${pp > 0 ? '+' : ''}${pp.toFixed(1)} pp`
}
