import { AuthProvider } from './auth/AuthContext'
import AppRoutes from './routes'

/**
 * 应用外壳（T0-01 / US-01）。
 *
 * 职责：装配会话（AuthProvider）与路由（AppRoutes），自身不含业务逻辑。
 * 路由定义见 `web/src/routes.tsx`，前端路由约定见 `docs/frontend-routes.md`。
 */
export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
