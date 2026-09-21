import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/** 应用外壳：顶栏（品牌 / 当前用户 / 退出）+ 内容区。 */
export default function AppLayout() {
  const { user, signOut } = useAuth()

  return (
    <div className="app">
      <header className="app-topbar">
        <Link to="/projects" className="brand">
          爱管理
        </Link>
        <div className="app-topbar-right">
          {user ? (
            <span className="muted">
              {user.displayName}（{user.account}）
            </span>
          ) : null}
          <button className="ghost" onClick={signOut}>
            退出登录
          </button>
        </div>
      </header>
      <div className="app-body">
        <Outlet />
      </div>
    </div>
  )
}

