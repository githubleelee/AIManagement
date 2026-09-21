import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/**
 * 登录守卫：未登录重定向 /login 并记住原目标（?redirect=），登录后回跳。
 * 初始化期间显示加载，避免刷新时误判为未登录。
 */
export default function ProtectedRoute() {
  const { user, initializing } = useAuth()
  const location = useLocation()

  if (initializing) {
    return <div className="page-loading">加载中…</div>
  }

  if (!user) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  return <Outlet />
}

