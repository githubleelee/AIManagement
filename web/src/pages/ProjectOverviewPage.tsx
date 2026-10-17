import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ProjectView, TaskView } from '../../../src/shared/types'
import { listMembers } from '../api'
import PageHeader from '../components/PageHeader'
import { ROLE_LABELS } from '../labels'
import { collectStoryRows, getGoalTree } from './requirement/api'
import { listProjectTasks } from './task/api'

type Stat = { value: number | null; error: boolean }
const initialStat: Stat = { value: null, error: false }
const taskStatusLabel = { TODO: '未开始', DOING: '进行中', DONE: '已完成' }

/** 项目概览只汇总现有接口数据，任务焦点来自实际未完成任务。 */
export default function ProjectOverviewPage() {
  const project = useOutletContext<ProjectView>()
  const [members, setMembers] = useState<Stat>(initialStat)
  const [stories, setStories] = useState<Stat>(initialStat)
  const [tasks, setTasks] = useState<TaskView[] | null>(null)
  const [taskError, setTaskError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMembers(initialStat)
    setStories(initialStat)
    setTasks(null)
    setTaskError(false)
    listMembers(project.id)
      .then((res) => { if (!cancelled) setMembers({ value: res.items.length, error: false }) })
      .catch(() => { if (!cancelled) setMembers({ value: null, error: true }) })
    getGoalTree(project.id)
      .then((goals) => { if (!cancelled) setStories({ value: collectStoryRows(goals).length, error: false }) })
      .catch(() => { if (!cancelled) setStories({ value: null, error: true }) })
    listProjectTasks(project.id)
      .then((items) => { if (!cancelled) setTasks(items) })
      .catch(() => { if (!cancelled) setTaskError(true) })
    return () => { cancelled = true }
  }, [project.id])

  const openTasks = tasks?.filter((task) => task.status !== 'DONE') ?? []
  const doingCount = tasks?.filter((task) => task.status === 'DOING').length ?? 0
  const focusTasks = [...openTasks].sort((a, b) => a.planEnd.localeCompare(b.planEnd)).slice(0, 3)
  const base = `/projects/${project.id}`

  return (
    <div className="page overview-page">
      <PageHeader title="项目概览" description="把项目进度、需求与任务放在同一个视野里。" />

      <div className="overview-stats" aria-label="项目统计">
        <Link className="overview-stat" to={`${base}/members`}>
          <span>成员</span><strong className={members.error ? 'stat-unavailable' : undefined}>{members.error ? '不可用' : members.value ?? '…'}</strong><small>跨角色协作</small>
        </Link>
        <Link className="overview-stat" to={`${base}/requirements`}>
          <span>用户故事</span><strong className={stories.error ? 'stat-unavailable' : undefined}>{stories.error ? '不可用' : stories.value ?? '…'}</strong><small>项目需求</small>
        </Link>
        <Link className="overview-stat" to={`${base}/tasks`}>
          <span>进行中任务</span><strong className={taskError ? 'stat-unavailable' : undefined}>{taskError ? '不可用' : tasks === null ? '…' : doingCount}</strong><small>尚未完成 {openTasks.length} 项</small>
        </Link>
      </div>

      <div className="overview-main-grid">
        <section className="surface-card overview-focus" aria-labelledby="focus-title">
          <h3 id="focus-title">近期任务</h3>
          <p className="muted">按计划结束日期查看尚未完成的任务。</p>
          {taskError ? <p className="state-message error">任务暂时无法加载，请前往任务列表重试。</p> :
            tasks === null ? <p className="state-message muted">正在加载任务…</p> :
              focusTasks.length === 0 ? <p className="state-message muted">暂无待处理任务。</p> : (
                <ol className="focus-list">
                  {focusTasks.map((task, index) => (
                    <li key={task.id}>
                      <span className="focus-index">{String(index + 1).padStart(2, '0')}</span>
                      <div className="focus-details"><strong>{task.title}</strong><small>任务 · {taskStatusLabel[task.status]} · 截止 {task.planEnd}</small></div>
                      <span className="focus-status">{taskStatusLabel[task.status]}</span>
                    </li>
                  ))}
                </ol>
              )}
        </section>
        <section className="surface-card overview-shortcuts" aria-labelledby="shortcuts-title">
          <h3 id="shortcuts-title">快捷入口</h3>
          <p className="muted">继续推进项目</p>
          <Link to={`${base}/requirements`}>查看需求层级 <span aria-hidden="true">→</span></Link>
          <Link to={`${base}/tasks`}>打开任务列表 <span aria-hidden="true">→</span></Link>
          <Link to={`${base}/members`}>查看项目成员 <span aria-hidden="true">→</span></Link>
        </section>
      </div>

      <section className="surface-card overview-project-info" aria-labelledby="project-info-title">
        <h3 id="project-info-title">项目资料</h3>
        <dl>
          <div><dt>项目名称</dt><dd>{project.name}</dd></div>
          <div><dt>创建时间</dt><dd>{new Date(project.createdAt).toLocaleDateString()}</dd></div>
          <div><dt>我的角色</dt><dd>{ROLE_LABELS[project.myRole]}</dd></div>
        </dl>
        {project.description ? <p className="muted">{project.description}</p> : null}
      </section>
    </div>
  )
}
