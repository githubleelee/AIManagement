import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import type { ProjectView } from '../../../src/shared/types'
import { ApiError, getProject } from '../api'
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
  | { status: 'error'; message: string }
  | { status: 'ready'; project: ProjectView }

export default function ProjectLayout() {
  const { projectId } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

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
      .catch((err) => {
        if (cancelled) return
        // 只有真正的 404 才当作「不存在 / 无权」；网络或 5xx 不能误报成 404。
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: 'notfound' })
        } else {
          setState({
            status: 'error',
            message: err instanceof ApiError ? err.message : '加载项目失败',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  if (state.status === 'loading') {
    return <div className="page-loading">加载中…</div>
  }

  if (state.status === 'notfound') {
    return (
      <div className="project-notfound">
        <EmptyState
          level={1}
          title="项目不存在或无权访问"
          hint="它可能已被删除，或你不在该项目中。"
        />
        <Link className="link" to="/projects">
          返回项目列表
        </Link>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="project-notfound">
        <EmptyState level={1} title="项目加载失败" hint={state.message} />
        <div className="page-header-actions">
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </button>
          <Link className="link" to="/projects">
            返回项目列表
          </Link>
        </div>
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
          <span className="sidebar-brand">爱管理</span>
          <span className="sidebar-kicker">PROJECT SPACE</span>
          <div className="sidebar-project-name" title={project.name}>{project.name}</div>
        </div>
        <nav className="project-nav" aria-label="项目导航">
          <NavLink to="overview" className={navClass}>
            <span aria-hidden="true">◫</span>概览
          </NavLink>
          <NavLink to="requirements" className={navClass}>
            <span aria-hidden="true">◇</span>需求
          </NavLink>
          <NavLink to="tasks" className={navClass}>
            <span aria-hidden="true">☑</span>任务
          </NavLink>
          {/* US-09 任务验收（工单 #29）：验收工作台入口。
              这行属冻结区（前端骨架），已按 #24 comment 6235528115 的申请口径落地；
              **尚无原 owner 的书面授权**，需单人复核合入（口径见 docs/us-09-acceptance-api.md §11）。 */}
          <NavLink to="acceptance" className={navClass}>
            <span aria-hidden="true">✓</span>验收
          </NavLink>
          <NavLink to="members" className={navClass}>
            <span aria-hidden="true">♙</span>成员
          </NavLink>
        </nav>
        <Link className="project-switcher" to="/projects">
          <span>当前项目 · {ROLE_LABELS[project.myRole]}</span>
          <strong>{project.name}</strong>
        </Link>
      </aside>
      <section className="project-content">
        <Outlet context={project} />
      </section>
    </div>
  )
}
