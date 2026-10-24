import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import Fastify, { type FastifyInstance } from 'fastify'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember, makeProject, makeUser } from '../../../test/http-support.js'
import { createTempDatabase, resetDatabase } from '../../db/test-support.js'
import { registerActorResolver } from '../../auth/actor.js'
import { issueToken } from '../../auth/token.js'
import { registerErrorHandler } from '../../error-handler.js'
import { PrismaAiSuggestionRepository } from '../../db/ai-repository.js'
import { canonicalAiJsonDigest, type AiAuthorizationPort } from '../../shared/ai.js'
import { createAuthorization } from '../authz/permissions.js'
import { applyTaskPlanDates } from '../task/rules.js'
import { createSchedulingGenerator, type SchedulingSuggestionRecord } from './generation.js'
import { createSchedulingReader } from './source.js'
import { createSchedulingVerifier } from './verification.js'
import { createSchedulingWorkflow, type SchedulingWorkflowPorts, type SchedulingDisposition } from './workflow.js'
import { registerSchedulingRoutes } from './plugin.js'

/** Real DB orchestration with explicit TEST-ONLY read/audit/task assembly.
 * These adapters are not production authorization or a replacement for B's shared ports.
 * The final 12 gates remain pending until authoritative assembly and browser/API verification.
 */
let ctx: { app: FastifyInstance; db: PrismaClient; reset(): Promise<void>; dispose(): Promise<void> }
let pm: string, member: string, projectId: string, tasks: string[], suggestionId: string
let h: ReturnType<typeof assembly>
beforeAll(async () => {
  // This file owns a custom test-only workflow. Production buildApp now registers the
  // same routes, so use a bare app here instead of registering this plugin twice.
  const database = createTempDatabase()
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  registerActorResolver(app, database.prisma)
  ctx = { app, db: database.prisma, reset: () => resetDatabase(database.prisma),
    dispose: async () => { await app.close(); await database.dispose() } }
  registerSchedulingRoutes(ctx.app, {
    generate: (input) => h.generate(input),
    workflow: {
      get: (...args) => h.service.get(...args), list: (...args) => h.service.list(...args),
      stats: (...args) => h.service.stats(...args), audit: (...args) => h.service.audit(...args),
      dispose: (...args) => h.service.dispose(...args), assess: (...args) => h.service.assess(...args),
    },
  })
  await ctx.app.ready()
}, 60_000)
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser(ctx.db, 'workflow-pm', 'Synthetic PM')
  member = await makeUser(ctx.db, 'workflow-member', 'Synthetic member')
  projectId = await makeProject(ctx.db, pm, 'Synthetic workflow')
  await makeMember(ctx.db, projectId, member)
  const goal = await ctx.db.businessGoal.create({ data: { projectId, name: 'Goal', sortOrder: 0 } })
  const activity = await ctx.db.userActivity.create({ data: { projectId, goalId: goal.id, name: 'Activity', sortOrder: 0 } })
  const story = await ctx.db.userStory.create({ data: {
    projectId, activityId: activity.id, title: 'Story', roleText: 'r', capabilityText: 'c', valueText: 'v', businessValue: 'b', priority: 'P1',
  } })
  tasks = []
  for (let i = 0; i < 2; i++) tasks.push((await ctx.db.task.create({ data: {
    projectId, storyId: story.id, title: `Synthetic ${i}`, status: 'TODO', ownerUserId: member,
    acceptorUserId: pm, planStart: '2026-10-23', planEnd: '2026-10-25',
  } })).id)
  h = assembly()
  suggestionId = (await h.generate({ projectId, actorUserId: pm, requestId: randomUUID() })).id
})
function assembly() {
  const repository = new PrismaAiSuggestionRepository<SchedulingSuggestionRecord>(ctx.db)
  const permission = async (tx: Prisma.TransactionClient, actor: string, project: string) => {
    const decision = await createAuthorization(tx).can(actor, 'ai.suggestion.dispose', { kind: 'project', projectId: project })
    return decision.allow ? { allow: true as const } : { allow: false as const, status: decision.status, code: decision.code }
  }
  const authorize = async (tx: Prisma.TransactionClient, actor: string, project: string) => {
    const decision = await permission(tx, actor, project)
    if (!decision.allow) throw new Error(decision.code)
  }
  const reader = createSchedulingReader(authorize)
  const now = () => new Date('2026-10-22T02:00:00Z')
  const authorization = (tx: Prisma.TransactionClient): AiAuthorizationPort => ({
    async decide(actor, capability, ref) {
      // TEST-ONLY audit authorization seam. No production audit adapter is inferred.
      const action = capability === 'ai.suggestion.generate' ? 'ai.suggestion.generate' : 'ai.suggestion.dispose'
      const decision = await createAuthorization(tx).can(actor, action, { kind: 'project', projectId: ref.projectId })
      return decision.allow ? { allow: true } : { allow: false, status: decision.status, code: decision.code }
    },
  })
  const transaction = <T,>(work: (tx: Prisma.TransactionClient) => Promise<T>) => ctx.db.$transaction(work)
  const descriptor = { provider: 'test-only', model: 'test-model', version: '未提供', mode: 'STUB' as const, execution: 'LOCAL' as const }
  const model = { descriptor, generate: vi.fn(async (r: { requestId: string }) => ({ requestId: r.requestId, descriptor,
    output: { changes: tasks.map((taskId) => ({ taskId, planStart: '2026-10-24', planEnd: '2026-10-25' })) } })) }
  const failure = vi.fn(async () => {})
  const verify = vi.fn(createSchedulingVerifier(authorize))
  const writeDates = vi.fn(applyTaskPlanDates)
  const ports: SchedulingWorkflowPorts<Prisma.TransactionClient> = {
    transaction, authorization, repository, readSource: reader, verify, writeDates, now,
    readAuthorization: (tx, actor, ref) => permission(tx, actor, ref.projectId),
    async appendAudit(tx, entry) {
      await tx.auditLog.create({ data: { projectId: entry.projectId, actorUserId: entry.actorUserId,
        action: 'test.scheduling.disposed', objectType: 'aiSuggestion', objectId: entry.suggestionId,
        before: JSON.stringify(entry.before), after: JSON.stringify(entry) } })
    },
    async readAudit(tx, project, suggestion) {
      const rows = await tx.auditLog.findMany({ where: { projectId: project, objectId: suggestion, action: 'test.scheduling.disposed' } })
      return rows.map((row) => JSON.parse(row.after!))
    },
    recordFailure: failure,
  }
  const generate = createSchedulingGenerator({ ...ports, model, newId: randomUUID, dataClassification: 'SYNTHETIC_DEMO' })
  return { ports, repository, verify, writeDates, failure, model, generate, service: createSchedulingWorkflow(ports) }
}
function disposition(status: SchedulingDisposition['status'] = 'ACCEPTED'): SchedulingDisposition {
  const base = { projectId, suggestionId, requestId: randomUUID() }
  if (status === 'MODIFIED') return { ...base, status, note: 'Synthetic change', changes: tasks.map((taskId) => ({ taskId, planStart: '2026-10-25', planEnd: '2026-10-26' })) }
  if (status === 'REJECTED') return { ...base, status, note: 'Synthetic rejection' }
  return { ...base, status }
}
async function record() { return (await h.repository.findById(suggestionId))! }

describe('C scheduling disposition and read composition, real SQLite/test assembly', () => {
  it('accepts both tasks + application + success audit in one caller transaction', async () => {
    const original = (await record()).suggestion
    const receipt = await h.service.dispose(pm, disposition())
    expect(receipt).toMatchObject({ status: 'APPLIED', application: 'APPLIED', disposition: 'ACCEPTED' })
    expect(await ctx.db.task.count({ where: { id: { in: tasks }, planStart: '2026-10-24' } })).toBe(2)
    expect(await ctx.db.auditLog.count()).toBe(1)
    expect((await record()).suggestion).toEqual(original)
    expect(h.model.generate).toHaveBeenCalledTimes(1)
  })
  it('stores modifications separately without changing the model proposal', async () => {
    const original = (await record()).suggestion
    await h.service.dispose(pm, disposition('MODIFIED'))
    const saved = await record()
    expect(saved.suggestion).toEqual(original)
    expect(saved.disposition.finalContent!.changes[0]!.planStart).toBe('2026-10-25')
  })
  it('replays after its own plan update without stale checks, writes or duplicate audit', async () => {
    const input = disposition()
    const first = await h.service.dispose(pm, input)
    const second = await h.service.dispose(pm, input)
    expect(second).toEqual(first)
    expect(h.verify).toHaveBeenCalledTimes(1)
    expect(h.writeDates).toHaveBeenCalledTimes(1)
    expect(await ctx.db.auditLog.count()).toBe(1)
  })
  it('normalizes modification order when identifying the same request', async () => {
    const input = disposition('MODIFIED')
    if (input.status !== 'MODIFIED') throw new Error('fixture')
    const first = await h.service.dispose(pm, input)
    expect(await h.service.dispose(pm, { ...input, changes: [...input.changes].reverse() })).toEqual(first)
  })
  it('denies revoked PM before replaying a previously successful request', async () => {
    const input = disposition()
    await h.service.dispose(pm, input)
    await ctx.db.projectMember.update({ where: { projectId_userId: { projectId, userId: pm } }, data: { role: 'MEMBER' } })
    await expect(h.service.dispose(pm, input)).rejects.toMatchObject({ status: 403 })
  })
  it('rejects a different request or digest after final disposition', async () => {
    const input = disposition('REJECTED')
    await h.service.dispose(pm, input)
    await expect(h.service.dispose(pm, disposition('REJECTED'))).rejects.toMatchObject({ status: 409 })
    await expect(h.service.dispose(pm, { ...input, note: 'Changed reason' })).rejects.toMatchObject({ status: 409 })
  })
  it('allows rejection of stale source without verification/date writing or another model call', async () => {
    await ctx.db.task.update({ where: { id: tasks[0] }, data: { status: 'DOING' } })
    const before = await ctx.db.task.findMany({ where: { projectId }, orderBy: { id: 'asc' } })
    const result = await h.service.dispose(pm, disposition('REJECTED'))
    expect(result).toMatchObject({ status: 'DISPOSED', application: 'NOT_APPLICABLE' })
    expect(h.verify).not.toHaveBeenCalled()
    expect(h.writeDates).not.toHaveBeenCalled()
    expect(await ctx.db.task.findMany({ where: { projectId }, orderBy: { id: 'asc' } })).toEqual(before)
    expect(h.model.generate).toHaveBeenCalledTimes(1)
  })
  it('refuses acceptance when source changed and leaves disposition pending', async () => {
    await ctx.db.task.update({ where: { id: tasks[0] }, data: { status: 'DOING' } })
    await expect(h.service.dispose(pm, disposition())).rejects.toMatchObject({ reason: 'SOURCE_STALE' })
    expect((await record()).status).toBe('PENDING')
    expect(await ctx.db.auditLog.count()).toBe(0)
  })
  it('rejects changes outside the original suggestion even for an accessible task', async () => {
    const original = (await record()).snapshot.data.source.tasks[0]!
    const extra = await ctx.db.task.create({ data: { projectId, storyId: original.storyId!, title: 'Extra',
      ownerUserId: member, acceptorUserId: pm, planStart: '2026-10-23', planEnd: '2026-10-25' } })
    const input = disposition('MODIFIED')
    if (input.status !== 'MODIFIED') throw new Error('fixture')
    input.changes[0]!.taskId = extra.id
    await expect(h.service.dispose(pm, input)).rejects.toMatchObject({ status: 409 }) // Source addition itself makes the whole baseline stale.
    expect((await record()).status).toBe('PENDING')
  })
  it.each(['audit', 'write', 'application'] as const)('rolls back all persisted work on %s failure', async (part) => {
    if (part === 'audit') h.ports.appendAudit = async () => { throw new Error('test audit failure') }
    if (part === 'write') h.ports.writeDates = async (tx, project, changes) => {
      await applyTaskPlanDates(tx, project, [changes[0]!])
      throw new Error('test write failure')
    }
    if (part === 'application') h.ports.repository = new Proxy(h.repository, {
      get(target, key) { return key === 'updateApplication' ? async () => null : Reflect.get(target, key, target) },
    })
    await expect(h.service.dispose(pm, disposition())).rejects.toThrow()
    expect((await record()).status).toBe('PENDING')
    expect(await ctx.db.aiDisposition.count()).toBe(0)
    expect(await ctx.db.aiApplication.count()).toBe(0)
    expect(await ctx.db.task.count({ where: { projectId, planStart: '2026-10-23' } })).toBe(2)
    expect(await ctx.db.auditLog.count()).toBe(0)
    expect(h.failure).toHaveBeenCalledOnce()
  })
  it('remains unavailable without success audit/date ports', async () => {
    h.ports.appendAudit = undefined
    await expect(h.service.dispose(pm, disposition('REJECTED'))).rejects.toThrow('排期能力暂不可用')
    h.ports.appendAudit = async () => {}
    h.ports.writeDates = undefined
    await expect(h.service.dispose(pm, disposition())).rejects.toThrow('排期能力暂不可用')
    expect((await record()).status).toBe('PENDING')
  })
  it('does not allow a corrupt protected fingerprint to authorize a plan write', async () => {
    await ctx.db.aiSuggestion.update({ where: { id: suggestionId }, data: { snapshotFingerprint: 'wrong' } })
    await expect(h.service.dispose(pm, disposition())).rejects.toThrow('排期能力暂不可用')
    expect(h.writeDates).not.toHaveBeenCalled()
  })
  it('returns safe detail/list/stats/audit projections only after specialized authorization', async () => {
    const input = { projectId, suggestionId }
    const detail = await h.service.get(pm, input)
    expect(detail.sourceState).toBe('current')
    expect(detail.tasks).toHaveLength(2)
    expect(JSON.stringify(detail)).not.toMatch(/serverPrivate|sourceRevision|constraintDigest|pmProtected|fingerprint/)
    const page = await h.service.list(pm, { projectId, limit: 1 })
    expect(page).toMatchObject({ total: 1, limit: 1, truncated: false })
    expect(page.items[0]).not.toHaveProperty('snapshot')
    expect((await h.service.stats(pm, projectId)).pending).toBe(1)
    await h.service.dispose(pm, disposition('REJECTED'))
    expect(await h.service.audit(pm, input)).toHaveLength(1)
    h.ports.readAuthorization = undefined
    await expect(h.service.get(pm, input)).rejects.toMatchObject({ status: 403 })
    await expect(h.service.list(pm, { projectId })).rejects.toMatchObject({ status: 403 })
    await expect(h.service.stats(pm, projectId)).rejects.toMatchObject({ status: 403 })
    await expect(h.service.audit(pm, input)).rejects.toMatchObject({ status: 403 })
  })
  it('refuses MEMBER reads/disposal and hides project/scenario mismatch', async () => {
    await expect(h.service.get(member, { projectId, suggestionId })).rejects.toMatchObject({ status: 403 })
    await expect(h.service.dispose(member, disposition())).rejects.toMatchObject({ status: 403 })
    await expect(h.service.get(pm, { projectId: 'other', suggestionId })).rejects.toMatchObject({ status: 404 })
    await ctx.db.aiSuggestion.update({ where: { id: suggestionId }, data: { scenario: 'REQUIREMENT_BREAKDOWN' } })
    await expect(h.service.get(pm, { projectId, suggestionId })).rejects.toMatchObject({ status: 404 })
  })
  it('fails closed instead of inventing exact totals when listPage is absent', async () => {
    h.ports.repository = new Proxy(h.repository, { get(target, key) { return key === 'listPage' ? undefined : Reflect.get(target, key, target) } })
    await expect(h.service.list(pm, { projectId })).rejects.toThrow('排期能力暂不可用')
  })
  it('HTTP routes authenticate, reject actor injection, return 422 and support stale rejection', async () => {
    const path = `/projects/${projectId}/scheduling-suggestions`
    const pmToken = await issueToken(ctx.db, pm)
    const memberToken = await issueToken(ctx.db, member)
    const client = {
      get: (url: string) => request(ctx.app.server).get(url).set('Authorization', `Bearer ${pmToken}`),
      post: (url: string) => request(ctx.app.server).post(url).set('Authorization', `Bearer ${pmToken}`),
    }
    expect((await request(ctx.app.server).get(path)).status).toBe(401)
    expect((await client.post(path).send({ requestId: 'r', actorUserId: member })).status).toBe(422)
    expect((await request(ctx.app.server).get(path).set('Authorization', `Bearer ${memberToken}`)).status).toBe(403)
    expect((await client.get(`${path}/${suggestionId}`)).status).toBe(200)
    expect((await client.post(`${path}/${suggestionId}/disposition`).send({ requestId: 'reject', status: 'REJECTED', note: ' ' })).status).toBe(422)
    await ctx.db.task.update({ where: { id: tasks[0] }, data: { status: 'DOING' } })
    const response = await client.post(`${path}/${suggestionId}/disposition`).send({ requestId: 'reject', status: 'REJECTED', note: 'Stale' })
    expect(response.status).toBe(200)
    expect(response.body.application).toBe('NOT_APPLICABLE')
  })
  it('assesses the saved task scope without leaking private revisions or writing disposition', async () => {
    const changes = (await record()).suggestion!.changes
    const result = await h.service.assess(pm, { projectId, suggestionId, changes })
    expect(result.state).toBe('ok')
    expect(result.assessment?.canApplyDates).toBe(true)
    expect(result.assessment?.warnings.some((warning) => warning.code === 'OWNER_DATE_OVERLAP')).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/sourceRevision|constraintDigest|serverPrivate/)
    expect(await ctx.db.aiDisposition.count()).toBe(0)
    expect(h.writeDates).not.toHaveBeenCalled()
    await expect(h.service.assess(member, { projectId, suggestionId, changes })).rejects.toMatchObject({ status: 403 })
  })
  it('allows only one final disposition under concurrent requests and keeps replay safe', async () => {
    const first = disposition('REJECTED')
    const second = disposition('REJECTED')
    const results = await Promise.allSettled([h.service.dispose(pm, first), h.service.dispose(pm, second)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await ctx.db.aiDisposition.count()).toBe(1)
    expect(await ctx.db.auditLog.count()).toBe(1)
    const winner = (await record()).disposition.requestId === first.requestId ? first : second
    expect(await h.service.dispose(pm, winner)).toMatchObject({ disposition: 'REJECTED' })
  })
  it('does not treat another PM as the same request identity', async () => {
    const otherPm = await makeUser(ctx.db, 'another-pm', 'Synthetic second PM')
    await makeMember(ctx.db, projectId, otherPm, 'PM')
    const input = disposition('REJECTED')
    await h.service.dispose(pm, input)
    await expect(h.service.dispose(otherPm, input)).rejects.toMatchObject({ status: 409 })
    expect((await record()).disposition.disposedByUserId).toBe(pm)
  })
  it('does not silently resume a foreign half-committed application', async () => {
    await h.service.dispose(pm, disposition())
    await ctx.db.aiSuggestion.update({ where: { id: suggestionId }, data: { status: 'APPLICATION_FAILED' } })
    const saved = await record()
    await expect(h.service.dispose(pm, { projectId, suggestionId, requestId: saved.disposition.requestId!, status: 'ACCEPTED' }))
      .rejects.toMatchObject({ reason: 'INCOMPLETE_PREVIOUS_APPLICATION' })
    expect(h.writeDates).toHaveBeenCalledTimes(1)
  })
  it('keeps independent failure-evidence errors visible', async () => {
    h.ports.appendAudit = async () => { throw new Error('audit down') }
    h.ports.recordFailure = async () => { throw new Error('failure evidence down') }
    await expect(h.service.dispose(pm, disposition())).rejects.toThrow('failure evidence down')
    expect((await record()).status).toBe('PENDING')
  })
  it('checks exactly the shared snapshot digest, not the internal source revision', async () => {
    const saved = await record()
    expect(saved.snapshot.fingerprint).toBe(canonicalAiJsonDigest(saved.snapshot.data))
    expect(saved.snapshot.fingerprint).not.toBe(saved.snapshot.data.verification.sourceRevision)
  })
})
