import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ProjectMemberView, ProjectView, TaskStatus, TaskView } from '../../../src/shared/types'
import { ApiError, listMembers } from '../api'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { listProjectTasks } from './task/api'
import { TASK_STATUS_LABEL, TaskStatusBadge } from './task/TaskStatusBadge'
import './task/task.css'

const STATUS_OPTIONS: TaskStatus[] = ['TODO', 'DOING', 'DONE']

export default function ProjectTasksPage() {
  const project = useOutletContext<ProjectView>()
  const [tasks, setTasks] = useState<TaskView[] | null>(null)
  const [members, setMembers] = useState<ProjectMemberView[]>([])
  const [ownerUserId, setOwnerUserId] = useState('')
  const [status, setStatus] = useState<TaskStatus | ''>('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    listMembers(project.id)
      .then((res) => { if (!cancelled) setMembers(res.items) })
      .catch(() => { if (!cancelled) setMembers([]) })
    return () => { cancelled = true }
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setTasks(null)
    listProjectTasks(project.id, ownerUserId || undefined)
      .then((rows) => { if (!cancelled) setTasks(rows) })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : '加载任务失败') })
    return () => { cancelled = true }
  }, [project.id, ownerUserId, reloadKey])

  const visibleTasks = tasks?.filter((task) =>
    (!status || task.status === status) && task.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ) ?? []
  const doingCount = tasks?.filter((task) => task.status === 'DOING').length ?? 0
  const doneCount = tasks?.filter((task) => task.status === 'DONE').length ?? 0

  return (
    <div className="page task-page">
      <PageHeader title="任务" description="查看执行状态，按负责人和状态聚焦待办。" />
      <div className="task-toolbar" role="search" aria-label="筛选任务">
        <label className="task-control task-search">
          <span className="task-sr-only">搜索任务标题</span>
          <input type="search" placeholder="搜索任务标题" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label className="task-control task-select">
          <span className="task-sr-only">按状态筛选</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | '')}>
            <option value="">全部状态</option>
            {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{TASK_STATUS_LABEL[value]}</option>)}
          </select>
        </label>
        <label className="task-control task-select">
          <span className="task-sr-only">按负责人筛选</span>
          <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
            <option value="">全部负责人</option>
            {members.map((member) => <option key={member.userId} value={member.userId}>{member.user.displayName}（{member.user.account}）</option>)}
          </select>
        </label>
        {project.myRole === 'PM' ? (
          <Link className="task-new-button" to={`/projects/${project.id}/requirements`}>＋ 在需求中新建任务</Link>
        ) : null}
      </div>
      <section className="task-list-panel" aria-labelledby="task-list-heading">
        <div className="task-list-heading">
          <h3 id="task-list-heading">任务列表</h3>
          {!error && tasks !== null ? <p>{doingCount} 个进行中 · {doneCount} 个已完成 · 共 {visibleTasks.length} 条匹配</p> : null}
        </div>
        {error ? (
          <div className="load-error" role="alert"><p className="error">{error}</p><button type="button" onClick={() => setReloadKey((key) => key + 1)}>重试</button></div>
        ) : tasks === null ? (
          <p className="muted" role="status">加载中…</p>
        ) : tasks.length === 0 ? (
          <EmptyState level={2} title="没有任务" hint="在需求详情里为某条用户故事新建任务。" />
        ) : visibleTasks.length === 0 ? (
          <EmptyState level={2} title="没有匹配的任务" hint="试着调整搜索词或筛选条件。" />
        ) : (
          <div className="task-table-scroll"><table className="task-table">
            <thead><tr><th scope="col">任务</th><th scope="col">负责人</th><th scope="col">状态</th><th scope="col">截止日期</th><th scope="col">操作</th></tr></thead>
            <tbody>{visibleTasks.map((task) => <tr key={task.id}>
              <td><span className="task-row-title">{task.title}</span><span className="task-row-meta">关联用户故事 · 验收人：{task.acceptor?.displayName ?? task.acceptorUserId}{task.isSensitive ? ' · 敏感' : ''}</span></td>
              <td>{task.owner?.displayName ?? task.ownerUserId}</td>
              <td><TaskStatusBadge status={task.status} /></td>
              <td className="task-nowrap">{task.planEnd}</td>
              <td><Link aria-label={`查看任务「${task.title}」关联的需求`} to={`/projects/${project.id}/requirements/${task.storyId}`}>查看需求</Link></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  )
}
