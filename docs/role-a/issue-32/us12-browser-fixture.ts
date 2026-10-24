/**
 * US-12 / #32 门禁 11（G6）—— 真实浏览器走查的**服务端子进程夹具**。
 *
 * 由 `src/modules/ai-scheduling/integration.pending.test.ts` 的 G6 用例
 * `fork(..., { execArgv: ['--import', 'tsx'], stdio: [...'ipc'] })` 启动，与
 * `docs/role-c/issue-36/integration-server.ts` 同型（同一套 `createHttpTestContext` +
 * `test/factories.js` + Vite 代理聚合）。差别只有两点，都是为了本门禁的取证口径：
 *
 *   ① 夹具**自己**起一个真实回环 HTTP 模型服务（Chat Completions 协议），并在
 *      `createHttpTestContext()` **之前**显式设置 `SCHEDULING_AI_*` 环境变量 ——
 *      `createHttpTestContext()` 不接受 scheduling 注入，只有这条路径能让
 *      **生产装配**（`schedulingOptionsFromEnvironment`）拿到真实端口；没有任何
 *      内存桩、也没有隐式回退（完全未配置时端口是「显式不可用」）。
 *   ② 模型服务的调用次数与收到的出站报文（合成数据）经 IPC 回传，供门禁断言
 *      「浏览器里生成一次 → 模型被真实调用一次；确认阶段不再二次调用」。
 *
 * 数据全部为**合成演示数据**（`SCHEDULING_AI_DATA_CLASSIFICATION=SYNTHETIC_DEMO`），
 * 不读 `.env`、不使用任何真实供应商凭据、不连真实 `var/uploads/`。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { createHttpTestContext, setActiveDatabase } from '../../../test/helpers.js'
import {
  makeActivity, makeGoal, makeMember, makeProject, makeStory, makeTask, makeUser,
} from '../../../test/factories.js'
import { shanghaiToday } from '../../../src/modules/ai-scheduling/policy.js'

const MODEL = 'us12-g6-synthetic-model'
const API_KEY = 'us12-g6-synthetic-key'

if (!process.send) throw new Error('US-12 门禁 11 夹具必须由 fork(..., stdio 含 ipc) 启动')

function send(value: unknown): void {
  process.send?.(value)
}

function shiftDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// 回环模型服务（真实 HTTP，不是内存桩）
// ---------------------------------------------------------------------------
let modelCalls = 0
const outbound: string[] = []

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

/** 与门禁 1/5/12 同一条确定性规则：输入中第 i 个 TODO 任务（按 id 升序）= today+i .. today+i+2。 */
function proposalFor(userContent: string): string {
  const parsed = JSON.parse(userContent) as {
    today: string; input: { tasks: Array<{ id: string; status: string }> }
  }
  const todo = parsed.input.tasks.filter((task) => task.status === 'TODO')
    .map((task) => task.id).sort()
  return JSON.stringify({
    changes: todo.map((taskId, index) => ({
      taskId, planStart: shiftDays(parsed.today, index), planEnd: shiftDays(parsed.today, index + 2),
    })),
  })
}

async function handleModel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  modelCalls += 1
  const body = await readJson(req)
  const messages = body.messages as Array<{ role: string; content: string }>
  const userContent = messages.find((message) => message.role === 'user')?.content ?? ''
  outbound.push(userContent)
  sendJson(res, 200, {
    model: body.model,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: proposalFor(userContent) } }],
  })
}

const modelServer = createHttpServer((req, res) => { void handleModel(req, res) })
await new Promise<void>((resolve) => { modelServer.listen(0, '127.0.0.1', resolve) })
const modelEndpoint = `http://127.0.0.1:${(modelServer.address() as AddressInfo).port}/v1/chat/completions`

// ---------------------------------------------------------------------------
// 生产装配：先设环境变量，再 createHttpTestContext()
// ---------------------------------------------------------------------------
for (const key of Object.keys(process.env)) if (key.startsWith('SCHEDULING_AI_')) delete process.env[key]
Object.assign(process.env, {
  SCHEDULING_AI_MODE: 'EXTERNAL_CHAT_COMPLETIONS',
  SCHEDULING_AI_ENDPOINT: modelEndpoint,
  SCHEDULING_AI_PROVIDER_ID: 'us12-g6-loopback',
  SCHEDULING_AI_MODEL: MODEL,
  SCHEDULING_AI_API_KEY: API_KEY,
  SCHEDULING_AI_TIMEOUT_MS: '30000',
  SCHEDULING_AI_DATA_CLASSIFICATION: 'SYNTHETIC_DEMO',
})

const uploadRoot = mkdtempSync(join(tmpdir(), 'us12-g6-browser-'))
const ctx = await createHttpTestContext({ uploadRoot })
setActiveDatabase(ctx.db)

const today = shanghaiToday(new Date())
const pm = await makeUser('us12-g6-pm@example.invalid', 'G6 项目经理')
const member = await makeUser('us12-g6-member@example.invalid', 'G6 执行成员')
const { projectId } = await makeProject(pm.id, 'US-12 门禁 11 合成项目')
await makeMember(projectId, member.id, 'MEMBER')
const goal = await makeGoal(projectId, 'G6 合成目标')
const activity = await makeActivity(goal, 'G6 合成活动')
const storyId = await makeStory(activity, { title: 'G6 合成故事' })

/** 前置任务已 CLOSED：让公开 FS 约束有真实参照点，同时不把后继拖进 DOING。 */
const predecessorTaskId = await makeTask(storyId, member.id, pm.id, {
  title: 'G6 已完成前置', status: 'CLOSED',
  planStart: shiftDays(today, -10), planEnd: shiftDays(today, -5),
})
const taskAId = await makeTask(storyId, member.id, pm.id, {
  title: 'G6 待排期任务甲', planStart: shiftDays(today, 10), planEnd: shiftDays(today, 14),
})
const taskBId = await makeTask(storyId, pm.id, member.id, {
  title: 'G6 待排期任务乙', planStart: shiftDays(today, 12), planEnd: shiftDays(today, 16),
})
/** 非 TODO：既进负载基数，又证明「未列入建议的任务日期不被改动」。 */
const doingTaskId = await makeTask(storyId, member.id, pm.id, {
  title: 'G6 进行中任务', status: 'DOING',
  planStart: shiftDays(today, 20), planEnd: shiftDays(today, 25),
})
await ctx.db.taskDependency.create({
  data: { projectId, predecessorTaskId, successorTaskId: taskAId, type: 'FS' },
})
const milestone = await ctx.db.milestone.create({
  data: { projectId, name: 'G6 里程碑', dueDate: shiftDays(today, 60), ownerUserId: pm.id },
})
await ctx.db.taskMilestone.create({ data: { milestoneId: milestone.id, taskId: taskAId } })

/** 门禁 11 在页面上填的人工日期：与模型原始建议不同，且明确晚于原计划（只触发提示）。 */
const edges = [
  { taskId: taskAId, planStart: shiftDays(today, 20), planEnd: shiftDays(today, 24) },
  { taskId: taskBId, planStart: shiftDays(today, 30), planEnd: shiftDays(today, 34) },
]

const address = await ctx.app.listen({ host: '127.0.0.1', port: 0 })
const vite = await createViteServer({
  configFile: 'web/vite.config.ts',
  server: {
    host: '127.0.0.1', port: 0,
    proxy: { '/api': { target: address, changeOrigin: true, rewrite: (value: string) => value.replace(/^\/api/, '') } },
  },
})
await vite.listen()
const bound = vite.httpServer!.address()
if (!bound || typeof bound === 'string') throw new Error('浏览器端点未绑定到回环地址')

const plannedTasks = await ctx.db.task.findMany({
  where: { projectId }, orderBy: { title: 'asc' },
  select: { id: true, title: true, status: true, planStart: true, planEnd: true },
})

send({
  type: 'ready',
  url: `http://127.0.0.1:${bound.port}`,
  apiUrl: address,
  projectId,
  storyId,
  storyTitle: 'G6 合成故事',
  today,
  pmAccount: pm.account,
  pmUserId: pm.id,
  pmDisplayName: pm.displayName,
  memberUserId: member.id,
  memberDisplayName: member.displayName,
  modelId: MODEL,
  tasks: plannedTasks,
  tasksById: Object.fromEntries(plannedTasks.map((task) => [task.id, task])),
  /** 模型原始建议（门禁 11 的「查看原始建议」期望值，与回环服务同一条规则）。 */
  expectedProposal: [taskAId, taskBId].sort().map((taskId, index) => ({
    taskId, planStart: shiftDays(today, index), planEnd: shiftDays(today, index + 2),
  })),
  /** 页面上要人工编辑成的日期。 */
  edits: edges,
  predecessorTaskId,
  doingTaskId,
  milestoneId: milestone.id,
})

let closing = false
async function close(): Promise<void> {
  if (closing) return
  closing = true
  try { await vite.close() } catch { /* 夹具收尾尽力而为，不遮盖测试结论 */ }
  try { await ctx.dispose() } catch { /* 同上 */ }
  try { modelServer.closeAllConnections(); modelServer.close() } catch { /* 同上 */ }
  rmSync(uploadRoot, { recursive: true, force: true })
  process.exit(0)
}

process.on('message', (value: unknown) => {
  if (value === 'close') { void close(); return }
  if (typeof value === 'object' && value !== null && (value as { type?: string }).type === 'inspect') {
    void (async () => {
      const suggestions = await ctx.db.aiSuggestion.findMany({
        where: { projectId }, orderBy: { generatedAt: 'asc' },
        select: {
          id: true, status: true, generationStatus: true, generationRequestId: true,
          modelProvider: true, modelName: true, modelMode: true, modelExecution: true,
          inputScope: true, suggestion: true,
        },
      })
      const ids = suggestions.map((row) => row.id)
      send({
        type: 'inspection',
        modelCalls,
        outboundCount: outbound.length,
        modelInputKeys: outbound.map((raw) => {
          const parsed = JSON.parse(raw) as { today: string; input: Record<string, unknown> }
          return { today: parsed.today, inputKeys: Object.keys(parsed.input).sort() }
        }),
        tasks: await ctx.db.task.findMany({
          where: { projectId }, orderBy: { title: 'asc' },
          select: { id: true, title: true, status: true, planStart: true, planEnd: true },
        }),
        suggestions,
        dispositions: await ctx.db.aiDisposition.findMany({
          where: { suggestionId: { in: ids } },
          select: { suggestionId: true, status: true, requestId: true, reason: true, disposedByUserId: true, finalContent: true },
        }),
        applications: await ctx.db.aiApplication.findMany({
          where: { suggestionId: { in: ids } },
          select: { suggestionId: true, appliedByUserId: true, result: true, targetReferences: true },
        }),
        audits: await ctx.db.auditLog.findMany({
          where: { projectId }, orderBy: { createdAt: 'asc' },
          select: { projectId: true, actorUserId: true, action: true, objectType: true, objectId: true, before: true, after: true, createdAt: true },
        }),
        milestone: await ctx.db.milestone.findMany({
          where: { id: milestone.id }, select: { id: true, dueDate: true },
        }),
      })
    })()
  }
})
process.on('disconnect', () => void close())
process.on('SIGTERM', () => void close())
