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
 * 写侧（本地 #12 / 后端已合入 main）：里程碑与 FS 依赖的增删改**仅 PM**。
 *   - 角色门禁是**体验层**：非 PM 不渲染写控件，但服务端 `gantt.write` 才是权威，
 *     非 PM 直连接口仍会被 403 / 404 拒绝（见 `src/modules/gantt/write.ts`）；
 *   - 任何写成功后**重新拉取 `GET /projects/:projectId/gantt` 作为唯一真相**，
 *     不做乐观本地改写；写失败不改本地状态，只在对应表单 / 行旁展示错误。
 *
 * 不做：拖拽、自动调度、导出；不显示敏感标记；不引入新依赖；选择器只含视图内可见任务。
 */
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import type { ProjectMemberView, ProjectView } from '../../../../src/shared/types'
import PageHeader from '../../components/PageHeader'
import { ApiError, listMembers } from '../../api'
import { getGantt } from './api'
import type { GanttTaskOption, GanttView } from './types'
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
  const project = useOutletContext<ProjectView>()
  // 角色门禁（体验层）：只有 PM 渲染写控件。服务端 `gantt.write` 才是权威。
  const isPM = project.myRole === 'PM'

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [members, setMembers] = useState<ProjectMemberView[]>([])
  const [notice, setNotice] = useState<string | null>(null)

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
    // 首次 / 出错后重试显示加载态；写成功后刷新时保留旧数据到新响应到达 ——
    // 唯一真相仍是新响应的聚合视图，不用旧数据做乐观改写。
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
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
  }, [projectId, reloadKey])

  // 负责人下拉候选：只有 PM 需要；非 PM 不请求（其一也用不到，其二少一次请求）。
  useEffect(() => {
    if (!isPM || !projectId) return
    let cancelled = false
    listMembers(projectId)
      .then((res) => {
        if (!cancelled) setMembers(res.items)
      })
      .catch(() => {
        // 成员列表取不到不阻塞写主流程：仍可「不指定」负责人。
        if (!cancelled) setMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [isPM, projectId])

  // 写侧选择器只允许视图内**可见任务**；绝不另拉全量任务接口。
  const taskOptions = useMemo<GanttTaskOption[]>(() => {
    if (state.status !== 'ready') return []
    const rows: GanttTaskOption[] = []
    for (const story of state.data.stories ?? []) {
      for (const task of story.tasks ?? []) {
        rows.push({
          id: task.id,
          title: task.title,
          storyId: story.id,
          storyTitle: story.title,
          ownerDisplayName: task.ownerDisplayName,
        })
      }
    }
    return rows
  }, [state])

  // 写成功：展示提示 + 重新拉取甘特视图（唯一真相）。
  const handleChanged = (message: string) => {
    setNotice(message)
    setReloadKey((key) => key + 1)
  }

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
        description="按统一时间轴查看故事与任务的计划区间、里程碑与任务依赖。"
        actions={<span className="gantt-scope">{scope}</span>}
      />

      {!isPM ? (
        <p className="gantt-readonly-note" role="status">
          只有项目经理可以维护里程碑与依赖；你当前是只读访问。
        </p>
      ) : null}

      {notice ? (
        <p className="gantt-notice" role="status">
          {notice}
        </p>
      ) : null}

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
        <GanttTimeline stories={stories} scopeLabel={scope} />
      </section>

      <section className="gantt-section">
        <SectionTitle title="里程碑" hint="按截止日期展示（不落在统一时间轴上）" />
        <GanttMilestones
          milestones={milestones}
          canWrite={isPM}
          projectId={data.projectId}
          members={members}
          taskOptions={taskOptions}
          tasksTruncated={truncated.tasks}
          onChanged={handleChanged}
        />
      </section>

      <section className="gantt-section">
        <SectionTitle title="任务依赖" hint="本期仅 FS（前驱完成后继才能开始）" />
        <GanttDependencies
          dependencies={data.dependencies}
          taskTitleById={taskTitleById}
          canWrite={isPM}
          projectId={data.projectId}
          taskOptions={taskOptions}
          tasksTruncated={truncated.tasks}
          onChanged={handleChanged}
        />
      </section>
    </div>
  )
}
