import { useEffect, useState, type FormEvent } from 'react'
import type { ProjectView, UserBrief } from '../../../src/shared/types'
import { ApiError, createProject, listProjects } from '../api'
import { ROLE_LABELS } from '../labels'

/** 我的项目列表（端点 4）+ 新建项目（端点 3）。 */
export default function ProjectsPage({
  currentUser,
  onOpen,
  onLogout,
}: {
  currentUser: UserBrief
  onOpen: (projectId: string) => void
  onLogout: () => void
}) {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  async function refresh() {
    setLoading(true)
    try {
      const res = await listProjects()
      setProjects(res.items)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载项目失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await createProject(name, description)
      setName('')
      setDescription('')
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建项目失败')
    }
  }

  return (
    <main className="shell wide">
      <header className="topbar">
        <div>
          <h1>我的项目</h1>
          <p className="tagline">
            {currentUser.displayName}（{currentUser.account}）
          </p>
        </div>
        <button className="ghost" onClick={onLogout}>
          退出登录
        </button>
      </header>

      <form className="form inline" onSubmit={handleCreate}>
        <input
          placeholder="项目名称（必填，≤50 字）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="描述（选填）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button type="submit">新建项目</button>
      </form>

      {error ? <p className="error">{error}</p> : null}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : projects.length === 0 ? (
        <p className="muted">还没有项目，先创建一个。</p>
      ) : (
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id}>
              <button className="row" onClick={() => onOpen(project.id)}>
                <span className="row-title">{project.name}</span>
                <span className="badge">{ROLE_LABELS[project.myRole]}</span>
                <span className="muted row-desc">{project.description ?? '无描述'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
