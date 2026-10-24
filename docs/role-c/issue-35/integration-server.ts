/** Disposable, migrated synthetic DB + actual app/plugin + actual Vite API proxy.
 * Launched only by verify-integration.mjs with IPC; no dev.db, secrets or public data.
 * Temporary test credentials are sent through IPC only, never printed or archived.
 */
import { createServer } from 'vite'
import { createHttpTestContext, setActiveDatabase } from '../../../test/helpers.js'
import { makeActivity, makeGoal, makeMember, makeProject, makeStory, makeTask, makeUser } from '../../../test/factories.js'
import { registerUmlRoutes } from '../../../src/modules/uml/plugin.js'

if (!process.send) throw new Error('This test server requires the verifier IPC channel')
const ctx = await createHttpTestContext()
setActiveDatabase(ctx.db)
const pm = await makeUser('uml-browser-pm@example.invalid')
const viewer = await makeUser('uml-browser-viewer@example.invalid')
const { projectId } = await makeProject(pm.id, 'UML 合成验收项目')
await makeMember(projectId, viewer.id, 'VIEWER')
const goalId = await makeGoal(projectId, '合成目标')
const activityId = await makeActivity(goalId, '合成活动')
const storyId = await makeStory(activityId, { title: '合成故事' })
const taskId = await makeTask(storyId, viewer.id, pm.id, { title: '合成任务' })
const restrictedTaskId = await makeTask(storyId, pm.id, viewer.id, { title: '合成敏感任务', isSensitive: true })
const extraGoalIds: string[] = []
for (let i = 1; i <= 51; i++) extraGoalIds.push(await makeGoal(projectId, `上限测试目标${i}`))
const emptyProjectId = (await makeProject(pm.id, '空候选合成项目')).projectId
const otherProjectId = (await makeProject(pm.id, '跨项目候选合成项目')).projectId
const foreignGoalId = await makeGoal(otherProjectId, '跨项目候选不应出现')
if (!ctx.app.hasRoute({ method: 'POST', url: '/projects/:projectId/uml-diagrams' })) registerUmlRoutes(ctx.app, { prisma: ctx.db })
const address = await ctx.app.listen({ host: '127.0.0.1', port: 0 })
const vite = await createServer({ configFile: 'web/vite.config.ts', server: {
  host: '127.0.0.1', port: 0, strictPort: false,
  proxy: { '/api': { target: address, changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') } },
} })
await vite.listen()
const webAddress = vite.httpServer!.address()
if (!webAddress || typeof webAddress === 'string') throw new Error('No test web address')
process.send({ type: 'ready', url: `http://127.0.0.1:${webAddress.port}`, projectId, goalId, activityId, storyId, taskId, restrictedTaskId, extraGoalIds, emptyProjectId, foreignGoalId,
  pmToken: ctx.loginAs(pm.id), viewerToken: ctx.loginAs(viewer.id) })
let closing = false
async function close() {
  if (closing) return
  closing = true
  await vite.close()
  await ctx.dispose()
  process.exit(0)
}
process.on('message', value => { if (value === 'close') void close() })
process.on('disconnect', () => void close())
process.on('SIGTERM', () => void close())
