import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * 前端（React + Vite）配置。
 * root 固定为 web/，因此 `vite` 从仓库根启动也能找到 web/index.html。
 * dev 时把后端路径代理到后端，避免本地跨域配置。
 *
 * 注意：契约（决策 I-8）的 30 个业务端点都在**根路径**（/auth、/projects、
 * /goals、/activities、/stories、/tasks），只代理 /health 与 /api 会让
 * `fetch('/projects')` 打到 Vite 而非后端。这里逐个列出契约路径前缀，
 * **不使用 `/` 全量代理**，以免吞掉静态资源与 HMR。
 */
const webRoot = fileURLToPath(new URL('.', import.meta.url))
const backendTarget = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/health': backendTarget,
      '/api': backendTarget,
      // 契约 I-8 的根路径端点前缀
      '/auth': backendTarget,
      '/projects': backendTarget,
      '/goals': backendTarget,
      '/activities': backendTarget,
      '/stories': backendTarget,
      '/tasks': backendTarget,
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
})
