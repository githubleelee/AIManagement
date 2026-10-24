import { z } from 'zod'
import {
  AI_SUGGESTION_LIST_LIMIT, canonicalAiJsonDigest, SHA256_CANONICAL_JSON_V1,
  type AiAccessDecision, type AiAuthorizationPort, type AiResourceRef, type AiSuggestionRepository,
} from '../../shared/ai.js'
import { AppError } from '../../shared/errors.js'
import { schedulingSuggestionSchema, type SchedulingSuggestionRecord } from './generation.js'
import { dateChangesSchema, type DateChange } from './schemas.js'
import type { SchedulingSourceResult } from './source.js'
import type { SchedulingVerification, SchedulingVerificationContext } from './verification.js'

const id = z.string().trim().min(1)
const identity = { projectId: id, suggestionId: id }
const note = z.string().trim().min(1).max(2000)
export const dispositionSchema = z.discriminatedUnion('status', [
  z.object({ ...identity, requestId: id, status: z.literal('ACCEPTED'), note: note.optional() }).strict(),
  z.object({ ...identity, requestId: id, status: z.literal('MODIFIED'), note, changes: dateChangesSchema }).strict(),
  z.object({ ...identity, requestId: id, status: z.literal('REJECTED'), note }).strict(),
])
export type SchedulingDisposition = z.infer<typeof dispositionSchema>
export type SchedulingAuditEntry = {
  projectId: string; suggestionId: string; actorUserId: string; requestId: string
  status: SchedulingDisposition['status']; reason: string | null; at: string
  before: DateChange[]; after: DateChange[]
}
export type SchedulingWorkflowPorts<Tx> = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>
  authorization(tx: Tx): AiAuthorizationPort
  /** B must enforce SCHEDULING PM-only here, not the generic project.read adapter.
   * Omitted capability denies before protected body/list/stat queries. No role checks in C.
   */
  readAuthorization?(tx: Tx, actor: string, ref: AiResourceRef): Promise<AiAccessDecision>
  repository: AiSuggestionRepository<SchedulingSuggestionRecord, Tx>
  readSource(tx: Tx, actor: string, projectId: string): Promise<SchedulingSourceResult>
  verify(tx: Tx, actor: string, projectId: string, context: SchedulingVerificationContext,
    changes: unknown, now: Date): Promise<SchedulingVerification>
  /** B injects the actual task foundation; never import task service or DB adapter here. */
  writeDates?(tx: Tx, projectId: string, changes: readonly DateChange[]): Promise<DateChange[]>
  /** Must append to the caller transaction and throw on failure. Not a DomainEvent substitute. */
  appendAudit?(tx: Tx, entry: SchedulingAuditEntry): Promise<void>
  readAudit?(tx: Tx, projectId: string, suggestionId: string): Promise<SchedulingAuditEntry[]>
  recordFailure(evidence: { projectId: string; actorUserId: string; requestId: string; code: string }): Promise<void>
  now(): Date
}

export class SchedulingConflict extends AppError {
  constructor(readonly reason: string) { super(409, 'CONFLICT', reason) }
}
export class SchedulingUnavailable extends Error {
  constructor() { super('排期能力暂不可用'); this.name = 'SchedulingUnavailable' }
}
function invalid(): never { throw new AppError(422, 'VALIDATION_FAILED', '排期请求字段或日期无效') }
function missing(): never { throw new AppError(404, 'NOT_FOUND', '资源不存在') }
function denied(decision: AiAccessDecision) {
  if (!decision.allow) throw new AppError(decision.status, decision.code, '资源不可访问')
}
const ref = (projectId: string, suggestionId?: string): AiResourceRef => ({
  projectId, suggestionId, scenario: 'SCHEDULING', populationBasis: 'GLOBAL',
})
/** UTF-16 task ordering; shared digest keeps arrays ordered, so normalize the date set first. */
export function orderedChanges(changes: readonly DateChange[]) {
  return [...changes].map(({ taskId, planStart, planEnd }) => ({ taskId, planStart, planEnd }))
    .sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)
}
function receipt(record: SchedulingSuggestionRecord) {
  return { id: record.id, status: record.status, disposition: record.disposition.status,
    application: record.application.status }
}
function summary(record: SchedulingSuggestionRecord) {
  const { provider, model, version, mode, execution } = record.model
  const { requestId, status, generatedAt, error } = record.generation
  return { ...receipt(record), projectId: record.projectId,
    model: { provider, model, version, mode, execution },
    generation: { requestId, status, generatedAt, error: error ? {
      code: error.code, message: '建议生成未成功，请核对调用记录', retryable: error.retryable,
    } : null } }
}
function detail(record: SchedulingSuggestionRecord, sourceState: 'current' | 'stale' | 'unavailable') {
  const dates = record.suggestion?.changes ?? []
  return {
    ...summary(record), sourceState,
    changes: orderedChanges(dates),
    tasks: dates.flatMap((change) => {
      const task = record.snapshot.data.source.tasks.find((item) => item.id === change.taskId)
      return task && !task.isSensitive && task.projectId === record.projectId ? [{
        id: task.id, title: task.title, planStart: task.planStart, planEnd: task.planEnd,
      }] : []
    }),
    // No snapshot/revision/private digest/PM statistics or repository record crosses this boundary.
    reason: record.disposition.reason,
    finalChanges: record.disposition.finalContent ? orderedChanges(record.disposition.finalContent.changes) : null,
  }
}
export type SchedulingDetail = ReturnType<typeof detail>

function savedProposal(record: SchedulingSuggestionRecord) {
  if (record.generation.status !== 'SUCCEEDED' || !record.suggestion
    || record.snapshot.fingerprintAlgorithm !== SHA256_CANONICAL_JSON_V1
    || canonicalAiJsonDigest(record.snapshot.data) !== record.snapshot.fingerprint) throw new SchedulingUnavailable()
  const original = schedulingSuggestionSchema.safeParse(record.suggestion)
  if (!original.success) throw new SchedulingUnavailable()
  const context = record.snapshot.data.verification
  const originalIds = original.data.changes.map((change) => change.taskId).sort()
  if (context.sourceRevision !== record.snapshot.data.source.revision
    || canonicalAiJsonDigest([...context.proposalTaskIds].sort()) !== canonicalAiJsonDigest(originalIds)) throw new SchedulingUnavailable()
  return { context, original: original.data }
}

export function createSchedulingWorkflow<Tx>(ports: SchedulingWorkflowPorts<Tx>) {
  async function readPermission(tx: Tx, actor: string, projectId: string, suggestionId?: string) {
    if (!ports.readAuthorization) throw new AppError(403, 'FORBIDDEN', '排期专项读取权限尚未装配')
    denied(await ports.readAuthorization(tx, actor, ref(projectId, suggestionId)))
  }
  async function metadata(tx: Tx, projectId: string, suggestionId: string) {
    const value = await ports.repository.findAccessMetadata(suggestionId, tx)
    if (!value || value.projectId !== projectId || value.scenario !== 'SCHEDULING') missing()
  }
  async function protectedRecord(tx: Tx, projectId: string, suggestionId: string) {
    const record = await ports.repository.findById(suggestionId, tx)
    if (!record || record.projectId !== projectId || record.scenario !== 'SCHEDULING') missing()
    return record
  }
  const get = async (actor: string, input: { projectId: string; suggestionId: string }) => {
    const request = z.object(identity).strict().safeParse(input)
    if (!request.success) invalid()
    return ports.transaction(async (tx) => {
      const { projectId, suggestionId } = request.data
      await metadata(tx, projectId, suggestionId)
      await readPermission(tx, actor, projectId, suggestionId)
      const record = await protectedRecord(tx, projectId, suggestionId)
      const source = await ports.readSource(tx, actor, projectId)
      const state = source.state !== 'ok' ? 'unavailable'
        : source.data.snapshot.revision === record.snapshot.data.verification.sourceRevision ? 'current' : 'stale'
      return detail(record, state)
    })
  }
  const list = async (actor: string, input: { projectId: string; limit?: number }) => {
    const parsed = z.object({ projectId: id, limit: z.number().int().min(1).max(AI_SUGGESTION_LIST_LIMIT).optional() }).strict().safeParse(input)
    if (!parsed.success) invalid()
    return ports.transaction(async (tx) => {
      await readPermission(tx, actor, parsed.data.projectId)
      if (!ports.repository.listPage) throw new SchedulingUnavailable()
      const page = await ports.repository.listPage({ ...parsed.data, scenario: 'SCHEDULING', actorUserId: actor }, tx)
      if (page.items.some((item) => item.scenario !== 'SCHEDULING' || item.projectId !== parsed.data.projectId)) throw new SchedulingUnavailable()
      return { ...page, items: page.items.map(summary) }
    })
  }
  const stats = async (actor: string, projectId: string) => ports.transaction(async (tx) => {
    if (!id.safeParse(projectId).success) invalid()
    await readPermission(tx, actor, projectId)
    return ports.repository.adoptionStats({ projectId, scenario: 'SCHEDULING', actorUserId: actor }, tx)
  })
  const audit = async (actor: string, input: { projectId: string; suggestionId: string }) => {
    const parsed = z.object(identity).strict().safeParse(input)
    if (!parsed.success) invalid()
    return ports.transaction(async (tx) => {
      const { projectId, suggestionId } = parsed.data
      await metadata(tx, projectId, suggestionId)
      await readPermission(tx, actor, projectId, suggestionId)
      denied(await ports.authorization(tx).decide(actor, 'ai.suggestion.audit', ref(projectId, suggestionId)))
      if (!ports.readAudit) throw new SchedulingUnavailable()
      const entries = await ports.readAudit(tx, projectId, suggestionId)
      if (entries.some((entry) => entry.projectId !== projectId || entry.suggestionId !== suggestionId)) throw new SchedulingUnavailable()
      // Explicit projection: adapters may contain extra private metadata at runtime.
      return entries.map(({ projectId, suggestionId, actorUserId, requestId, status, reason, at, before, after }) => ({
        projectId, suggestionId, actorUserId, requestId, status, reason, at,
        before: orderedChanges(before), after: orderedChanges(after),
      }))
    })
  }
  const assess = async (actor: string, input: { projectId: string; suggestionId: string; changes: DateChange[] }) => {
    const parsed = z.object({ ...identity, changes: dateChangesSchema }).strict().safeParse(input)
    if (!parsed.success) invalid()
    return ports.transaction(async (tx) => {
      const { projectId, suggestionId, changes } = parsed.data
      await metadata(tx, projectId, suggestionId)
      denied(await ports.authorization(tx).decide(actor, 'ai.suggestion.dispose', ref(projectId, suggestionId)))
      const record = await protectedRecord(tx, projectId, suggestionId)
      if (record.status !== 'PENDING') throw new SchedulingConflict('DISPOSITION_CONFLICT')
      const { context } = savedProposal(record)
      const result = await ports.verify(tx, actor, projectId, context, changes, ports.now())
      // The verifier's revision is private. Only its sanitized diagnostics cross the boundary.
      return { state: result.state, assessment: result.assessment }
    })
  }
  const dispose = async (actor: string, input: SchedulingDisposition) => {
    const parsed = dispositionSchema.safeParse(input)
    if (!parsed.success) invalid()
    const request = parsed.data
    try {
      return await ports.transaction(async (tx) => {
        await metadata(tx, request.projectId, request.suggestionId)
        denied(await ports.authorization(tx).decide(actor, 'ai.suggestion.dispose', ref(request.projectId, request.suggestionId)))
        const record = await protectedRecord(tx, request.projectId, request.suggestionId)
        const changes = request.status === 'MODIFIED' ? orderedChanges(request.changes) : null
        if (changes && new Set(changes.map((c) => c.taskId)).size !== changes.length) invalid()
        const digest = canonicalAiJsonDigest({ status: request.status, reason: request.note ?? null, changes })
        // Reauthorization precedes replay; replay precedes current-source/clock validation.
        if (record.disposition.status !== 'PENDING' || record.status !== 'PENDING') {
          if (record.disposition.requestId !== request.requestId || record.disposition.disposedByUserId !== actor
            || record.disposition.contentDigest !== digest) throw new SchedulingConflict('DISPOSITION_CONFLICT')
          const complete = record.status === 'APPLIED'
            || (record.status === 'DISPOSED' && record.disposition.status === 'REJECTED')
          if (!complete) throw new SchedulingConflict('INCOMPLETE_PREVIOUS_APPLICATION')
          return receipt(record)
        }
        if (!ports.appendAudit) throw new SchedulingUnavailable()
        let effective: DateChange[] = []
        let before: DateChange[] = []
        if (request.status !== 'REJECTED') {
          if (!ports.writeDates) throw new SchedulingUnavailable()
          const { context, original } = savedProposal(record)
          effective = changes ?? orderedChanges(original.changes)
          const verification = await ports.verify(tx, actor, request.projectId, context, effective, ports.now())
          if (verification.state === 'stale') throw new SchedulingConflict('SOURCE_STALE')
          if (verification.state === 'unavailable') throw new SchedulingUnavailable()
          if (verification.state !== 'ok' || !verification.assessment.canApplyDates) invalid()
          if (!verification.complete || verification.sourceRevision !== context.sourceRevision
            || verification.assessment.blockers.length > 0) throw new SchedulingUnavailable()
          before = effective.map((change) => {
            const task = record.snapshot.data.source.tasks.find((task) => task.id === change.taskId)
            if (!task) throw new SchedulingUnavailable()
            return { taskId: task.id, planStart: task.planStart, planEnd: task.planEnd }
          })
        }
        const at = ports.now().toISOString()
        const finalized = await ports.repository.finalizeDisposition({
          suggestionId: record.id, actorUserId: actor, requestId: request.requestId, contentDigest: digest,
          status: request.status, reason: request.note ?? null,
          modification: changes ? { changes } : null,
          finalContent: request.status === 'REJECTED' ? null : { changes: effective }, disposedAt: at,
        }, tx)
        // CAS APPLIED is only disposition reservation, NOT successful task application.
        if (finalized.kind === 'REPLAY' && (finalized.record.status === 'APPLIED'
          || (finalized.record.status === 'DISPOSED' && finalized.record.disposition.status === 'REJECTED'))) {
          return receipt(finalized.record)
        }
        if (finalized.kind !== 'APPLIED') throw new SchedulingConflict('DISPOSITION_CONFLICT')
        let completed = finalized.record
        if (request.status !== 'REJECTED') {
          const written = await ports.writeDates!(tx, request.projectId, effective)
          if (canonicalAiJsonDigest(orderedChanges(written)) !== canonicalAiJsonDigest(effective)) throw new SchedulingUnavailable()
          const updated = await ports.repository.updateApplication(record.id, {
            suggestionStatus: 'APPLIED', appliedAt: at, appliedByUserId: actor,
            result: { changes: effective }, targetReferences: effective.map((c) => ({ objectType: 'task', objectId: c.taskId })),
          }, 'DISPOSED', tx)
          if (!updated) throw new SchedulingConflict('APPLICATION_CONFLICT')
          completed = updated
        }
        await ports.appendAudit(tx, {
          projectId: request.projectId, suggestionId: record.id, actorUserId: actor,
          requestId: request.requestId, status: request.status, reason: request.note ?? null,
          at, before, after: effective,
        })
        return receipt(completed)
      })
    } catch (cause) {
      // A caller-owned transaction may expose DB race codes; normalize only known conflicts.
      const databaseConflict = typeof cause === 'object' && cause !== null && 'code' in cause
        && (cause.code === 'P2034' || cause.code === 'P2002')
      const error = databaseConflict ? new SchedulingConflict('CONCURRENT_DISPOSITION') : cause
      await ports.recordFailure({ projectId: request.projectId, actorUserId: actor, requestId: request.requestId,
        code: error instanceof SchedulingConflict ? error.reason : error instanceof AppError ? error.code : 'APPLICATION_FAILED' })
      throw error
    }
  }
  return { get, list, stats, audit, assess, dispose }
}
