import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { POST_SIGN_OUT_KEY, useAuth } from '../auth/AuthContext'

/** 明确退出后丢弃旧页面回跳；首次访问深链时保留原目标。 */
export default function ProtectedRoute() {
  const { user, initializing } = useAuth()
  const location = useLocation()

  if (initializing) {
    return <div className="page-loading">加载中…</div>
  }

  if (!user) {
    if (sessionStorage.getItem(POST_SIGN_OUT_KEY) === '1') {
      return <Navigate to="/login" replace />
    }
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  return <Outlet />
}
