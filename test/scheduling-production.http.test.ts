/** B's production assembly regression: real buildApp, temp SQLite and HTTP routes.
 * Real temp SQLite + real HTTP routes + explicit synthetic model port.
 * Synthetic loopback/injected model is NOT a real vendor/model acceptance.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { hashToken } from '../src/auth/token.js'
import { createTempDatabase, resetDatabase, type TestDatabase } from '../src/db/test-support.js'
import type { AiGenerationRequest, AiModelPort, AiProviderDescriptor } from '../src/shared/ai.js'
import { makeMember, makeProject, makeUser } from './http-support.js'

let db: TestDatabase
let configured: FastifyInstance
let unconfigured: FastifyInstance
let uploadRoot: string
let pm: string, member: string, viewer: string, outsider: string
let projectId: string, outsiderProjectId: string, taskIds: string[]
let modelInputs: unknown[] = []

function syntheticModel(): AiModelPort {
  const descriptor: AiProviderDescriptor = {
    provider: 'synthetic-b-probe', model: 'synthetic-scheduling-model', version: '未提供',
    mode: 'API', execution: 'EXTERNAL',
  }
  return {
    descriptor,
    async generate(req: AiGenerationRequest) {
      modelInputs.push(structuredClone(req.input))
      const input = req.input as { tasks: Array<{ id: string; status: string }> }
      const todo = input.tasks.filter((task) => task.status === 'TODO').map((task) => task.id)
      return { requestId: req.requestId, descriptor, output: {
        changes: todo.map((id) => ({ taskId: id, planStart: '2099-02-01', planEnd: '2099-02-02' })) } }
    },
  }
}

beforeAll(async () => {
  db = createTempDatabase()
  uploadRoot = mkdtempSync(join(tmpdir(), 'probe-b-s3-uploads-'))
  configured = buildApp({ logger: false, prisma: db.prisma, uploadRoot,
    scheduling: { model: syntheticModel(), dataClassification: 'SYNTHETIC_DEMO' } })
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SCHEDULING_AI_')) { saved[key] = process.env[key]; delete process.env[key] }
  }
  unconfigured = buildApp({ logger: false, prisma: db.prisma, uploadRoot })
  for (const [key, value] of Object.entries(saved)) process.env[key] = value
  await configured.ready()
  await unconfigured.ready()
}, 120_000)

afterAll(async () => {
  await configured.close()
  await unconfigured.close()
  await db.dispose()
  rmSync(uploadRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  await resetDatabase(db.prisma)
  modelInputs = []
  pm = await makeUser(db.prisma, 'probe-pm', 'Probe PM')
  member = await makeUser(db.prisma, 'probe-member', 'Probe member')
  viewer = await makeUser(db.prisma, 'probe-viewer', 'Probe viewer')
  outsider = await makeUser(db.prisma, 'probe-outsider', 'Probe outsider')
  projectId = await makeProject(db.prisma, pm, 'Probe scheduling')
  await makeMember(db.prisma, projectId, member, 'MEMBER')
  await makeMember(db.prisma, projectId, viewer, 'VIEWER')
  outsiderProjectId = await makeProject(db.prisma, outsider, 'Outsider project')
  const goal = await db.prisma.businessGoal.create({ data: { projectId, name: 'Goal', sortOrder: 0 } })
  const activity = await db.prisma.userActivity.create({ data: { projectId, goalId: goal.id, name: 'Activity', sortOrder: 0 } })
  const story = await db.prisma.userStory.create({ data: { projectId, activityId: activity.id,
    title: 'Story', roleText: 'r', capabilityText: 'c', valueText: 'v', businessValue: 'b', priority: 'P1' } })
  taskIds = []
  for (let i = 0; i < 2; i++) taskIds.push((await db.prisma.task.create({ data: {
    projectId, storyId: story.id, title: `Synthetic ${i}`, status: 'TODO', ownerUserId: member,
    acceptorUserId: pm, planStart: '2099-01-01', planEnd: '2099-01-05',
  } })).id)
})

async function login(userId: string): Promise<string> {
  const token = `probe-token-${userId}`
  await db.prisma.user.update({ where: { id: userId }, data: {
    sessionTokenHash: hashToken(token),
    sessionTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  } })
  return token
}
function as(app: FastifyInstance, token: string | null) {
  const wrap = (t: request.Test) => (token ? t.set('Authorization', `Bearer ${token}`) : t)
  return {
    get: (url: string) => wrap(request(app.server).get(url)),
    post: (url: string) => wrap(request(app.server).post(url)),
  }
}
const base = () => `/projects/${projectId}/scheduling-suggestions`

async function generate(app: FastifyInstance = configured): Promise<string> {
  const token = await login(pm)
  const response = await as(app, token).post(base()).send({ requestId: randomUUID() })
  expect(response.status).toBe(201)
  return response.body.id as string
}

describe('B production scheduling assembly (buildApp)', () => {
  it('registers the seven scheduling routes on the real app', () => {
    const pattern = '/projects/:projectId/scheduling-suggestions'
    const routes: Array<[string, string]> = [
      ['POST', pattern], ['GET', pattern], ['GET', `${pattern}/stats`],
      ['GET', `${pattern}/:suggestionId`], ['GET', `${pattern}/:suggestionId/audit`],
      ['POST', `${pattern}/:suggestionId/assessment`], ['POST', `${pattern}/:suggestionId/disposition`],
    ]
    for (const [method, url] of routes) expect(configured.hasRoute({ method, url })).toBe(true)
  })

  it('returns 401 for all seven routes when unauthenticated', async () => {
    const client = as(configured, null)
    const responses = [
      await client.post(base()).send({ requestId: 'r' }), await client.get(base()), await client.get(`${base()}/stats`),
      await client.get(`${base()}/x`), await client.get(`${base()}/x/audit`),
      await client.post(`${base()}/x/assessment`).send({ changes: [] }),
      await client.post(`${base()}/x/disposition`).send({ requestId: 'r', status: 'REJECTED', note: 'n' }),
    ]
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401])
  })

  it('lets PM list and read stats for its own project', async () => {
    await generate()
    const token = await login(pm)
    const list = await as(configured, token).get(base())
    expect(list.status).toBe(200)
    expect(list.body.total).toBe(1)
    expect(list.body.items[0]).toMatchObject({ status: 'PENDING' })
    const stats = await as(configured, token).get(`${base()}/stats`)
    expect(stats.status).toBe(200)
    expect(stats.body.pending).toBe(1)
  })

  it('gives MEMBER and VIEWER 403 and outsider 404 on the same project', async () => {
    await generate()
    for (const userId of [member, viewer]) {
      const token = await login(userId)
      expect((await as(configured, token).get(base())).status).toBe(403)
      expect((await as(configured, token).post(base()).send({ requestId: randomUUID() })).status).toBe(403)
    }
    const outsiderToken = await login(outsider)
    expect((await as(configured, outsiderToken).get(base())).status).toBe(404)
    expect((await as(configured, outsiderToken).post(base()).send({ requestId: randomUUID() })).status).toBe(404)
    expect(outsiderProjectId).not.toBe(projectId)
  })

  it('records GENERATION_FAILED (not fake success) when no model is configured', async () => {
    const token = await login(pm)
    const response = await as(unconfigured, token).post(base()).send({ requestId: randomUUID() })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ status: 'GENERATION_FAILED',
      generation: { status: 'FAILED', error: { code: 'AI_SERVICE_UNAVAILABLE', retryable: true } } })
    const detail = await as(unconfigured, token).get(`${base()}/${response.body.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.suggestion ?? null).toBeNull()
    expect(detail.body.changes).toEqual([])
  })

  it('runs generate -> assess -> accept -> audit -> replay -> revoke over HTTP', async () => {
    const suggestionId = await generate()
    const token = await login(pm)
    const changes = taskIds.map((taskId) => ({ taskId, planStart: '2099-02-01', planEnd: '2099-02-02' }))
    const assess = await as(configured, token).post(`${base()}/${suggestionId}/assessment`).send({ changes })
    expect(assess.status).toBe(200)
    expect(assess.body.state).toBe('ok')
    const requestId = randomUUID()
    const first = await as(configured, token).post(`${base()}/${suggestionId}/disposition`)
      .send({ requestId, status: 'ACCEPTED' })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ status: 'APPLIED', disposition: 'ACCEPTED', application: 'APPLIED' })
    const tasks = await db.prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' } })
    expect(tasks.map((task) => task.planStart)).toEqual(['2099-02-01', '2099-02-01'])
    expect(tasks.every((task) => task.status === 'TODO')).toBe(true) // date-only write did not enter DOING/FS
    expect(await db.prisma.auditLog.count()).toBe(1)
    const replay = await as(configured, token).post(`${base()}/${suggestionId}/disposition`)
      .send({ requestId, status: 'ACCEPTED' })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(await db.prisma.auditLog.count()).toBe(1)
    const audit = await as(configured, token).get(`${base()}/${suggestionId}/audit`)
    expect(audit.status).toBe(200)
    expect(audit.body.items).toHaveLength(1)
    // Revoke PM, then a replay of a previously successful request is denied.
    await db.prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: pm } }, data: { role: 'MEMBER' } })
    const revoked = await as(configured, token).post(`${base()}/${suggestionId}/disposition`)
      .send({ requestId, status: 'ACCEPTED' })
    expect(revoked.status).toBe(403)
  })

  it('supports MODIFIED and REJECTED dispositions with success audit', async () => {
    const token = await login(pm)
    const modifiedId = await generate()
    const modified = await as(configured, token).post(`${base()}/${modifiedId}/disposition`).send({
      requestId: randomUUID(), status: 'MODIFIED', note: 'shift later',
      changes: taskIds.map((taskId) => ({ taskId, planStart: '2099-03-10', planEnd: '2099-03-11' })),
    })
    expect(modified.status).toBe(200)
    expect(modified.body).toMatchObject({ status: 'APPLIED', disposition: 'MODIFIED' })
    expect(await db.prisma.auditLog.count()).toBe(1)
    const rejectedId = await generate()
    const before = await db.prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' } })
    const rejected = await as(configured, token).post(`${base()}/${rejectedId}/disposition`)
      .send({ requestId: randomUUID(), status: 'REJECTED', note: 'not now' })
    expect(rejected.status).toBe(200)
    expect(rejected.body).toMatchObject({ status: 'DISPOSED', disposition: 'REJECTED', application: 'NOT_APPLICABLE' })
    expect(await db.prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' } })).toEqual(before)
    expect(await db.prisma.auditLog.count()).toBe(2)
  })

  it('fails a stale acceptance with 409 and leaves no partial disposition/date/audit writes', async () => {
    const suggestionId = await generate()
    const token = await login(pm)
    const before = await db.prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' } })
    await db.prisma.task.update({ where: { id: taskIds[0] }, data: { status: 'DOING' } })
    const response = await as(configured, token).post(`${base()}/${suggestionId}/disposition`)
      .send({ requestId: randomUUID(), status: 'ACCEPTED' })
    expect(response.status).toBe(409)
    expect(await db.prisma.aiDisposition.count()).toBe(0)
    expect(await db.prisma.aiApplication.count()).toBe(0)
    expect(await db.prisma.auditLog.count()).toBe(0)
    const after = await db.prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' } })
    expect(after.find((task) => task.id === taskIds[1])).toEqual(before.find((task) => task.id === taskIds[1]))
  })
  it('rolls back dates, disposition and application if the final audit append fails', async () => {
    const suggestionId = await generate()
    const token = await login(pm)
    const before = await db.prisma.task.findMany({ where: { projectId }, orderBy: { id: 'asc' } })
    await db.prisma.$executeRawUnsafe(`CREATE TRIGGER reject_scheduling_audit
      BEFORE INSERT ON AuditLog WHEN NEW.action = 'scheduling.disposed'
      BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`)
    try {
      const response = await as(configured, token).post(`${base()}/${suggestionId}/disposition`)
        .send({ requestId: randomUUID(), status: 'ACCEPTED' })
      expect(response.status).toBe(500)
      expect(await db.prisma.task.findMany({ where: { projectId }, orderBy: { id: 'asc' } })).toEqual(before)
      expect(await db.prisma.aiSuggestion.findUnique({ where: { id: suggestionId } })).toMatchObject({ status: 'PENDING' })
      expect(await db.prisma.aiDisposition.count()).toBe(0)
      expect(await db.prisma.aiApplication.count()).toBe(0)
      expect(await db.prisma.auditLog.count()).toBe(0)
    } finally { await db.prisma.$executeRawUnsafe('DROP TRIGGER reject_scheduling_audit') }
  })

  it('keeps sensitive tasks out of the model and blocks a protected FS violation atomically', async () => {
    const task = await db.prisma.task.findUniqueOrThrow({ where: { id: taskIds[0] } })
    const hidden = await db.prisma.task.create({ data: {
      projectId, storyId: task.storyId, title: 'SENSITIVE-PREDECESSOR-NOT-FOR-MODEL',
      ownerUserId: member, acceptorUserId: pm, status: 'CLOSED', isSensitive: true,
      planStart: '2099-02-01', planEnd: '2099-02-10',
    } })
    await db.prisma.taskDependency.create({ data: {
      projectId, predecessorTaskId: hidden.id, successorTaskId: task.id, type: 'FS',
    } })
    const suggestionId = await generate()
    const input = JSON.stringify(modelInputs)
    expect(input).not.toContain(hidden.id)
    expect(input).not.toContain(hidden.title)
    expect(input).not.toContain('serverPrivate')
    expect(input).not.toContain('excludedSensitiveCount')
    const token = await login(pm)
    const response = await as(configured, token).post(`${base()}/${suggestionId}/disposition`)
      .send({ requestId: randomUUID(), status: 'ACCEPTED' })
    expect(response.status).toBe(422)
    expect(JSON.stringify(response.body)).not.toContain(hidden.id)
    expect(JSON.stringify(response.body)).not.toContain(hidden.title)
    expect(await db.prisma.aiDisposition.count()).toBe(0)
    expect(await db.prisma.aiApplication.count()).toBe(0)
    expect(await db.prisma.auditLog.count()).toBe(0)
    expect(await db.prisma.task.findUnique({ where: { id: taskIds[0] } })).toMatchObject({ planStart: '2099-01-01' })
  })

  it('denies every suggestion operation for MEMBER/VIEWER and foreign-project identity', async () => {
    const suggestionId = await generate()
    for (const [user, status] of [[member, 403], [viewer, 403], [outsider, 404]] as const) {
      const client = as(configured, await login(user))
      const responses = [
        await client.get(base()), await client.get(`${base()}/stats`),
        await client.get(`${base()}/${suggestionId}`), await client.get(`${base()}/${suggestionId}/audit`),
        await client.post(base()).send({ requestId: randomUUID() }),
        await client.post(`${base()}/${suggestionId}/assessment`).send({
          changes: [{ taskId: taskIds[0], planStart: '2099-02-01', planEnd: '2099-02-02' }],
        }),
        await client.post(`${base()}/${suggestionId}/disposition`).send({
          requestId: randomUUID(), status: 'REJECTED', note: 'unauthorized',
        }),
      ]
      expect(responses.map((response) => response.status)).toEqual(Array(7).fill(status))
    }
    const token = await login(pm)
    const crossProject = await as(configured, token).get(
      `/projects/${outsiderProjectId}/scheduling-suggestions/${suggestionId}`)
    expect(crossProject.status).toBe(404)
    expect(await db.prisma.aiDisposition.count()).toBe(0)
  })

  it('emits a minimal scheduling HTTP>=400 safety log covering read/audit denials', async () => {
    const suggestionId = await generate()
    const warns: unknown[][] = []
    const log = configured.log as unknown as { warn: (...args: unknown[]) => void }
    const original = log.warn
    log.warn = (...args: unknown[]) => { warns.push(args) }
    try {
      const memberToken = await login(member)
      const bodyMarker = 'do-not-log-body-marker'
      expect((await as(configured, memberToken).get(base())).status).toBe(403)
      expect((await as(configured, memberToken).get(`${base()}/${suggestionId}/audit`)).status).toBe(403)
      expect((await as(configured, memberToken).post(base()).send({ requestId: bodyMarker })).status).toBe(403)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const entries = warns.filter((args) => typeof args[0] === 'object' && args[0] !== null
        && String((args[0] as Record<string, unknown>).code).startsWith('HTTP_'))
      expect(entries.length).toBeGreaterThanOrEqual(3) // list + audit + generate, all denied 403
      for (const args of entries) {
        const fields = args[0] as Record<string, unknown>
        expect(Object.keys(fields).sort()).toEqual([ 'actorUserId', 'code', 'projectId', 'requestId' ].sort())
        expect(fields.projectId).toBe(projectId)
        for (const forbidden of ['cause', 'err', 'stack', 'body']) expect(fields).not.toHaveProperty(forbidden)
      }
      // The client body value only ever appears as the domain idempotency requestId on the
      // pre-existing generation failure sink, never as raw body/cause on the HTTP hook.
      expect(entries.every((args) => (args[0] as Record<string, unknown>).requestId !== bodyMarker)).toBe(true)
    } finally { log.warn = original }
  })
})
