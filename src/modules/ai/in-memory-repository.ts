import type {
  AiAdoptionStats,
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

  async updateApplication(
    record: TRecord,
    expectedStatus: 'DISPOSED',
  ): Promise<TRecord | null> {
    const current = this.records.get(record.id)
    if (!current || current.status !== expectedStatus) return null
    this.records.set(record.id, copy(record))
    return copy(record)
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
