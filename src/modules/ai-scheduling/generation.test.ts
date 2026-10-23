import { describe, expect, it, vi } from 'vitest'
import { canonicalAiJsonDigest, SHA256_CANONICAL_JSON_V1, type AiAccessDecision, type AiProviderDescriptor } from '../../shared/ai.js'
import { buildSchedulingInput } from './policy.js'
import { createSchedulingGenerator, type SchedulingGenerationPorts, type SchedulingSuggestionRecord } from './generation.js'
import type { SchedulingSource, SchedulingSourceResult } from './source.js'

const now = new Date('2026-10-22T02:00:00.000Z')
const descriptor: AiProviderDescriptor = {
  provider: 'test-only', model: 'test-model', version: '未提供', mode: 'STUB', execution: 'LOCAL',
}
const changes = [{ taskId: 't1', planStart: '2026-10-23', planEnd: '2026-10-24' }]
const request = { projectId: 'p1', actorUserId: 'pm', requestId: 'req1' }
function sourceFixture(): SchedulingSource {
  const snapshot = {
    projectId: 'p1', revision: 'protected-revision', capturedAt: now.toISOString(),
    memberIds: ['pm', 'm1'], sourceComplete: true as const, sourceConstraints: 'complete' as const,
    tasks: [{
      id: 't1', projectId: 'p1', storyId: 's1', title: 'Synthetic task', ownerUserId: 'm1',
      acceptorUserId: 'pm', status: 'TODO' as const, isSensitive: false,
      planStart: '2026-10-23', planEnd: '2026-10-25',
    }], dependencies: [], milestones: [],
  }
  return {
    snapshot, aiInput: buildSchedulingInput(snapshot),
    pmProtected: { audience: 'pm-protected', globalPopulation: 777, excludedSensitiveCount: 776 },
    serverPrivate: { protocol: 'us12-source-v1', constraintDigest: 'private-digest' },
  }
}
function harness() {
  let active = false
  let sequence = 0
  const transactions: Array<{ id: number }> = []
  const saved: SchedulingSuggestionRecord[] = []
  const source = sourceFixture()
  const decide = vi.fn(async (): Promise<AiAccessDecision> => ({ allow: true }))
  const readSource = vi.fn(async (): Promise<SchedulingSourceResult> => ({ state: 'ok', complete: true, data: source }))
  const generate = vi.fn(async () => {
    expect(active).toBe(false)
    return { requestId: request.requestId, descriptor, output: { changes } }
  })
  const create = vi.fn(async (record: SchedulingSuggestionRecord, tx?: { id: number }) => {
    expect(active).toBe(true)
    expect(tx).toBe(transactions[1])
    saved.push(record)
    return record
  })
  const recordFailure = vi.fn(async () => { expect(active).toBe(false) })
  const ports: SchedulingGenerationPorts<{ id: number }> = {
    async transaction(work) {
      expect(active).toBe(false)
      active = true
      const tx = { id: ++sequence }
      transactions.push(tx)
      try { return await work(tx) } finally { active = false }
    },
    authorization: () => ({ decide }), readSource, model: { descriptor, generate },
    repository: { create }, newId: () => 'suggestion-1', now: () => now, recordFailure,
  }
  return { ports, decide, readSource, generate, create, saved, recordFailure, transactions, source }
}

describe('C scheduling generation via shared AI ports (unit tests, not final integration gates)', () => {
  it('uses two short transactions and saves protected context with a separate shared digest', async () => {
    const h = harness()
    const receipt = await createSchedulingGenerator(h.ports)(request)
    expect(h.transactions).toHaveLength(2)
    expect(h.decide).toHaveBeenCalledTimes(2)
    expect(h.decide).toHaveBeenCalledWith('pm', 'ai.suggestion.generate', {
      projectId: 'p1', scenario: 'SCHEDULING', populationBasis: 'GLOBAL',
    })
    expect(h.readSource).toHaveBeenCalledTimes(2)
    expect(h.saved).toHaveLength(1)
    const saved = h.saved[0]!
    expect(saved.snapshot.fingerprintAlgorithm).toBe(SHA256_CANONICAL_JSON_V1)
    expect(saved.snapshot.fingerprint).toBe(canonicalAiJsonDigest(saved.snapshot.data))
    expect(saved.snapshot.fingerprint).not.toBe(saved.snapshot.data.verification.sourceRevision)
    expect(saved.snapshot.data.verification).toEqual({ sourceRevision: 'protected-revision', proposalTaskIds: ['t1'] })
    expect(saved.inputScope.population).toEqual({ sourceCount: 777, includedCount: 1, excludedSensitiveCount: 776 })
    expect(saved.inputScope.objects).toEqual([{ objectType: 'task', objectId: 't1' }])
    expect(saved.suggestion).toEqual({ changes })
    expect(saved.status).toBe('PENDING')
    expect(saved.disposition.status).toBe('PENDING')
    expect(saved.application.status).toBe('PENDING_DISPOSITION')
    expect(receipt).toEqual({ id: saved.id, status: 'PENDING', generation: saved.generation })
    expect(JSON.stringify(receipt)).not.toMatch(/protected-revision|private-digest|777|776|snapshot|suggestion.*changes/)
    const invocation = h.generate.mock.calls[0] as unknown as [unknown]
    expect(JSON.stringify(invocation)).not.toMatch(/protected-revision|private-digest|777|776|acceptorUserId|memberIds/)
    expect(h.recordFailure).not.toHaveBeenCalled()
  })

  it.each([403, 404] as const)('denies %s before loading input or calling the model', async (status) => {
    const h = harness()
    const code = status === 403 ? 'FORBIDDEN' : 'NOT_FOUND'
    h.decide.mockResolvedValue({ allow: false, status, code })
    await expect(createSchedulingGenerator(h.ports)(request)).rejects.toMatchObject({ code })
    expect(h.readSource).not.toHaveBeenCalled()
    expect(h.generate).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(h.recordFailure).toHaveBeenCalledWith({ ...request, code })
  })

  it('rechecks revoked authorization after the model, before any save', async () => {
    const h = harness()
    h.decide.mockResolvedValueOnce({ allow: true }).mockResolvedValueOnce({ allow: false, status: 403, code: 'FORBIDDEN' })
    await expect(createSchedulingGenerator(h.ports)(request)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(h.generate).toHaveBeenCalledTimes(1)
    expect(h.create).not.toHaveBeenCalled()
    expect(h.readSource).toHaveBeenCalledTimes(1)
  })

  it('rejects a changed baseline after generation', async () => {
    const h = harness()
    const changedSource = structuredClone(h.source)
    changedSource.snapshot.revision = 'new-revision'
    h.readSource.mockResolvedValueOnce({ state: 'ok', complete: true, data: h.source })
      .mockResolvedValueOnce({ state: 'ok', complete: true, data: changedSource })
    await expect(createSchedulingGenerator(h.ports)(request)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    expect(h.create).not.toHaveBeenCalled()
  })

  it.each(['initial', 'after-model'])('fails closed for unavailable source: %s', async (stage) => {
    const h = harness()
    if (stage === 'after-model') h.readSource.mockResolvedValueOnce({ state: 'ok', complete: true, data: h.source })
    h.readSource.mockResolvedValue({ state: 'unavailable', data: null, note: 'Unavailable' })
    await expect(createSchedulingGenerator(h.ports)(request)).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.generate).toHaveBeenCalledTimes(stage === 'initial' ? 0 : 1)
  })

  it('blocks external project data without a model call; synthetic classification is assembly-only', async () => {
    const h = harness()
    h.ports.model = { descriptor: { ...descriptor, mode: 'API', execution: 'EXTERNAL' }, generate: h.generate }
    await expect(createSchedulingGenerator(h.ports)(request)).rejects.toMatchObject({ code: 'EXTERNAL_PROJECT_DATA_FORBIDDEN' })
    expect(h.generate).not.toHaveBeenCalled()
    await expect(createSchedulingGenerator(h.ports)({ ...request, dataClassification: 'SYNTHETIC_DEMO' } as typeof request))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('records explicit external API metadata for trusted synthetic deployment', async () => {
    const h = harness()
    const external: AiProviderDescriptor = { ...descriptor, mode: 'API', execution: 'EXTERNAL' }
    h.ports.model = { descriptor: external, generate: h.generate }
    h.ports.dataClassification = 'SYNTHETIC_DEMO'
    h.generate.mockResolvedValue({ requestId: request.requestId, descriptor: external, output: { changes } })
    await createSchedulingGenerator(h.ports)(request)
    expect(h.saved[0]!.model).toEqual(external)
  })

  it.each([
    { changes: [...changes, ...changes] },
    { changes: [{ ...changes[0], taskId: 'hidden-task' }] },
    { changes: [{ ...changes[0], ownerUserId: 'someone' }] },
    { changes: [{ ...changes[0], planStart: '2026-02-30' }] },
    { changes: [{ ...changes[0], planEnd: '2026-10-22' }] },
    { changes: [] },
    { changes, privateExplanation: 'do not save me' },
  ])('stores a sanitized generation failure for invalid output %#', async (output) => {
    const h = harness()
    h.generate.mockResolvedValue({ requestId: request.requestId, descriptor, output } as never)
    const receipt = await createSchedulingGenerator(h.ports)(request)
    expect(receipt.status).toBe('GENERATION_FAILED')
    expect(h.saved[0]!.suggestion).toBeNull()
    expect(h.saved[0]!.generation.error?.code).toBe('AI_INVALID_RESPONSE')
    expect(h.saved[0]!.snapshot.data.verification.proposalTaskIds).toEqual([])
    expect(JSON.stringify(h.saved)).not.toContain('hidden-task')
    expect(JSON.stringify(h.saved)).not.toContain('do not save me')
  })

  it('rejects mismatched request/model trace rather than claiming successful output', async () => {
    const h = harness()
    h.generate.mockResolvedValue({ requestId: 'wrong-request', descriptor: { ...descriptor, model: 'different' }, output: { changes } })
    await createSchedulingGenerator(h.ports)(request)
    expect(h.saved[0]!.generation.error?.code).toBe('AI_INVALID_RESPONSE')
    expect(h.saved[0]!.model).toEqual(descriptor)
  })

  it('does not persist provider exception text or silently fall back to fixture output', async () => {
    const h = harness()
    h.generate.mockRejectedValue(new Error('secret-provider-token'))
    await createSchedulingGenerator(h.ports)(request)
    expect(h.saved[0]!.generation.status).toBe('FAILED')
    expect(h.saved[0]!.suggestion).toBeNull()
    expect(JSON.stringify(h.saved)).not.toContain('secret-provider-token')
    expect(h.generate).toHaveBeenCalledTimes(1)
  })

  it('propagates failed persistence and independently records safe failure evidence', async () => {
    const h = harness()
    h.create.mockRejectedValue(new Error('storage-internal'))
    await expect(createSchedulingGenerator(h.ports)(request)).rejects.toThrow('storage-internal')
    expect(h.recordFailure).toHaveBeenCalledWith({ ...request, code: 'GENERATION_SAVE_FAILED' })
  })

  it('keeps a failure-evidence write failure observable', async () => {
    const h = harness()
    h.decide.mockResolvedValue({ allow: false, status: 403, code: 'FORBIDDEN' })
    h.recordFailure.mockRejectedValue(new Error('failure-evidence-unavailable'))
    await expect(createSchedulingGenerator(h.ports)(request)).rejects.toThrow('failure-evidence-unavailable')
  })
})
