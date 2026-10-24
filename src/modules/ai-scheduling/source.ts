import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { createAuthorization } from '../authz/permissions.js'
import { buildSchedulingInput } from './policy.js'
import { schedulingSnapshotSchema, type SchedulingSnapshot } from './schemas.js'

/** Local adapter, not a shared wire contract or a production route.
 * B must supply the authoritative US12 PM-only authorizer at assembly time.
 * There is deliberately NO project.read fallback or business role check here.
 */
export type SchedulingReadAuthorizer = (
  tx: Prisma.TransactionClient, actorUserId: string, projectId: string,
) => Promise<void>

export type SchedulingSource = {
  snapshot: SchedulingSnapshot
  aiInput: ReturnType<typeof buildSchedulingInput>
  pmProtected: { audience: 'pm-protected'; globalPopulation: number; excludedSensitiveCount: number }
  serverPrivate: { protocol: 'us12-source-v1'; constraintDigest: string }
}
export type SchedulingSourceResult =
  | { state: 'ok'; data: SchedulingSource; complete: true }
  | { state: 'unavailable'; data: null; note: string }

/** Set-oriented canonicalization: array order is irrelevant for this protocol.
 * Do not reuse for ordered business payloads such as UML messages.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
export function sourceDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** Only outward serializer for the model: no snapshot/serverPrivate/PM counts.
 * Used by the injected generator; never silently substitutes fixture data.
 */
export function schedulingModelInput(source: SchedulingSource) {
  return structuredClone(source.aiInput)
}

export function createSchedulingReader(authorize: SchedulingReadAuthorizer) {
  return async function readSchedulingSource(
    tx: Prisma.TransactionClient, actorUserId: string, projectId: string,
  ): Promise<SchedulingSourceResult> {
    // A root client is structurally assignable to TransactionClient; reject it at runtime.
    if ('$transaction' in tx) throw new Error('Scheduling reads require a caller-owned transaction')
    // Authorization failures propagate, never masquerade as empty/unavailable data.
    await authorize(tx, actorUserId, projectId)
    const { visibilityScope } = createAuthorization(tx)
    const taskScope = await visibilityScope(actorUserId, projectId, 'task')
    const storyScope = await visibilityScope(actorUserId, projectId, 'story')
    try {
      const scopeWhere: Prisma.TaskWhereInput = {
        projectId,
        ...(taskScope.mode === 'subset' ? { id: { in: taskScope.ids } } : {}),
        story: {
          projectId,
          ...(storyScope.mode === 'subset' ? { id: { in: storyScope.ids } } : {}),
          isSensitive: false,
        },
        isSensitive: false,
      }
      // No take/skip cap: this is a complete DB projection, not a truncated view DTO.
      // Sensitive task AND parent-story filtering happens before selecting title/content.
      const tasks = await tx.task.findMany({
        where: scopeWhere,
        select: {
          id: true, projectId: true, storyId: true, title: true,
          ownerUserId: true, acceptorUserId: true, status: true,
          planStart: true, planEnd: true, isSensitive: true,
        },
        orderBy: { id: 'asc' },
      })
      const members = await tx.projectMember.findMany({
        where: { projectId }, select: { userId: true, role: true }, orderBy: { userId: 'asc' },
      })
      const ids = tasks.map((task) => task.id)
      const included = new Set(ids)
      // Private constraint fetches contain no title/description/account/name.
      // They are ephemeral; only the digest survives in the server-private bundle.
      const edges = await tx.taskDependency.findMany({
        where: { projectId, OR: [{ predecessorTaskId: { in: ids } }, { successorTaskId: { in: ids } }] },
        select: { id: true, predecessorTaskId: true, successorTaskId: true, type: true },
      })
      const milestones = await tx.milestone.findMany({
        where: { projectId, tasks: { some: { taskId: { in: ids } } } },
        select: { id: true, dueDate: true, tasks: { select: { taskId: true } } },
      })
      const privateIds = [...new Set(edges.flatMap((edge) => [edge.predecessorTaskId, edge.successorTaskId]))]
        .filter((id) => !included.has(id))
      const privateEndpoints = await tx.task.findMany({
        where: { projectId, id: { in: privateIds } },
        select: {
          id: true, status: true, planStart: true, planEnd: true,
          ownerUserId: true, acceptorUserId: true, isSensitive: true,
          story: { select: { id: true, isSensitive: true } },
        },
      })
      if (privateEndpoints.length !== privateIds.length || edges.some((edge) => edge.type !== 'FS')) {
        return { state: 'unavailable', data: null, note: '必要约束不完整或类型非法，不能进行正式应用' }
      }
      const publicEdges = edges.filter((edge) => included.has(edge.predecessorTaskId) && included.has(edge.successorTaskId))
      const publicMilestones = milestones.filter((m) => m.tasks.every((link) => included.has(link.taskId)))
      const needsPrivateValidation = privateIds.length > 0 || publicMilestones.length !== milestones.length
      const constraintDigest = sourceDigest({ edges, milestones, privateEndpoints })
      const asOf = new Date().toISOString()
      const candidate = {
        projectId, revision: 'pending-digest', capturedAt: asOf,
        memberIds: members.map((member) => member.userId), memberRoles: members,
        sourceComplete: true,
        sourceConstraints: needsPrivateValidation ? 'requires-private-validation' : 'complete',
        tasks,
        dependencies: publicEdges.map((edge) => ({ predecessorId: edge.predecessorTaskId, successorId: edge.successorTaskId })),
        milestones: publicMilestones.map((m) => ({ id: m.id, date: m.dueDate, taskIds: m.tasks.map((link) => link.taskId).sort() })),
      }
      const parsed = schedulingSnapshotSchema.safeParse(candidate)
      if (tasks.some((task) => task.planEnd < task.planStart)) {
        return { state: 'unavailable', data: null, note: '排期来源存在非法日期顺序' }
      }
      if (!parsed.success) return { state: 'unavailable', data: null, note: '排期来源包含非法日期、状态或成员数据' }
      const { revision: _revision, capturedAt: _asOf, ...baseline } = parsed.data
      // Parent-story provenance is protected snapshot data, not extra model context.
      parsed.data.revision = sourceDigest({ protocol: 'us12-source-v1', baseline, constraintDigest })
      const globalPopulation = await tx.task.count({ where: { projectId } })
      const excludedSensitiveCount = await tx.task.count({
        where: { projectId, OR: [{ isSensitive: true }, { story: { isSensitive: true } }] },
      })
      // The fingerprint includes private constraints: it must NEVER enter the model DTO.
      const aiInput = buildSchedulingInput(parsed.data)
      return {
        state: 'ok', complete: true,
        data: {
          snapshot: parsed.data, aiInput,
          pmProtected: { audience: 'pm-protected', globalPopulation, excludedSensitiveCount },
          serverPrivate: { protocol: 'us12-source-v1', constraintDigest },
        },
      }
    } catch {
      // No []/0 fallback and no DB error text / sensitive payload in the caller's result.
      return { state: 'unavailable', data: null, note: '排期来源暂不可用；不代表没有任务、依赖或里程碑' }
    }
  }
}
