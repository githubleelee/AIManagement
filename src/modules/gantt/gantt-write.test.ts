/**
 * US-06 甘特图（GitHub #26，本地 #12）—— 里程碑与 FS 依赖**写路径**模块测试。
 *
 * 唯一 seam 是 HTTP 接口层（契约 Testing Decisions）：全部通过 supertest 发请求、
 * 断言状态码 / 响应体 / 库内落数据；造数用 `test/factories.ts` 与局部 seed 辅助
 * （工厂不覆盖里程碑 / 依赖 / 指定 createdAt 的任务）。
 *
 * 覆盖（对应主代理下发的用例清单）：
 *   - 权限矩阵：每类端点的 PM 成功 / MEMBER 403 / VIEWER 403 / outsider 404 / 未登录 401；
 *   - 里程碑：创建（含 taskIds，按 createdAt asc, id asc）/ dueDate 非法 / 负责人非成员 /
 *     taskIds 跨项目与不存在同一条 / PATCH 替换语义 / DELETE 级联清理 / 他项目 id 404；
 *   - 依赖：FS 创建 / 非 FS 类型 / 自依赖 / 跨项目与不存在同一条 / 重复边 /
 *     二节点环 / 三节点环 / **并发互反建边**（恰好一个 201、一个 409）/ DELETE / 不存在 404；
 *   - 回归：写成功后 `GET /projects/:projectId/gantt` 能读到新里程碑与依赖。
 *
 * `src/routes.ts` 已注册本插件：这里保留 `hasRoute` 守卫，避免重复注册
 * （Fastify 重复注册会抛 FST_ERR_DUPLICATED_ROUTE），同时让本文件在未挂载的
 * 分支上也能独立运行。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpTestContext,
  setActiveDatabase,
  type HttpTestContext,
} from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeUser,
} from '../../../test/factories.js'
import type { UserBrief } from '../../shared/types.js'
import { registerGanttRoutes } from './plugin.js'
import type { GanttView, MilestoneWriteView, TaskDependencyView } from './types.js'

type ErrorBody = {
  error: {
    code: string
    message: string
    details?: Array<{ field: string; code: string }>
  }
}

let ctx: HttpTestContext
let pm: UserBrief
let member: UserBrief
let viewer: UserBrief
let outsider: UserBrief
let projectId: string
let activityId: string

const MILESTONE_ROUTE = '/projects/:projectId/milestones'
const MILESTONE_BY_ID_ROUTE = '/milestones/:milestoneId'
const DEPENDENCY_ROUTE = '/projects/:projectId/task-dependencies'
const DEPENDENCY_BY_ID_ROUTE = '/task-dependencies/:dependencyId'

beforeAll(async () => {
  ctx = await createHttpTestContext()
  setActiveDatabase(ctx.db)

  const registered = [
    { method: 'GET' as const, url: '/projects/:projectId/gantt' },
    { method: 'POST' as const, url: MILESTONE_ROUTE },
    { method: 'PATCH' as const, url: MILESTONE_BY_ID_ROUTE },
    { method: 'DELETE' as const, url: MILESTONE_BY_ID_ROUTE },
    { method: 'POST' as const, url: DEPENDENCY_ROUTE },
    { method: 'DELETE' as const, url: DEPENDENCY_BY_ID_ROUTE },
  ]
  if (registered.some((route) => !ctx.app.hasRoute(route))) {
    registerGanttRoutes(ctx.app, { prisma: ctx.db })
  }
  await ctx.app.ready()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()

  pm = await makeUser('pm@example.com', 'Dave')
  member = await makeUser('member@example.com', 'Alice')
  viewer = await makeUser('viewer@example.com', 'Carol')
  outsider = await makeUser('outsider@example.com', 'Outsider')

  const created = await makeProject(pm.id, '甘特写路径测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  activityId = await makeActivity(goalId, '活动')

  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

// ---------------------------------------------------------------------------
// 造数辅助（直接写库；工厂不覆盖里程碑 / 依赖 / 指定 createdAt 的任务）
// ---------------------------------------------------------------------------

async function seedStory(title = '故事'): Promise<string> {
  const row = await ctx.db.userStory.create({
    data: {
      projectId,
      activityId,
      title,
      roleText: '角色',
      capabilityText: '能力',
      valueText: '价值',
      businessValue: '业务价值',
      priority: 'P0',
    },
    select: { id: true },
  })
  return row.id
}

/** 造一个本项目任务；`createdAt` 显式给定，保证里程碑 `taskIds` 的排序断言确定。 */
async function seedTask(input: {
  storyId: string
  title?: string
  createdAt?: Date
  ownerUserId?: string
}): Promise<string> {
  const row = await ctx.db.task.create({
    data: {
      projectId,
      storyId: input.storyId,
      title: input.title ?? '任务',
      ownerUserId: input.ownerUserId ?? member.id,
      acceptorUserId: pm.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  })
  return row.id
}

/** 另一个项目（含任务与里程碑），用于「跨项目引用」与「他项目 id 404」用例。 */
async function seedOtherProject(): Promise<{
  projectId: string
  taskId: string
  milestoneId: string
}> {
  const pm2 = await makeUser('pm2@example.com', 'Eve')
  const other = await makeProject(pm2.id, '另一个项目')
  const goalId = await makeGoal(other.projectId, '别项目标')
  const otherActivityId = await makeActivity(goalId, '别项活动')
  const story = await ctx.db.userStory.create({
    data: {
      projectId: other.projectId,
      activityId: otherActivityId,
      title: '别项故事',
      roleText: '角色',
      capabilityText: '能力',
      valueText: '价值',
      businessValue: '业务价值',
      priority: 'P0',
    },
    select: { id: true },
  })
  const task = await ctx.db.task.create({
    data: {
      projectId: other.projectId,
      storyId: story.id,
      title: '别项任务',
      ownerUserId: pm2.id,
      acceptorUserId: pm2.id,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
    },
    select: { id: true },
  })
  const milestone = await ctx.db.milestone.create({
    data: { projectId: other.projectId, name: '别项里程碑', dueDate: '2026-03-01' },
    select: { id: true },
  })
  return { projectId: other.projectId, taskId: task.id, milestoneId: milestone.id }
}

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

/** 以某个用户身份发请求；`null` = 不带 Authorization 头（未登录）。 */
function api(actorUserId: string | null) {
  return ctx.asUser(actorUserId === null ? null : ctx.loginAs(actorUserId))
}

function postMilestone(actorUserId: string | null, body: Record<string, unknown>, project = projectId) {
  return api(actorUserId).post(`/projects/${project}/milestones`).send(body)
}

function patchMilestone(actorUserId: string | null, milestoneId: string, body: Record<string, unknown>) {
  return api(actorUserId).patch(`/milestones/${milestoneId}`).send(body)
}

function deleteMilestone(actorUserId: string | null, milestoneId: string) {
  return api(actorUserId).delete(`/milestones/${milestoneId}`)
}

function postDependency(
  actorUserId: string | null,
  body: Record<string, unknown>,
  project = projectId,
) {
  return api(actorUserId).post(`/projects/${project}/task-dependencies`).send(body)
}

function deleteDependency(actorUserId: string | null, dependencyId: string) {
  return api(actorUserId).delete(`/task-dependencies/${dependencyId}`)
}

function errorOf(res: { body: unknown }): ErrorBody['error'] {
  return (res.body as ErrorBody).error
}

function fieldCodeOf(res: { body: unknown }, field: string): string | undefined {
  return errorOf(res).details?.find((detail) => detail.field === field)?.code
}

/** 断 403：对象可见但无写权限（`gantt.write` 仅 PM）。 */
function expectForbidden(res: { status: number; body: unknown }): void {
  expect(res.status).toBe(403)
  expect(errorOf(res).code).toBe('FORBIDDEN')
}

/** 断 404：对象不存在 / 非项目成员，文案与读端点逐字一致。 */
function expectProjectNotFound(res: { status: number; body: unknown }): void {
  expect(res.status).toBe(404)
  expect(errorOf(res).code).toBe('NOT_FOUND')
  expect(errorOf(res).message).toBe('项目不存在')
}

/** 断 422 + 单一字段错误码。 */
function expectValidation(
  res: { status: number; body: unknown },
  field: string,
  code: string,
): void {
  expect(res.status).toBe(422)
  expect(errorOf(res).code).toBe('VALIDATION_FAILED')
  expect(fieldCodeOf(res, field)).toBe(code)
}

/** 断 409 + 单一字段错误码。 */
function expectConflict(res: { status: number; body: unknown }, field: string, code: string): void {
  expect(res.status).toBe(409)
  expect(errorOf(res).code).toBe('CONFLICT')
  expect(fieldCodeOf(res, field)).toBe(code)
}

async function createMilestoneOk(
  actorUserId: string,
  body: Record<string, unknown>,
): Promise<MilestoneWriteView> {
  const res = await postMilestone(actorUserId, body)
  expect(res.status).toBe(201)
  return res.body as MilestoneWriteView
}

async function createDependencyOk(
  actorUserId: string,
  predecessorTaskId: string,
  successorTaskId: string,
): Promise<TaskDependencyView> {
  const res = await postDependency(actorUserId, { predecessorTaskId, successorTaskId })
  expect(res.status).toBe(201)
  return res.body as TaskDependencyView
}

// ---------------------------------------------------------------------------
// 权限矩阵：每类端点各一轮（PM 成功 / MEMBER 403 / VIEWER 403 / outsider 404 / 未登录 401）
// ---------------------------------------------------------------------------

describe('写端点权限矩阵（`gantt.write` 仅 PM）', () => {
  it('POST /projects/:projectId/milestones', async () => {
    const storyId = await seedStory()
    const taskId = await seedTask({ storyId })
    const body = { name: '权限里程碑', dueDate: '2026-02-01', taskIds: [taskId] }

    const created = await postMilestone(pm.id, body)
    expect(created.status).toBe(201)

    expectForbidden(await postMilestone(member.id, body))
    expectForbidden(await postMilestone(viewer.id, body))
    expectProjectNotFound(await postMilestone(outsider.id, body))
    expect((await postMilestone(null, body)).status).toBe(401)
  })

  it('PATCH /milestones/:milestoneId', async () => {
    const created = await createMilestoneOk(pm.id, { name: '原名称', dueDate: '2026-02-01' })

    const patched = await patchMilestone(pm.id, created.id, { name: '新名称' })
    expect(patched.status).toBe(200)
    expect((patched.body as MilestoneWriteView).name).toBe('新名称')

    expectForbidden(await patchMilestone(member.id, created.id, { name: '越权' }))
    expectForbidden(await patchMilestone(viewer.id, created.id, { name: '越权' }))
    expectProjectNotFound(await patchMilestone(outsider.id, created.id, { name: '越权' }))
    expect((await patchMilestone(null, created.id, { name: '越权' })).status).toBe(401)
  })

  it('DELETE /milestones/:milestoneId', async () => {
    const victim = await createMilestoneOk(pm.id, { name: '待删除', dueDate: '2026-02-01' })
    const forMember = await createMilestoneOk(pm.id, { name: '给成员试', dueDate: '2026-02-02' })
    const forViewer = await createMilestoneOk(pm.id, { name: '给观察者试', dueDate: '2026-02-03' })
    const forOutsider = await createMilestoneOk(pm.id, { name: '给外部试', dueDate: '2026-02-04' })

    expect((await deleteMilestone(pm.id, victim.id)).status).toBe(204)
    expectForbidden(await deleteMilestone(member.id, forMember.id))
    expectForbidden(await deleteMilestone(viewer.id, forViewer.id))
    expectProjectNotFound(await deleteMilestone(outsider.id, forOutsider.id))
    expect((await deleteMilestone(null, forOutsider.id)).status).toBe(401)
  })

  it('POST /projects/:projectId/task-dependencies', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })
    const body = { predecessorTaskId: t1, successorTaskId: t2, type: 'FS' }

    expect((await postDependency(pm.id, body)).status).toBe(201)

    expectForbidden(await postDependency(member.id, body))
    expectForbidden(await postDependency(viewer.id, body))
    expectProjectNotFound(await postDependency(outsider.id, body))
    expect((await postDependency(null, body)).status).toBe(401)
  })

  it('DELETE /task-dependencies/:dependencyId', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })
    const t3 = await seedTask({ storyId })
    const t4 = await seedTask({ storyId })
    const forPm = await createDependencyOk(pm.id, t1, t2)
    const forMember = await createDependencyOk(pm.id, t2, t3)
    const forViewer = await createDependencyOk(pm.id, t3, t4)

    expect((await deleteDependency(pm.id, forPm.id)).status).toBe(204)
    expectForbidden(await deleteDependency(member.id, forMember.id))
    expectForbidden(await deleteDependency(viewer.id, forViewer.id))
    expectProjectNotFound(await deleteDependency(outsider.id, forViewer.id))
    expect((await deleteDependency(null, forViewer.id)).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// 里程碑写路径
// ---------------------------------------------------------------------------

describe('POST /projects/:projectId/milestones', () => {
  it('创建（含 taskIds）→ 201，taskIds 按 createdAt asc, id asc 且去重', async () => {
    const storyId = await seedStory()
    const earlier = await seedTask({
      storyId,
      title: '较早任务',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    const later = await seedTask({
      storyId,
      title: '较晚任务',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })

    // 请求里故意后序、重复 —— 响应须归一为 createdAt 升序且去重
    const view = await createMilestoneOk(pm.id, {
      name: '里程碑 A',
      dueDate: '2026-02-10',
      ownerUserId: member.id,
      taskIds: [later, earlier, later],
    })

    expect(view).toMatchObject({
      projectId,
      name: '里程碑 A',
      dueDate: '2026-02-10',
      ownerUserId: member.id,
      owner: { id: member.id, account: 'member@example.com', displayName: 'Alice' },
      taskIds: [earlier, later],
    })
    expect(typeof view.createdAt).toBe('string')
    expect(Object.keys(view).sort()).toEqual([
      'createdAt',
      'dueDate',
      'id',
      'name',
      'owner',
      'ownerUserId',
      'projectId',
      'taskIds',
    ])
    expect(await ctx.db.taskMilestone.count({ where: { milestoneId: view.id } })).toBe(2)
  })

  it('无 taskIds / 无 ownerUserId → 空关联、负责人 null', async () => {
    const view = await createMilestoneOk(pm.id, { name: '空里程碑', dueDate: '2026-02-10' })
    expect(view.taskIds).toEqual([])
    expect(view.ownerUserId).toBeNull()
    expect(view.owner).toBeNull()
  })

  it('dueDate 非法 → 422（格式 INVALID_FORMAT / 日历不存在 INVALID_VALUE）', async () => {
    const badFormat = await postMilestone(pm.id, { name: 'X', dueDate: '2026-2-1' })
    expectValidation(badFormat, 'dueDate', 'INVALID_FORMAT')

    const badCalendar = await postMilestone(pm.id, { name: 'X', dueDate: '2026-02-30' })
    expectValidation(badCalendar, 'dueDate', 'INVALID_VALUE')
    expect(await ctx.db.milestone.count({ where: { projectId } })).toBe(0)
  })

  it('ownerUserId 非本项目成员 → 422 NOT_PROJECT_MEMBER', async () => {
    const res = await postMilestone(pm.id, {
      name: 'X',
      dueDate: '2026-02-10',
      ownerUserId: outsider.id,
    })
    expectValidation(res, 'ownerUserId', 'NOT_PROJECT_MEMBER')
  })

  it('taskIds 跨项目 / 不存在 → 422 CROSS_PROJECT_REF，且两者响应逐字一致', async () => {
    const other = await seedOtherProject()

    const crossProject = await postMilestone(pm.id, {
      name: 'X',
      dueDate: '2026-02-10',
      taskIds: [other.taskId],
    })
    expectValidation(crossProject, 'taskIds', 'CROSS_PROJECT_REF')

    const missing = await postMilestone(pm.id, {
      name: 'X',
      dueDate: '2026-02-10',
      taskIds: ['no-such-task'],
    })
    expectValidation(missing, 'taskIds', 'CROSS_PROJECT_REF')

    // 不造存在性预言机：跨项目与不存在返回同一条响应
    expect(missing.body).toEqual(crossProject.body)
    expect(await ctx.db.milestone.count({ where: { projectId } })).toBe(0)
  })
})

describe('PATCH /milestones/:milestoneId', () => {
  it('改 name / dueDate，taskIds 出现即整体替换（旧关联消失）', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId, createdAt: new Date('2026-01-01T00:00:00Z') })
    const t2 = await seedTask({ storyId, createdAt: new Date('2026-01-02T00:00:00Z') })
    const created = await createMilestoneOk(pm.id, {
      name: '旧名称',
      dueDate: '2026-02-01',
      ownerUserId: member.id,
      taskIds: [t1, t2],
    })

    const res = await patchMilestone(pm.id, created.id, {
      name: '新名称',
      dueDate: '2026-03-15',
      taskIds: [t2],
    })
    expect(res.status).toBe(200)
    const view = res.body as MilestoneWriteView
    expect(view).toMatchObject({
      id: created.id,
      name: '新名称',
      dueDate: '2026-03-15',
      ownerUserId: member.id,
      taskIds: [t2],
    })
    expect(await ctx.db.taskMilestone.count({ where: { milestoneId: created.id } })).toBe(1)
    expect(
      await ctx.db.taskMilestone.count({ where: { milestoneId: created.id, taskId: t1 } }),
    ).toBe(0)
  })

  it('taskIds = [] 清空关联；未提供 taskIds 时不动关联', async () => {
    const storyId = await seedStory()
    const taskId = await seedTask({ storyId })
    const created = await createMilestoneOk(pm.id, {
      name: '关联里程碑',
      dueDate: '2026-02-01',
      taskIds: [taskId],
    })

    const renamed = await patchMilestone(pm.id, created.id, { name: '只改名' })
    expect((renamed.body as MilestoneWriteView).taskIds).toEqual([taskId])

    const cleared = await patchMilestone(pm.id, created.id, { taskIds: [] })
    expect((cleared.body as MilestoneWriteView).taskIds).toEqual([])
    expect(await ctx.db.taskMilestone.count({ where: { milestoneId: created.id } })).toBe(0)
  })

  it('ownerUserId / dueDate / taskIds 的非法取值 → 422（不落库）', async () => {
    const other = await seedOtherProject()
    const created = await createMilestoneOk(pm.id, { name: '原名称', dueDate: '2026-02-01' })

    expectValidation(
      await patchMilestone(pm.id, created.id, { dueDate: '2026-04-31' }),
      'dueDate',
      'INVALID_VALUE',
    )
    expectValidation(
      await patchMilestone(pm.id, created.id, { ownerUserId: outsider.id }),
      'ownerUserId',
      'NOT_PROJECT_MEMBER',
    )
    expectValidation(
      await patchMilestone(pm.id, created.id, { taskIds: [other.taskId] }),
      'taskIds',
      'CROSS_PROJECT_REF',
    )

    const row = await ctx.db.milestone.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.name).toBe('原名称')
    expect(row.dueDate).toBe('2026-02-01')
    expect(row.ownerUserId).toBeNull()
  })

  it('他项目里程碑 id / 不存在 id → 404，且与「项目不存在」逐字一致', async () => {
    const other = await seedOtherProject()
    const foreign = await patchMilestone(pm.id, other.milestoneId, { name: '越权' })
    expectProjectNotFound(foreign)

    const missing = await patchMilestone(pm.id, 'no-such-milestone', { name: '越权' })
    expectProjectNotFound(missing)
    expect(missing.body).toEqual(foreign.body)

    // 别项目确实没被改动
    const row = await ctx.db.milestone.findUniqueOrThrow({ where: { id: other.milestoneId } })
    expect(row.name).toBe('别项里程碑')
  })
})

describe('DELETE /milestones/:milestoneId', () => {
  it('删除 → 204，里程碑与 TaskMilestone 关联行都被清理', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })
    const created = await createMilestoneOk(pm.id, {
      name: '待删里程碑',
      dueDate: '2026-02-01',
      taskIds: [t1, t2],
    })
    expect(await ctx.db.taskMilestone.count({ where: { milestoneId: created.id } })).toBe(2)

    const res = await deleteMilestone(pm.id, created.id)
    expect(res.status).toBe(204)
    expect(res.text).toBe('')

    expect(await ctx.db.milestone.findUnique({ where: { id: created.id } })).toBeNull()
    expect(await ctx.db.taskMilestone.count({ where: { milestoneId: created.id } })).toBe(0)
    // 任务本身不受影响
    expect(await ctx.db.task.count({ where: { projectId } })).toBe(2)
  })

  it('他项目里程碑 id / 不存在 id → 404', async () => {
    const other = await seedOtherProject()
    expectProjectNotFound(await deleteMilestone(pm.id, other.milestoneId))
    expectProjectNotFound(await deleteMilestone(pm.id, 'no-such-milestone'))
    // 别项目里程碑仍然存在
    expect(await ctx.db.milestone.findUnique({ where: { id: other.milestoneId } })).not.toBeNull()
  })

  it('并发两次 DELETE → 恰好一个 204、另一个 404（不得 500），关联行被清理', async () => {
    const storyId = await seedStory()
    const taskId = await seedTask({ storyId })
    const created = await createMilestoneOk(pm.id, {
      name: '并发删除里程碑',
      dueDate: '2026-02-01',
      taskIds: [taskId],
    })
    expect(await ctx.db.taskMilestone.count({ where: { milestoneId: created.id } })).toBe(1)

    const token = ctx.loginAs(pm.id)
    const url = `/milestones/${created.id}`
    const [first, second] = await Promise.all([
      ctx.asUser(token).delete(url),
      ctx.asUser(token).delete(url),
    ])

    expect([first.status, second.status].sort()).toEqual([204, 404])
    // 后到者：P2025 已映射为与「不存在」逐字一致的 404，不是 500
    expectProjectNotFound(first.status === 404 ? first : second)
    expect(await ctx.db.milestone.findUnique({ where: { id: created.id } })).toBeNull()
    expect(await ctx.db.taskMilestone.count({ where: { milestoneId: created.id } })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// FS 依赖写路径
// ---------------------------------------------------------------------------

describe('POST /projects/:projectId/task-dependencies', () => {
  it('创建 FS → 201；type 缺省视为 FS', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })

    const view = await createDependencyOk(pm.id, t1, t2)
    expect(view).toMatchObject({
      projectId,
      predecessorTaskId: t1,
      successorTaskId: t2,
      type: 'FS',
    })
    expect(typeof view.createdAt).toBe('string')
    expect(Object.keys(view).sort()).toEqual([
      'createdAt',
      'id',
      'predecessorTaskId',
      'projectId',
      'successorTaskId',
      'type',
    ])
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(1)
  })

  it("type 非 'FS'（SS / FF / SF）→ 422 INVALID_VALUE（field type）", async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })

    for (const type of ['SS', 'FF', 'SF', 'fs']) {
      const res = await postDependency(pm.id, {
        predecessorTaskId: t1,
        successorTaskId: t2,
        type,
      })
      expectValidation(res, 'type', 'INVALID_VALUE')
    }
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(0)
  })

  it('自依赖 → 422 INVALID_VALUE（field successorTaskId）', async () => {
    const storyId = await seedStory()
    const taskId = await seedTask({ storyId })

    const res = await postDependency(pm.id, {
      predecessorTaskId: taskId,
      successorTaskId: taskId,
    })
    expectValidation(res, 'successorTaskId', 'INVALID_VALUE')
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(0)
  })

  it('跨项目 / 不存在任务 → 422 CROSS_PROJECT_REF，且「不可见」与「不存在」响应一致', async () => {
    const storyId = await seedStory()
    const taskId = await seedTask({ storyId })
    const other = await seedOtherProject()

    // 后继跨项目
    const successorCross = await postDependency(pm.id, {
      predecessorTaskId: taskId,
      successorTaskId: other.taskId,
    })
    expectValidation(successorCross, 'successorTaskId', 'CROSS_PROJECT_REF')

    // 后继不存在 —— 同一条响应（不造存在性预言机）
    const successorMissing = await postDependency(pm.id, {
      predecessorTaskId: taskId,
      successorTaskId: 'no-such-task',
    })
    expectValidation(successorMissing, 'successorTaskId', 'CROSS_PROJECT_REF')
    expect(successorMissing.body).toEqual(successorCross.body)

    // 前驱跨项目 —— 字段指向前驱
    const predecessorCross = await postDependency(pm.id, {
      predecessorTaskId: other.taskId,
      successorTaskId: taskId,
    })
    expectValidation(predecessorCross, 'predecessorTaskId', 'CROSS_PROJECT_REF')

    expect(await ctx.db.taskDependency.count()).toBe(0)
  })

  it('重复边 → 409 CONFLICT + DUPLICATE', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })
    await createDependencyOk(pm.id, t1, t2)

    const duplicate = await postDependency(pm.id, {
      predecessorTaskId: t1,
      successorTaskId: t2,
      type: 'FS',
    })
    expectConflict(duplicate, 'successorTaskId', 'DUPLICATE')
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(1)
  })

  it('二节点环（A→B 后 B→A）→ 409 CONFLICT + INVALID_VALUE，环不落库', async () => {
    const storyId = await seedStory()
    const a = await seedTask({ storyId })
    const b = await seedTask({ storyId })
    await createDependencyOk(pm.id, a, b)

    const cycle = await postDependency(pm.id, { predecessorTaskId: b, successorTaskId: a })
    expectConflict(cycle, 'successorTaskId', 'INVALID_VALUE')
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(1)
  })

  it('三节点环（A→B、B→C 后 C→A）→ 409 CONFLICT + INVALID_VALUE', async () => {
    const storyId = await seedStory()
    const a = await seedTask({ storyId })
    const b = await seedTask({ storyId })
    const c = await seedTask({ storyId })
    await createDependencyOk(pm.id, a, b)
    await createDependencyOk(pm.id, b, c)

    const cycle = await postDependency(pm.id, { predecessorTaskId: c, successorTaskId: a })
    expectConflict(cycle, 'successorTaskId', 'INVALID_VALUE')
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(2)

    // 同一张图上「顺向冗余边」不是环：A→C 只是 A→B→C 的传递边，允许建立
    const redundant = await postDependency(pm.id, { predecessorTaskId: a, successorTaskId: c })
    expect(redundant.status).toBe(201)
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(3)
  })

  it('并发互反建边 → 恰好一个 201、另一个 409，库中只有一条边', async () => {
    const storyId = await seedStory()
    const a = await seedTask({ storyId })
    const b = await seedTask({ storyId })

    // 同一个用户只取一次令牌：两次 loginAs 会重写会话哈希（虽然本仓库令牌是确定性的，
    // 仍保持「一次请求身份解析」的写法，避免依赖该实现细节）。
    const token = ctx.loginAs(pm.id)
    const asPmOnce = ctx.asUser(token)
    const url = `/projects/${projectId}/task-dependencies`

    const [first, second] = await Promise.all([
      asPmOnce.post(url).send({ predecessorTaskId: a, successorTaskId: b }),
      ctx
        .asUser(token)
        .post(url)
        .send({ predecessorTaskId: b, successorTaskId: a }),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 409])

    const loser = first.status === 409 ? first : second
    expectConflict(loser, 'successorTaskId', 'INVALID_VALUE')

    // 关键：不会因为两个请求各自通过检测而写出两条互反边
    expect(await ctx.db.taskDependency.count({ where: { projectId } })).toBe(1)
  })
})

describe('DELETE /task-dependencies/:dependencyId', () => {
  it('删除 → 204，边消失且后建同向边不再冲突', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })
    const created = await createDependencyOk(pm.id, t1, t2)

    const res = await deleteDependency(pm.id, created.id)
    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(await ctx.db.taskDependency.findUnique({ where: { id: created.id } })).toBeNull()

    const again = await postDependency(pm.id, { predecessorTaskId: t1, successorTaskId: t2 })
    expect(again.status).toBe(201)
  })

  it('不存在 id → 404（与「项目不存在」同一条文案）', async () => {
    expectProjectNotFound(await deleteDependency(pm.id, 'no-such-dependency'))
  })

  it('并发两次 DELETE → 恰好一个 204、另一个 404（不得 500）', async () => {
    const storyId = await seedStory()
    const t1 = await seedTask({ storyId })
    const t2 = await seedTask({ storyId })
    const created = await createDependencyOk(pm.id, t1, t2)

    const token = ctx.loginAs(pm.id)
    const url = `/task-dependencies/${created.id}`
    const [first, second] = await Promise.all([
      ctx.asUser(token).delete(url),
      ctx.asUser(token).delete(url),
    ])

    expect([first.status, second.status].sort()).toEqual([204, 404])
    // 后到者：P2025 已映射为 404，不是 500
    expectProjectNotFound(first.status === 404 ? first : second)
    expect(await ctx.db.taskDependency.findUnique({ where: { id: created.id } })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 回归：写成功后只读聚合不受影响，且能读到新数据
// ---------------------------------------------------------------------------

describe('写后读回归：GET /projects/:projectId/gantt', () => {
  it('新里程碑（含关联）与新依赖出现在聚合视图里', async () => {
    const storyId = await seedStory('回归故事')
    const t1 = await seedTask({
      storyId,
      title: '任务一',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    const t2 = await seedTask({
      storyId,
      title: '任务二',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })

    const milestone = await createMilestoneOk(pm.id, {
      name: '回归里程碑',
      dueDate: '2026-02-20',
      ownerUserId: member.id,
      taskIds: [t1, t2],
    })
    const dependency = await createDependencyOk(pm.id, t1, t2)

    const res = await api(pm.id).get(`/projects/${projectId}/gantt`)
    expect(res.status).toBe(200)
    const view = res.body as GanttView

    expect(view.basis.scopeLabel).toBe('全项目')
    expect(view.milestones).toHaveLength(1)
    const milestoneItem = view.milestones[0]
    expect(milestoneItem).toMatchObject({
      id: milestone.id,
      name: '回归里程碑',
      dueDate: '2026-02-20',
      ownerUserId: member.id,
      ownerDisplayName: 'Alice',
    })
    // 读端点只保证「只含可见关联任务」（其 taskIds 按 id 排序，与写响应的 createdAt 序不同源）
    expect([...(milestoneItem?.taskIds ?? [])].sort()).toEqual([t1, t2].sort())
    if (view.dependencies.state !== 'ok') throw new Error('unreachable')
    expect(view.dependencies.items).toEqual([
      {
        id: dependency.id,
        predecessorTaskId: t1,
        successorTaskId: t2,
        type: 'FS',
      },
    ])

    const story = view.stories.find((item) => item.id === storyId)
    if (!story) throw new Error('响应里缺少故事')
    expect(story.tasks.map((task) => task.id).sort()).toEqual([t1, t2].sort())
    expect(story.tasks.find((task) => task.id === t1)?.milestoneIds).toEqual([milestone.id])
    expect(story.tasks.find((task) => task.id === t2)?.milestoneIds).toEqual([milestone.id])
  })
})
