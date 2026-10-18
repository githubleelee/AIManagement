/**
 * US-06 甘特图（GitHub #26）—— 项目甘特页面（默认导出）。
 *
 * 挂载：`/projects/:projectId/gantt`（由公共骨架另批完成，见 `web/src/routes.tsx`）。
 * 本文件只交付组件本身，**不改**路由 / 布局 / 骨架。
 *
 * 只读页面：
 *   - 统一时间轴（`GanttTimeline`）：故事行可展开到任务行，纯 CSS 计划区间条；
 *   - 里程碑区（`GanttMilestones`）：名称 / 截止 / 负责人 / 关联任务数；
 *   - 依赖区（`GanttDependencies`）：两态，`unavailable` 明确提示不当作「无依赖」；
 *   - 顶部：范围标签（`basis.scopeLabel`）+ 计数摘要。
 *
 * 不做：拖拽、自动调度、写操作、导出；不显示敏感标记；不引入新依赖。
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { ApiError } from '../../api'
import { getGantt } from './api'
import type { GanttView } from './types'
import GanttTimeline from './GanttTimeline'
import GanttMilestones from './GanttMilestones'
import GanttDependencies from './GanttDependencies'
import './gantt.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; statusCode?: number; denied: boolean }
  | { status: 'ready'; data: GanttView }

/** 计数摘要的一枚小标签。 */
function CountChip({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="gantt-chip">
      <span className="gantt-chip-value">{value}</span>
      <span className="gantt-chip-label">{label}</span>
    </span>
  )
}

/** 区块标题。 */
function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="gantt-section-head">
      <h3 className="gantt-section-title">{title}</h3>
      {hint ? <span className="gantt-section-hint">{hint}</span> : null}
    </div>
  )
}

export default function GanttPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!projectId) {
      setState({
        status: 'error',
        denied: false,
        message: 'URL 缺少项目编号，无法加载甘特图。',
      })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    getGantt(projectId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          // 设计 §6：非成员/项目不存在一律 404（不泄漏存在性）；403 为对象可见但操作不允许。
          setState({
            status: 'error',
            denied: true,
            statusCode: error.status,
            message:
              error.status === 404
                ? '该项目不存在，或你不是项目成员，无法查看甘特图。'
                : '你没有查看该项目甘特图的权限。',
          })
        } else if (error instanceof ApiError) {
          setState({
            status: 'error',
            denied: false,
            statusCode: error.status,
            message: error.message,
          })
        } else {
          setState({ status: 'error', denied: false, message: '加载失败，请稍后重试。' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (state.status === 'loading') {
    return (
      <div className="page gantt-page">
        <PageHeader title="项目甘特图" description="加载中…" />
        <div className="page-loading">加载中…</div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="page gantt-page">
        <PageHeader
          title="项目甘特图"
          description={state.denied ? '无法查看' : '加载失败'}
        />
        <p className="error">
          {state.message}
          {state.statusCode ? `（HTTP ${state.statusCode}）` : ''}
        </p>
      </div>
    )
  }

  const data = state.data
  const stories = data.stories ?? []
  const milestones = data.milestones ?? []
  const truncated = data.truncated ?? { tasks: false, milestones: false, dependencies: false }
  const scope = data.basis?.scopeLabel ?? '—'

  const taskCount = stories.reduce((sum, story) => sum + (story.tasks?.length ?? 0), 0)
  // 依赖不可用时**不显示 0**：0 会被误读为「确实没有依赖」。
  const dependencyCount: number | string =
    data.dependencies.state === 'ok' ? data.dependencies.items?.length ?? 0 : '—'

  // 依赖两端任务标题解析表：仅由当前可见故事/任务构建，不额外请求、不泄漏隐藏对象。
  const taskTitleById = new Map<string, string>()
  for (const story of stories) {
    for (const task of story.tasks ?? []) {
      taskTitleById.set(task.id, task.title)
    }
  }

  const truncatedLabels: string[] = []
  if (truncated.tasks) truncatedLabels.push('任务')
  if (truncated.milestones) truncatedLabels.push('里程碑')
  if (truncated.dependencies) truncatedLabels.push('依赖')

  const scopeNote =
    scope === '全项目'
      ? '范围：本项目全部故事、任务、里程碑与依赖。'
      : scope === '可见范围'
        ? '范围：仅统计你有权查看的对象，不代表项目全量基数。'
        : '范围：未标注。'

  return (
    <div className="page gantt-page">
      <PageHeader
        title="项目甘特图"
        description="按统一时间轴查看故事与任务的计划区间、里程碑与任务依赖（只读）。"
        actions={<span className="gantt-scope">{scope}</span>}
      />

      <div className="gantt-summary">
        <CountChip label="故事" value={stories.length} />
        <CountChip label="任务" value={taskCount} />
        <CountChip label="里程碑" value={milestones.length} />
        <CountChip label="依赖边" value={dependencyCount} />
      </div>
      <p className="gantt-scope-note">{scopeNote}</p>

      {truncatedLabels.length > 0 ? (
        <p className="gantt-truncated">
          数据已截断：{truncatedLabels.join(' / ')} 仅显示部分，上述计数为下界、不代表总数。
        </p>
      ) : null}

      <section className="gantt-section">
        <SectionTitle title="统一时间轴" hint="故事可展开查看其任务" />
        <GanttTimeline stories={stories} />
      </section>

      <section className="gantt-section">
        <SectionTitle title="里程碑" hint="按截止日期展示（不落在统一时间轴上）" />
        <GanttMilestones milestones={milestones} />
      </section>

      <section className="gantt-section">
        <SectionTitle title="任务依赖" hint="本期仅 FS（前驱完成后继才能开始）" />
        <GanttDependencies dependencies={data.dependencies} taskTitleById={taskTitleById} />
      </section>
    </div>
  )
}
