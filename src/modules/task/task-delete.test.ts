/**
 * T5-04 接口与数据库层测试 —— 端点 29（`DELETE /tasks/:taskId`）与删除一致性
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-8 端点 29：204 / 403 / 404；副作用为「同一事务内清理 ObjectVisibility」
 *   - 决策 I-7「ObjectVisibility 的特殊约定」：多态列无外键，必须人工清理
 *   - 决策 I-3：删除成功 204 无响应体；不可见对象与「不存在」响应完全一致
 *   - 决策 I-5：403（可见但写动作不允许）/ 404（非成员、敏感未授权）由 can() 给出
 *   - 验收标准：工单 T5-04 七条；基线 AC-US-05-06、AC-US-03-05、§5 风险 R4
 *
 * 唯一 seam 是 HTTP 接口层；仅「有任务的用户故事不可删除」一条按工单要求用
 * **数据库层测试**证明（该保护由 `onDelete: Restrict` 外键提供，不依赖应用层）。
 * 端点 22（`DELETE /stories/:storyId`）属 M4/T3.9，不在本工单实现范围 —— 这里
 * 只调用 `prisma.userStory.delete()` 验证底层保护，不改需求模块、不改 schema。
 *
 * 覆盖：
 *   - 正例：PM 删除 → 204、空响应体；任务从列表 / 详情 / 计数中消失
 *   - ★ 引用完整性：任务删除后其 ObjectVisibility 记录条数为 0（实测计数）
 *   - 一致性：不影响同故事其它任务、其它故事 / 其它对象的可见性记录
 *   - 反例：MEMBER / VIEWER → 403；非项目成员 → 404 且响应体无任务字段；
 *           不存在 / 非成员 / 敏感未授权三种 404 响应逐字一致
 *   - 事务性：权限拒绝不产生任何副作用（任务与可见性记录原样保留）
 *   - 数据库层：删除挂有任务的用户故事 → P2003，任务与故事都仍在（含反事实对照）
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../shared/types.js'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import { makeUser, makeProject, makeGoal, makeActivity, makeStory, makeMember } from '../../../test/factories.js'

// 数据前置：项目 + 目标 + 活动 + 故事（组合 test/factories.js 的真实工厂）。
async function createProjectWithStory(
  _db: unknown,
  ownerUserId: string,
  options: { projectName?: string; storyTitle?: string } = {},
): Promise<{ projectId: string; storyId: string }> {
  const { projectId } = await makeProject(ownerUserId, options.projectName ?? '测试项目')
  const goalId = await makeGoal(projectId, '测试目标')
  const activityId = await makeActivity(goalId, '测试活动')
  const storyId = await makeStory(activityId, {
    title: options.storyTitle ?? '测试用户故事',
    capabilityText: '拆任务',
    valueText: '推进交付',
    businessValue: '高',
    priority: 'P0',
  })
  return { projectId, storyId }
}

// 直接插入任务行（工厂 makeTask 不允许指定 createdAt 或构造非法数据；故走 ctx.db）。
async function createTaskRow(
  _db: unknown,
  params: {
    projectId: string
    storyId: string
    ownerUserId: string
    acceptorUserId: string
    title?: string
    description?: string | null
    planStart?: string
    planEnd?: string
    status?: 'TODO' | 'DOING' | 'DONE'
    isSensitive?: boolean
    createdAt?: Date
  },
) {
  return ctx.db.task.create({
    data: {
      projectId: params.projectId,
      storyId: params.storyId,
      title: params.title ?? '任务',
      description: params.description ?? null,
      ownerUserId: params.ownerUserId,
      acceptorUserId: params.acceptorUserId,
      planStart: params.planStart ?? '2026-01-01',
      planEnd: params.planEnd ?? '2026-01-31',
      status: params.status ?? 'TODO',
      isSensitive: params.isSensitive ?? false,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  })
}

type ErrorBody = {
  error: {
    code: string
    message: string
    details?: Array<{ field: string; code: string }>
  }
}

let ctx: HttpTestContext
let pm: { id: string }
let member: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string
let activityId: string
/** 每个用例在 beforeEach 里重建的合法任务主键（owner=member、acceptor=pm）。 */
let taskId: string

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser('pm@example.com', '项目经理')
  member = await makeUser('member@example.com', '项目成员')
  viewer = await makeUser('viewer@example.com', '管理者')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const project = await createProjectWithStory(ctx.db, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')

  // 记录 activityId，便于在同一项目内创建「兄弟故事」验证跨故事一致性。
  const story = await ctx.db.userStory.findUniqueOrThrow({
    where: { id: storyId },
    select: { activityId: true },
  })
  activityId = story.activityId

  const task = await createTaskRow(ctx.db, {
    projectId,
    storyId,
    ownerUserId: member.id,
    acceptorUserId: pm.id,
    title: '待删除任务',
    description: '待删除描述',
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
  })
  taskId = task.id
})

// ---------------------------------------------------------------------------
// 本地辅助（不改动共享测试基建）
// ---------------------------------------------------------------------------

function deleteTask(actorUserId: string = pm.id, targetTaskId: string = taskId) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .delete(`/tasks/${targetTaskId}`)
}

function getTask(actorUserId: string = pm.id, targetTaskId: string = taskId) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .get(`/tasks/${targetTaskId}`)
}

function listTasks(actorUserId: string = pm.id, targetStoryId: string = storyId) {
  return ctx.asUser(ctx.loginAs(actorUserId))
    .get(`/stories/${targetStoryId}/tasks`)
}

/** 在同一项目里创建一个兄弟用户故事；端点 22 属 M4，这里直接用 prisma 造数。 */
function createSiblingStory(title: string) {
  return ctx.db.userStory.create({
    data: {
      projectId,
      activityId,
      title,
      roleText: '项目经理',
      capabilityText: '拆任务',
      valueText: '推进交付',
      businessValue: '高',
      priority: 'P1',
    },
  })
}

/** 为多态对象插入一条可见性记录（端点 30 属 T5-05，这里直接用 prisma 造数）。 */
function grantVisibility(
  objectType: 'story' | 'task',
  objectId: string,
  userId: string,
): Promise<unknown> {
  return ctx.db.objectVisibility.create({
    data: { projectId, objectType, objectId, userId },
  })
}

function visibilityCountForTask(id: string): Promise<number> {
  return ctx.db.objectVisibility.count({ where: { objectType: 'task', objectId: id } })
}

// ---------------------------------------------------------------------------
// 正例：删除任务
// ---------------------------------------------------------------------------

describe('端点 29 正例：PM 删除任务', () => {
  it('删除成功返回 204 且响应体为空', async () => {
    const response = await deleteTask()

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expect(response.body).toEqual({})
  })

  it('删除后任务从故事任务列表与任务详情中同时消失', async () => {
    // 先确认删除前两处都能看到
    expect((await listTasks()).body).toMatchObject({ items: [expect.objectContaining({ id: taskId })] })
    expect((await getTask()).status).toBe(200)

    const response = await deleteTask()
    expect(response.status).toBe(204)

    const list = await listTasks()
    expect(list.status).toBe(200)
    expect((list.body as { items: TaskView[] }).items).toHaveLength(0)

    const detail = await getTask()
    expect(detail.status).toBe(404)
    expect((detail.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('删除后任务不再出现在任何计数中（任务表 count 减少 1）', async () => {
    const before = await ctx.db.task.count()
    expect(before).toBe(1)

    await deleteTask()

    expect(await ctx.db.task.count()).toBe(0)
  })

  it('删除任务不影响同一故事下的其它任务', async () => {
    const other = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: pm.id,
      acceptorUserId: member.id,
      title: '保留任务',
    })

    await deleteTask()

    const list = await listTasks()
    const items = (list.body as { items: TaskView[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe(other.id)
    expect(await getTask(pm.id, other.id)).toMatchObject({ status: 200 })
  })
})

// ---------------------------------------------------------------------------
// ★ 引用完整性：ObjectVisibility 清理（决策 I-7）
// ---------------------------------------------------------------------------

describe('端点 29 引用完整性：ObjectVisibility 清理', () => {
  it('删除任务后该任务的 ObjectVisibility 记录条数为 0（先造 2 条，含实测计数）', async () => {
    await grantVisibility('task', taskId, member.id)
    await grantVisibility('task', taskId, viewer.id)

    const before = await visibilityCountForTask(taskId)
    expect(before).toBe(2) // 实测：删除前 2 条

    const response = await deleteTask()
    expect(response.status).toBe(204)

    const after = await visibilityCountForTask(taskId)
    expect(after).toBe(0) // 实测：删除后 0 条
  })

  it('无可见性记录的任务也能正常删除（清理是幂等的 deleteMany）', async () => {
    expect(await visibilityCountForTask(taskId)).toBe(0)

    expect((await deleteTask()).status).toBe(204)

    expect(await visibilityCountForTask(taskId)).toBe(0)
  })

  it('删除一个任务不得影响同故事其它任务、其它故事与其它对象的可见性记录', async () => {
    const keptTask = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: pm.id,
      acceptorUserId: member.id,
      title: '保留任务',
    })
    const siblingStory = await createSiblingStory('兄弟故事')
    const siblingTask = await createTaskRow(ctx.db, {
      projectId,
      storyId: siblingStory.id,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '兄弟故事任务',
    })

    // 被删任务 2 条；保留任务 / 兄弟任务 / 兄弟故事各 1 条可见性记录。
    await grantVisibility('task', taskId, member.id)
    await grantVisibility('task', taskId, viewer.id)
    await grantVisibility('task', keptTask.id, viewer.id)
    await grantVisibility('task', siblingTask.id, member.id)
    await grantVisibility('story', siblingStory.id, member.id)

    expect(await visibilityCountForTask(taskId)).toBe(2)
    expect(await visibilityCountForTask(keptTask.id)).toBe(1)
    expect(await visibilityCountForTask(siblingTask.id)).toBe(1)
    expect(
      await ctx.db.objectVisibility.count({
        where: { objectType: 'story', objectId: siblingStory.id },
      }),
    ).toBe(1)

    expect((await deleteTask()).status).toBe(204)

    // 只清掉被删任务的记录，其它记录逐条仍在。
    expect(await visibilityCountForTask(taskId)).toBe(0)
    expect(await visibilityCountForTask(keptTask.id)).toBe(1)
    expect(await visibilityCountForTask(siblingTask.id)).toBe(1)
    expect(
      await ctx.db.objectVisibility.count({
        where: { objectType: 'story', objectId: siblingStory.id },
      }),
    ).toBe(1)
  })

  it('ObjectVisibility 清理与任务删除在同一事务：清理后总记录数只减少被删任务的条数', async () => {
    await grantVisibility('task', taskId, member.id)
    await grantVisibility('task', taskId, viewer.id)
    const totalBefore = await ctx.db.objectVisibility.count()
    expect(totalBefore).toBe(2)

    await deleteTask()

    expect(await ctx.db.objectVisibility.count()).toBe(totalBefore - 2)
  })
})

// ---------------------------------------------------------------------------
// 反例：权限与一致性响应
// ---------------------------------------------------------------------------

describe('端点 29 权限反例', () => {
  it('MEMBER 删除任务 → 403 FORBIDDEN', async () => {
    const response = await deleteTask(member.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 删除任务 → 403 FORBIDDEN', async () => {
    const response = await deleteTask(viewer.id)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员删除任务 → 404 NOT_FOUND 且响应体不含任务任何字段', async () => {
    const response = await deleteTask(outsider.id)
    const serialized = JSON.stringify(response.body)

    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(response.body).not.toHaveProperty('id')
    expect(response.body).not.toHaveProperty('title')
    expect(response.body).not.toHaveProperty('projectId')
    expect(serialized).not.toContain('待删除任务')
    expect(serialized).not.toContain('待删除描述')
    expect(serialized).not.toContain(projectId)
  })

  it('未登录删除任务 → 401 UNAUTHENTICATED', async () => {
    const response = await ctx.asUser(null).delete(`/tasks/${taskId}`)

    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('敏感任务：未授权 MEMBER 删除 → 404，与「任务不存在」响应逐字一致', async () => {
    const sensitive = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '敏感任务',
      isSensitive: true,
    })

    const unauthorized = await deleteTask(member.id, sensitive.id)
    const missing = await deleteTask(pm.id, 'does-not-exist')

    expect(unauthorized.status).toBe(404)
    expect(unauthorized.body).toEqual(missing.body)
    expect(await ctx.db.task.count({ where: { id: sensitive.id } })).toBe(1)
  })

  it('删除不存在的任务 → 与「无权限」返回完全一致的响应（状态码与结构逐字比对）', async () => {
    const missing = await deleteTask(pm.id, 'does-not-exist')
    const forbidden = await deleteTask(outsider.id, taskId)

    expect(missing.status).toBe(forbidden.status)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual(forbidden.body)
    expect(missing.body).toEqual({ error: { code: 'NOT_FOUND', message: '资源不存在' } })
  })
})

// ---------------------------------------------------------------------------
// 事务性：失败时无副作用
// ---------------------------------------------------------------------------

describe('端点 29 事务性：失败不产生副作用', () => {
  it('MEMBER 删除被拒后，任务与可见性记录原样保留', async () => {
    await grantVisibility('task', taskId, viewer.id)

    const response = await deleteTask(member.id)

    expect(response.status).toBe(403)
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
    expect(await visibilityCountForTask(taskId)).toBe(1)
  })

  it('非成员删除被拒后，任务与可见性记录原样保留', async () => {
    await grantVisibility('task', taskId, member.id)

    const response = await deleteTask(outsider.id)

    expect(response.status).toBe(404)
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
    expect(await visibilityCountForTask(taskId)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 数据库层：有任务的用户故事不可删除（外键 Restrict，不依赖应用层）
// ---------------------------------------------------------------------------

describe('用户故事删除保护（数据库外键 Restrict）', () => {
  it('删除挂有任务的用户故事 → 被拒绝（P2003），任务与故事都仍在', async () => {
    await expect(ctx.db.userStory.delete({ where: { id: storyId } })).rejects.toMatchObject({
      code: 'P2003',
    })

    // 删除失败后，故事与任务都必须原样保留，不产生孤儿数据。
    expect(await ctx.db.userStory.count({ where: { id: storyId } })).toBe(1)
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
    expect(await ctx.db.task.count({ where: { storyId } })).toBe(1)
  })

  it('反事实对照：先移除任务后，同一条故事删除语句必须成功（证明确实由外键拦截）', async () => {
    await expect(ctx.db.userStory.delete({ where: { id: storyId } })).rejects.toMatchObject({
      code: 'P2003',
    })

    // 通过端点 29 的等价路径（先清可见性、再删任务）移除子任务。
    await ctx.db.objectVisibility.deleteMany({ where: { objectType: 'task', objectId: taskId } })
    await ctx.db.task.delete({ where: { id: taskId } })

    await expect(ctx.db.userStory.delete({ where: { id: storyId } })).resolves.toMatchObject({
      id: storyId,
    })
    expect(await ctx.db.userStory.count({ where: { id: storyId } })).toBe(0)
  })

  it('删除任务本身不会误删其所属用户故事', async () => {
    expect((await deleteTask()).status).toBe(204)

    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(0)
    expect(await ctx.db.userStory.count({ where: { id: storyId } })).toBe(1)
  })
})
