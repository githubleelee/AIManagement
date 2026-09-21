import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState'

/** 全局 404（未匹配路由，含非成员直达项目页时的兜底）。 */
export default function NotFoundPage() {
  return (
    <main className="login-page">
      <div className="card">
        <EmptyState title="页面不存在" hint="请检查地址，或返回项目列表。" />
        <Link className="link" to="/projects">
          返回项目列表
        </Link>
      </div>
    </main>
  )
}

