import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ProjectView, TaskStatus } from '../../../../src/shared/types'
import { ApiError } from '../../api'
import PageHeader from '../../components/PageHeader'
// 状态徽标与标签表复用任务模块已有的那一份（不再抄第二张表，避免 US-08 审查 B-4 的重演）
import { TASK_STATUS_LABEL } from '../task/TaskStatusBadge'
import './dashboard.css'
import {
  deviationText,
  getDashboard,
  percentText,
  HEALTH_STATE_LABEL,
  type ProjectDashboardView,
} from './api'

/**
 * 项目仪表盘（US-10 / 工单 #30，AC1 / AC2 / AC6）。
 *
 * 三条界面纪律：
 * 1. **算不出来就显示「—」**：进度为 `null` 时显示「—」而不是 0%；健康度 `UNAVAILABLE`
 *    时显示原因，不给一个"健康"的假徽标。
 * 2. **非 PM 必须标注「可见范围」**：批复第 3 节要求，避免以可见子集冒称全项目。
 * 3. **口径随页面展示**：阈值、时区、公式来自服务端 `basis`，前端不自己写死数字。
 */
const STATUS_ORDER: readonly TaskStatus[] = [
  'TODO',
  'DOING',
  'BLOCKED',
  'SUSPENDED',
  'DONE',
  'CLOSED',
]

export default function DashboardPage() {
  const project = useOutletContext<ProjectView>()
  const [view, setView] = useState<ProjectDashboardView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      setView(await getDashboard(project.id))
    } catch (caught) {
      setView(null)
      setError(caught instanceof ApiError ? caught.message : '加载仪表盘失败')
    }
  }, [project.id])

  useEffect(() => {
    void reload()
  }, [reload])

  if (error) {
    return (
      <div className="page">
        <PageHeader title="项目仪表盘" description="加载失败" />
        <p className="error" role="alert">
          {error}
        </p>
        <button type="button" className="dash-retry" onClick={() => void reload()}>
          重试
        </button>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="page">
        <PageHeader title="项目仪表盘" description="加载中…" />
        <div className="page-loading">加载中…</div>
      </div>
    )
  }

  const { progress, health, byStatus, basis } = view
  const ratio = progress.ratio

  return (
    <div className="page">
      <PageHeader
        title="项目仪表盘"
        description={
          basis.scope === 'visible'
            ? '以下数字只统计**你可看到**的任务（可见范围），不代表全项目。'
            : '以下数字统计全项目任务。'
        }
      />

      <div className="dash-grid">
        {/* ---------------- 进度 ---------------- */}
        <section className="dash-card">
          <h2 className="dash-card-title">进度</h2>
          <p className="dash-big">{percentText(ratio)}</p>
          <p className="dash-sub">
            已验收关闭 <strong>{progress.closed}</strong> / 共 <strong>{progress.total}</strong> 个任务
          </p>
          <div className="dash-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }} />
          </div>
          <p className="dash-hint">
            {ratio === null ? '项目下还没有任务，所以没有进度可言。' : '「待验收」不计入进度，要等验收关闭。'}
          </p>
        </section>

        {/* ---------------- 健康度 ---------------- */}
        <section className="dash-card">
          <h2 className="dash-card-title">健康度</h2>
          <p className={`dash-badge dash-badge--${health.state.toLowerCase()}`}>
            {HEALTH_STATE_LABEL[health.state]}
          </p>
          <p className="dash-sub">
            偏差 <strong>{deviationText(health.deviationPp)}</strong>
            <span className="dash-muted">（计划 − 实际；正数表示落后于计划）</span>
          </p>
          {health.note ? <p className="dash-hint">{health.note}</p> : null}
          <p className="dash-hint">
            分级：偏差 ≤ {basis.thresholds.healthyPp}pp 健康、≤ {basis.thresholds.warningPp}pp 预警、 超过
            {basis.thresholds.warningPp}pp 风险。
          </p>
        </section>

        {/* ---------------- 计划窗口 ---------------- */}
        <section className="dash-card">
          <h2 className="dash-card-title">计划时间</h2>
          <p className="dash-big">{percentText(basis.planTimeProgress)}</p>
          <p className="dash-sub">
            {basis.planWindow
              ? `${basis.planWindow.start} → ${basis.planWindow.end}`
              : '暂无计划数据'}
          </p>
          <p className="dash-hint">
            计划时间进度按自然日**含首尾**计算（时区 {basis.timezone}），今天记作 {basis.asOf}。
          </p>
        </section>

        {/* ---------------- 状态分布 ---------------- */}
        <section className="dash-card dash-card--wide">
          <h2 className="dash-card-title">任务状态分布</h2>
          <ul className="dash-status-list">
            {STATUS_ORDER.map((status) => {
              const count = byStatus[status] ?? 0
              const share = progress.total === 0 ? 0 : count / progress.total
              return (
                <li className="dash-status-item" key={status}>
                  <span className="dash-status-name">{TASK_STATUS_LABEL[status]}</span>
                  <span className="dash-status-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(share * 100)}%` }} />
                  </span>
                  <span className="dash-status-count">{count}</span>
                </li>
              )
            })}
          </ul>
          <p className="dash-hint">六项之和恒等于任务总数（{progress.total}），不会漏算状态。</p>
        </section>
      </div>

      {/* ---------------- 口径说明 ---------------- */}
      <details className="dash-basis">
        <summary>计算口径（点开可核对）</summary>
        <dl className="dash-basis-list">
          <dt>实际进度</dt>
          <dd>{basis.progressMeans}</dd>
          <dt>计划时间进度</dt>
          <dd>{basis.planTimeProgressMeans}</dd>
          <dt>健康度</dt>
          <dd>{basis.healthMeans}</dd>
          <dt>统计范围</dt>
          <dd>
            {basis.scope === 'global' ? '全项目（项目经理视角）' : '仅你可看到的部分（可见范围）'}
          </dd>
          <dt>今天</dt>
          <dd>
            {basis.asOf}（{basis.timezone}）
          </dd>
        </dl>
      </details>
    </div>
  )
}
