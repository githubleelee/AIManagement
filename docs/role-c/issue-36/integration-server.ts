import { createServer } from 'vite'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpTestContext, setActiveDatabase } from '../../../test/helpers.js'
import { makeUser, makeProject, makeMember, makeGoal, makeActivity, makeStory, makeTask } from '../../../test/factories.js'
if (!process.send) throw new Error('IPC test fixture required')
const root = await mkdtemp(join(tmpdir(), 'c-attachment-browser-'))
const ctx = await createHttpTestContext({ uploadRoot: root }); setActiveDatabase(ctx.db)
const users = {
  pm: await makeUser('browser-attach-pm@example.invalid'), owner: await makeUser('browser-attach-owner@example.invalid'),
  viewer: await makeUser('browser-attach-viewer@example.invalid'), other: await makeUser('browser-attach-other@example.invalid'),
  outsider: await makeUser('browser-attach-outsider@example.invalid'),
}
const { projectId } = await makeProject(users.pm.id, 'C附件合成验收项目')
await makeMember(projectId, users.owner.id, 'MEMBER'); await makeMember(projectId, users.viewer.id, 'VIEWER'); await makeMember(projectId, users.other.id, 'MEMBER')
const storyId = await makeStory(await makeActivity(await makeGoal(projectId)), { title: 'C附件合成故事' })
const taskId = await makeTask(storyId, users.owner.id, users.pm.id, { title: '合成附件任务' })
const secondTaskId = await makeTask(storyId, users.owner.id, users.pm.id, { title: '第二附件任务' })
const viewerTaskId = await makeTask(storyId, users.viewer.id, users.pm.id, { title: 'VIEWER负责人任务' })
// loginAs synchronously writes SQLite: mint sessions before onReady starts real worker writers.
const tokens = Object.fromEntries(Object.entries(users).map(([key, user]) => [key, ctx.loginAs(user.id)]))
const address = await ctx.app.listen({ host: '127.0.0.1', port: 0 })
const vite = await createServer({ configFile: 'web/vite.config.ts', server: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: address, changeOrigin: true, rewrite: value => value.replace(/^\/api/, '') } },
} })
await vite.listen()
const bound = vite.httpServer!.address()
if (!bound || typeof bound === 'string') throw new Error('No loopback browser endpoint')
process.send({ type: 'ready', url: `http://127.0.0.1:${bound.port}`, projectId, storyId, taskId, secondTaskId, viewerTaskId,
  tokens })
let closing = false
async function close() {
  if (closing) return
  closing = true
  await vite.close(); await ctx.dispose(); await rm(root, { recursive: true, force: true }); process.exit(0)
}
process.on('message', async value => {
  if (value === 'close') { await close(); return }
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'inspect') {
    process.send?.({ type: 'inspection', taskExists: !!await ctx.db.task.findUnique({ where: { id: taskId } }),
      attachments: await ctx.db.attachment.findMany({ select: { id: true, state: true, taskId: true } }), files: (await readdir(root)).length })
  }
})
process.on('disconnect', () => void close()); process.on('SIGTERM', () => void close())
