/**
 * 项目级任务总表（US-05 / 端点 26）。
 *
 * 只读视图：可按负责人过滤；点「需求」跳到对应故事详情（任务的新建/编辑/删除在故事详情里）。
 * 写操作不在此页（见 docs/frontend-routes.md 与 TaskSection）。
 */
import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ProjectMemberView, ProjectView, TaskStatus, TaskView } from '../../../src/shared/types'
import { ApiError, listMembers } from '../api'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { listProjectTasks } from './task/api'

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: '未开始',
  DOING: '进行中',
  DONE: '已完成',
}

export default function ProjectTasksPage() {
  const project = useOutletContext<ProjectView>()
  const [tasks, setTasks] = useState<TaskView[] | null>(null)
  const [members, setMembers] = useState<ProjectMemberView[]>([])
  const [ownerUserId, setOwnerUserId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listMembers(project.id)
      .then((res) => setMembers(res.items))
      .catch(() => setMembers([]))
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setTasks(null)
    listProjectTasks(project.id, ownerUserId || undefined)
      .then((rows) => {
        if (!cancelled) setTasks(rows)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : '加载任务失败')
          setTasks([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [project.id, ownerUserId])

  return (
    <div className="page">
      <PageHeader title="任务" description="按负责人过滤的项目任务总表" />

      <label className="form-field task-filter">
        按负责人过滤
        <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
          <option value="">全部成员</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.displayName}（{m.user.account}）
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="error">{error}</p> : null}

      {tasks === null ? (
        <p className="muted">加载中…</p>
      ) : tasks.length === 0 ? (
        <EmptyState title="没有任务" hint="在需求详情里为某条用户故事新建任务。" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>任务</th>
              <th>负责人</th>
              <th>验收人</th>
              <th className="nowrap">计划</th>
              <th>状态</th>
              <th>敏感</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>{t.owner?.account ?? t.ownerUserId}</td>
                <td>{t.acceptor?.account ?? t.acceptorUserId}</td>
                <td className="nowrap">
                  {t.planStart} → {t.planEnd}
                </td>
                <td>{TASK_STATUS_LABEL[t.status]}</td>
                <td>{t.isSensitive ? '是' : '否'}</td>
                <td>
                  <Link to={`/projects/${project.id}/requirements/${t.storyId}`}>需求</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
