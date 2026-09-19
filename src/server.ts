import { buildApp } from './app'

const port = Number(process.env.PORT ?? 3000)
const app = buildApp()

app
  .listen({ port, host: '0.0.0.0' })
  .then((address) => {
    console.log(`[server] listening on ${address}`)
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
