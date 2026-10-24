import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Prisma } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHttpTestContext, makeMember, makeProject, makeUser, type HttpTestContext } from '../../../test/http-support.js'
import { PrismaAiSuggestionRepository } from '../../db/ai-repository.js'
import type { AiAuthorizationPort } from './contracts.js'
import { createAuthorization } from '../authz/permissions.js'
import { createSchedulingGenerator, type SchedulingSuggestionRecord } from '../ai-scheduling/generation.js'
import { createSchedulingReader } from '../ai-scheduling/source.js'
import { createSchedulingAiModelPort } from './factory.js'

/** Compatibility evidence only: real HTTP transport + actual C generator/reader + SQLite.
 * A synthetic loopback completion server and test-only tx authorization are explicit.
 * This does NOT register production routes, replace B assembly or satisfy C's 12 gates.
 */
let ctx: HttpTestContext
let endpoint: string, pm: string, member: string, projectId: string, taskId: string
let httpCalls = 0
let responseMode: 'ok' | 'invalid' | 'fail' | 'revoke' | 'change-source' = 'ok'
const modelInputs: unknown[] = []
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk.toString()
  const body = JSON.parse(raw)
  modelInputs.push(JSON.parse(body.messages[1].content).input)
  httpCalls++
  if (responseMode === 'fail') { res.statusCode = 503; res.end('secret-error-not-for-storage'); return }
  if (responseMode === 'revoke') await ctx.db.projectMember.delete({ where: { projectId_userId: { projectId, userId: pm } } })
  if (responseMode === 'change-source') await ctx.db.task.update({ where: { id: taskId }, data: { title: 'Changed after model start' } })
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ model: 'synthetic-scheduling-http', choices: [{ finish_reason: 'stop', message: {
    role: 'assistant', content: JSON.stringify({ changes: [{
      taskId: responseMode === 'invalid' ? 'invented-task' : taskId,
      planStart: '2099-02-01', planEnd: '2099-02-02',
    }] }),
  } }] }))
})
beforeAll(async () => {
  ctx = await createHttpTestContext()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`
}, 60_000)
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await ctx.dispose()
})
beforeEach(async () => {
  await ctx.reset()
  httpCalls = 0; modelInputs.length = 0; responseMode = 'ok'
  pm = await makeUser(ctx.db, 'd-scheduling-pm', 'Synthetic PM')
  member = await makeUser(ctx.db, 'd-scheduling-member', 'Synthetic member')
  projectId = await makeProject(ctx.db, pm, 'Synthetic scheduling compatibility')
  await makeMember(ctx.db, projectId, member)
  const goal = await ctx.db.businessGoal.create({ data: { projectId, name: 'Synthetic goal', sortOrder: 0 } })
  const activity = await ctx.db.userActivity.create({ data: { projectId, goalId: goal.id, name: 'Synthetic activity', sortOrder: 0 } })
  const story = await ctx.db.userStory.create({ data: { projectId, activityId: activity.id,
    title: 'Synthetic story', roleText: 'r', capabilityText: 'c', valueText: 'v', businessValue: 'b', priority: 'P1' } })
  taskId = (await ctx.db.task.create({ data: { projectId, storyId: story.id,
    title: 'Synthetic TODO task', status: 'TODO', ownerUserId: member, acceptorUserId: pm,
    planStart: '2099-02-01', planEnd: '2099-02-03' } })).id
})
function assemble(classification: 'SYNTHETIC_DEMO' | 'PROJECT_DATA' = 'SYNTHETIC_DEMO') {
  const repository = new PrismaAiSuggestionRepository<SchedulingSuggestionRecord>(ctx.db)
  const authorization = (tx: Prisma.TransactionClient): AiAuthorizationPort => ({
    async decide(actor, capability, ref) {
      if (capability !== 'ai.suggestion.generate') return { allow: false, status: 403, code: 'FORBIDDEN' }
      const decision = await createAuthorization(tx).can(actor, capability, { kind: 'project', projectId: ref.projectId })
      return decision.allow ? { allow: true } : { allow: false, status: decision.status, code: decision.code }
    },
  })
  const reader = createSchedulingReader(async (tx, actor, project) => {
    const decision = await authorization(tx).decide(actor, 'ai.suggestion.generate', { projectId: project, scenario: 'SCHEDULING' })
    if (!decision.allow) throw new Error(decision.code)
  })
  const generate = createSchedulingGenerator({
    transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => ctx.db.$transaction(work),
    authorization, readSource: reader, repository, newId: randomUUID, now: () => new Date(),
    recordFailure: async () => {}, // Test evidence sink, NOT the production audit adapter.
    dataClassification: classification,
    model: createSchedulingAiModelPort({ endpoint, providerId: 'synthetic-loopback',
      model: 'synthetic-scheduling-http', apiKey: 'synthetic-test-only' }),
  })
  return { generate, repository }
}
function invocation(actorUserId = pm) { return { projectId, actorUserId, requestId: randomUUID() } }

describe('D model adapter + unmodified C generation + actual SQLite', () => {
  it('persists a traced PENDING scheduling proposal but never applies formal dates', async () => {
    const a = assemble(), req = invocation()
    const before = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    const receipt = await a.generate(req)
    const record = await a.repository.findById(receipt.id)
    expect(receipt).toMatchObject({ status: 'PENDING', generation: { requestId: req.requestId, status: 'SUCCEEDED' } })
    expect(record).toMatchObject({ scenario: 'SCHEDULING', model: { mode: 'API', execution: 'EXTERNAL', version: '未提供' },
      suggestion: { changes: [{ taskId, planStart: '2099-02-01', planEnd: '2099-02-02' }] } })
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).toEqual(before)
    expect(await ctx.db.aiDisposition.count()).toBe(0)
    expect(await ctx.db.aiApplication.count()).toBe(0)
    const wire = JSON.stringify(modelInputs)
    for (const field of ['revision', 'pmProtected', 'serverPrivate', 'constraintDigest', 'acceptorUserId']) expect(wire).not.toContain(field)
    expect(httpCalls).toBe(1)
  })

  it.each(['invalid', 'fail'] as const)('saves sanitized failure instead of valid suggestions for %s', async (mode) => {
    responseMode = mode
    const a = assemble(), receipt = await a.generate(invocation())
    const record = await a.repository.findById(receipt.id)
    expect(record).toMatchObject({ status: 'GENERATION_FAILED', suggestion: null,
      generation: { status: 'FAILED', error: { code: mode === 'invalid' ? 'AI_INVALID_RESPONSE' : 'AI_SERVICE_UNAVAILABLE' } } })
    expect(JSON.stringify(record)).not.toContain('secret-error-not-for-storage')
    expect(JSON.stringify(record)).not.toContain('invented-task')
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ planEnd: '2099-02-03' })
    expect(httpCalls).toBe(1)
  })

  it('denies MEMBER generation before HTTP or creating a proposal', async () => {
    await expect(assemble().generate(invocation(member))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(httpCalls).toBe(0)
    expect(await ctx.db.aiSuggestion.count()).toBe(0)
  })

  it('denies real project data before HTTP even when a model is configured', async () => {
    await expect(assemble('PROJECT_DATA').generate(invocation())).rejects.toMatchObject({ code: 'EXTERNAL_PROJECT_DATA_FORBIDDEN' })
    expect(httpCalls).toBe(0)
    expect(await ctx.db.aiSuggestion.count()).toBe(0)
  })

  it.each(['revoke', 'change-source'] as const)('rechecks %s after real model transport and does not save', async (mode) => {
    responseMode = mode
    await expect(assemble().generate(invocation())).rejects.toMatchObject({ code: mode === 'revoke' ? 'NOT_FOUND' : 'SOURCE_CHANGED' })
    expect(httpCalls).toBe(1)
    expect(await ctx.db.aiSuggestion.count()).toBe(0)
  })
})
