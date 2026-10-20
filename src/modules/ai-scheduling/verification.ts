import type { Prisma } from '@prisma/client'
import type { SchedulingAssessment } from './schemas.js'
import { calendarDateSchema, dateChangesSchema } from './schemas.js'
import { assessSchedulingDates } from './policy.js'
import { createSchedulingReader, type SchedulingReadAuthorizer } from './source.js'

/** Module-local projection of a protected saved proposal, not a shared storage schema. */
export type SchedulingVerificationContext = {
  sourceRevision: string
  proposalTaskIds: readonly string[]
}

export type SchedulingVerification =
  | { state: 'ok'; complete: true; sourceRevision: string; assessment: SchedulingAssessment }
  | { state: 'stale' | 'invalid-changes' | 'out-of-scope' | 'unavailable'; assessment: null }

/** Internal validation only, NOT a suggestion disposition or public error contract.
 * Call AFTER protected suggestion lookup and idempotency replay, inside its transaction.
 * context must come from the protected server-side suggestion, never client-issued scope/locks.
 * No write/model/audit/event/commit occurs here. B supplies the eventual US12 authorizer.
 */
export function createSchedulingVerifier(authorize: SchedulingReadAuthorizer) {
  const reader = createSchedulingReader(authorize)
  return async function verifySchedulingDates(
    tx: Prisma.TransactionClient, actorUserId: string, projectId: string,
    context: SchedulingVerificationContext, changes: unknown, now: Date,
  ): Promise<SchedulingVerification> {
    const source = await reader(tx, actorUserId, projectId)
    if (source.state !== 'ok' || !source.complete) return { state: 'unavailable', assessment: null }
    if (source.data.snapshot.revision !== context.sourceRevision) return { state: 'stale', assessment: null }
    const allowed = new Set(context.proposalTaskIds)
    if (allowed.size === 0 || allowed.size !== context.proposalTaskIds.length
      || context.proposalTaskIds.some((id) => !source.data.snapshot.tasks.some((task) => task.id === id))) {
      return { state: 'unavailable', assessment: null }
    }
    const parsed = dateChangesSchema.safeParse(changes)
    if (!parsed.success) return { state: 'invalid-changes', assessment: null }
    if (parsed.data.some((change) => !allowed.has(change.taskId))) return { state: 'out-of-scope', assessment: null }
    const snapshot = source.data.snapshot
    // First run the public policy. Its private gate is not cleared until ALL checks below finish.
    const initial = assessSchedulingDates(snapshot, parsed.data, now)
    if (initial.blockers.some((b) => b.code !== 'PRIVATE_VALIDATION_REQUIRED')) {
      return { state: 'ok', complete: true, sourceRevision: snapshot.revision, assessment: initial }
    }
    const eligible = new Set(snapshot.tasks.map((task) => task.id))
    const changed = parsed.data.map((change) => change.taskId)
    const projected = new Map(parsed.data.map((change) => [change.taskId, change]))
    const privateBlockers: SchedulingAssessment['blockers'] = []
    const privateWarnings: SchedulingAssessment['warnings'] = []
    try {
      const edges = await tx.taskDependency.findMany({
        where: { projectId, OR: [{ predecessorTaskId: { in: changed } }, { successorTaskId: { in: changed } }] },
        select: { predecessorTaskId: true, successorTaskId: true, type: true },
      })
      const endpointIds = [...new Set(edges.flatMap((edge) => [edge.predecessorTaskId, edge.successorTaskId]))]
      const endpoints = await tx.task.findMany({
        where: { projectId, id: { in: endpointIds } },
        select: { id: true, planStart: true, planEnd: true },
      })
      if (endpoints.length !== endpointIds.length || edges.some((edge) => edge.type !== 'FS')
        || endpoints.some((task) => !calendarDateSchema.safeParse(task.planStart).success
          || !calendarDateSchema.safeParse(task.planEnd).success || task.planEnd < task.planStart)) {
        return { state: 'unavailable', assessment: null }
      }
      const byId = new Map(endpoints.map((task) => [task.id, projected.get(task.id) ?? task]))
      for (const edge of edges) {
        // Public-public edges were already assessed with projected dates by the pure policy.
        if (eligible.has(edge.predecessorTaskId) && eligible.has(edge.successorTaskId)) continue
        if (byId.get(edge.successorTaskId)!.planStart <= byId.get(edge.predecessorTaskId)!.planEnd
          && privateBlockers.length === 0) {
          privateBlockers.push({ code: 'PROTECTED_FS_VIOLATION', taskIds: [], message: '调整不满足受保护的真实 FS 日期约束' })
        }
      }
      const milestones = await tx.milestone.findMany({
        where: { projectId, tasks: { some: { taskId: { in: changed } } } },
        select: { dueDate: true, tasks: { select: { taskId: true } } },
      })
      for (const milestone of milestones) {
        if (!calendarDateSchema.safeParse(milestone.dueDate).success) return { state: 'unavailable', assessment: null }
        if (milestone.tasks.every((link) => eligible.has(link.taskId))) continue
        for (const link of milestone.tasks) {
          const change = projected.get(link.taskId)
          if (change && change.planEnd > milestone.dueDate
            && !privateWarnings.some((warning) => warning.taskIds[0] === change.taskId)) {
            privateWarnings.push({ code: 'AFTER_PROTECTED_MILESTONE', taskIds: [change.taskId], message: '计划结束超过已关联的受保护里程碑日期（仅提示）' })
          }
        }
      }
    } catch {
      return { state: 'unavailable', assessment: null }
    }
    // No hidden endpoint IDs/dates/counts enter the snapshot or returned assessment.
    const assessment = assessSchedulingDates({ ...snapshot, sourceConstraints: 'complete' }, parsed.data, now)
    assessment.blockers.push(...privateBlockers)
    assessment.warnings.push(...privateWarnings)
    assessment.canApplyDates = assessment.blockers.length === 0
    return { state: 'ok', complete: true, sourceRevision: snapshot.revision, assessment }
  }
}
