import { useCallback, useEffect, useState } from 'react'
import type { UserBrief } from '../../src/shared/types'
import { clearToken, fetchMe, getToken } from './api'
import LoginPage from './pages/LoginPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectsPage from './pages/ProjectsPage'

/**
 * 应用外壳（T0-01 / US-01）
 *
 * 会话：启动时若有本地令牌则拉取 /auth/me，失败则清理并回到登录页（刷新保持登录）。
 * 路由：登录页 → 我的项目列表 → 项目详情（成员管理）。用状态切换，不引入路由依赖。
 */
export default function App() {
  const [user, setUser] = useState<UserBrief | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) {
      setInitializing(false)
      return
    }
    fetchMe()
      .then(setUser)
      .catch(() => {
        clearToken()
        setUser(null)
      })
      .finally(() => setInitializing(false))
  }, [])

  const handleLogout = useCallback(() => {
    clearToken()
    setUser(null)
    setSelectedProjectId(null)
  }, [])

  if (initializing) {
    return (
      <main className="shell">
        <p className="muted">加载中…</p>
      </main>
    )
  }

  if (!user) {
    return <LoginPage onSuccess={setUser} />
  }

  if (selectedProjectId) {
    return (
      <ProjectDetailPage
        projectId={selectedProjectId}
        currentUser={user}
        onBack={() => setSelectedProjectId(null)}
      />
    )
  }

  return (
    <ProjectsPage currentUser={user} onOpen={setSelectedProjectId} onLogout={handleLogout} />
  )
}
