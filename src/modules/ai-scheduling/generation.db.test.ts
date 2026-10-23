import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpTestContext, makeMember, makeProject, makeUser, type HttpTestContext } from '../../../test/http-support.js'
import { PrismaAiSuggestionRepository } from '../../db/ai-repository.js'
import type { AiAuthorizationPort } from '../../shared/ai.js'
import { createAuthorization } from '../authz/permissions.js'
import { createSchedulingGenerator, type SchedulingGenerationPorts, type SchedulingSuggestionRecord } from './generation.js'
import { createSchedulingReader } from './source.js'

/** Real SQLite source/store tests, NOT production assembly, PM-read/audit or final US12 acceptance.
 * The transaction-scoped generation authorizer below is test assembly only: B's current
 * createAiAuthorizationPort takes a root PrismaClient, not a TransactionClient.
 */
let ctx: HttpTestContext
let pm: string, member: string, projectId: string, taskId: string
beforeAll(async () => { ctx = await createHttpTestContext() }, 60_000)
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser(ctx.db, 'generation-pm', 'Synthetic PM')
  member = await makeUser(ctx.db, 'generation-member', 'Synthetic member')
  projectId = await makeProject(ctx.db, pm, 'Synthetic scheduling')
  await makeMember(ctx.db, projectId, member)
  const goal = await ctx.db.businessGoal.create({ data: { projectId, name: 'Goal', sortOrder: 0 } })
  const activity = await ctx.db.userActivity.create({ data: { projectId, goalId: goal.id, name: 'Activity', sortOrder: 0 } })
  const story = await ctx.db.userStory.create({ data: {
    projectId, activityId: activity.id, title: 'Story', roleText: 'r', capabilityText: 'c',
    valueText: 'v', businessValue: 'b', priority: 'P1',
  } })
  taskId = (await ctx.db.task.create({ data: {
    projectId, storyId: story.id, title: 'Synthetic task', status: 'TODO',
    ownerUserId: member, acceptorUserId: pm, planStart: '2026-10-23', planEnd: '2026-10-25',
  } })).id
})

function assembly() {
  let duringModel: (() => Promise<void>) | undefined
  const repository = new PrismaAiSuggestionRepository<SchedulingSuggestionRecord>(ctx.db)
  const authorization = (tx: Prisma.TransactionClient): AiAuthorizationPort => ({
    async decide(actor, capability, ref) {
      if (capability !== 'ai.suggestion.generate') return { allow: false, status: 403, code: 'FORBIDDEN' }
      const decision = await createAuthorization(tx).can(actor, 'ai.suggestion.generate', {
        kind: 'project', projectId: ref.projectId,
      })
      return decision.allow ? { allow: true } : { allow: false, status: decision.status, code: decision.code }
    },
  })
  const reader = createSchedulingReader(async (tx, actor, project) => {
    // Generation input read only. This is NOT a substitute for the missing PM-only detail capability.
    const decision = await authorization(tx).decide(actor, 'ai.suggestion.generate', {
      projectId: project, scenario: 'SCHEDULING', populationBasis: 'GLOBAL',
    })
    if (!decision.allow) throw new Error(decision.code)
  })
  const descriptor = { provider: 'test-only', model: 'synthetic-model', version: '未提供', mode: 'STUB' as const, execution: 'LOCAL' as const }
  const generate = vi.fn(async (request: { requestId: string }) => {
    if (duringModel) await duringModel()
    return { requestId: request.requestId, descriptor, output: {
      changes: [{ taskId, planStart: '2026-10-24', planEnd: '2026-10-25' }],
    } }
  })
  const recordFailure = vi.fn(async () => {})
  const ports: SchedulingGenerationPorts<Prisma.TransactionClient> = {
    transaction: (work) => ctx.db.$transaction(work), authorization, readSource: reader,
    repository, model: { descriptor, generate }, newId: randomUUID,
    now: () => new Date('2026-10-22T02:00:00Z'), recordFailure,
  }
  return { ports, repository, generate, recordFailure, setDuringModel: (work: () => Promise<void>) => { duringModel = work } }
}
function request(actorUserId = pm) { return { projectId, actorUserId, requestId: randomUUID() } }

describe('scheduling generation: real source and shared SQLite repository', () => {
  it('persists actual source/suggestion/trace but leaves the formal task plan unchanged', async () => {
    const a = assembly()
    const before = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    const receipt = await createSchedulingGenerator(a.ports)(request())
    const saved = await a.repository.findById(receipt.id)
    expect(saved).toMatchObject({ scenario: 'SCHEDULING', status: 'PENDING', generatedByUserId: pm,
      generation: { status: 'SUCCEEDED' }, model: { mode: 'STUB', version: '未提供' } })
    expect(saved!.snapshot.data.verification.proposalTaskIds).toEqual([taskId])
    expect(saved!.snapshot.data.source.tasks).toHaveLength(1)
    expect(saved!.suggestion!.changes[0]!.planStart).toBe('2026-10-24')
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).toEqual(before)
    expect(await ctx.db.aiDisposition.count()).toBe(0)
    expect(await ctx.db.aiApplication.count()).toBe(0)
    expect(a.generate).toHaveBeenCalledTimes(1)
  })

  it('rejects a real MEMBER before model execution and saves nothing', async () => {
    const a = assembly()
    await expect(createSchedulingGenerator(a.ports)(request(member))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(a.generate).not.toHaveBeenCalled()
    expect(await ctx.db.aiSuggestion.count()).toBe(0)
  })

  it('observes PM revocation committed while the model runs outside the transaction', async () => {
    const a = assembly()
    a.setDuringModel(async () => {
      await ctx.db.projectMember.update({ where: { projectId_userId: { projectId, userId: pm } }, data: { role: 'MEMBER' } })
    })
    await expect(createSchedulingGenerator(a.ports)(request())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await ctx.db.aiSuggestion.count()).toBe(0)
    expect(a.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('detects a real source change during the model call', async () => {
    const a = assembly()
    a.setDuringModel(async () => {
      await ctx.db.task.update({ where: { id: taskId }, data: { planStart: '2026-10-24' } })
    })
    await expect(createSchedulingGenerator(a.ports)(request())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    expect(await ctx.db.aiSuggestion.count()).toBe(0)
  })

  it('rolls back the actual suggestion insert when the caller transaction fails after create', async () => {
    const a = assembly()
    a.ports.repository = { async create(record, tx) {
      await a.repository.create(record, tx)
      throw new Error('test-only post-insert failure')
    } }
    await expect(createSchedulingGenerator(a.ports)(request())).rejects.toThrow('test-only post-insert failure')
    expect(await ctx.db.aiSuggestion.count()).toBe(0)
    expect(a.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'GENERATION_SAVE_FAILED' }))
  })
})
