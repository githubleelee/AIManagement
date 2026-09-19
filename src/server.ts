/**
 * 后端入口：`npm run dev` 由 tsx watch 运行本文件。
 */
import { buildApp } from './app.js'

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'

const app = buildApp()

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`[server] 爱管理后端已启动：http://localhost:${PORT}（健康检查 /health）`)
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[server] 启动失败', error)
    process.exit(1)
  })
