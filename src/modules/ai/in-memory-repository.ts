import type {
  AiAdoptionStats,
  AiApplicationPatch,
  AiSuggestionQuery,
  AiSuggestionRecord,
  AiSuggestionRepository,
  FinalizeDispositionInput,
  FinalizeDispositionResult,
  RequirementBreakdownRecord,
} from './contracts.js'

function copy<T>(value: T): T {
  return structuredClone(value)
}

function matches(record: AiSuggestionRecord, query: AiSuggestionQuery): boolean {
  if (record.projectId !== query.projectId) return false
  if (query.scenario && record.scenario !== query.scenario) return false
  if (
    query.sourceObject &&
    (record.sourceObject.objectType !== query.sourceObject.objectType ||
      record.sourceObject.objectId !== query.sourceObject.objectId)
  ) {
    return false
  }
  return true
}

/**
 * Deterministic development adapter. It proves store semantics only; it is not
 * a persistence claim and must be replaced by B's database adapter in runtime.
 */
export class InMemoryAiSuggestionRepository<
  TRecord extends AiSuggestionRecord = RequirementBreakdownRecord,
> implements AiSuggestionRepository<TRecord> {
  private readonly records = new Map<string, TRecord>()

  async create(record: TRecord): Promise<TRecord> {
    if (this.records.has(record.id)) throw new Error(`AI suggestion already exists: ${record.id}`)
    this.records.set(record.id, copy(record))
    return copy(record)
  }

  async findAccessMetadata(id: string) {
    const record = this.records.get(id)
    if (!record) return null
    return copy({
      id: record.id,
      projectId: record.projectId,
      scenario: record.scenario,
      sourceObject: record.sourceObject,
      status: record.status,
    })
  }

  async findById(id: string): Promise<TRecord | null> {
    const record = this.records.get(id)
    return record ? copy(record) : null
  }

  async list(query: AiSuggestionQuery): Promise<TRecord[]> {
    return [...this.records.values()]
      .filter(record => matches(record, query))
      .sort((left, right) =>
        right.generation.generatedAt.localeCompare(left.generation.generatedAt),
      )
      .map(copy)
  }

  async finalizeDisposition(
    input: FinalizeDispositionInput,
  ): Promise<FinalizeDispositionResult<TRecord>> {
    const current = this.records.get(input.suggestionId)
    if (!current) throw new Error(`AI suggestion does not exist: ${input.suggestionId}`)

    if (current.disposition.status !== 'PENDING') {
      const sameRequest =
        current.disposition.disposedByUserId === input.actorUserId &&
        current.disposition.requestId === input.requestId &&
        current.disposition.contentDigest === input.contentDigest
      return { kind: sameRequest ? 'REPLAY' : 'CONFLICT', record: copy(current) }
    }

    const updated = {
      ...current,
      status: 'DISPOSED',
      disposition: {
        status: input.status,
        requestId: input.requestId,
        contentDigest: input.contentDigest,
        disposedByUserId: input.actorUserId,
        disposedAt: input.disposedAt,
        reason: input.reason,
        modification: input.modification,
        finalContent: input.finalContent,
      },
      application: {
        ...current.application,
        status: input.status === 'REJECTED' ? 'NOT_APPLICABLE' : 'PENDING_INTEGRATION',
      },
    } as TRecord

    this.records.set(updated.id, copy(updated))
    return { kind: 'APPLIED', record: copy(updated) }
  }

  /**
   * 应用结果登记：支持两种调用形式（见 `src/shared/ai.ts` 的端口重载）。
   *
   * 本内存桩是 D 的模块测试夹具，**不是**正式持久化；改动仅为满足公共端口新增的
   * H3 规范形式（`id, patch, expectedStatus`），旧形式（整条记录）行为逐字保留。
   * 真正的字段级补丁 + CAS 语义由 `src/db/ai-repository.ts` 实现。
   */
  async updateApplication(
    target: TRecord | string,
    patchOrExpectedStatus: AiApplicationPatch | 'DISPOSED' | 'APPLICATION_FAILED',
    expectedStatus?: 'DISPOSED' | 'APPLICATION_FAILED',
  ): Promise<TRecord | null> {
    const id = typeof target === 'string' ? target : target.id
    const current = this.records.get(id)
    const expected = typeof target === 'string' ? expectedStatus : patchOrExpectedStatus
    if (!current || current.status !== expected) return null

    const updated =
      typeof target === 'string'
        ? ({
            ...current,
            status: (patchOrExpectedStatus as AiApplicationPatch).suggestionStatus,
            application: {
              status:
                (patchOrExpectedStatus as AiApplicationPatch).suggestionStatus === 'APPLIED'
                  ? 'APPLIED'
                  : 'FAILED',
              appliedAt: (patchOrExpectedStatus as AiApplicationPatch).appliedAt,
              appliedByUserId: (patchOrExpectedStatus as AiApplicationPatch).appliedByUserId,
              result: (patchOrExpectedStatus as AiApplicationPatch).result,
              targetReferences: (patchOrExpectedStatus as AiApplicationPatch).targetReferences,
            },
          } as TRecord)
        : (target as TRecord)

    this.records.set(id, copy(updated))
    return copy(updated)
  }

  async adoptionStats(query: AiSuggestionQuery): Promise<AiAdoptionStats> {
    const records = [...this.records.values()].filter(record => matches(record, query))
    const pending = records.filter(record => record.disposition.status === 'PENDING').length
    const accepted = records.filter(record => record.disposition.status === 'ACCEPTED').length
    const modified = records.filter(record => record.disposition.status === 'MODIFIED').length
    const rejected = records.filter(record => record.disposition.status === 'REJECTED').length
    const finalCount = accepted + modified + rejected
    return {
      pending,
      accepted,
      modified,
      rejected,
      adoptionRate: finalCount === 0 ? null : (accepted + modified) / finalCount,
    }
  }
}
