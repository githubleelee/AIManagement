/**
 * US12 / #32 最终 12 门禁 —— 真实 HTTP + 真实临时 SQLite + 真实回环模型服务。
 *
 * 本文件原名 `integration.pending.test.ts`，此前 12 条只是 `it.todo`
 * （文件头自述 `blocked, not passed`）。经负责人 2026-10-24 裁定由 A 直接接手后，
 * 12 条逐项落成可执行用例；**文件名沿用**以保留与 C 门禁清单的对应关系，
 * 但内容不再有 pending。
 *
 * 证据边界（如实声明，不用桩冒充实机）：
 *   - 模型出口是**真实回环 HTTP**（Chat Completions 协议，`node:http` 起在本机
 *     127.0.0.1 的随机端口），经 `SCHEDULING_AI_*` 环境变量显式开启 EXTERNAL 模式，
 *     因此外发报文可计数、可取证；不是内存桩，也不是隐式回退。
 *   - **未使用任何真实厂商凭据**，也未做「真实供应商模型」终验：外发内容按
 *     `DECISIONS.md` `role-d.ai.demo-external-api-scope` 只限合成演示数据
 *     （`SCHEDULING_AI_DATA_CLASSIFICATION=SYNTHETIC_DEMO`）。
 *   - 生产默认仍是 `PROJECT_DATA`（默认**拒绝**外发），本文件对此有反例断言。
 *   - 门禁 12 的「真实供应商实调」仍需部署负责人配置供应商/模型/密钥，未在本文件声称通过。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { hashToken } from '../../auth/token.js'
import { createTempDatabase, resetDatabase, type TestDatabase } from '../../db/test-support.js'
import { makeMember, makeProject, makeUser } from '../../../test/http-support.js'
import { shanghaiToday } from './policy.js'

/** Portable browser-gate prerequisites. No other machine's absolute path may be hardcoded:
 * a fresh clone must either find a real browser+driver or SKIP the gate loudly (never fake it).
 * Set US12_REQUIRE_BROWSER=1 in CI to turn a missing prerequisite into a hard failure. */
function firstExisting(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate) => candidate !== undefined && existsSync(candidate))
}
function browserPrerequisites(fixtureEntry: string): { ok: true; fixture: string; playwright: string; chrome: string }
  | { ok: false; reason: string } {
  if (!existsSync(fixtureEntry)) return { ok: false, reason: `门禁夹具缺失：${fixtureEntry}` }
  const home = homedir()
  const playwright = firstExisting([
    process.env.US12_PLAYWRIGHT_CORE,
    join(process.cwd(), 'node_modules/playwright-core/index.js'),
    ...[safeReadDir(join(home, '.cache/codex-runtimes'))].flatMap((runs) => runs.map((run) =>
      join(home, '.cache/codex-runtimes', run, 'dependencies/node/node_modules/playwright-core/index.js'))),
  ])
  if (!playwright) return { ok: false, reason: '未找到 playwright-core（可用 US12_PLAYWRIGHT_CORE 指定）' }
  const chrome = firstExisting([
    process.env.US12_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    ...[safeReadDir(join(home, 'AppData/Local/ms-playwright'))].flatMap((dirs) => dirs
      .filter((dir) => dir.startsWith('chromium-'))
      .map((dir) => join(home, 'AppData/Local/ms-playwright', dir, 'chrome-win64/chrome.exe'))),
  ])
  if (!chrome) return { ok: false, reason: '未找到 Chrome/Chromium 可执行文件（可用 US12_CHROME_PATH 指定）' }
  return { ok: true, fixture: fixtureEntry, playwright, chrome }
}
function safeReadDir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

const MODEL = 'synthetic-scheduling-model'
const API_KEY = 'synthetic-key'
/** 模型/服务端超时（毫秒）：够小以便「超时」门禁在测试里可等待。 */
const TIMEOUT_MS = 700

type Behaviour = 'proposal' | 'malformed' | 'http-500' | 'hang'
/** Recorded when G6 could not run here (no browser/driver); surfaced in the JSON evidence. */
let skippedBrowserGate: string | undefined
let behaviour: Behaviour = 'proposal'
/** 回环模型服务被调用的次数（门禁 5「确认不二次调用模型」靠它取证）。 */
let calls = 0
/** 服务端真实收到的出站报文（门禁 12「出流证据」）。 */
const outbound: Array<{ authorization: string | undefined; model: unknown; data: string }> = []

let server: Server
let endpoint = ''
let db: TestDatabase
let uploadRoot: string
/** EXTERNAL + SYNTHETIC_DEMO：允许合成演示数据外发到回环模型。 */
let app: FastifyInstance
/** EXTERNAL + 默认 PROJECT_DATA：**必须拒绝**外发。 */
let projectDataApp: FastifyInstance
/** 完全没有 SCHEDULING_AI_* 配置：显式不可用，绝不静默回桩。 */
let unconfiguredApp: FastifyInstance

function shiftDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

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

/** 只对输入中的 TODO 任务给建议：第 i 个 TODO 任务 = today+i .. today+i+2。 */
function proposalFor(userContent: string): string {
  const parsed = JSON.parse(userContent) as {
    today: string; input: { tasks: Array<{ id: string; status: string }> }
  }
  const todo = parsed.input.tasks.filter((task) => task.status === 'TODO')
    .map((task) => task.id).sort()
  return JSON.stringify({ changes: todo.map((taskId, index) => ({
    taskId, planStart: shiftDays(parsed.today, index), planEnd: shiftDays(parsed.today, index + 2),
  })) })
}

async function handleModel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  calls += 1
  const body = await readJson(req)
  if (behaviour === 'http-500') {
    // 供应商错误正文绝不回传：服务端只需一个失败响应。
    sendJson(res, 500, { error: 'synthetic upstream failure' })
    return
  }
  const messages = body.messages as Array<{ role: string; content: string }>
  const userContent = messages.find((message) => message.role === 'user')?.content ?? ''
  outbound.push({ authorization: req.headers.authorization, model: body.model, data: userContent })
  if (behaviour === 'hang') return // 永不响应 → 客户端超时
  const content = behaviour === 'malformed' ? 'not-json-at-all' : proposalFor(userContent)
  sendJson(res, 200, {
    model: body.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
  })
}

type Seed = {
  pm: string; otherPm: string; member: string; viewer: string; outsider: string
  projectId: string; outsiderProjectId: string
  storyId: string; today: string
  preTaskId: string; aTaskId: string; bTaskId: string; doingTaskId: string
  milestoneId: string; unlinkedMilestoneId: string
  pmToken: string; otherPmToken: string; memberToken: string; viewerToken: string; outsiderToken: string
}
let s: Seed

async function tokenFor(userId: string): Promise<string> {
  const token = `gate-token-${userId}`
  await db.prisma.user.update({ where: { id: userId }, data: {
    sessionTokenHash: hashToken(token),
    sessionTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  } })
  return token
}

/**
 * 夹具刻意同时提供 #26（FS 依赖、里程碑）与 #27（负载）的真实数据：
 * 门禁 1 要证明这些数据确实进了模型输入，门禁 9 要证明它们的任一变化都会让整份建议过期。
 * 日期取「今天 + n」而非远古日期，以便同时受「新开始不得早于上海今天」约束。
 */
async function seed(): Promise<Seed> {
  await resetDatabase(db.prisma)
  calls = 0
  behaviour = 'proposal'
  outbound.length = 0
  const today = shanghaiToday(new Date())
  const pm = await makeUser(db.prisma, 'gate-pm', 'Gate PM')
  const otherPm = await makeUser(db.prisma, 'gate-pm2', 'Gate PM 2')
  const member = await makeUser(db.prisma, 'gate-member', 'Gate member')
  const viewer = await makeUser(db.prisma, 'gate-viewer', 'Gate viewer')
  const outsider = await makeUser(db.prisma, 'gate-outsider', 'Gate outsider')
  const projectId = await makeProject(db.prisma, pm, 'Gate scheduling')
  await makeMember(db.prisma, projectId, otherPm, 'PM')
  await makeMember(db.prisma, projectId, member, 'MEMBER')
  await makeMember(db.prisma, projectId, viewer, 'VIEWER')
  const outsiderProjectId = await makeProject(db.prisma, outsider, 'Gate outsider project')
  const goal = await db.prisma.businessGoal.create({ data: { projectId, name: 'Goal', sortOrder: 0 } })
  const activity = await db.prisma.userActivity.create({
    data: { projectId, goalId: goal.id, name: 'Activity', sortOrder: 0 },
  })
  const story = await db.prisma.userStory.create({ data: {
    projectId, activityId: activity.id, title: 'Story', roleText: 'r', capabilityText: 'c',
    valueText: 'v', businessValue: 'b', priority: 'P1',
  } })
  const makeTask = async (title: string, status: string, ownerUserId: string, acceptorUserId: string,
    planStart: string, planEnd: string) => (await db.prisma.task.create({ data: {
    projectId, storyId: story.id, title, status, ownerUserId, acceptorUserId, planStart, planEnd,
  } })).id
  // 前置任务已 CLOSED：让公开 FS 约束有真实参照点，同时不把后继拖进 DOING。
  const preTaskId = await makeTask('Predecessor', 'CLOSED', member, pm, shiftDays(today, -10), shiftDays(today, -5))
  const aTaskId = await makeTask('Todo A', 'TODO', member, pm, shiftDays(today, 10), shiftDays(today, 14))
  const bTaskId = await makeTask('Todo B', 'TODO', pm, member, shiftDays(today, 12), shiftDays(today, 16))
  const doingTaskId = await makeTask('Doing C', 'DOING', member, pm, shiftDays(today, 20), shiftDays(today, 25))
  await db.prisma.taskDependency.create({ data: {
    projectId, predecessorTaskId: preTaskId, successorTaskId: aTaskId, type: 'FS',
  } })
  const milestone = await db.prisma.milestone.create({ data: {
    projectId, name: 'M1', dueDate: shiftDays(today, 30), ownerUserId: pm,
  } })
  await db.prisma.taskMilestone.create({ data: { milestoneId: milestone.id, taskId: aTaskId } })
  // 无关联任务的里程碑：按 PB-09（2026-10-24 裁定）它属于可见范围，因此必须进**排程来源**
  // （影响 revision 与整份过期判定，见门禁 9）；但按 C 的 policy 口径**不进模型输入**
  // （「无关联不编造」）。门禁 1 与门禁 9 分别钉住这两面。
  const unlinkedMilestone = await db.prisma.milestone.create({ data: {
    projectId, name: 'M-unlinked', dueDate: shiftDays(today, 45), ownerUserId: pm,
  } })
  return {
    pm, otherPm, member, viewer, outsider, projectId, outsiderProjectId, storyId: story.id, today,
    preTaskId, aTaskId, bTaskId, doingTaskId, milestoneId: milestone.id,
    unlinkedMilestoneId: unlinkedMilestone.id,
    pmToken: await tokenFor(pm), otherPmToken: await tokenFor(otherPm), memberToken: await tokenFor(member),
    viewerToken: await tokenFor(viewer), outsiderToken: await tokenFor(outsider),
  }
}

type Api = ReturnType<typeof api>
function api(target: FastifyInstance, token: string | null) {
  const wrap = (test: request.Test) => (token ? test.set('Authorization', `Bearer ${token}`) : test)
  return {
    get: (url: string) => wrap(request(target.server).get(url)),
    post: (url: string, body: object = {}) => wrap(request(target.server).post(url).send(body)),
  }
}
const pmApi = (target: FastifyInstance = app) => api(target, s.pmToken)
const base = () => `/projects/${s.projectId}/scheduling-suggestions`

/** 与回环模型服务完全同源的期望建议：按 taskId 升序的 TODO 任务依次 today+i .. today+i+2。 */
function proposal(): Array<{ taskId: string; planStart: string; planEnd: string }> {
  return [s.aTaskId, s.bTaskId].sort().map((taskId, index) => ({
    taskId, planStart: shiftDays(s.today, index), planEnd: shiftDays(s.today, index + 2),
  }))
}

async function tasks() {
  return db.prisma.task.findMany({ where: { projectId: s.projectId }, orderBy: { id: 'asc' } })
}

async function suggestionId(target: FastifyInstance = app): Promise<string> {
  const response = await pmApi(target).post(base(), { requestId: randomUUID() })
  expect(response.status).toBe(201)
  expect(response.body.status).toBe('PENDING')
  return response.body.id as string
}

async function statusesOf(client: Api, id: string): Promise<number[]> {
  const responses = await Promise.all([
    client.post(base(), { requestId: randomUUID() }),
    client.get(base()),
    client.get(`${base()}/stats`),
    client.get(`${base()}/${id}`),
    client.get(`${base()}/${id}/audit`),
    client.post(`${base()}/${id}/assessment`, { changes: proposal() }),
    client.post(`${base()}/${id}/disposition`, {
      requestId: randomUUID(), status: 'REJECTED', note: 'unauthorized probe',
    }),
  ])
  return responses.map((response) => response.status)
}

async function setRole(role: 'PM' | 'MEMBER'): Promise<void> {
  await db.prisma.projectMember.update({
    where: { projectId_userId: { projectId: s.projectId, userId: s.pm } }, data: { role },
  })
}

beforeAll(async () => {
  server = createServer((req, res) => { void handleModel(req, res) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`
  db = createTempDatabase()
  uploadRoot = mkdtempSync(join(tmpdir(), 'us12-gates-uploads-'))
  const keys = ['SCHEDULING_AI_MODE', 'SCHEDULING_AI_ENDPOINT', 'SCHEDULING_AI_PROVIDER_ID',
    'SCHEDULING_AI_MODEL', 'SCHEDULING_AI_RESPONSE_MODEL', 'SCHEDULING_AI_API_KEY',
    'SCHEDULING_AI_TIMEOUT_MS', 'SCHEDULING_AI_DATA_CLASSIFICATION'] as const
  const saved: Record<string, string | undefined> = {}
  for (const key of keys) { saved[key] = process.env[key]; delete process.env[key] }
  const external: Record<string, string> = {
    SCHEDULING_AI_MODE: 'EXTERNAL_CHAT_COMPLETIONS', SCHEDULING_AI_ENDPOINT: endpoint,
    SCHEDULING_AI_PROVIDER_ID: 'synthetic-loopback', SCHEDULING_AI_MODEL: MODEL,
    SCHEDULING_AI_API_KEY: API_KEY, SCHEDULING_AI_TIMEOUT_MS: String(TIMEOUT_MS),
  }
  // 三份 app 共用同一临时库；差别只在装配时读到的环境变量。
  Object.assign(process.env, external, { SCHEDULING_AI_DATA_CLASSIFICATION: 'SYNTHETIC_DEMO' })
  app = buildApp({ logger: false, prisma: db.prisma, uploadRoot })
  Object.assign(process.env, external, { SCHEDULING_AI_DATA_CLASSIFICATION: 'PROJECT_DATA' })
  projectDataApp = buildApp({ logger: false, prisma: db.prisma, uploadRoot })
  delete process.env.SCHEDULING_AI_DATA_CLASSIFICATION
  for (const key of keys) if (key !== 'SCHEDULING_AI_DATA_CLASSIFICATION') delete process.env[key]
  unconfiguredApp = buildApp({ logger: false, prisma: db.prisma, uploadRoot })
  for (const key of keys) { delete process.env[key]; if (saved[key] !== undefined) process.env[key] = saved[key] }
  await app.ready()
  await projectDataApp.ready()
  await unconfiguredApp.ready()
}, 120_000)

afterAll(async () => {
  await app.close()
  await projectDataApp.close()
  await unconfiguredApp.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
  await db.dispose()
  rmSync(uploadRoot, { recursive: true, force: true })
}, 60_000)

beforeEach(async () => { s = await seed() }, 60_000)

describe('US12 final integration gates — real HTTP, real SQLite, real loopback model', () => {
  it('G1/G2: generates from real #31 port and current #26/#27 data without altering formal plans', async () => {
    const before = await tasks()
    const response = await pmApi().post(base(), { requestId: randomUUID() })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ status: 'PENDING', generation: { status: 'SUCCEEDED' } })
    expect(calls).toBe(1)

    // 「真实端口 + 当前 #26/#27 数据」：出站报文里确实带着本项目的 FS 边、里程碑与负载，
    // 且字段被最小出流白名单钉死（多一个字段就会失败）。
    expect(outbound).toHaveLength(1)
    const payload = JSON.parse(outbound[0]!.data) as { today: string; input: Record<string, unknown> }
    expect(payload.today).toBe(s.today)
    expect(Object.keys(payload.input).sort()).toEqual(
      ['capturedAt', 'dependencies', 'milestones', 'projectId', 'scenario', 'scope', 'tasks', 'workload'])
    const input = payload.input as {
      projectId: string; tasks: Array<Record<string, unknown>>; dependencies: unknown
      milestones: unknown; workload: Array<{ userId: string; openTaskCount: number }>
    }
    expect(input.projectId).toBe(s.projectId)
    expect(input.tasks.map((task) => task.id).sort())
      .toEqual([s.aTaskId, s.bTaskId, s.doingTaskId, s.preTaskId].sort())
    expect(Object.keys(input.tasks[0]!).sort())
      .toEqual(['id', 'ownerUserId', 'planEnd', 'planStart', 'status', 'title'])
    expect(input.dependencies).toEqual([{ predecessorId: s.preTaskId, successorId: s.aTaskId }])
    expect(input.milestones).toEqual([{ id: s.milestoneId, taskIds: [s.aTaskId], date: shiftDays(s.today, 30) }])
    // 夹具里另有一个**无关联任务**的里程碑（PB-09 之后它属于可见范围）：它必须进排程来源
    // （否则整份建议不会因它变化而过期，见门禁 9），但按 policy 口径**不进模型输入**
    // ——「无关联不编造」。这就是对齐后的边界，这里把它钉死。
    expect(input.milestones).toHaveLength(1)
    // 负载 = 可见子集内非 CLOSED 任务数（含 DONE）；前置任务已 CLOSED 故不计入。
    expect(input.workload).toEqual(expect.arrayContaining([
      { userId: s.member, openTaskCount: 2 }, { userId: s.pm, openTaskCount: 1 },
    ]))

    // 生成只产建议，不动正式计划。
    expect(await tasks()).toEqual(before)
  }, 60_000)

  it('G3: real PM-only actions cover generation/list/detail/decision/audit and 401/403/404', async () => {
    const id = await suggestionId()
    const pm = pmApi()
    expect((await pm.get(base())).status).toBe(200)
    expect((await pm.get(`${base()}/stats`)).status).toBe(200)
    const detail = await pm.get(`${base()}/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({ id, status: 'PENDING', sourceState: 'current' })
    expect((await pm.get(`${base()}/${id}/audit`)).status).toBe(200)
    expect((await pm.post(`${base()}/${id}/assessment`, { changes: proposal() })).status).toBe(200)
    const accepted = await pm.post(`${base()}/${id}/disposition`, { requestId: randomUUID(), status: 'ACCEPTED' })
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({ status: 'APPLIED', disposition: 'ACCEPTED', application: 'APPLIED' })

    // 未登录：七条入口全部 401；绕过 UI 直接打接口同样失败。
    expect(await statusesOf(api(app, null), id)).toEqual(Array(7).fill(401))
    // 项目内非 PM：403；项目外：404（不泄漏存在性）。
    expect(await statusesOf(api(app, s.memberToken), id)).toEqual(Array(7).fill(403))
    expect(await statusesOf(api(app, s.viewerToken), id)).toEqual(Array(7).fill(403))
    expect(await statusesOf(api(app, s.outsiderToken), id)).toEqual(Array(7).fill(404))
    // 别项目 PM 也不能借本项目路径读到这条建议。
    const cross = await pm.get(`/projects/${s.outsiderProjectId}/scheduling-suggestions/${id}`)
    expect(cross.status).toBe(404)
  }, 60_000)

  it('G3: revocation takes effect before every request and idempotent retry', async () => {
    const id = await suggestionId()
    const requestId = randomUUID()
    const first = await pmApi().post(`${base()}/${id}/disposition`, { requestId, status: 'ACCEPTED' })
    expect(first.status).toBe(200)
    expect(await db.prisma.auditLog.count()).toBe(1)

    // 撤权：下一请求即被拒（含读回历史与幂等重放），不依赖重新登录、不等令牌过期。
    await setRole('MEMBER')
    expect(await statusesOf(api(app, s.pmToken), id)).toEqual(Array(7).fill(403))
    const replayWhileRevoked = await pmApi().post(`${base()}/${id}/disposition`, { requestId, status: 'ACCEPTED' })
    expect(replayWhileRevoked.status).toBe(403)
    expect(await db.prisma.auditLog.count()).toBe(1)

    // 恢复权限后，重放同一请求仍返回原结果且不重复审计。
    await setRole('PM')
    const replay = await pmApi().post(`${base()}/${id}/disposition`, { requestId, status: 'ACCEPTED' })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(await db.prisma.auditLog.count()).toBe(1)
  }, 60_000)

  it('G4: persists actual input scope, mode/model/version/requestId and generation time', async () => {
    // 混入一个敏感任务：它必须只体现在基数里，不进对象清单、不进模型。
    const sensitive = await db.prisma.task.create({ data: {
      projectId: s.projectId, storyId: s.storyId, title: 'SENSITIVE-NOT-FOR-MODEL', status: 'TODO',
      ownerUserId: s.member, acceptorUserId: s.pm, isSensitive: true,
      planStart: shiftDays(s.today, 40), planEnd: shiftDays(s.today, 44),
    } })
    const requestId = randomUUID()
    const before = Date.now()
    const response = await pmApi().post(base(), { requestId })
    expect(response.status).toBe(201)
    const row = await db.prisma.aiSuggestion.findUniqueOrThrow({ where: { id: response.body.id } })
    expect(row).toMatchObject({
      projectId: s.projectId, scenario: 'SCHEDULING', status: 'PENDING',
      modelProvider: 'synthetic-loopback', modelName: MODEL, modelVersion: '未提供',
      modelMode: 'API', modelExecution: 'EXTERNAL',
      generationStatus: 'SUCCEEDED', generationRequestId: requestId,
      generatedByUserId: s.pm, generationErrorCode: null,
    })
    expect(row.generatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(row.generatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    const scope = row.inputScope as {
      projectId: string; populationBasis: string; containsSensitiveData: boolean
      filters: Record<string, boolean>; includedFields: string[]; excludedFields: string[]
      objects: Array<{ objectType: string; objectId: string }>
      population: { sourceCount: number; includedCount: number; excludedSensitiveCount: number }
    }
    expect(scope).toMatchObject({
      projectId: s.projectId, populationBasis: 'VISIBLE', containsSensitiveData: false,
      filters: { isSensitive: false, parentStoryIsSensitive: false },
      includedFields: ['tasks', 'dependencies', 'milestones', 'workload'],
      population: { sourceCount: 5, includedCount: 4, excludedSensitiveCount: 1 },
    })
    expect(scope.excludedFields).toContain('serverPrivate')
    expect(scope.objects.every((object) => object.objectType === 'task')).toBe(true)
    expect(scope.objects.map((object) => object.objectId))
      .toEqual([s.aTaskId, s.bTaskId, s.doingTaskId, s.preTaskId].sort())
    expect(JSON.stringify(scope)).not.toContain(sensitive.id)

    // 对外投影同样不回传快照、私有约束包或 PM 基数。
    const detail = await pmApi().get(`${base()}/${response.body.id}`)
    expect(detail.status).toBe(200)
    const projected = JSON.stringify(detail.body)
    for (const forbidden of ['serverPrivate', 'excludedSensitiveCount', 'snapshot', 'constraintDigest', sensitive.id, 'SENSITIVE-NOT-FOR-MODEL']) {
      expect(projected, forbidden).not.toContain(forbidden)
    }
    expect(JSON.stringify(outbound)).not.toContain(sensitive.id)
    expect(JSON.stringify(outbound)).not.toContain('SENSITIVE-NOT-FOR-MODEL')
  }, 60_000)

  it('G4/G5: confirms the saved proposal without calling the model a second time', async () => {
    const id = await suggestionId()
    expect(calls).toBe(1)
    const detail = await pmApi().get(`${base()}/${id}`)
    expect(detail.body.changes).toEqual(proposal())
    // 对抗性复核指出：C 的 `SchedulingWorkflowPorts` 里根本没有模型端口，所以
    // 「计数不增加」是结构性恒真、单独不构成哨兵。这里补一条**动态反证**：
    // 把回环模型服务切成「任何新请求一律 500」，此后若 SUT 还敢发起第二次模型调用，
    // 复核/确认必然被拖成失败 —— 「在模型已坏的前提下仍然成功」才证明确认路径没有二次调用。
    behaviour = 'http-500'
    try {
      const assess = await pmApi().post(`${base()}/${id}/assessment`, { changes: proposal() })
      expect(assess.status).toBe(200)
      const accepted = await pmApi().post(`${base()}/${id}/disposition`, {
        requestId: randomUUID(), status: 'ACCEPTED',
      })
      expect(accepted.status).toBe(200)
      expect(accepted.body).toMatchObject({ status: 'APPLIED', application: 'APPLIED' })
    } finally { behaviour = 'proposal' }
    // 确认阶段只应用**已保存**建议：模型调用计数不增加，也没有新的出站报文。
    expect(calls).toBe(1)
    expect(outbound).toHaveLength(1)
    const after = await tasks()
    for (const change of proposal()) {
      expect(after.find((task) => task.id === change.taskId))
        .toMatchObject({ planStart: change.planStart, planEnd: change.planEnd })
    }
  }, 60_000)

  it('G4/G5: two-task application and successful audit share one real DB transaction', async () => {
    const id = await suggestionId()
    const accepted = await pmApi().post(`${base()}/${id}/disposition`, { requestId: randomUUID(), status: 'ACCEPTED' })
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({ status: 'APPLIED', application: 'APPLIED' })

    // 两条任务、处置、应用与成功审计同时可见 —— 它们只在同一事务里一起提交。
    const after = await tasks()
    for (const change of proposal()) {
      expect(after.find((task) => task.id === change.taskId))
        .toMatchObject({ planStart: change.planStart, planEnd: change.planEnd })
    }
    expect(await db.prisma.aiDisposition.count()).toBe(1)
    expect(await db.prisma.aiApplication.count()).toBe(1)
    const audit = await db.prisma.auditLog.findMany()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      projectId: s.projectId, actorUserId: s.pm, action: 'scheduling.disposed',
      objectType: 'ai-suggestion', objectId: id,
    })
    expect(JSON.parse(audit[0]!.after!)).toMatchObject({ status: 'ACCEPTED', changes: proposal() })
    const before = JSON.parse(audit[0]!.before!) as Array<{ taskId: string; planStart: string }>
    expect(before.map((change) => change.taskId).sort()).toEqual([s.aTaskId, s.bTaskId].sort())
    expect(before.find((change) => change.taskId === s.aTaskId)!.planStart).toBe(shiftDays(s.today, 10))
    // 接口读回的审计与库内一致。
    const read = await pmApi().get(`${base()}/${id}/audit`)
    expect(read.body.items).toHaveLength(1)
    expect(read.body.items[0]).toMatchObject({ projectId: s.projectId, status: 'ACCEPTED', after: proposal() })

    // 反证「同一事务」：上面的断言只观测「最终可见状态」，把 `$transaction` 换成顺序提交
    // 也照样全绿（对抗性复核指出的缺口）。这里让**成功审计**这一步真实失败，
    // 则日期写入 / 处置 CAS / 应用更新必须一起消失 —— 那才是「一个真实事务」的证据。
    const second = await suggestionId()
    const beforeRollback = await tasks()
    const dispositionsBefore = await db.prisma.aiDisposition.count()
    const applicationsBefore = await db.prisma.aiApplication.count()
    const auditsBefore = await db.prisma.auditLog.count()
    await db.prisma.$executeRawUnsafe(`CREATE TRIGGER reject_gate_audit
      BEFORE INSERT ON AuditLog WHEN NEW.action = 'scheduling.disposed'
      BEGIN SELECT RAISE(ABORT, 'synthetic gate audit failure'); END`)
    try {
      const failed = await pmApi().post(`${base()}/${second}/disposition`, {
        requestId: randomUUID(), status: 'ACCEPTED',
      })
      expect(failed.status).toBe(500)
      expect(await tasks()).toEqual(beforeRollback)
      expect(await db.prisma.aiDisposition.count()).toBe(dispositionsBefore)
      expect(await db.prisma.aiApplication.count()).toBe(applicationsBefore)
      expect(await db.prisma.auditLog.count()).toBe(auditsBefore)
      expect(await db.prisma.aiSuggestion.findUniqueOrThrow({ where: { id: second } }))
        .toMatchObject({ status: 'PENDING' })
    } finally { await db.prisma.$executeRawUnsafe('DROP TRIGGER reject_gate_audit') }
  }, 60_000)

  it('G4/G5: one invalid task rolls back all changes, separate safe failure evidence remains', async () => {
    const id = await suggestionId()
    const before = await tasks()
    const warns: unknown[][] = []
    const log = app.log as unknown as { warn: (...args: unknown[]) => void }
    const original = log.warn
    log.warn = (...args: unknown[]) => { warns.push(args) }
    const note = 'rollback-probe-note'
    const invalidRequestId = randomUUID()
    let status = 0
    try {
      // 第二个任务日期倒置：第一个任务完全合法，但它也不能被写。
      const changes = proposal().map((change, index) => index === 1
        ? { ...change, planStart: change.planEnd, planEnd: shiftDays(change.planStart, -3) }
        : change)
      status = (await pmApi().post(`${base()}/${id}/disposition`, {
        requestId: invalidRequestId, status: 'MODIFIED', note, changes,
      })).status
    } finally { log.warn = original }
    expect(status).toBe(422)
    // 整份回滚：日期、处置、应用、审计一处不落；建议本身仍停在 PENDING。
    expect(await tasks()).toEqual(before)
    expect(await db.prisma.aiDisposition.count()).toBe(0)
    expect(await db.prisma.aiApplication.count()).toBe(0)
    expect(await db.prisma.auditLog.count()).toBe(0)
    expect(await db.prisma.aiSuggestion.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'PENDING' })
    // 回滚之后另留的安全失败证据：只有标识与错误码，没有正文、提示词或异常对象。
    const evidence = warns.map((args) => args[0]).filter((value): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).code === 'string')
    // 精确到本次请求：不能只靠「碰巧存在一条 VALIDATION_FAILED」——HTTP hook 也会记同形状的
    // 4 键行（code=HTTP_422），弱计数无法区分失败证据来自哪一层。
    expect(evidence.filter((entry) => entry.requestId === invalidRequestId).map((entry) => entry.code))
      .toContain('VALIDATION_FAILED')
    for (const entry of evidence) {
      expect(Object.keys(entry).sort()).toEqual(['actorUserId', 'code', 'projectId', 'requestId'])
      expect(entry.projectId).toBe(s.projectId)
      expect(entry.actorUserId).toBe(s.pm)
      expect(JSON.stringify(entry)).not.toContain(note)
    }
    // 失败不改变建议状态，也不消耗幂等身份：换一个 requestId 仍可正常采纳。
    const recovered = await pmApi().post(`${base()}/${id}/disposition`, {
      requestId: randomUUID(), status: 'ACCEPTED',
    })
    expect(recovered.status).toBe(200)

    // ── 真正的回滚证明 ─────────────────────────────────────────────────────
    // 上面那种「日期倒置」在 verify 阶段就被拦下，**根本没有写入可回滚**，
    // 所以它并不构成「整份回滚」的证据（对抗性复核指出的核心缺口）。
    // 这里让**第二个任务的真实写入**失败（DB 触发器），此时第一个任务的写入
    // 已经发生在同一事务里 —— 这才需要真回滚。
    const real = await suggestionId()
    const beforeReal = await tasks()
    const dispositionsBefore = await db.prisma.aiDisposition.count()
    const applicationsBefore = await db.prisma.aiApplication.count()
    const auditsBefore = await db.prisma.auditLog.count()
    const failingTaskId = proposal()[1]!.taskId
    const realRequestId = randomUUID()
    const realWarns: unknown[][] = []
    const realLog = app.log as unknown as { warn: (...args: unknown[]) => void }
    const realOriginal = realLog.warn
    realLog.warn = (...args: unknown[]) => { realWarns.push(args) }
    let realStatus = 0
    await db.prisma.$executeRawUnsafe(`CREATE TRIGGER reject_gate_task_update
      BEFORE UPDATE ON "Task" WHEN NEW.id = '${failingTaskId}'
      BEGIN SELECT RAISE(ABORT, 'synthetic gate task write failure'); END`)
    try {
      realStatus = (await pmApi().post(`${base()}/${real}/disposition`, {
        requestId: realRequestId, status: 'ACCEPTED',
      })).status
    } finally {
      realLog.warn = realOriginal
      await db.prisma.$executeRawUnsafe('DROP TRIGGER reject_gate_task_update')
    }
    expect(realStatus).toBe(500)
    // 第一个任务（本可写入成功）也必须一起消失：整批零变化、无处置、无应用、无审计。
    expect(await tasks()).toEqual(beforeReal)
    expect(await db.prisma.aiDisposition.count()).toBe(dispositionsBefore)
    expect(await db.prisma.aiApplication.count()).toBe(applicationsBefore)
    expect(await db.prisma.auditLog.count()).toBe(auditsBefore)
    expect(await db.prisma.aiSuggestion.findUniqueOrThrow({ where: { id: real } }))
      .toMatchObject({ status: 'PENDING' })
    // 事务之外另有安全失败证据：只带标识与码，不带异常正文。
    const realEvidence = realWarns.map((args) => args[0]).filter((value): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && (value as Record<string, unknown>).requestId === realRequestId)
    expect(realEvidence.length).toBeGreaterThanOrEqual(1)
    for (const entry of realEvidence) {
      expect(Object.keys(entry).sort()).toEqual(['actorUserId', 'code', 'projectId', 'requestId'])
      expect(String(entry.code)).not.toContain('synthetic gate task write failure')
    }
  }, 60_000)

  it('G4/G5: identical request is idempotent, different/concurrent disposition conflicts', async () => {
    const id = await suggestionId()
    const requestId = randomUUID()
    const first = await pmApi().post(`${base()}/${id}/disposition`, { requestId, status: 'ACCEPTED' })
    expect(first.status).toBe(200)
    // 同一 requestId + 同一内容：重放返回原结果，不重复审计、不重复应用。
    const replay = await pmApi().post(`${base()}/${id}/disposition`, { requestId, status: 'ACCEPTED' })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(await db.prisma.auditLog.count()).toBe(1)
    expect(await db.prisma.aiApplication.count()).toBe(1)
    // 已成功重放不会被「自身日期更新」误判为来源过期（上面那次 200 即证据）。

    // 同一 requestId、不同内容 → 冲突。
    const conflict = await pmApi().post(`${base()}/${id}/disposition`, {
      requestId, status: 'MODIFIED', note: 'different content', changes: proposal(),
    })
    expect(conflict.status).toBe(409)
    expect(await db.prisma.auditLog.count()).toBe(1)
    // 同一 requestId、另一位 actor → 冲突（处置身份不可被他人接管）。
    const other = await api(app, s.otherPmToken).post(`${base()}/${id}/disposition`, {
      requestId, status: 'ACCEPTED',
    })
    expect(other.status).toBe(409)

    // 并发不同请求：恰好一次生效，另一次冲突；不产生第二次审计。
    const concurrentId = await suggestionId()
    const [one, two] = await Promise.all([
      pmApi().post(`${base()}/${concurrentId}/disposition`, { requestId: randomUUID(), status: 'ACCEPTED' }),
      pmApi().post(`${base()}/${concurrentId}/disposition`, { requestId: randomUUID(), status: 'ACCEPTED' }),
    ])
    expect([one.status, two.status].sort()).toEqual([200, 409])
    expect(await db.prisma.auditLog.count()).toBe(2)
    expect(await db.prisma.aiApplication.count()).toBe(2)
  }, 60_000)

  it('G2/G5: changed task/member/FS/milestone/workload/permission snapshot expires whole proposal', async () => {
    const cases: Array<{ name: string; mutate: () => Promise<void>; revert: () => Promise<void> }> = [
      {
        name: 'task plan dates',
        mutate: () => db.prisma.task.update({ where: { id: s.bTaskId },
          data: { planStart: shiftDays(s.today, 13), planEnd: shiftDays(s.today, 17) } }).then(() => undefined),
        revert: () => db.prisma.task.update({ where: { id: s.bTaskId },
          data: { planStart: shiftDays(s.today, 12), planEnd: shiftDays(s.today, 16) } }).then(() => undefined),
      },
      {
        name: 'task status (workload source)',
        mutate: () => db.prisma.task.update({ where: { id: s.doingTaskId },
          data: { status: 'DONE' } }).then(() => undefined),
        revert: () => db.prisma.task.update({ where: { id: s.doingTaskId },
          data: { status: 'DOING' } }).then(() => undefined),
      },
      {
        name: 'member role',
        mutate: () => db.prisma.projectMember.update({
          where: { projectId_userId: { projectId: s.projectId, userId: s.member } },
          data: { role: 'VIEWER' } }).then(() => undefined),
        revert: () => db.prisma.projectMember.update({
          where: { projectId_userId: { projectId: s.projectId, userId: s.member } },
          data: { role: 'MEMBER' } }).then(() => undefined),
      },
      {
        name: 'FS dependency',
        mutate: async () => { await db.prisma.taskDependency.create({ data: {
          projectId: s.projectId, predecessorTaskId: s.doingTaskId, successorTaskId: s.bTaskId, type: 'FS' } }) },
        revert: async () => { await db.prisma.taskDependency.deleteMany({
          where: { predecessorTaskId: s.doingTaskId, successorTaskId: s.bTaskId } }) },
      },
      {
        name: 'milestone',
        mutate: async () => { await db.prisma.milestone.create({ data: {
          projectId: s.projectId, name: 'M2', dueDate: shiftDays(s.today, 50), ownerUserId: s.pm,
          tasks: { create: { taskId: s.bTaskId } } } }) },
        revert: async () => { await db.prisma.milestone.deleteMany({
          where: { projectId: s.projectId, name: 'M2' } }) },
      },
      {
        name: 'unlinked milestone（PB-09 对齐）',
        mutate: () => db.prisma.milestone.update({ where: { id: s.unlinkedMilestoneId },
          data: { dueDate: shiftDays(s.today, 46) } }).then(() => undefined),
        revert: () => db.prisma.milestone.update({ where: { id: s.unlinkedMilestoneId },
          data: { dueDate: shiftDays(s.today, 45) } }).then(() => undefined),
      },
      {
        name: 'new task in scope',
        mutate: async () => { await db.prisma.task.create({ data: {
          projectId: s.projectId, storyId: s.storyId, title: 'New in scope', status: 'TODO',
          ownerUserId: s.viewer, acceptorUserId: s.pm,
          planStart: shiftDays(s.today, 60), planEnd: shiftDays(s.today, 64) } }) },
        revert: async () => { await db.prisma.task.deleteMany({
          where: { projectId: s.projectId, title: 'New in scope' } }) },
      },
    ]
    for (const item of cases) {
      const id = await suggestionId()
      expect((await pmApi().get(`${base()}/${id}`)).body.sourceState, item.name).toBe('current')
      await item.mutate()
      // 变化后：详情标 stale，复核标 stale，处置整份拒绝，且不接受部分应用。
      expect((await pmApi().get(`${base()}/${id}`)).body.sourceState, item.name).toBe('stale')
      const assessment = await pmApi().post(`${base()}/${id}/assessment`, { changes: proposal() })
      expect(assessment.status, item.name).toBe(200)
      expect(assessment.body.state, item.name).toBe('stale')
      const disposed = await pmApi().post(`${base()}/${id}/disposition`, {
        requestId: randomUUID(), status: 'ACCEPTED',
      })
      expect(disposed.status, item.name).toBe(409)
      expect(await db.prisma.aiDisposition.count(), item.name).toBe(0)
      expect(await db.prisma.auditLog.count(), item.name).toBe(0)
      await item.revert()
    }
    // 纯排序/无变化不产生假过期：同一来源重新生成的建议是 current。
    const stable = await suggestionId()
    expect((await pmApi().get(`${base()}/${stable}`)).body.sourceState).toBe('current')
    // 权限变化不走快照，而是每次请求重新鉴权 → 直接 403（口径见门禁 3）。
    await setRole('MEMBER')
    expect((await pmApi().get(`${base()}/${stable}`)).status).toBe(403)
    expect((await pmApi().post(`${base()}/${stable}/disposition`, {
      requestId: randomUUID(), status: 'ACCEPTED',
    })).status).toBe(403)
    await setRole('PM')
  }, 120_000)

  it('G5: preserves existing task assignment/progress/acceptance rules after authorized extraction', async () => {
    const before = await tasks()
    const id = await suggestionId()
    const identityOf = (rows: Awaited<ReturnType<typeof tasks>>) => rows.map((row) => ({
      id: row.id, ownerUserId: row.ownerUserId, acceptorUserId: row.acceptorUserId,
      status: row.status, progress: row.progress,
    }))
    expect((await pmApi().post(`${base()}/${id}/disposition`, {
      requestId: randomUUID(), status: 'ACCEPTED',
    })).status).toBe(200)
    const after = await tasks()
    // 授权提取后只改计划日期：负责人、验收人、状态（含 TODO 不被带进 DOING）与验收口径都不动。
    expect(identityOf(after)).toEqual(identityOf(before))
    expect(after.find((task) => task.id === s.aTaskId)).toMatchObject({ status: 'TODO' })
    expect(after.find((task) => task.id === s.doingTaskId))
      .toMatchObject({ planStart: shiftDays(s.today, 20), planEnd: shiftDays(s.today, 25) })
    expect(await db.prisma.auditLog.count()).toBe(1)

    // AI 建议不能越出提取范围：把非 TODO（DOING）任务塞进修改后采纳 → 拒绝且零写入。
    const scoped = await suggestionId()
    const beforeSecond = await tasks()
    const outOfScope = await pmApi().post(`${base()}/${scoped}/disposition`, {
      requestId: randomUUID(), status: 'MODIFIED', note: 'touch a DOING task',
      changes: [...proposal(), { taskId: s.doingTaskId,
        planStart: shiftDays(s.today, 21), planEnd: shiftDays(s.today, 26) }],
    })
    expect(outOfScope.status).toBe(422)
    expect(await tasks()).toEqual(beforeSecond)
    expect(await db.prisma.aiDisposition.count()).toBe(1) // 仍只有上面那次成功处置
    expect(await db.prisma.auditLog.count()).toBe(1)
    // 越出提取范围的任务进不来。这里断言**精确 422**：原来的 `[404,422]` 析取无法区分
    // 「范围/日期校验层拦下」与「任务写入层 404」，等于没有定位拦截层（对抗性复核指出）。
    const foreign = await pmApi().post(`${base()}/${scoped}/disposition`, {
      requestId: randomUUID(), status: 'MODIFIED', note: 'out-of-scope task',
      changes: [{ taskId: 'not-a-task-in-this-project', planStart: s.today, planEnd: s.today }],
    })
    expect(foreign.status).toBe(422)
    expect(await tasks()).toEqual(beforeSecond)
  }, 60_000)

  it('G7: explicit real API mode and outflow evidence on invented data, never implicit stub fallback', async () => {
    const before = await tasks()
    const response = await pmApi().post(base(), { requestId: randomUUID() })
    expect(response.status).toBe(201)
    // 显式 EXTERNAL 模式：回环 HTTP 服务真实收到一次带凭据的 Chat Completions 请求。
    expect(calls).toBe(1)
    expect(outbound).toHaveLength(1)
    expect(outbound[0]!.authorization).toBe(`Bearer ${API_KEY}`)
    expect(outbound[0]!.model).toBe(MODEL)
    const payload = JSON.parse(outbound[0]!.data) as { input: Record<string, unknown> }
    expect(Object.keys(payload.input).sort()).toEqual(
      ['capturedAt', 'dependencies', 'milestones', 'projectId', 'scenario', 'scope', 'tasks', 'workload'])
    for (const forbidden of ['serverPrivate', 'pmProtected', 'excludedSensitiveCount', 'revision']) {
      expect(JSON.stringify(payload), forbidden).not.toContain(forbidden)
    }
    expect(await db.prisma.aiSuggestion.findUniqueOrThrow({ where: { id: response.body.id } }))
      .toMatchObject({ modelMode: 'API', modelExecution: 'EXTERNAL' })

    // 未配置：显式不可用（不是本地桩），正式计划不受影响。
    const unconfigured = await api(unconfiguredApp, s.pmToken).post(base(), { requestId: randomUUID() })
    expect(unconfigured.status).toBe(201)
    expect(unconfigured.body).toMatchObject({ status: 'GENERATION_FAILED',
      generation: { status: 'FAILED', error: { code: 'AI_SERVICE_UNAVAILABLE' } } })
    const unavailableDetail = await api(unconfiguredApp, s.pmToken).get(`${base()}/${unconfigured.body.id}`)
    expect(unavailableDetail.status).toBe(200)
    expect(unavailableDetail.body.changes).toEqual([])
    // 对抗性复核指出 `body.suggestion ?? null` 是**恒真**（对外投影从不含该键），
    // 因此它给不了任何信号。改为断言「这些敏感键在投影里根本不存在」。
    for (const forbiddenKey of ['suggestion', 'snapshot', 'serverPrivate', 'pmProtected']) {
      expect(Object.keys(unavailableDetail.body), forbiddenKey).not.toContain(forbiddenKey)
    }

    // 模型非法输出 / 上游 5xx / 超时：一律显式失败，不静默回桩、不落伪建议、不写正式计划。
    for (const mode of ['malformed', 'http-500', 'hang'] as const) {
      behaviour = mode
      const failed = await pmApi().post(base(), { requestId: randomUUID() })
      expect(failed.status, mode).toBe(201)
      expect(failed.body.status, mode).toBe('GENERATION_FAILED')
      expect(failed.body.generation.error.code, mode).toBe(
        mode === 'hang' ? 'AI_TIMEOUT' : mode === 'malformed' ? 'AI_INVALID_RESPONSE' : 'AI_SERVICE_UNAVAILABLE')
      const detail = await pmApi().get(`${base()}/${failed.body.id}`)
      expect(detail.body.changes, mode).toEqual([])
    }
    behaviour = 'proposal'
    expect(await tasks()).toEqual(before)

    // 默认 PROJECT_DATA 时**拒绝**外发到外部模型（未发生任何出站请求）。
    const beforeProjectDataAttempt = calls
    const refused = await api(projectDataApp, s.pmToken).post(base(), { requestId: randomUUID() })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe('VALIDATION_FAILED')
    expect(calls).toBe(beforeProjectDataAttempt)
  }, 120_000)

  it('G6: browser generation → confirm → actual task/gantt/workload changes → audit', async () => {
    // =====================================================================
    // 门禁 11（G6）—— 真实浏览器走查：
    //   以 PM 登录 → 打开排期页 → 生成 → 查看**原始建议** → 编辑 → 复核
    //   → 确认（修改后采纳）→ 刷新后仍持久 → 任务/甘特日期一致
    //   → 负载按状态口径不变 → 审计/记录可追溯。
    //
    // 三处「真实」都不打折，也不留退路：
    //   ① 服务端是**真实进程**：fork `docs/role-a/issue-32/us12-browser-fixture.ts`
    //      （独立临时 SQLite + 真实 Fastify 生产装配 + Vite 代理），浏览器访问的是它；
    //   ② 模型出口是**真实回环 HTTP**（夹具内 `node:http` 的 Chat Completions，
    //      经 `SCHEDULING_AI_*` 显式开启 EXTERNAL 模式），不是内存桩、无隐式回退；
    //   ③ 浏览器是**真实 Chrome**（playwright-core 通过 CDP 驱动本机可执行文件），
    //      登录走真实登录页，编辑/复核/确认都点真实按钮。
    //
    // 驱动依赖不在本仓 node_modules（按绝对路径加载，可用环境变量覆盖），缺任一即显式失败：
    //   US12_PLAYWRIGHT_CORE · playwright-core 入口（CJS，须 require 后取 .chromium）
    //   US12_CHROME_PATH      · Chrome 可执行文件（本机没有 playwright 自带 chromium 二进制）
    //
    // 页面选择器与按钮文案全部取自实读的 `web/src/pages/scheduling/SchedulingPage.tsx`：
    //   「生成建议」/「刷新核对」/「校验当前日期」/「采纳」/「修改后采纳」/「拒绝」/
    //   「读取审计」、`#scheduling-reason`、`input[type=date]`、`dd`/`th`/`td` 表格行。
    // =====================================================================
    const { fork } = await import('node:child_process')
    const { createRequire } = await import('node:module')
    const nodeFs = await import('node:fs')
    const nodePath = await import('node:path')
    const nodeOs = await import('node:os')
    const { TEST_PASSWORD } = await import('../../../test/http-support.js')

    /** 服务端 JSON 投影（不在测试里重复契约校验，只读已知字段）。 */
    type Json = Record<string, any>
    /** playwright-core 不在本仓依赖中，故只声明本用例实际用到的最小接口。 */
    type PwLocator = {
      fill(value: string): Promise<void>
      click(): Promise<void>
      waitFor(options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>
      inputValue(): Promise<string>
      textContent(): Promise<string | null>
      isDisabled(): Promise<boolean>
      count(): Promise<number>
      allTextContents(): Promise<string[]>
      locator(selector: string): PwLocator
      filter(options: { hasText?: string | RegExp; has?: PwLocator }): PwLocator
      nth(index: number): PwLocator
      first(): PwLocator
      getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): PwLocator
      getByText(text: string | RegExp, options?: { exact?: boolean }): PwLocator
      getByLabel(text: string | RegExp, options?: { exact?: boolean }): PwLocator
    }
    type PwResponse = { url(): string; status(): number; request(): { method(): string }; json(): Promise<unknown> }
    type PwRequest = { url(): string; method(): string; postData(): string | null }
    type PwConsole = { type(): string; text(): string }
    type PwPageError = { message: string }
    type PwPage = PwLocator & {
      goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<unknown>
      reload(options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<unknown>
      waitForURL(predicate: (url: URL) => boolean, options?: { timeout?: number }): Promise<void>
      url(): string
      screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>
      evaluate<R>(work: (input: string) => R | Promise<R>, input: string): Promise<R>
      on(event: 'response', handler: (value: PwResponse) => void): void
      on(event: 'request', handler: (value: PwRequest) => void): void
      on(event: 'console', handler: (value: PwConsole) => void): void
      on(event: 'pageerror', handler: (value: PwPageError) => void): void
    }
    type PwContext = { newPage(): Promise<PwPage>; close(): Promise<void> }
    type PwBrowser = {
      version(): Promise<string>
      newContext(options: { viewport: { width: number; height: number }; locale?: string }): Promise<PwContext>
      close(): Promise<void>
    }
    type FixtureReady = {
      type: 'ready'; url: string; apiUrl: string; projectId: string; storyId: string; storyTitle: string
      today: string; pmAccount: string; pmUserId: string; pmDisplayName: string
      memberUserId: string; memberDisplayName: string; modelId: string
      tasks: Array<{ id: string; title: string; status: string; planStart: string; planEnd: string }>
      tasksById: Record<string, { id: string; title: string; status: string; planStart: string; planEnd: string }>
      expectedProposal: Array<{ taskId: string; planStart: string; planEnd: string }>
      edits: Array<{ taskId: string; planStart: string; planEnd: string }>
      predecessorTaskId: string; doingTaskId: string; milestoneId: string
    }
    type FixtureInspection = {
      type: 'inspection'; modelCalls: number; outboundCount: number
      modelInputKeys: Array<{ today: string; inputKeys: string[] }>
      tasks: Array<{ id: string; title: string; status: string; planStart: string; planEnd: string }>
      suggestions: Json[]
      dispositions: Json[]
      applications: Json[]
      audits: Json[]
      milestone: Json[]
    }

    const repoRoot = process.cwd()
    const fixtureEntry = nodePath.resolve(repoRoot, 'docs/role-a/issue-32/us12-browser-fixture.ts')
    // 证据（截图 + 结构化 JSON）默认写进**系统临时目录**，不落进仓库：
    // 它们是每次运行都会重新生成的中间产物，不该成为仓库里的常驻文件。
    // 需要留档/附到记录里时，显式给 US12_EVIDENCE_DIR=<目录>。
    const evidenceDir = process.env.US12_EVIDENCE_DIR
      ? nodePath.resolve(process.env.US12_EVIDENCE_DIR)
      : nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'us12-g6-evidence-'))
    const prerequisites = browserPrerequisites(fixtureEntry)
    if (!prerequisites.ok) {
      const reason = `G6 浏览器门禁未执行：${prerequisites.reason}`
      if (process.env.US12_REQUIRE_BROWSER === '1') throw new Error(reason)
      skippedBrowserGate = reason
      console.warn(`[US12 G6] ${reason}`)
      return
    }
    const playwrightEntry = prerequisites.playwright
    const chromePath = prerequisites.chrome
    nodeFs.mkdirSync(evidenceDir, { recursive: true })

    const shot = (name: string) => nodePath.join(evidenceDir, name)
    const checks: Array<{ name: string; passed: boolean }> = []
    async function check(name: string, work: () => Promise<void>): Promise<void> {
      await work()
      checks.push({ name, passed: true })
    }
    /** 按 taskId 升序 —— 服务端 `orderedChanges()` 的排序口径，断言前先归一。 */
    function ordered(rows: ReadonlyArray<{ taskId: string; planStart: string; planEnd: string }>) {
      return [...rows].map((row) => ({ taskId: row.taskId, planStart: row.planStart, planEnd: row.planEnd }))
        .sort((left, right) => (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0))
    }

    // ---- 服务端夹具子进程（真实 Fastify + 真实临时 SQLite + Vite 代理）----
    const fixture = fork(fixtureEntry, [], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], cwd: repoRoot,
    })
    let fixtureLog = ''
    fixture.stdout?.on('data', (value: Buffer) => { fixtureLog += value.toString() })
    fixture.stderr?.on('data', (value: Buffer) => { fixtureLog += value.toString() })
    const tail = (value: string) => value.slice(-4000)

    let browser: PwBrowser | undefined
    let page!: PwPage
    const requests: Array<{ method: string; path: string; status: number }> = []
    const captured: Array<{ key: string; body: Promise<unknown> }> = []
    const sent: Array<{ key: string; body: Json }> = []
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const noteText = '门禁 11：人工调整后采纳（合成演示数据）'
    let suggestionId = ''
    let dispositionRequestId = ''
    let workloadBefore: string[] = []
    let dbState: FixtureInspection | undefined

    function debug(value: unknown): void {
      if (value !== undefined) console.error('[G6]', JSON.stringify(value))
    }
    function inspector(): Promise<FixtureInspection> {
      return new Promise<FixtureInspection>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('门禁 11 夹具 inspect 超时（15s）')), 15_000)
        const listener = (value: unknown) => {
          const typed = value as { type?: string }
          if (typed?.type === 'inspection') { clearTimeout(timer); fixture.off('message', listener); resolve(value as FixtureInspection) }
        }
        fixture.on('message', listener)
        fixture.send({ type: 'inspect' })
      })
    }
    /** 取某次操作之后**新捕获**的服务端响应体（按捕获序号过滤，避免读到上一次的同名响应）。 */
    async function bodyAfter(key: string, from: number, timeoutMs = 60_000): Promise<Json> {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        for (let index = captured.length - 1; index >= from; index -= 1) {
          if (captured[index]!.key === key) {
            const body = await captured[index]!.body
            if (body !== undefined && body !== null) return body as Json
          }
        }
        if (Date.now() > deadline) throw new Error(`未捕获到 ${key} 的真实响应（${timeoutMs}ms 超时）`)
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    /** 取浏览器**实际发出**的请求体（用于断言页面提交的 requestId/changes，而不是测试自造的值）。 */
    function sentAfter(key: string, from: number): Json {
      for (let index = sent.length - 1; index >= from; index -= 1) if (sent[index]!.key === key) return sent[index]!.body
      throw new Error(`未记录到浏览器发出的 ${key} 请求体`)
    }
    /** 以页面自己的登录态（localStorage 令牌留在页面内，绝不落到证据文件）读真实接口。 */
    async function apiGet(pathName: string): Promise<{ status: number; body: Json }> {
      return await page.evaluate(async (path: string) => {
        const store = (globalThis as unknown as { localStorage: { getItem(key: string): string | null } }).localStorage
        const token = store.getItem('aim.token')
        const response = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        const text = await response.text()
        return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, any> }
      }, pathName)
    }
    const workloadPairs = (view: Json) => (view.members as Array<{ userId: string; openTaskCount: number }>)
      .map((row) => `${row.userId}:${row.openTaskCount}`).sort()

    let ready: FixtureReady
    try {
      ready = await new Promise<FixtureReady>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`门禁 11 夹具启动超时（90s）。夹具输出：\n${tail(fixtureLog)}`)), 90_000)
        fixture.on('message', (value: unknown) => {
          if ((value as { type?: string })?.type === 'ready') { clearTimeout(timer); resolve(value as FixtureReady) }
        })
        fixture.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`门禁 11 夹具退出 code=${code}。夹具输出：\n${tail(fixtureLog)}`))
        })
      })

      // ---- 真实 Chrome（playwright-core 驱动本机可执行文件）----
      const playwright = createRequire(import.meta.url)(playwrightEntry) as {
        chromium: { launch(options: { executablePath: string; headless: boolean; args?: string[] }): Promise<PwBrowser> }
      }
      browser = await playwright.chromium.launch({
        executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
      })
      const browserVersion = await browser.version()
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
      page = await context.newPage()

      // 关键网络请求摘要（只有路径/方法/状态）与控制台异常；不含令牌与密码。
      page.on('response', (value) => {
        const url = new URL(value.url())
        if (!url.pathname.startsWith('/api/')) return
        requests.push({ method: value.request().method(), path: url.pathname, status: value.status() })
        captured.push({ key: `${value.request().method()} ${url.pathname}`, body: value.json().catch(() => undefined) })
      })
      page.on('request', (value) => {
        const url = new URL(value.url())
        if (!url.pathname.startsWith('/api/') || value.method() === 'GET') return
        const raw = value.postData()
        let body: Json = {}
        try { body = raw ? JSON.parse(raw) as Json : {} } catch { body = {} }
        sent.push({ key: `${value.method()} ${url.pathname}`, body })
      })
      page.on('console', (value) => { if (value.type() === 'error') consoleErrors.push(value.text()) })
      page.on('pageerror', (value) => pageErrors.push(String(value.message)))

      const basePath = `/projects/${ready.projectId}/scheduling-suggestions`
      const itemPath = (id: string) => `${basePath}/${id}`
      /** 浏览器实际请求的线上路径（`apiFetch` 统一加 `/api` 前缀，Vite 代理 rewrite 去掉）。 */
      const wire = (path: string) => `/api${path}`
      const rowOf = (title: string) => page.getByRole('row').filter({ hasText: title })

      // -----------------------------------------------------------------
      // ① 真实登录 + 打开排期页
      // -----------------------------------------------------------------
      await check('① 以 PM 走真实登录页登录，进入该项目排期页（尚未生成）', async () => {
        await page.goto(`${ready.url}/login`, { waitUntil: 'domcontentloaded' })
        await page.getByLabel('账号').fill(ready.pmAccount)
        await page.getByLabel('密码').fill(TEST_PASSWORD)
        await page.getByRole('button', { name: '登录', exact: true }).click()
        await page.waitForURL((url) => url.pathname === '/projects', { timeout: 45_000 })
        expect(requests.some((row) => row.method === 'POST' && row.path === '/api/auth/login' && row.status === 200)).toBe(true)

        await page.goto(`${ready.url}/projects/${ready.projectId}/scheduling`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('heading', { name: 'AI 排期建议' }).waitFor({ timeout: 45_000 })
        // 列表已接通生产接口且此刻为空：不是「前端假造的空态」。
        await page.getByText(/共 0 条/).waitFor({ timeout: 45_000 })
        expect(await page.getByRole('button', { name: '生成建议', exact: true }).isDisabled()).toBe(false)
        const before = await apiGet(`/projects/${ready.projectId}/workload`)
        expect(before.status).toBe(200)
        workloadBefore = workloadPairs(before.body)
        expect(workloadBefore).toEqual([`${ready.memberUserId}:2`, `${ready.pmUserId}:1`].sort())
      })

      // -----------------------------------------------------------------
      // ② 生成 → 页面显示原始建议（AI 给出的日期）
      // -----------------------------------------------------------------
      await check('② 点「生成建议」→ 页面显示服务端保存的原始 AI 建议，正式计划未被改动', async () => {
        const mark = captured.length
        await page.getByRole('button', { name: '生成建议', exact: true }).click()
        await page.getByText('建议已保存，尚未应用。', { exact: true }).waitFor({ timeout: 60_000 })

        const generation = await bodyAfter(`POST ${wire(basePath)}`, mark)
        expect(generation).toMatchObject({ status: 'PENDING' })
        expect(generation.generation).toMatchObject({ status: 'SUCCEEDED', error: null })
        suggestionId = String(generation.id)
        expect(suggestionId).not.toBe('')

        // 详情里的 changes 就是**回环模型真实产出**的建议（不经过任何测试桩）。
        const detail = await bodyAfter(`GET ${wire(itemPath(suggestionId))}`, mark)
        expect(detail.sourceState).toBe('current')
        expect(detail.changes).toEqual(ordered(ready.expectedProposal))
        for (const change of ready.expectedProposal) {
          const planned = ready.tasksById[change.taskId]!
          expect(detail.tasks).toEqual(expect.arrayContaining([expect.objectContaining({
            id: planned.id, title: planned.title, planStart: planned.planStart, planEnd: planned.planEnd,
          })]))
        }

        // 页面逐行核对：「原计划」列是库里的正式计划；「新开始/新结束」输入框是 AI 原始建议。
        await page.getByRole('heading', { name: '建议与追溯' }).waitFor({ timeout: 30_000 })
        expect(await page.getByText(suggestionId, { exact: true }).count()).toBeGreaterThanOrEqual(1)
        for (const change of ready.expectedProposal) {
          const planned = ready.tasksById[change.taskId]!
          const row = rowOf(planned.title)
          await row.waitFor({ timeout: 30_000 })
          const dates = row.locator('input[type="date"]')
          expect(await dates.nth(0).inputValue()).toBe(change.planStart)
          expect(await dates.nth(1).inputValue()).toBe(change.planEnd)
          const original = (await row.locator('td').first().textContent()) ?? ''
          expect(original).toContain(planned.planStart)
          expect(original).toContain(planned.planEnd)
        }
        await page.screenshot({ path: shot('g6-01-generated.png'), fullPage: true })

        // 生成只产建议：正式计划（含未列入建议的 DOING / CLOSED 任务）一行都没动。
        const afterGeneration = await inspector()
        dbState = afterGeneration
        expect(afterGeneration.modelCalls).toBe(1)
        expect(afterGeneration.outboundCount).toBe(1)
        expect(afterGeneration.tasks).toEqual(ready.tasks)
      })

      // -----------------------------------------------------------------
      // ③ 在页面上编辑日期
      // -----------------------------------------------------------------
      await check('③ 在页面上人工编辑两行日期：改动后「采纳」被禁用，只能走「修改后采纳」', async () => {
        for (const edit of ready.edits) {
          const row = rowOf(ready.tasksById[edit.taskId]!.title)
          const dates = row.locator('input[type="date"]')
          await dates.nth(0).fill(edit.planStart)
          await dates.nth(1).fill(edit.planEnd)
        }
        await page.screenshot({ path: shot('g6-02-edited.png'), fullPage: true })
        expect(await page.getByRole('button', { name: '采纳', exact: true }).isDisabled()).toBe(true)
        // 理由为空时「修改后采纳」也不可用（人工修改必须留痕）。
        expect(await page.getByRole('button', { name: '修改后采纳', exact: true }).isDisabled()).toBe(true)
      })

      // -----------------------------------------------------------------
      // ④ 复核（assessment）
      // -----------------------------------------------------------------
      await check('④ 复核（校验当前日期）：服务端评估通过，负载按「非 CLOSED」口径可见', async () => {
        const mark = captured.length
        await page.getByRole('button', { name: '校验当前日期', exact: true }).click()
        const assessment = await bodyAfter(`POST ${wire(`${itemPath(suggestionId)}/assessment`)}`, mark)
        expect(assessment.state).toBe('ok')
        expect(assessment.assessment).toMatchObject({ canApplyDates: true, blockers: [] })

        // 负载 = 非 CLOSED 任务数（含 DONE），与任务状态口径一致，与日期无关。
        const workload = (assessment.assessment.workload as Array<{ userId: string; openTaskCount: number }>)
          .map((row) => `${row.userId}:${row.openTaskCount}`).sort()
        expect(workload).toEqual([`${ready.memberUserId}:2`, `${ready.pmUserId}:1`].sort())

        await page.getByText(/此评估不是锁/).waitFor({ timeout: 30_000 })
        await page.getByText(/负载含 DONE、不含 CLOSED，不设过载阈值/).waitFor()
        expect(await page.getByText(/阻断：/).count()).toBe(0)
        const rendered = await page.locator('div[aria-live="polite"] li').allTextContents()
        expect(rendered).toEqual(expect.arrayContaining([
          `${ready.memberUserId}：2 项未关闭任务`, `${ready.pmUserId}：1 项未关闭任务`,
        ]))
      })

      // -----------------------------------------------------------------
      // ⑤ 确认（修改后采纳）+ 落库 + 不二次调用模型
      // -----------------------------------------------------------------
      await check('⑤ 填理由后「修改后采纳」：正式计划已应用，且确认阶段不再调用模型', async () => {
        await page.locator('#scheduling-reason').fill(noteText)
        expect(await page.getByRole('button', { name: '修改后采纳', exact: true }).isDisabled()).toBe(false)
        const mark = captured.length
        const sentMark = sent.length
        await page.getByRole('button', { name: '修改后采纳', exact: true }).click()
        await page.getByText('正式计划已应用；正在刷新建议，请核对任务、甘特、负载与审计。', { exact: true })
          .waitFor({ timeout: 60_000 })

        const disposition = await bodyAfter(`POST ${wire(`${itemPath(suggestionId)}/disposition`)}`, mark)
        expect(disposition).toMatchObject({ id: suggestionId, status: 'APPLIED', disposition: 'MODIFIED', application: 'APPLIED' })
        // 浏览器**实际提交**的内容：身份与 requestId 都由服务端上下文/页面生成。
        const submitted = sentAfter(`POST ${wire(`${itemPath(suggestionId)}/disposition`)}`, sentMark)
        expect(submitted).toMatchObject({ status: 'MODIFIED', note: noteText })
        expect(submitted.changes).toEqual(ordered(ready.edits))
        dispositionRequestId = String(submitted.requestId)
        expect(dispositionRequestId).toMatch(/^[0-9a-f-]{36}$/)

        const finalText = (await page.getByText(/最终应用内容：/).textContent()) ?? ''
        for (const edit of ready.edits) expect(finalText).toContain(`${edit.taskId}: ${edit.planStart} — ${edit.planEnd}`)
        await page.screenshot({ path: shot('g6-03-confirmed.png'), fullPage: true })

        const afterConfirm = await inspector()
        dbState = afterConfirm
        expect(afterConfirm.modelCalls).toBe(1) // 确认只应用已保存建议，不二次调用模型
      })

      // -----------------------------------------------------------------
      // ⑥ 审计可追溯（页面 + 接口，含 requestId / 状态 / 前后日期）
      // -----------------------------------------------------------------
      await check('⑥ 审计入口可追溯本次处置：requestId、状态、前后日期齐全', async () => {
        const mark = captured.length
        await page.getByRole('button', { name: '读取审计', exact: true }).click()
        const audit = await bodyAfter(`GET ${wire(`${itemPath(suggestionId)}/audit`)}`, mark)
        const beforeExpected = ready.edits.map((edit) => {
          const planned = ready.tasksById[edit.taskId]!
          return { taskId: edit.taskId, planStart: planned.planStart, planEnd: planned.planEnd }
        })
        expect(audit.items).toHaveLength(1)
        expect(audit.items[0]).toMatchObject({
          projectId: ready.projectId, suggestionId, actorUserId: ready.pmUserId,
          requestId: dispositionRequestId, status: 'MODIFIED', reason: noteText,
        })
        expect(audit.items[0].before).toEqual(ordered(beforeExpected))
        expect(audit.items[0].after).toEqual(ordered(ready.edits))

        // 选择器说明：外层「建议记录」section 里也有 <li>（建议 id · 状态），只用
        // `section` + `has` 会把两者一起收进来（首轮实测拿到 2 条，断言因此失败）。
        // 改为**按内容筛出审计条目**：恰好一条同时含本次理由与处置状态 —— 既不依赖
        // section 嵌套顺序，也不放松「只有一条审计」的约束。
        const auditSection = page.locator('section')
          .filter({ has: page.getByRole('heading', { name: '审计', exact: true }) })
        const lines = (await auditSection.locator('ul li').allTextContents())
          .map((line: string) => line.trim()).filter(Boolean)
        const auditLines = lines.filter((line) => line.includes('MODIFIED') && line.includes(noteText))
        expect(auditLines.length, `审计区 <li> 实际内容：${JSON.stringify(lines)}`).toBe(1)
        await page.screenshot({ path: shot('g6-05-audit.png'), fullPage: true })
      })

      // -----------------------------------------------------------------
      // ⑦ 刷新后仍然持久（服务端真相，不是前端假状态）
      // -----------------------------------------------------------------
      await check('⑦ 刷新页面后建议与已应用日期仍然持久，审计记录仍可读取', async () => {
        const mark = captured.length
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByRole('heading', { name: 'AI 排期建议' }).waitFor({ timeout: 45_000 })
        await page.getByText(/共 1 条/).waitFor({ timeout: 45_000 })
        await page.getByRole('button').filter({ hasText: suggestionId }).click()
        await page.getByText(/最终应用内容：/).waitFor({ timeout: 45_000 })

        // 刷新后详情是**重新从服务端读的**（服务端最终状态，而非留在内存里的对象）。
        const detail = await bodyAfter(`GET ${wire(itemPath(suggestionId))}`, mark)
        expect(detail).toMatchObject({
          id: suggestionId, status: 'APPLIED', disposition: 'MODIFIED', application: 'APPLIED', reason: noteText,
        })
        expect(detail.finalChanges).toEqual(ordered(ready.edits))
        const statusLine = await page.locator('dd').nth(1).textContent()
        expect(statusLine).toBe('APPLIED / APPLIED')
        const finalText = (await page.getByText(/最终应用内容：/).textContent()) ?? ''
        for (const edit of ready.edits) expect(finalText).toContain(`${edit.taskId}: ${edit.planStart} — ${edit.planEnd}`)

        // 刷新后重新读取审计：记录仍在（可追溯不依赖前端的临时状态）。
        await page.getByRole('button', { name: '读取审计', exact: true }).click()
        await page.getByText(new RegExp(noteText)).waitFor({ timeout: 30_000 })
        await page.screenshot({ path: shot('g6-04-after-reload.png'), fullPage: true })
      })

      // -----------------------------------------------------------------
      // ⑧ 任务正式计划确实变为确认后的日期（真实接口 + 任务页）
      // -----------------------------------------------------------------
      await check('⑧ 任务日期确实变为确认后的日期；未列入建议的任务保持原日期', async () => {
        const view = await apiGet(`/projects/${ready.projectId}/tasks`)
        expect(view.status).toBe(200)
        const items = view.body.items as Json[]
        for (const edit of ready.edits) {
          expect(items.find((task) => task.id === edit.taskId))
            .toMatchObject({ planStart: edit.planStart, planEnd: edit.planEnd })
        }
        // 只改被授权的 TODO 任务：DOING 与 CLOSED 任务一行未动。
        for (const untouched of ready.tasks.filter((task) => task.status !== 'TODO')) {
          expect(items.find((task) => task.id === untouched.id))
            .toMatchObject({ status: untouched.status, planStart: untouched.planStart, planEnd: untouched.planEnd })
        }

        await page.goto(`${ready.url}/projects/${ready.projectId}/tasks`, { waitUntil: 'domcontentloaded' })
        for (const edit of ready.edits) {
          const row = rowOf(ready.tasksById[edit.taskId]!.title)
          await row.waitFor({ timeout: 45_000 })
          expect(await row.getByText(edit.planEnd, { exact: true }).count()).toBe(1)
        }
      })

      // -----------------------------------------------------------------
      // ⑨ 甘特日期一致（甘特接口 + 甘特页面）
      // -----------------------------------------------------------------
      await check('⑨ 甘特数据与任务日期一致：同一任务在甘特里也是同一日期', async () => {
        const gantt = await apiGet(`/projects/${ready.projectId}/gantt`)
        expect(gantt.status).toBe(200)
        const rows = (gantt.body.stories as Array<{ tasks: Json[] }>).flatMap((story) => story.tasks)
        for (const edit of ready.edits) {
          expect(rows.find((task) => task.id === edit.taskId))
            .toMatchObject({ planStart: edit.planStart, planEnd: edit.planEnd })
        }

        await page.goto(`${ready.url}/projects/${ready.projectId}/gantt`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: `展开故事「${ready.storyTitle}」的任务` }).click()
        for (const edit of ready.edits) {
          const row = page.locator('.gantt-row--task').filter({ hasText: ready.tasksById[edit.taskId]!.title })
          await row.waitFor({ timeout: 45_000 })
          expect(await row.getByText(`计划 ${edit.planStart} ~ ${edit.planEnd}`, { exact: true }).count()).toBe(1)
        }
        await page.screenshot({ path: shot('g6-06-gantt.png'), fullPage: true })
      })

      // -----------------------------------------------------------------
      // ⑩ 负载计数按状态口径（日期变化不改计数）
      // -----------------------------------------------------------------
      await check('⑩ 负载计数按状态口径不变：日期调整不改变「非 CLOSED 任务数」', async () => {
        const after = await apiGet(`/projects/${ready.projectId}/workload`)
        expect(after.status).toBe(200)
        // 口径：openTaskCount = 该成员名下 status != CLOSED 的任务数（含 DONE）。
        // 本次只改 TODO 任务的计划日期、不动任何状态 ⇒ 计数与处置前**逐字相同**。
        expect(workloadPairs(after.body)).toEqual(workloadBefore)

        await page.goto(`${ready.url}/projects/${ready.projectId}/workload`, { waitUntil: 'domcontentloaded' })
        const row = page.getByRole('row').filter({ hasText: ready.memberDisplayName })
        await row.waitFor({ timeout: 45_000 })
        expect((await row.locator('.wl-count').textContent())?.trim()).toBe('2')
        await page.screenshot({ path: shot('g6-07-workload.png'), fullPage: true })
      })

      // -----------------------------------------------------------------
      // ⑪ 真实库终端状态 + 出流范围 + 控制台
      // -----------------------------------------------------------------
      await check('⑪ 真实库终端状态与出流范围：任务日期已落地、审计/处置/应用各一条、模型仅调用一次', async () => {
        const inspection = await inspector()
        dbState = inspection
        for (const edit of ready.edits) {
          expect(inspection.tasks.find((task) => task.id === edit.taskId))
            .toMatchObject({ planStart: edit.planStart, planEnd: edit.planEnd })
        }
        for (const untouched of ready.tasks.filter((task) => task.status !== 'TODO')) {
          expect(inspection.tasks.find((task) => task.id === untouched.id))
            .toMatchObject({ status: untouched.status, planStart: untouched.planStart, planEnd: untouched.planEnd })
        }
        expect(inspection.suggestions).toHaveLength(1)
        expect(inspection.suggestions[0]).toMatchObject({
          id: suggestionId, status: 'APPLIED', generationStatus: 'SUCCEEDED',
          modelProvider: 'us12-g6-loopback', modelName: ready.modelId, modelMode: 'API', modelExecution: 'EXTERNAL',
        })
        expect(inspection.dispositions).toHaveLength(1)
        expect(inspection.dispositions[0]).toMatchObject({
          suggestionId, status: 'MODIFIED', requestId: dispositionRequestId,
          reason: noteText, disposedByUserId: ready.pmUserId,
        })
        expect(inspection.applications).toHaveLength(1)
        expect(inspection.applications[0]).toMatchObject({ suggestionId, appliedByUserId: ready.pmUserId })
        expect(inspection.audits).toHaveLength(1)
        expect(inspection.audits[0]).toMatchObject({
          projectId: ready.projectId, actorUserId: ready.pmUserId, action: 'scheduling.disposed',
          objectType: 'ai-suggestion', objectId: suggestionId,
        })
        // 出流白名单：整场走查只发过一次模型请求，且只有最小出口字段（无快照/私有约束/敏感基数）。
        expect(inspection.modelCalls).toBe(1)
        expect(inspection.outboundCount).toBe(1)
        expect(inspection.modelInputKeys).toEqual([{
          today: ready.today,
          inputKeys: ['capturedAt', 'dependencies', 'milestones', 'projectId', 'scenario', 'scope', 'tasks', 'workload'],
        }])
        expect(pageErrors).toEqual([])
      })

      const evidence = {
        gate: 'US-12 / #32 门禁 11（G6）真实浏览器走查',
        ranAt: new Date().toISOString(),
        browser: { engine: 'Chrome', version: browserVersion, executablePath: chromePath, driver: 'playwright-core via CDP' },
        stack: {
          ui: `${ready.url}/projects/${ready.projectId}/scheduling`,
          api: ready.apiUrl,
          localStorageTokenKey: 'aim.token',
          apiPrefix: '/api（Vite 代理 rewrite 去掉前缀）',
        },
        dataScope: '全部为合成演示数据（SCHEDULING_AI_DATA_CLASSIFICATION=SYNTHETIC_DEMO）；'
          + '本文件不记录令牌明文、密码、.env 或任何真实数据。',
        suggestionId,
        dispositionRequestId,
        originalProposal: ordered(ready.expectedProposal),
        editedChanges: ordered(ready.edits),
        checks,
        requests,
        consoleErrors,
        pageErrors,
        dbTerminalState: dbState
          ? {
            modelCalls: dbState.modelCalls, tasks: dbState.tasks,
            suggestion: dbState.suggestions.map((row) => ({
              id: row.id, status: row.status, generationStatus: row.generationStatus,
              modelProvider: row.modelProvider, modelName: row.modelName,
              modelMode: row.modelMode, modelExecution: row.modelExecution,
            })),
            dispositions: dbState.dispositions, applications: dbState.applications, audits: dbState.audits,
          }
          : undefined,
        screenshots: ['g6-01-generated.png', 'g6-02-edited.png', 'g6-03-confirmed.png',
          'g6-05-audit.png', 'g6-04-after-reload.png', 'g6-06-gantt.png', 'g6-07-workload.png'],
      }
      nodeFs.writeFileSync(shot('g6-browser-results.json'), JSON.stringify(evidence, null, 2))
      debug(`checks=${checks.length} browser=${browserVersion} url=${page.url()} evidence=${evidenceDir}`)
    } catch (error) {
      try {
        nodeFs.writeFileSync(shot('g6-browser-failure.json'), JSON.stringify({
          error: String(error), checks, requests, consoleErrors, pageErrors, fixtureLog: tail(fixtureLog),
        }, null, 2))
      } catch { /* 失败证据写不出时不遮盖原始错误 */ }
      debug(`失败：${String(error)}`)
      throw error
    } finally {
      if (browser) await browser.close().catch(() => undefined)
      if (fixture.connected) {
        const exited = new Promise<void>((resolve) => { fixture.once('exit', () => resolve()) })
        fixture.send('close')
        const closed = await Promise.race([
          exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20_000)),
        ])
        if (!closed) { fixture.kill('SIGKILL'); await exited }
      }
    }
  }, 300_000)
})
