import { describe, expect, it } from 'vitest'
import type { RequirementBreakdownRecord } from './contracts.js'
import { InMemoryAiSuggestionRepository } from './in-memory-repository.js'

function pendingRecord(id = 'suggestion-1'): RequirementBreakdownRecord {
  return {
    id,
    scenario: 'REQUIREMENT_BREAKDOWN',
    projectId: 'project-1',
    sourceObject: { objectType: 'story', objectId: 'story-1' },
    status: 'PENDING',
    inputScope: {
      projectId: 'project-1',
      populationBasis: 'OBJECT',
      objects: [{ objectType: 'story', objectId: 'story-1' }],
      filters: {},
      includedFields: ['title'],
      excludedFields: ['isSensitive'],
      population: { sourceCount: 1, includedCount: 1, excludedSensitiveCount: 0 },
      containsSensitiveData: false,
    },
    snapshot: {
      asOf: '2026-10-18T10:00:00.000Z',
      data: {
        title: 'Story',
        roleText: 'PM',
        capabilityText: 'plan',
        valueText: 'value',
        businessValue: 'value',
        acceptanceCriteria: null,
      },
      fingerprint: 'fingerprint',
      fingerprintAlgorithm: 'SHA-256_CANONICAL_JSON_V1',
    },
    model: {
      provider: 'local-stub',
      model: 'breakdown',
      version: '1',
      mode: 'STUB',
      execution: 'LOCAL',
    },
    generation: {
      requestId: id,
      status: 'SUCCEEDED',
      generatedAt: '2026-10-18T10:00:00.000Z',
      error: null,
    },
    generatedByUserId: 'pm-1',
    suggestion: { summary: 'summary', workItems: [] },
    disposition: {
      status: 'PENDING',
      requestId: null,
      contentDigest: null,
      disposedByUserId: null,
      disposedAt: null,
      reason: null,
      modification: null,
      finalContent: null,
    },
    application: {
      status: 'PENDING_DISPOSITION',
      appliedAt: null,
      appliedByUserId: null,
      result: null,
      targetReferences: [],
    },
  }
}

describe('shared AI suggestion store semantics', () => {
  it('returns replay only for same actor + request id + digest', async () => {
    const repository = new InMemoryAiSuggestionRepository()
    await repository.create(pendingRecord())
    const input = {
      suggestionId: 'suggestion-1',
      actorUserId: 'pm-1',
      requestId: 'dispose-1',
      contentDigest: 'digest-1',
      status: 'ACCEPTED' as const,
      reason: null,
      modification: null,
      finalContent: { summary: 'summary', workItems: [] },
      disposedAt: '2026-10-18T10:01:00.000Z',
    }

    expect((await repository.finalizeDisposition(input)).kind).toBe('APPLIED')
    expect((await repository.finalizeDisposition(input)).kind).toBe('REPLAY')
    expect(
      (
        await repository.finalizeDisposition({
          ...input,
          actorUserId: 'pm-2',
          requestId: 'dispose-2',
        })
      ).kind,
    ).toBe('CONFLICT')
  })

  it('calculates adoption quality by scenario/project without counting pending', async () => {
    const repository = new InMemoryAiSuggestionRepository()
    await repository.create(pendingRecord('accepted'))
    await repository.create(pendingRecord('rejected'))
    await repository.create(pendingRecord('pending'))
    for (const [id, status] of [
      ['accepted', 'ACCEPTED'],
      ['rejected', 'REJECTED'],
    ] as const) {
      await repository.finalizeDisposition({
        suggestionId: id,
        actorUserId: 'pm-1',
        requestId: `dispose-${id}`,
        contentDigest: `digest-${id}`,
        status,
        reason: status === 'REJECTED' ? 'not useful' : null,
        modification: null,
        finalContent: status === 'REJECTED' ? null : { summary: 'summary', workItems: [] },
        disposedAt: '2026-10-18T10:01:00.000Z',
      })
    }

    await expect(
      repository.adoptionStats({ projectId: 'project-1', scenario: 'REQUIREMENT_BREAKDOWN' }),
    ).resolves.toEqual({ pending: 1, accepted: 1, modified: 0, rejected: 1, adoptionRate: 0.5 })
  })
})
