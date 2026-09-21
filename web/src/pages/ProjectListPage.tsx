import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectView } from '../../../src/shared/types'
import { ApiError, listProjects } from '../api'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { ROLE_LABELS } from '../labels'

/** 我的项目列表（端点 4，T1.2）。 */
export default function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listProjects()
      .then((res) => {
        if (!cancelled) setProjects(res.items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : '加载项目失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page">
      <PageHeader
        title="我的项目"
        description="只显示你参与的项目"
        actions={
          <Link className="button primary" to="/projects/new">
            新建项目
          </Link>
        }
      />

      {error ? <p className="error">{error}</p> : null}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : projects.length === 0 ? (
        <EmptyState title="还没有项目" hint="点击右上角「新建项目」开始。" />
      ) : (
        <ul className="project-cards">
          {projects.map((project) => (
            <li key={project.id}>
              <Link className="project-card" to={`/projects/${project.id}/overview`}>
                <span className="project-card-title">{project.name}</span>
                <span className="badge">{ROLE_LABELS[project.myRole]}</span>
                <span className="muted project-card-desc">{project.description ?? '无描述'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

