import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assessmentRequestSchema, schedulingSnapshotSchema } from './schemas.js'
import type { SchedulingSnapshot } from './schemas.js'
import { assessSchedulingDates, buildSchedulingInput, sameSchedulingBaseline, shanghaiToday } from './policy.js'

/** Test-only HTTP adapter. Not production routes/auth/AI/DB integration or final AC evidence. */
const app = Fastify()
const now = new Date('2026-10-18T02:00:00Z')
beforeAll(async () => {
  app.post('/_test/assessment', async (request, reply) => {
    const parsed = assessmentRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(422).send({ error: { code: 'VALIDATION_FAILED' } })
    return assessSchedulingDates(parsed.data.snapshot, parsed.data.changes, now)
  })
  app.post('/_test/input', async (request, reply) => {
    const parsed = schedulingSnapshotSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(422).send({ error: { code: 'VALIDATION_FAILED' } })
    return buildSchedulingInput(parsed.data)
  })
  app.post('/_test/baseline', async (request) => {
    const body = request.body as { before: SchedulingSnapshot; after: SchedulingSnapshot }
    return { same: sameSchedulingBaseline(body.before, body.after) }
  })
  app.get('/_test/today', async (request) => ({ today: shanghaiToday(new Date((request.query as { now: string }).now)) }))
  await app.ready()
})
afterAll(() => app.close())

function fixture(): SchedulingSnapshot {
  const task = { projectId: 'p1', title: 'invented task', ownerUserId: 'u1', acceptorUserId: 'u2', status: 'TODO' as const,
    planStart: '2026-10-20', planEnd: '2026-10-21', isSensitive: false }
  return { projectId: 'p1', revision: 'v1', capturedAt: '2026-10-18T02:00:00Z', memberIds: ['u1', 'u2'],
    tasks: [{ ...task, id: 'a' }, { ...task, id: 'b', ownerUserId: 'u2', acceptorUserId: 'u1', planStart: '2026-10-22', planEnd: '2026-10-23' }],
    dependencies: [{ predecessorId: 'a', successorId: 'b' }], milestones: [{ id: 'm1', taskIds: ['b'], date: '2026-10-23' }] }
}
const dates = (taskId = 'a', planStart = '2026-10-19', planEnd = '2026-10-20') => ({ taskId, planStart, planEnd })
async function assess(snapshot = fixture(), changes: unknown = [dates()]) {
  return app.inject({ method: 'POST', url: '/_test/assessment', payload: { snapshot, changes } })
}
async function input(snapshot: SchedulingSnapshot) {
  return (await app.inject({ method: 'POST', url: '/_test/input', payload: snapshot })).json()
}
async function same(before: SchedulingSnapshot, after: SchedulingSnapshot) {
  return (await app.inject({ method: 'POST', url: '/_test/baseline', payload: { before, after } })).json().same
}

describe('US12 approved policy through test-only HTTP seam', () => {
  it('assesses dates without mutating baseline or performing writes', async () => {
    const snapshot = fixture(); const before = JSON.stringify(snapshot)
    const response = await assess(snapshot)
    expect(response.statusCode).toBe(200)
    expect(response.json().canApplyDates).toBe(true)
    expect(JSON.stringify(snapshot)).toBe(before)
  })
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-01-00', '2026-1-01', '', '2026-10-20T00:00:00Z'])('rejects invalid natural date %s', async (value) => {
    expect((await assess(fixture(), [dates('a', value)])).statusCode).toBe(422)
  })
  it('accepts a valid leap date shape (then enforces past-date policy)', async () => {
    const response = await assess(fixture(), [dates('a', '2024-02-29', '2024-03-01')])
    expect(response.statusCode).toBe(200)
    expect(response.json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'START_BEFORE_TODAY' })]))
  })
  it.each(['ownerUserId', 'acceptorUserId', 'status', 'projectId', 'isSensitive'])('rejects unauthorized patch field %s instead of stripping it', async (field) => {
    const response = await assess(fixture(), [{ ...dates(), [field]: 'injected' }])
    expect(response.statusCode).toBe(422)
    expect(response.body).not.toContain('injected')
  })
  it('requires at least one change', async () => { expect((await assess(fixture(), [])).statusCode).toBe(422) })
  it('blocks inverted range', async () => {
    expect((await assess(fixture(), [dates('a', '2026-10-21', '2026-10-20')])).json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'END_BEFORE_START' })]))
  })
  it('allows today and inclusive single-day duration', async () => {
    expect((await assess(fixture(), [dates('a', '2026-10-18', '2026-10-18')])).json().canApplyDates).toBe(true)
  })
  it.each(['DOING', 'BLOCKED', 'SUSPENDED', 'DONE', 'CLOSED'] as const)('never reschedules %s', async (status) => {
    const snapshot = fixture(); snapshot.tasks[0]!.status = status
    expect((await assess(snapshot)).json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NOT_TODO' })]))
  })
  it('rejects duplicate adjustment', async () => {
    expect((await assess(fixture(), [dates(), dates()])).json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_TASK' })]))
  })
  it('blocks duplicate snapshot IDs', async () => {
    const snapshot = fixture(); snapshot.tasks.push({ ...snapshot.tasks[0]! })
    expect((await assess(snapshot)).json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INVALID_SNAPSHOT' })]))
  })
  it.each(['same-person', 'removed-owner', 'single-member'])('retains assignment guards: %s', async (caseName) => {
    const snapshot = fixture()
    if (caseName === 'same-person') snapshot.tasks[0]!.acceptorUserId = 'u1'
    if (caseName === 'removed-owner') snapshot.tasks[0]!.ownerUserId = 'removed'
    if (caseName === 'single-member') snapshot.memberIds = ['u1']
    expect((await assess(snapshot)).json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ASSIGNMENT_INVALID' })]))
  })
  it('rejects unavailable IDs without echoing them', async () => {
    const response = await assess(fixture(), [dates('hidden-secret-id')])
    expect(response.json().canApplyDates).toBe(false)
    expect(response.body).not.toContain('hidden-secret-id')
  })
  it('does not include cross-project objects in AI input or adjustments', async () => {
    const snapshot = fixture(); snapshot.tasks[0]!.projectId = 'other'; snapshot.tasks[0]!.title = 'OTHER_PROJECT_TITLE'
    expect(JSON.stringify(await input(snapshot))).not.toContain('OTHER_PROJECT_TITLE')
    expect((await assess(snapshot)).json().canApplyDates).toBe(false)
  })
  it('checks FS against both projected dates, next day is valid', async () => {
    expect((await assess(fixture(), [dates('a', '2026-10-20', '2026-10-22')])).json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FS_PLAN_VIOLATION' })]))
    expect((await assess(fixture(), [dates('a', '2026-10-20', '2026-10-22'), dates('b', '2026-10-23', '2026-10-24')])).json().canApplyDates).toBe(true)
  })
  it('does not confuse FS planned dates with actual CLOSED start gate', async () => {
    const snapshot = fixture(); snapshot.tasks[0]!.status = 'DONE'
    // This policy adjusts dates, not actual execution: no task status is changed or opened.
    expect((await assess(snapshot, [dates('b', '2026-10-22', '2026-10-23')])).json().canApplyDates).toBe(true)
  })
  it('fails closed on excluded dependency without leaking its identity', async () => {
    const snapshot = fixture(); snapshot.tasks[0]!.isSensitive = true; snapshot.tasks[0]!.id = 'secret-predecessor'
    snapshot.dependencies[0]!.predecessorId = 'secret-predecessor'
    const response = await assess(snapshot, [dates('b', '2026-10-22', '2026-10-23')])
    expect(response.json().blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INCOMPLETE_DEPENDENCY' })]))
    expect(response.body).not.toContain('secret-predecessor')
  })
  it('warns, not blocks, inclusive overlap/delay/milestone; counts DONE as open', async () => {
    const snapshot = fixture(); snapshot.dependencies = []
    snapshot.tasks[0]!.status = 'DONE'; snapshot.tasks[1]!.ownerUserId = 'u1'; snapshot.tasks[1]!.acceptorUserId = 'u2'
    const response = (await assess(snapshot, [dates('b', '2026-10-21', '2026-10-24')])).json()
    expect(response.canApplyDates).toBe(true)
    expect(response.warnings.map((item: { code: string }) => item.code)).toEqual(expect.arrayContaining(['OWNER_DATE_OVERLAP', 'LATER_THAN_BASELINE', 'AFTER_MILESTONE']))
    expect(response.workload).toContainEqual({ userId: 'u1', openTaskCount: 2 })
  })
  it('never invents milestones or overload thresholds', async () => {
    const snapshot = fixture(); snapshot.milestones = []
    const response = (await assess(snapshot, [dates('b', '2026-10-22', '2026-11-01')])).json()
    expect(response.warnings.map((item: { code: string }) => item.code)).toEqual(['LATER_THAN_BASELINE'])
  })
  it('excludes sensitive tasks, links, mixed milestones and counts even for PM input', async () => {
    const snapshot = fixture(); snapshot.tasks[0]!.isSensitive = true; snapshot.tasks[0]!.title = 'SECRET_TITLE'
    snapshot.tasks[0]!.id = 'SECRET_ID'; snapshot.dependencies[0]!.predecessorId = 'SECRET_ID'
    snapshot.milestones[0]!.taskIds.push('SECRET_ID'); snapshot.milestones[0]!.id = 'SECRET_MILESTONE'
    const context = await input(snapshot)
    expect(context.tasks).toHaveLength(1); expect(context.dependencies).toHaveLength(0); expect(context.milestones).toHaveLength(0)
    expect(JSON.stringify(context)).not.toContain('SECRET')
    expect(context.workload).toContainEqual({ userId: 'u1', openTaskCount: 0 })
    expect(context.scope).toContain('不是 PM 全项目基数')
  })
  it('does not send acceptor or sensitivity flags to an AI input proposal', async () => {
    const context = await input(fixture())
    expect(context.tasks[0]).not.toHaveProperty('acceptorUserId')
    expect(context.tasks[0]).not.toHaveProperty('isSensitive')
  })
  it.each(['incomplete', 'unavailable', 'private'] as const)('fails closed on explicit source evidence: %s', async (kind) => {
    const snapshot = fixture()
    if (kind === 'incomplete') snapshot.sourceComplete = false
    if (kind === 'unavailable') snapshot.sourceConstraints = 'unavailable'
    if (kind === 'private') snapshot.sourceConstraints = 'requires-private-validation'
    const res = (await assess(snapshot)).json()
    expect(res.canApplyDates).toBe(false)
    expect(res.blockers).toEqual(expect.arrayContaining([expect.objectContaining({
      code: kind === 'private' ? 'PRIVATE_VALIDATION_REQUIRED' : 'INCOMPLETE_SOURCE',
    })]))
  })
  it('membership role change expires a baseline even with the same member IDs', async () => {
    const before = fixture(); const after = fixture()
    before.memberRoles = [{ userId: 'u1', role: 'PM' }, { userId: 'u2', role: 'MEMBER' }]
    after.memberRoles = [{ userId: 'u1', role: 'PM' }, { userId: 'u2', role: 'VIEWER' }]
    expect(await same(before, after)).toBe(false)
  })
  it('does not send a private-derived revision or source evidence to a model', async () => {
    const snapshot = fixture(); snapshot.revision = 'PRIVATE-DIGEST'
    snapshot.sourceConstraints = 'requires-private-validation'; snapshot.sourceComplete = true
    const text = JSON.stringify(await input(snapshot))
    expect(text).not.toContain('PRIVATE-DIGEST')
    expect(text).not.toContain('sourceConstraints')
    expect(text).not.toContain('sourceComplete')
  })
  it('compares baselines independent of ordering/capture time', async () => {
    const before = fixture(); const after = fixture(); after.tasks.reverse(); after.memberIds.reverse(); after.capturedAt = '2026-10-19T00:00:00Z'
    expect(await same(before, after)).toBe(true)
  })
  it.each(['revision', 'date', 'status', 'owner', 'acceptor', 'members', 'fs', 'milestone', 'sensitivity', 'story'])('invalidates changed baseline: %s', async (kind) => {
    const before = fixture(); const after = fixture()
    if (kind === 'revision') after.revision = 'permissions-v2'
    if (kind === 'date') after.tasks[0]!.planEnd = '2026-10-22'
    if (kind === 'status') after.tasks[0]!.status = 'DOING'
    if (kind === 'owner') after.tasks[0]!.ownerUserId = 'u2'
    if (kind === 'acceptor') after.tasks[0]!.acceptorUserId = 'u1'
    if (kind === 'members') after.memberIds.pop()
    if (kind === 'fs') after.dependencies = []
    if (kind === 'milestone') after.milestones[0]!.date = '2026-10-24'
    if (kind === 'sensitivity') after.tasks[0]!.isSensitive = true
    if (kind === 'story') after.tasks[0]!.storyId = 'another-parent-story'
    expect(await same(before, after)).toBe(false)
  })
  it.each([
    ['2026-10-18T15:59:59Z', '2026-10-18'], ['2026-10-18T16:00:00Z', '2026-10-19'],
    ['2026-12-31T16:00:00Z', '2027-01-01'],
  ])('uses Shanghai boundary %s', async (instant, today) => {
    const response = await app.inject({ url: `/_test/today?now=${encodeURIComponent(instant)}` })
    expect(response.json().today).toBe(today)
  })
})
