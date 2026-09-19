import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

/**
 * 前端入口（T0-01 / US-01）。
 *
 * 挂载 React 根节点，并以 BrowserRouter 提供 History 路由（支持刷新与直达）。
 * 深链（如 /projects/:id/overview）由 Vite 的 SPA fallback 回退到 index.html。
 */
const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到根节点 #root')
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
