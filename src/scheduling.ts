import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { createAiAuthorizationPort, PrismaAiSuggestionRepository } from './db/ai-repository.js'
import { createAuthorization } from './modules/authz/permissions.js'
import { createSchedulingGenerator, type SchedulingSuggestionRecord } from './modules/ai-scheduling/generation.js'
import { createSchedulingWorkflow, type SchedulingAuditEntry } from './modules/ai-scheduling/workflow.js'
import { createSchedulingReader } from './modules/ai-scheduling/source.js'
import { createSchedulingVerifier } from './modules/ai-scheduling/verification.js'
import { calendarDateSchema } from './modules/ai-scheduling/schemas.js'
import { applyTaskPlanDates } from './modules/task/rules.js'
import { createSchedulingAiModelPortFromEnvironment } from './modules/ai/factory.js'
import { AiPortError } from './modules/ai/errors.js'
import type { AiAuthorizationPort, AiDataClassification, AiModelPort } from './shared/ai.js'
import { AppError } from './shared/errors.js'

/** B-owned composition only. C retains its workflow; D retains model implementation. */
export type SchedulingRuntimeOptions = {
  model: AiModelPort
  dataClassification?: AiDataClassification
}
export type SchedulingFailureEvidence = {
  projectId: string; actorUserId: string; requestId: string; code: string
}

/** Only the approved SCHEDULING scenario gets PM-only read/audit capability.
 * Generic AI read/audit mapping remains unchanged. No business-role branch or new Action.
 */
export function createSchedulingAuthorization(tx: Prisma.TransactionClient): AiAuthorizationPort {
  const generic = createAiAuthorizationPort(tx)
  const { can } = createAuthorization(tx)
  return {
    async decide(actor, capability, ref) {
      if (ref.scenario !== 'SCHEDULING') return { allow: false, status: 404, code: 'NOT_FOUND' }
      if (ref.suggestionId) {
        const metadata = await tx.aiSuggestion.findUnique({
          where: { id: ref.suggestionId }, select: { projectId: true, scenario: true },
        })
        if (!metadata || metadata.projectId !== ref.projectId || metadata.scenario !== 'SCHEDULING') {
          return { allow: false, status: 404, code: 'NOT_FOUND' }
        }
      }
      if (capability === 'ai.suggestion.read' || capability === 'ai.suggestion.audit') {
        // Existing PM-only policy supplies the grant; this does NOT execute a disposition.
        return can(actor, 'ai.suggestion.dispose', { kind: 'project', projectId: ref.projectId })
      }
      return generic.decide(actor, capability, ref)
    },
  }
}

const dates = z.array(z.object({
  taskId: z.string().min(1), planStart: calendarDateSchema, planEnd: calendarDateSchema,
}).strict())
const auditAfter = z.object({
  requestId: z.string().min(1), status: z.enum(['ACCEPTED', 'MODIFIED', 'REJECTED']),
  reason: z.string().nullable(), changes: dates,
}).strict()
const AUDIT_ACTION = 'scheduling.disposed'

/** Success evidence belongs to the SAME caller transaction as dates/disposition/application.
 * AuditLog is not suggestion storage; the shared three tables remain the sole suggestion source.
 */
export async function appendSchedulingAudit(tx: Prisma.TransactionClient, entry: SchedulingAuditEntry) {
  await tx.auditLog.create({ data: {
    projectId: entry.projectId, actorUserId: entry.actorUserId,
    action: AUDIT_ACTION, objectType: 'ai-suggestion', objectId: entry.suggestionId,
    before: JSON.stringify(dates.parse(entry.before)),
    after: JSON.stringify(auditAfter.parse({ requestId: entry.requestId, status: entry.status,
      reason: entry.reason, changes: entry.after })),
    createdAt: new Date(entry.at),
  } })
}

export async function readSchedulingAudit(
  tx: Prisma.TransactionClient, projectId: string, suggestionId: string,
): Promise<SchedulingAuditEntry[]> {
  const rows = await tx.auditLog.findMany({
    where: { projectId, objectType: 'ai-suggestion', objectId: suggestionId, action: AUDIT_ACTION },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((row) => {
    const saved = auditAfter.parse(JSON.parse(row.after ?? 'null'))
    return {
      projectId: row.projectId, suggestionId: row.objectId, actorUserId: row.actorUserId,
      requestId: saved.requestId, status: saved.status, reason: saved.reason,
      at: row.createdAt.toISOString(), before: dates.parse(JSON.parse(row.before ?? 'null')),
      after: saved.changes,
    }
  })
}

/** No configured provider is an explicit unavailable capability, NOT a replacement local stub.
 * A partially/incorrectly configured API fails startup; API failures never switch providers.
 */
export function schedulingOptionsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): SchedulingRuntimeOptions {
  const classification = z.enum(['PROJECT_DATA', 'SYNTHETIC_DEMO'])
    .parse(environment.SCHEDULING_AI_DATA_CLASSIFICATION ?? 'PROJECT_DATA')
  const configured = Object.keys(environment).some((key) => key.startsWith('SCHEDULING_AI_')
    && key !== 'SCHEDULING_AI_DATA_CLASSIFICATION' && environment[key] !== undefined)
  if (configured) return {
    model: createSchedulingAiModelPortFromEnvironment(environment), dataClassification: classification,
  }
  return {
    dataClassification: classification,
    model: {
      descriptor: { provider: 'unconfigured', model: 'scheduling-unavailable', version: '未提供',
        mode: 'API', execution: 'LOCAL' },
      async generate() { throw new AiPortError('AI_SERVICE_UNAVAILABLE', '排期模型尚未配置', true) },
    },
  }
}

/** Single application composition point, called by app.ts. Never commits inside an adapter.
 * Failure evidence uses the application's structured security log outside the rolled-back tx;
 * only identifiers/code are accepted, no provider error, prompt, snapshot or credentials.
 */
export function createSchedulingRuntime(
  prisma: PrismaClient, options: SchedulingRuntimeOptions,
  recordFailure: (evidence: SchedulingFailureEvidence) => Promise<void>,
) {
  const authorization = createSchedulingAuthorization
  const authorizeSource = async (tx: Prisma.TransactionClient, actor: string, projectId: string) => {
    const decision = await authorization(tx).decide(actor, 'ai.suggestion.read', {
      projectId, scenario: 'SCHEDULING', populationBasis: 'GLOBAL',
    })
    if (!decision.allow) throw new AppError(decision.status, decision.code, '资源不可访问')
  }
  const common = {
    transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work),
    authorization,
    repository: new PrismaAiSuggestionRepository<SchedulingSuggestionRecord>(prisma),
    readSource: createSchedulingReader(authorizeSource),
    recordFailure,
    now: () => new Date(),
  }
  return {
    generate: createSchedulingGenerator<Prisma.TransactionClient>({ ...common, ...options, newId: randomUUID }),
    workflow: createSchedulingWorkflow<Prisma.TransactionClient>({
      ...common,
      readAuthorization: (tx, actor, ref) => authorization(tx).decide(actor, 'ai.suggestion.read', ref),
      verify: createSchedulingVerifier(authorizeSource),
      // The same task foundation used by manual writes; date-only edits do not enter DOING.
      // C's verifier above checks full (including protected) FS plan constraints in this tx.
      writeDates: applyTaskPlanDates,
      appendAudit: appendSchedulingAudit,
      readAudit: readSchedulingAudit,
    }),
  }
}
