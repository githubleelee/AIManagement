/**
 * 后端入口：`npm run dev` 由 tsx watch 运行本文件。
 */
import { buildApp } from './app.js'

const PORT = Number(process.env.PORT ?? 3000)
// 默认只绑定回环地址，避免开发机服务暴露到局域网；需要对外暴露时显式设 HOST。
const HOST = process.env.HOST ?? '127.0.0.1'

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
