import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { NotificationBell } from '../pages/notification'

/** 应用外壳：顶栏（品牌 / 当前用户 / 退出）+ 内容区。 */
export default function AppLayout() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const inProject = /^\/projects\/[^/]+\//.test(location.pathname)

  return (
    <div className="app">
      <header className="app-topbar">
        <Link to="/projects" className="brand" aria-label="爱管理，返回工作台">
          爱管理
        </Link>
        <span className="topbar-breadcrumb">工作台{inProject ? ' / 项目空间' : ''}</span>
        {/* US-08 个人工作台（工单 #28）的入口。骨架文件，按流程需 M2 授权后合入。 */}
        <Link to="/workbench" className="link">
          我的工作台
        </Link>
        <div className="app-topbar-right">
          {/* US-14 站内通知（工单 #34）入口。组件本体归 D（`web/src/pages/notification`），
              公共骨架挂载归 B；只嵌入组件，不新增 URL、不接管通知业务。 */}
          <NotificationBell />
          {user ? (
            <span className="user-avatar" title={`${user.displayName}（${user.account}）`} aria-label={`当前用户：${user.displayName}`}>
              {user.displayName.slice(0, 1)}
            </span>
          ) : null}
          <button className="ghost signout-button" onClick={() => { signOut(); navigate('/login', { replace: true }) }}>
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
