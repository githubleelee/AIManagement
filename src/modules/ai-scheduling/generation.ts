import { z } from 'zod'
import {
  canonicalAiJsonDigest, SHA256_CANONICAL_JSON_V1,
  type AiAuthorizationPort, type AiDataClassification, type AiGenerationError,
  type AiModelPort, type AiProviderDescriptor, type AiSuggestionRecord,
  type AiSuggestionRepository,
} from '../../shared/ai.js'
import { assessSchedulingDates } from './policy.js'
import { dateChangesSchema, type SchedulingSnapshot } from './schemas.js'
import { schedulingModelInput, type SchedulingSource, type SchedulingSourceResult } from './source.js'
import type { SchedulingVerificationContext } from './verification.js'

/** C owns the scenario payload; shared/ai.ts remains the sole lifecycle contract. */
export const schedulingSuggestionSchema = z.object({ changes: dateChangesSchema }).strict()
export type SchedulingSuggestion = z.infer<typeof schedulingSuggestionSchema>
export type SchedulingSavedSnapshot = {
  source: SchedulingSnapshot
  verification: SchedulingVerificationContext
  serverPrivate: SchedulingSource['serverPrivate']
  pmProtected: SchedulingSource['pmProtected']
}
export type SchedulingSuggestionRecord = AiSuggestionRecord<
  SchedulingSuggestion, SchedulingSavedSnapshot, SchedulingSuggestion
>

const requestSchema = z.object({
  projectId: z.string().trim().min(1), actorUserId: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
}).strict()
const descriptorSchema = z.object({
  provider: z.string().trim().min(1), model: z.string().trim().min(1),
  version: z.string().trim().transform((value) => value || '未提供'),
  mode: z.enum(['STUB', 'API']), execution: z.enum(['LOCAL', 'EXTERNAL']),
}).strict()

export class SchedulingGenerationError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND'
    | 'SOURCE_UNAVAILABLE' | 'SOURCE_CHANGED' | 'EXTERNAL_PROJECT_DATA_FORBIDDEN'
    | 'INVALID_PROVIDER') {
    super(code)
    this.name = 'SchedulingGenerationError'
  }
}

/** Assembly-only dependencies. actorUserId must come from authenticated server context.
 * No route is registered here. In particular this does not enable shared member-readable
 * lists/details or claim that the missing #32 audit/PM-read capabilities are implemented.
 */
export type SchedulingGenerationPorts<TTransaction> = {
  transaction<T>(work: (tx: TTransaction) => Promise<T>): Promise<T>
  authorization(tx: TTransaction): AiAuthorizationPort
  readSource(tx: TTransaction, actorUserId: string, projectId: string): Promise<SchedulingSourceResult>
  repository: Pick<AiSuggestionRepository<SchedulingSuggestionRecord, TTransaction>, 'create'>
  model: AiModelPort
  /** Trusted deployment setting, NEVER an HTTP request field. Default is real project data. */
  dataClassification?: AiDataClassification
  newId(): string
  now(): Date
  /** Independent safe failure evidence, outside the rolled-back business transaction.
   * A failure here propagates; it must not silently discard missing evidence.
   */
  recordFailure(evidence: { projectId: string; actorUserId: string; requestId: string; code: string }): Promise<void>
}

const invalidResponse: AiGenerationError = {
  code: 'AI_INVALID_RESPONSE', message: '模型返回无效排期建议', retryable: false,
}
const generationFailed: AiGenerationError = {
  code: 'AI_GENERATION_FAILED', message: '排期建议生成失败', retryable: false,
}

/** Saves a proposal only. Never writes task plans, disposes a proposal or calls D service.
 * Two short caller-owned transactions surround the model call, never contain it.
 */
export function createSchedulingGenerator<TTransaction>(ports: SchedulingGenerationPorts<TTransaction>) {
  return async (input: { projectId: string; actorUserId: string; requestId: string }) => {
    const parsed = requestSchema.safeParse(input)
    if (!parsed.success) throw new SchedulingGenerationError('INVALID_REQUEST')
    const request = parsed.data
    const authorize = async (tx: TTransaction) => {
      const decision = await ports.authorization(tx).decide(request.actorUserId, 'ai.suggestion.generate', {
        projectId: request.projectId, scenario: 'SCHEDULING', populationBasis: 'GLOBAL',
      })
      if (!decision.allow) throw new SchedulingGenerationError(decision.code)
    }
    try {
      const prepared = await ports.transaction(async (tx) => {
        await authorize(tx)
        const parsedDescriptor = descriptorSchema.safeParse(ports.model.descriptor)
        if (!parsedDescriptor.success) throw new SchedulingGenerationError('INVALID_PROVIDER')
        const descriptor: AiProviderDescriptor = parsedDescriptor.data
        const classification = ports.dataClassification ?? 'PROJECT_DATA'
        if (descriptor.execution === 'EXTERNAL' && classification !== 'SYNTHETIC_DEMO') {
          throw new SchedulingGenerationError('EXTERNAL_PROJECT_DATA_FORBIDDEN')
        }
        const source = await ports.readSource(tx, request.actorUserId, request.projectId)
        if (source.state !== 'ok' || !source.complete || source.data.snapshot.projectId !== request.projectId
          || source.data.snapshot.sourceComplete !== true
          || source.data.snapshot.sourceConstraints === 'unavailable') {
          throw new SchedulingGenerationError('SOURCE_UNAVAILABLE')
        }
        // Detach from adapter-owned mutable objects before releasing the read transaction.
        return { source: structuredClone(source.data), descriptor, classification }
      })
      let suggestion: SchedulingSuggestion | null = null
      let error: AiGenerationError | null = null
      try {
        const result = await ports.model.generate({
          requestId: request.requestId, scenario: 'SCHEDULING',
          context: {
            projectId: request.projectId, actorUserId: request.actorUserId,
            sourceObjectType: 'project', sourceObjectId: request.projectId,
            dataClassification: prepared.classification, containsSensitiveData: false,
          },
          input: schedulingModelInput(prepared.source),
        })
        const output = schedulingSuggestionSchema.safeParse(result.output)
        const resultDescriptor = descriptorSchema.safeParse(result.descriptor)
        if (result.requestId !== request.requestId || !resultDescriptor.success
          || canonicalAiJsonDigest(resultDescriptor.data) !== canonicalAiJsonDigest(prepared.descriptor)
          || !output.success) {
          error = invalidResponse
        } else {
          const assessment = assessSchedulingDates(prepared.source.snapshot, output.data.changes, ports.now())
          // Protected constraints are deliberately verified only at the later application boundary.
          if (assessment.blockers.some((blocker) => blocker.code !== 'PRIVATE_VALIDATION_REQUIRED')) error = invalidResponse
          else suggestion = output.data
        }
      } catch {
        // Never persist provider exception text, raw output, credentials or prompts.
        error = generationFailed
      }
      const generatedAt = ports.now().toISOString()
      const saved = await ports.transaction(async (tx) => {
        // Long calls cannot carry an old permission grant into a save transaction.
        await authorize(tx)
        const current = await ports.readSource(tx, request.actorUserId, request.projectId)
        if (current.state !== 'ok' || !current.complete || current.data.snapshot.sourceComplete !== true
          || current.data.snapshot.projectId !== request.projectId) {
          throw new SchedulingGenerationError('SOURCE_UNAVAILABLE')
        }
        if (current.data.snapshot.revision !== prepared.source.snapshot.revision) {
          throw new SchedulingGenerationError('SOURCE_CHANGED')
        }
        const source = prepared.source
        const snapshot: SchedulingSavedSnapshot = {
          source: source.snapshot,
          verification: {
            sourceRevision: source.snapshot.revision,
            proposalTaskIds: suggestion?.changes.map((change) => change.taskId) ?? [],
          },
          serverPrivate: source.serverPrivate, pmProtected: source.pmProtected,
        }
        const record: SchedulingSuggestionRecord = {
          id: ports.newId(), scenario: 'SCHEDULING', projectId: request.projectId,
          sourceObject: { objectType: 'project', objectId: request.projectId },
          status: error ? 'GENERATION_FAILED' : 'PENDING',
          inputScope: {
            projectId: request.projectId, populationBasis: 'VISIBLE',
            objects: source.aiInput.tasks.map((task) => ({ objectType: 'task', objectId: task.id })),
            filters: { isSensitive: false, parentStoryIsSensitive: false },
            includedFields: ['tasks', 'dependencies', 'milestones', 'workload'],
            excludedFields: ['revision', 'serverPrivate', 'pmProtected', 'sensitiveContent'],
            population: {
              sourceCount: source.pmProtected.globalPopulation,
              includedCount: source.aiInput.tasks.length,
              excludedSensitiveCount: source.pmProtected.excludedSensitiveCount,
            },
            containsSensitiveData: false,
          },
          snapshot: {
            asOf: source.snapshot.capturedAt, data: snapshot,
            fingerprint: canonicalAiJsonDigest(snapshot), fingerprintAlgorithm: SHA256_CANONICAL_JSON_V1,
          },
          model: prepared.descriptor,
          generation: { requestId: request.requestId, status: error ? 'FAILED' : 'SUCCEEDED', generatedAt, error },
          generatedByUserId: request.actorUserId, suggestion,
          disposition: {
            status: 'PENDING', requestId: null, contentDigest: null, disposedByUserId: null,
            disposedAt: null, reason: null, modification: null, finalContent: null,
          },
          application: {
            status: 'PENDING_DISPOSITION', appliedAt: null, appliedByUserId: null,
            result: null, targetReferences: [],
          },
        }
        return ports.repository.create(record, tx)
      })
      // A deliberately narrow receipt, NOT the protected record/detail projection.
      return { id: saved.id, status: saved.status, generation: saved.generation }
    } catch (cause) {
      await ports.recordFailure({
        ...request, code: cause instanceof SchedulingGenerationError ? cause.code : 'GENERATION_SAVE_FAILED',
      })
      throw cause
    }
  }
}
