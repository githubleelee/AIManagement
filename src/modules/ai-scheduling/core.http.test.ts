import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHttpTestContext, makeMember, makeProject, makeUser, type HttpTestContext } from '../../../test/http-support.js'
import { currentUserId, requireAuth } from '../../auth/actor.js'
import { createAuthorization } from '../authz/permissions.js'
import { AppError } from '../../shared/errors.js'
import { applyTaskPlanDates } from '../task/rules.js'
import { buildApp } from '../../app.js'
import { createSchedulingReader, schedulingModelInput, type SchedulingReadAuthorizer } from './source.js'
import { createSchedulingVerifier } from './verification.js'
import { assessSchedulingDates } from './policy.js'
import { dateChangesSchema } from './schemas.js'

/** Real SQLite + HTTP probes only. These routes are NEVER production registered.
 * task.write is a TEST-ONLY PM authorization seam, NOT the pending US12 Action.
 * No real AI/store/decision/idempotency acceptance is claimed by these tests.
 */
let ctx: HttpTestContext
let pm: string, member: string, viewer: string, outsider: string, projectId: string, storyId: string
let one: string, two: string

const authorize: SchedulingReadAuthorizer = async (tx, actor, project) => {
  const decision = await createAuthorization(tx).can(actor, 'task.write', { kind: 'project', projectId: project })
  if (!decision.allow) throw new AppError(decision.status, decision.code, '资源不可访问')
}
const reader = createSchedulingReader(authorize)
const verifier = createSchedulingVerifier(authorize)

beforeAll(async () => {
  ctx = await createHttpTestContext()
  ctx.app.post('/_test/us12/source', { preHandler: requireAuth }, async (request) => {
    const body = request.body as { projectId: string; modelOnly?: boolean; unavailable?: boolean; root?: boolean; assess?: boolean }
    const actor = currentUserId(request)
    if (body.root) return reader(ctx.db, actor, body.projectId)
    if (body.unavailable) {
      let result
      const rollback = new Error('deliberate test DDL rollback')
      try {
        await ctx.db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('DROP TABLE "TaskDependency"')
          result = await reader(tx, actor, body.projectId)
          throw rollback
        })
      } catch (error) { if (error !== rollback) throw error }
      return result
    }
    return ctx.db.$transaction(async (tx) => {
      const result = await reader(tx, actor, body.projectId)
      if (result.state !== 'ok') return result
      if (body.modelOnly) return schedulingModelInput(result.data)
      if (body.assess) return assessSchedulingDates(result.data.snapshot,
        [{ taskId: two, planStart: '2026-10-22', planEnd: '2026-10-23' }], new Date('2026-10-19T00:00:00Z'))
      return result
    })
  })
  ctx.app.post('/_test/us12/verify', { preHandler: requireAuth }, async (request) => {
    const body = request.body as { projectId: string; revision: string; changes: unknown; restricted?: boolean; corruptContext?: boolean }
    // Server-owned fixture context, NOT a client-supplied allowed-ID list or real saved suggestion.
    const context = { sourceRevision: body.revision, proposalTaskIds: body.corruptContext ? [] : body.restricted ? [two] : [one, two] }
    return ctx.db.$transaction((tx) => verifier(tx, currentUserId(request), body.projectId,
      context, body.changes, new Date('2026-10-19T00:00:00Z')))
  })
  ctx.app.post('/_test/us12/plan', { preHandler: requireAuth }, async (request) => {
    const body = request.body as { projectId: string; changes: unknown; failAfter?: boolean; failAudit?: boolean; root?: boolean }
    const parsed = dateChangesSchema.safeParse(body.changes)
    if (!parsed.success) throw new AppError(422, 'VALIDATION_FAILED', '非法日期调整')
    const actor = currentUserId(request)
    return ctx.db.$transaction(async (tx) => {
      const permission = await createAuthorization(tx).can(actor, 'task.write', { kind: 'project', projectId: body.projectId })
      if (!permission.allow) throw new AppError(permission.status, permission.code, '资源不可访问')
      const result = await applyTaskPlanDates(body.root ? ctx.db : tx, body.projectId, parsed.data)
      if (body.failAfter) throw new AppError(409, 'CONFLICT', '故障注入：整体回滚')
      if (body.failAudit) await tx.auditLog.create({ data: { projectId: 'nonexistent-project', actorUserId: actor, action: 'test', objectType: 'task', objectId: one } })
      return result
    })
  })
  await ctx.app.ready()
}, 60_000)
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser(ctx.db, 'core-pm', '虚构PM')
  member = await makeUser(ctx.db, 'core-member', '虚构成员')
  viewer = await makeUser(ctx.db, 'core-viewer', '虚构查看者')
  outsider = await makeUser(ctx.db, 'core-outsider', '虚构外部人')
  projectId = await makeProject(ctx.db, pm, '虚构排期读取项目')
  await makeMember(ctx.db, projectId, member)
  await makeMember(ctx.db, projectId, viewer, 'VIEWER')
  const goal = await ctx.db.businessGoal.create({ data: { projectId, name: '目标', sortOrder: 0 } })
  const activity = await ctx.db.userActivity.create({ data: { projectId, goalId: goal.id, name: '活动', sortOrder: 0 } })
  const story = await ctx.db.userStory.create({ data: { projectId, activityId: activity.id, title: '非敏感故事', roleText: 'r', capabilityText: 'c', valueText: 'v', businessValue: 'b', priority: 'P1' } })
  storyId = story.id
  one = (await task('非敏感任务一', 'TODO')).id
  two = (await task('非敏感任务二', 'TODO')).id
})
async function task(title: string, status = 'TODO', sensitive = false, inStory = storyId) {
  return ctx.db.task.create({ data: { projectId, storyId: inStory, title, status, isSensitive: sensitive, ownerUserId: member, acceptorUserId: pm, planStart: '2026-10-20', planEnd: '2026-10-21' } })
}
function source(extra: Record<string, unknown> = {}, actor: string | null = pm) {
  return ctx.asUser(actor ? ctx.loginAs(actor) : null).post('/_test/us12/source').send({ projectId, ...extra })
}
function plan(extra: Record<string, unknown> = {}, actor: string | null = pm) {
  return ctx.asUser(actor ? ctx.loginAs(actor) : null).post('/_test/us12/plan').send({ projectId, changes: [
    { taskId: one, planStart: '2026-10-22', planEnd: '2026-10-23' },
    { taskId: two, planStart: '2026-10-24', planEnd: '2026-10-25' },
  ], ...extra })
}
async function revision() { const res = await source(); expect(res.body.state).toBe('ok'); return res.body.data.snapshot.revision as string }

describe('real source projection and safe model boundary', () => {
  it('reads real DB and marks known empty dependencies/milestones as complete', async () => {
    const res = await source()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ state: 'ok', complete: true, data: { snapshot: { sourceComplete: true, sourceConstraints: 'complete', dependencies: [], milestones: [] } } })
    expect(res.body.data.snapshot.tasks).toHaveLength(2)
    expect(res.body.data.snapshot.tasks.every((task: { storyId: string }) => task.storyId === storyId)).toBe(true)
    expect(res.body.data.snapshot.memberRoles).toHaveLength(3)
  })
  it('filters task AND parent-story sensitivity before returning title/content', async () => {
    const secret = await task('SECRET-TASK', 'TODO', true)
    const hiddenStory = await ctx.db.userStory.update({ where: { id: storyId }, data: { isSensitive: true } })
    const res = await source()
    expect(res.body.data.snapshot.tasks).toEqual([])
    expect(res.body.data.pmProtected).toMatchObject({ globalPopulation: 3, excludedSensitiveCount: 3 })
    expect(JSON.stringify(res.body)).not.toContain(secret.id)
    expect(JSON.stringify(res.body)).not.toContain(hiddenStory.title)
  })
  it('model DTO excludes private counts/digest/revision/roles/sensitive flags', async () => {
    const secret = await task('SECRET-NOT-FOR-MODEL', 'TODO', true)
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: secret.id, successorTaskId: two, type: 'FS' } })
    const res = await source({ modelOnly: true })
    expect(res.status).toBe(200)
    const text = JSON.stringify(res.body)
    for (const value of [secret.id, secret.title, 'pmProtected', 'globalPopulation', 'excludedSensitiveCount', 'constraintDigest', 'revision', 'memberRoles', 'isSensitive', 'storyId', 'requires-private-validation']) expect(text).not.toContain(value)
    expect(res.body.tasks).toHaveLength(2)
    expect(res.body.dependencies).toEqual([])
  })
  it('private FS edges require controlled validation, not silently no dependencies', async () => {
    const secret = await task('隐藏前置', 'CLOSED', true)
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: secret.id, successorTaskId: two, type: 'FS' } })
    const res = await source({ assess: true })
    expect(res.body.canApplyDates).toBe(false)
    expect(res.body.blockers.some((b: { code: string }) => b.code === 'PRIVATE_VALIDATION_REQUIRED')).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain(secret.id)
  })
  it('mixed milestone associations never leak hidden task IDs into the model', async () => {
    const hidden = await task('隐藏关联', 'TODO', true)
    const m = await ctx.db.milestone.create({ data: { projectId, name: '隐藏关联里程碑', dueDate: '2026-10-25', tasks: { create: [{ taskId: two }, { taskId: hidden.id }] } } })
    const res = await source({ modelOnly: true })
    expect(res.body.milestones).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain(m.id)
    expect(JSON.stringify(res.body)).not.toContain(hidden.id)
    expect((await source()).body.data.snapshot.sourceConstraints).toBe('requires-private-validation')
  })
  it('non-CLOSED workload includes DONE, excludes CLOSED and sensitive tasks', async () => {
    await ctx.db.task.update({ where: { id: one }, data: { status: 'DONE' } })
    await ctx.db.task.update({ where: { id: two }, data: { status: 'CLOSED' } })
    await task('隐藏负载', 'TODO', true)
    const res = await source({ modelOnly: true })
    expect(res.body.workload.find((m: { userId: string }) => m.userId === member).openTaskCount).toBe(1)
  })
  it('does not silently drop tasks whose owner has left the project', async () => {
    await ctx.db.projectMember.delete({ where: { projectId_userId: { projectId, userId: member } } })
    const res = await source({ assess: true })
    expect(res.body.canApplyDates).toBe(false)
    expect(res.body.blockers.some((b: { code: string }) => b.code === 'ASSIGNMENT_INVALID')).toBe(true)
    const input = await source({ modelOnly: true })
    expect(input.body.tasks).toHaveLength(2)
    expect(input.body.workload.find((row: { userId: string }) => row.userId === member).openTaskCount).toBe(2)
  })
  it('real FS checks retain unchanged neighboring tasks', async () => {
    await ctx.db.task.update({ where: { id: one }, data: { planEnd: '2026-10-22' } })
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: one, successorTaskId: two, type: 'FS' } })
    const res = await source({ assess: true })
    expect(res.body.canApplyDates).toBe(false)
    expect(res.body.blockers.some((b: { code: string }) => b.code === 'FS_PLAN_VIOLATION')).toBe(true)
  })
  it('real linked milestone date yields a warning, not a new hard deadline', async () => {
    await ctx.db.milestone.create({ data: { projectId, name: '真实表内虚构里程碑', dueDate: '2026-10-22', tasks: { create: [{ taskId: two }] } } })
    const res = await source({ assess: true })
    expect(res.body.canApplyDates).toBe(true)
    expect(res.body.warnings.some((w: { code: string }) => w.code === 'AFTER_MILESTONE')).toBe(true)
  })
  it('does not inherit the 500-row UI cap', async () => {
    await ctx.db.task.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ projectId, storyId, title: `bulk-${i}`, ownerUserId: member, acceptorUserId: pm, planStart: '2026-10-20', planEnd: '2026-10-21' })) })
    const res = await source()
    expect(res.body.complete).toBe(true)
    expect(res.body.data.snapshot.tasks).toHaveLength(503)
  })
  it('DB source failure returns unavailable/null, never empty arrays or fabricated count', async () => {
    const res = await source({ unavailable: true })
    expect(res.body).toMatchObject({ state: 'unavailable', data: null })
    expect(JSON.stringify(res.body)).not.toContain('TaskDependency')
    expect((await source()).body.state).toBe('ok') // deliberate DDL was rolled back
  })
  it.each(['UNKNOWN', 'bad-date', 'bad-order'])('invalid persisted %s fails closed instead of defaulting to TODO', async (value) => {
    await ctx.db.task.update({ where: { id: one }, data: value === 'UNKNOWN' ? { status: value } : value === 'bad-order' ? { planStart: '2026-10-25', planEnd: '2026-10-20' } : { planStart: '2026-02-30' } })
    expect((await source()).body).toMatchObject({ state: 'unavailable', data: null })
  })
  it.each([[null, 401], ['member', 403], ['viewer', 403], ['outsider', 404]] as const)('authorizer seam %s -> %s', async (who, status) => {
    const actor = who === null ? null : who === 'member' ? member : who === 'viewer' ? viewer : outsider
    const res = await source({}, actor)
    expect(res.status).toBe(status)
    expect(JSON.stringify(res.body)).not.toContain('非敏感任务')
  })
  it('revocation applies to the next source request using the same login', async () => {
    const token = ctx.loginAs(pm)
    expect((await ctx.asUser(token).post('/_test/us12/source').send({ projectId })).status).toBe(200)
    await ctx.db.projectMember.update({ where: { projectId_userId: { projectId, userId: pm } }, data: { role: 'MEMBER' } })
    expect((await ctx.asUser(token).post('/_test/us12/source').send({ projectId })).status).toBe(403)
  })
  it('root-client read is rejected instead of pretending multi-query consistency', async () => {
    expect((await source({ root: true })).status).toBe(500)
  })
})

describe('stable source baseline', () => {
  it('separate reads preserve digest despite a different capture time', async () => { expect(await revision()).toBe(await revision()) })
  it.each(['planStart', 'status', 'title', 'acceptor', 'role', 'dependency', 'milestone', 'link', 'sensitivity'])('%s change invalidates source', async (kind) => {
    const before = await revision()
    if (kind === 'planStart') await ctx.db.task.update({ where: { id: one }, data: { planStart: '2026-10-19' } })
    if (kind === 'status') await ctx.db.task.update({ where: { id: one }, data: { status: 'DONE' } })
    if (kind === 'title') await ctx.db.task.update({ where: { id: one }, data: { title: '新的非敏感标题' } })
    if (kind === 'acceptor') await ctx.db.task.update({ where: { id: one }, data: { acceptorUserId: viewer } })
    if (kind === 'role') await ctx.db.projectMember.update({ where: { projectId_userId: { projectId, userId: member } }, data: { role: 'VIEWER' } })
    if (kind === 'dependency') await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: one, successorTaskId: two, type: 'FS' } })
    if (kind === 'milestone' || kind === 'link') await ctx.db.milestone.create({ data: { projectId, name: 'm', dueDate: '2026-10-25', tasks: { create: [{ taskId: kind === 'link' ? one : two }] } } })
    if (kind === 'sensitivity') await ctx.db.task.update({ where: { id: one }, data: { isSensitive: true } })
    expect(await revision()).not.toBe(before)
  })
  it('private predecessor date changes invalidate the protected digest', async () => {
    const hidden = await task('隐藏前置', 'TODO', true)
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: hidden.id, successorTaskId: two, type: 'FS' } })
    const before = await revision()
    await ctx.db.task.update({ where: { id: hidden.id }, data: { planEnd: '2026-10-23' } })
    expect(await revision()).not.toBe(before)
  })
  it('unrelated hidden-task changes do not expire every suggestion globally', async () => {
    const hidden = await task('不相关隐藏任务', 'TODO', true)
    const before = await revision()
    await ctx.db.task.update({ where: { id: hidden.id }, data: { planEnd: '2026-10-24' } })
    expect(await revision()).toBe(before)
  })
})

describe('protected constraint verification, still no suggestion disposition', () => {
  async function verify(changes: unknown = [{ taskId: two, planStart: '2026-10-22', planEnd: '2026-10-23' }], savedRevision?: string, extra: Record<string, unknown> = {}) {
    const saved = savedRevision ?? await revision()
    return ctx.asUser(ctx.loginAs(pm)).post('/_test/us12/verify').send({ projectId, revision: saved, changes, ...extra })
  }
  it('validates real public dates without writing plans or recording a disposition', async () => {
    const res = await verify()
    expect(res.body).toMatchObject({ state: 'ok', complete: true, assessment: { canApplyDates: true } })
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: two } })).planEnd).toBe('2026-10-21')
    expect(await ctx.db.auditLog.count()).toBe(0)
  })
  it.each(['DONE', 'CLOSED'])('checks dates of protected %s predecessors, not the separate actual-start gate', async (status) => {
    const hidden = await task('隐藏前置不出外发', status, true)
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: hidden.id, successorTaskId: two } })
    const res = await verify()
    expect(res.body.assessment.canApplyDates).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain(hidden.id)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: hidden.id } })).status).toBe(status)
  })
  it('blocks a private predecessor violation without hidden endpoint/date/title disclosure', async () => {
    const hidden = await task('PRIVATE-PREDECESSOR-TITLE', 'CLOSED', true)
    await ctx.db.task.update({ where: { id: hidden.id }, data: { planEnd: '2026-11-01' } })
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: hidden.id, successorTaskId: two } })
    const res = await verify()
    expect(res.body.assessment.canApplyDates).toBe(false)
    expect(res.body.assessment.blockers).toContainEqual(expect.objectContaining({ code: 'PROTECTED_FS_VIOLATION', taskIds: [] }))
    for (const value of [hidden.id, hidden.title, '2026-11-01']) expect(JSON.stringify(res.body)).not.toContain(value)
  })
  it('checks outgoing private successors against projected end, not just incoming edges', async () => {
    const hidden = await task('隐藏后继', 'TODO', true)
    await ctx.db.task.update({ where: { id: hidden.id }, data: { planStart: '2026-10-23', planEnd: '2026-10-25' } })
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: two, successorTaskId: hidden.id } })
    const res = await verify([{ taskId: two, planStart: '2026-10-22', planEnd: '2026-10-24' }])
    expect(res.body.assessment.canApplyDates).toBe(false)
    expect(res.body.assessment.blockers.some((b: { code: string }) => b.code === 'PROTECTED_FS_VIOLATION')).toBe(true)
  })
  it('mixed milestone overrun is a sanitized warning, not a hard block', async () => {
    const hidden = await task('隐藏关联', 'TODO', true)
    const milestone = await ctx.db.milestone.create({ data: { projectId, name: '不向模型透露的名称', dueDate: '2026-10-22', tasks: { create: [{ taskId: two }, { taskId: hidden.id }] } } })
    const res = await verify()
    expect(res.body.assessment.canApplyDates).toBe(true)
    expect(res.body.assessment.warnings).toContainEqual(expect.objectContaining({ code: 'AFTER_PROTECTED_MILESTONE', taskIds: [two] }))
    for (const value of [hidden.id, milestone.id, milestone.name, milestone.dueDate]) expect(JSON.stringify(res.body)).not.toContain(value)
  })
  it('does not expose the exact number of private FS violations in diagnostics', async () => {
    for (const name of ['a', 'b']) {
      const hidden = await task(`隐藏前置${name}`, 'TODO', true)
      await ctx.db.task.update({ where: { id: hidden.id }, data: { planEnd: '2026-11-01' } })
      await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: hidden.id, successorTaskId: two } })
    }
    const res = await verify()
    expect(res.body.assessment.canApplyDates).toBe(false)
    expect(res.body.assessment.blockers.filter((b: { code: string }) => b.code === 'PROTECTED_FS_VIOLATION')).toHaveLength(1)
  })
  it('coalesces private milestone warnings per public task, not per hidden association', async () => {
    const hidden = await task('隐藏关联不计数外发', 'TODO', true)
    for (const name of ['a', 'b']) await ctx.db.milestone.create({ data: { projectId, name, dueDate: '2026-10-22', tasks: { create: [{ taskId: two }, { taskId: hidden.id }] } } })
    const res = await verify()
    expect(res.body.assessment.canApplyDates).toBe(true)
    expect(res.body.assessment.warnings.filter((w: { code: string }) => w.code === 'AFTER_PROTECTED_MILESTONE')).toHaveLength(1)
  })
  it('an unrelated private edge does not arbitrarily block another candidate', async () => {
    const hidden = await task('另一候选的私有约束', 'TODO', true)
    await ctx.db.task.update({ where: { id: hidden.id }, data: { planEnd: '2026-11-01' } })
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: hidden.id, successorTaskId: one } })
    expect((await source()).body.data.snapshot.sourceConstraints).toBe('requires-private-validation')
    expect((await verify()).body.assessment.canApplyDates).toBe(true)
  })
  it('invalid private endpoint data returns unavailable instead of clearing the private gate', async () => {
    const hidden = await task('非法日期私有任务', 'TODO', true)
    await ctx.db.task.update({ where: { id: hidden.id }, data: { planEnd: 'not-a-date' } })
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: hidden.id, successorTaskId: two } })
    expect((await verify()).body).toMatchObject({ state: 'unavailable', assessment: null })
  })
  it.each(['public', 'private'])('%s source change produces stale, no write', async (kind) => {
    const hidden = await task('隐藏前置', 'TODO', true)
    await ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId: hidden.id, successorTaskId: two } })
    const saved = await revision()
    await ctx.db.task.update({ where: { id: kind === 'public' ? one : hidden.id }, data: { planEnd: '2026-10-24' } })
    expect((await verify(undefined, saved)).body).toMatchObject({ state: 'stale', assessment: null })
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: two } })).planEnd).toBe('2026-10-21')
  })
  it('malformed dates have an internal invalid state, no invented public HTTP mapping', async () => {
    expect((await verify([{ taskId: two, planStart: '2026-02-30', planEnd: '2026-10-23' }])).body).toMatchObject({ state: 'invalid-changes', assessment: null })
  })
  it('cannot adjust a hidden task even if its ID is supplied to the verifier', async () => {
    const hidden = await task('不可改隐藏任务', 'TODO', true)
    const res = await verify([{ taskId: hidden.id, planStart: '2026-10-22', planEnd: '2026-10-23' }])
    expect(res.body).toMatchObject({ state: 'out-of-scope', assessment: null })
    expect(JSON.stringify(res.body)).not.toContain(hidden.id)
  })
  it('cannot broaden an existing proposal to another visible task in the same project', async () => {
    const res = await verify([{ taskId: one, planStart: '2026-10-22', planEnd: '2026-10-23' }], undefined, { restricted: true })
    expect(res.body).toMatchObject({ state: 'out-of-scope', assessment: null })
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: one } })).planStart).toBe('2026-10-20')
  })
  it('missing protected proposal scope is unavailable, not a whole-project fallback', async () => {
    expect((await verify(undefined, undefined, { corruptContext: true })).body).toMatchObject({ state: 'unavailable', assessment: null })
  })
  it('rechecks authorization before reading a saved revision after PM revocation', async () => {
    const saved = await revision()
    await ctx.db.projectMember.update({ where: { projectId_userId: { projectId, userId: pm } }, data: { role: 'MEMBER' } })
    const res = await verify(undefined, saved)
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain(saved)
  })
})

describe('caller-transaction plan capability, not suggestion application', () => {
  it('writes both dates without changing title/status/assignment', async () => {
    const res = await plan()
    expect(res.status).toBe(200)
    const row = await ctx.db.task.findUniqueOrThrow({ where: { id: one } })
    expect(row).toMatchObject({ planStart: '2026-10-22', planEnd: '2026-10-23', title: '非敏感任务一', status: 'TODO', ownerUserId: member, acceptorUserId: pm })
  })
  it('second invalid date order leaves every task unchanged', async () => {
    const res = await plan({ changes: [{ taskId: one, planStart: '2026-10-22', planEnd: '2026-10-23' }, { taskId: two, planStart: '2026-10-25', planEnd: '2026-10-24' }] })
    expect(res.status).toBe(422)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: one } })).planEnd).toBe('2026-10-21')
  })
  it.each(['failAfter', 'failAudit'])('%s rolls back actual SQL changes', async (flag) => {
    expect((await plan({ [flag]: true })).status).toBe(flag === 'failAfter' ? 409 : 500)
    expect((await ctx.db.task.findMany({ where: { projectId } })).every((t) => t.planEnd === '2026-10-21')).toBe(true)
    expect(await ctx.db.auditLog.count()).toBe(0)
  })
  it.each(['foreign', 'missing'])('%s task cannot partially write or escape project scope', async (kind) => {
    let target = 'missing'
    if (kind === 'foreign') {
      const otherProject = await makeProject(ctx.db, pm, '另一个项目')
      const goal = await ctx.db.businessGoal.create({ data: { projectId: otherProject, name: 'g', sortOrder: 0 } })
      const activity = await ctx.db.userActivity.create({ data: { projectId: otherProject, goalId: goal.id, name: 'a', sortOrder: 0 } })
      const story = await ctx.db.userStory.create({ data: { projectId: otherProject, activityId: activity.id, title: 's', roleText: 'r', capabilityText: 'c', valueText: 'v', businessValue: 'b', priority: 'P1' } })
      target = (await ctx.db.task.create({ data: { projectId: otherProject, storyId: story.id, title: 'foreign', ownerUserId: pm, acceptorUserId: member, planStart: '2026-10-20', planEnd: '2026-10-21' } })).id
    }
    const res = await plan({ changes: [{ taskId: one, planStart: '2026-10-22', planEnd: '2026-10-23' }, { taskId: target, planStart: '2026-10-24', planEnd: '2026-10-25' }] })
    expect(res.status).toBe(404)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: one } })).planEnd).toBe('2026-10-21')
  })
  it('current assignment membership is rechecked for every task before writing', async () => {
    await ctx.db.task.update({ where: { id: two }, data: { acceptorUserId: outsider } })
    expect((await plan()).status).toBe(422)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: one } })).planEnd).toBe('2026-10-21')
  })
  it('root-client batch cannot bypass caller transaction requirement', async () => { expect((await plan({ root: true })).status).toBe(500) })
  it('duplicate tasks are rejected without writes', async () => {
    const change = { taskId: one, planStart: '2026-10-22', planEnd: '2026-10-23' }
    expect((await plan({ changes: [change, change] })).status).toBe(422)
  })
  it('member cannot use test plan route', async () => { expect((await plan({}, member)).status).toBe(403) })
  it('base helper does not impose AI TODO-only on ordinary manual edits', async () => {
    await ctx.db.task.update({ where: { id: one }, data: { status: 'DOING' } })
    expect((await ctx.asUser(ctx.loginAs(pm)).patch(`/tasks/${one}`).send({ title: '混合更新', planEnd: '2026-10-24', progress: 40 })).status).toBe(200)
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: one } })).toMatchObject({ title: '混合更新', planEnd: '2026-10-24', status: 'DOING', progress: 40 })
  })
  it('invalid mixed PATCH keeps title/date/progress unchanged', async () => {
    expect((await ctx.asUser(ctx.loginAs(pm)).patch(`/tasks/${one}`).send({ title: '不能留下', planEnd: '2026-10-19', progress: 40 })).status).toBe(422)
    expect(await ctx.db.task.findUniqueOrThrow({ where: { id: one } })).toMatchObject({ title: '非敏感任务一', planEnd: '2026-10-21', progress: null })
  })
  it('production assembly does not expose the test probes or a fake scheduling API', async () => {
    const app = buildApp({ prisma: ctx.db, logger: false })
    try {
      await app.ready()
      expect((await app.inject({ method: 'POST', url: '/_test/us12/source', payload: { projectId } })).statusCode).toBe(404)
      expect((await app.inject({ method: 'POST', url: '/_test/us12/plan', payload: {} })).statusCode).toBe(404)
      expect((await app.inject({ method: 'POST', url: '/_test/us12/verify', payload: {} })).statusCode).toBe(404)
    } finally { await app.close() }
  })
})
