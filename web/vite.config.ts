import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * 前端（React + Vite）配置。root 固定为 web/。
 *
 * 关键：SPA 使用 History 路由，其路径（/projects/:id/overview 等）与后端契约路径
 * （/projects 等）**同名**。若像早期那样逐个代理 /projects、/auth，会把前端深链
 * 也转发到后端，导致刷新/直达 404。因此前端 API 统一走 `/api` 前缀，这里只代理
 * `/api` 并 rewrite 去掉前缀，后端契约路径保持不变（见 docs/frontend-routes.md）。
 */
const webRoot = fileURLToPath(new URL('.', import.meta.url))
const backendTarget = `http://localhost:${process.env.PORT ?? 3000}`

const apiProxy = {
  '/api': {
    target: backendTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
}

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
})
