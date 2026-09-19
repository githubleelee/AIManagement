import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端开发服务器地址（见 docs/sprint1-baseline.md 决策 0）
const backendTarget = 'http://localhost:3000'

// 接口契约的端点均挂在根路径，因此逐个代理，保持与契约完全一致的 URL
const proxiedPrefixes = [
  '/auth',
  '/projects',
  '/goals',
  '/activities',
  '/stories',
  '/tasks',
  '/health',
]

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      proxiedPrefixes.map((prefix) => [
        prefix,
        { target: backendTarget, changeOrigin: true },
      ]),
    ),
  },
})
