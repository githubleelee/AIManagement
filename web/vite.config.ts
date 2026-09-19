import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * 前端（React + Vite）配置。
 * root 固定为 web/，因此 `vite` 从仓库根启动也能找到 web/index.html。
 * dev 时把 /health 与 /api 代理到后端，避免本地跨域配置。
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
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
})
