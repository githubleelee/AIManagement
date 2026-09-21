import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import type { ProjectView } from '../../../src/shared/types'
import { getProject } from '../api'
import { ROLE_LABELS } from '../labels'
import EmptyState from '../components/EmptyState'

/**
 * 项目工作台骨架：按 :projectId 拉项目（端点 5），左侧导航 + 子路由内容。
 * 非成员 / 不存在 → 404 页（与后端一致，不泄漏对象）。
 * 子页面用 useOutletContext<ProjectView>() 取项目与 myRole。
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'ready'; project: ProjectView }

export default function ProjectLayout() {
  const { projectId } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!projectId) {
      setState({ status: 'notfound' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    getProject(projectId)
      .then((project) => {
        if (!cancelled) setState({ status: 'ready', project })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'notfound' })
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (state.status === 'loading') {
    return <div className="page-loading">加载中…</div>
  }

  if (state.status === 'notfound') {
    return (
      <div className="project-notfound">
        <EmptyState title="项目不存在或无权访问" hint="它可能已被删除，或你不在该项目中。" />
        <Link className="link" to="/projects">
          返回项目列表
        </Link>
      </div>
    )
  }

  const { project } = state
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-item active' : 'nav-item'

  return (
    <div className="project-layout">
      <aside className="project-sidebar">
        <div className="project-sidebar-head">
          <h1>{project.name}</h1>
          <p className="muted">我的角色：{ROLE_LABELS[project.myRole]}</p>
        </div>
        <nav className="project-nav">
          <NavLink to="overview" className={navClass}>
            概览
          </NavLink>
          <NavLink to="requirements" className={navClass}>
            需求
          </NavLink>
          <NavLink to="tasks" className={navClass}>
            任务
          </NavLink>
          <NavLink to="members" className={navClass}>
            成员
          </NavLink>
        </nav>
      </aside>
      <section className="project-content">
        <Outlet context={project} />
      </section>
    </div>
  )
}

