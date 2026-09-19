/**
 * T5-04 对抗性验证 —— 端点 29（`DELETE /tasks/:taskId`）与 ObjectVisibility 引用完整性
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-7「ObjectVisibility 的特殊约定」：`objectId` 是多态列、无真实外键，
 *     数据库不会级联清理；删除任务必须在**同一事务**内手动清理，是全文唯一
 *     需要人工保证的引用完整性
 *   - 决策 I-3：删除成功 204 无响应体；不可见对象与「不存在」响应完全一致
 *   - 决策 I-4：FORBIDDEN(403) / NOT_FOUND(404) / UNAUTHENTICATED(401)
 *   - 决策 I-8 端点 29：权限 `task.write`；副作用同事务清理 ObjectVisibility
 *
 * 与 `task-delete.test.ts` 的分工：本文件是**对抗性探针**，重点在
 *   A. 引用完整性：正例计数、隔离性（不误删其它对象记录）、事务原子性（失败回滚）
 *   B. 契约与权限的逐字一致性（重复删除、敏感任务存在性不泄漏）
 *   C. 用户故事删除保护的数据库层反事实
 *   D. 回归由全量 vitest + tsc 承担
 *
 * 唯一 seam 是 HTTP 接口层；仅 C 组按工单要求用数据库层证明 `onDelete: Restrict`。
 * 不修改共享的 `_test-harness.ts` / `test/factories.ts` / `test/helpers.ts`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { TaskView } from '../../shared/types.js'
import {
  addMember,
  createProjectWithStory,
  createTaskRow,
  createUser,
  resetTaskTestDatabase,
  setupTaskTestApp,
  type TaskTestContext,
} from './_test-harness.js'

type ErrorBody = {
  error: {
    code: string
    message: string
    details?: Array<{ field: string; code: string }>
  }
}

let ctx: TaskTestContext
let pm: { id: string }
let member: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string
let activityId: string
/** beforeEach 重建的合法任务（owner=member、acceptor=pm）。 */
let taskId: string

beforeAll(async () => {
  ctx = await setupTaskTestApp()
})

afterAll(async () => {
  await ctx.app.close()
  await ctx.prisma.$disconnect()
  await ctx.db.dispose()
})

beforeEach(async () => {
  await resetTaskTestDatabase(ctx)
  pm = await createUser(ctx.prisma, 'pm@example.com', '项目经理')
  member = await createUser(ctx.prisma, 'member@example.com', '项目成员')
  viewer = await createUser(ctx.prisma, 'viewer@example.com', '只读成员')
  outsider = await createUser(ctx.prisma, 'outsider@example.com', '外部用户')

  const project = await createProjectWithStory(ctx.prisma, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await addMember(ctx.prisma, projectId, member.id, 'MEMBER')
  await addMember(ctx.prisma, projectId, viewer.id, 'VIEWER')

  const story = await ctx.prisma.userStory.findUniqueOrThrow({
    where: { id: storyId },
    select: { activityId: true },
  })
  activityId = story.activityId

  const task = await createTaskRow(ctx.prisma, {
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
// 本地辅助
// ---------------------------------------------------------------------------

function deleteTask(actorUserId: string = pm.id, targetTaskId: string = taskId) {
  return request(ctx.app.server)
    .delete(`/tasks/${targetTaskId}`)
    .set('x-actor-user-id', actorUserId)
}

function getTask(actorUserId: string = pm.id, targetTaskId: string = taskId) {
  return request(ctx.app.server)
    .get(`/tasks/${targetTaskId}`)
    .set('x-actor-user-id', actorUserId)
}

function listTasks(actorUserId: string = pm.id, targetStoryId: string = storyId) {
  return request(ctx.app.server)
    .get(`/stories/${targetStoryId}/tasks`)
    .set('x-actor-user-id', actorUserId)
}

function createSiblingStory(title: string) {
  return ctx.prisma.userStory.create({
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

function grantVisibility(
  objectType: 'story' | 'task',
  objectId: string,
  userId: string,
): Promise<unknown> {
  return ctx.prisma.objectVisibility.create({
    data: { projectId, objectType, objectId, userId },
  })
}

function countVisibility(objectType: 'story' | 'task', objectId: string): Promise<number> {
  return ctx.prisma.objectVisibility.count({ where: { objectType, objectId } })
}

function countTaskVisibility(id: string): Promise<number> {
  return countVisibility('task', id)
}

// ===========================================================================
// A. ★ 引用完整性（决策 I-7）
// ===========================================================================

describe('A 引用完整性：ObjectVisibility 同事务清理', () => {
  it('A1 正例计数：为任务造 3 条可见性记录，删除后该任务记录数由 3 变为 0', async () => {
    // 三个不同用户 → 三条独立记录（复合主键 objectType+objectId+userId）
    await grantVisibility('task', taskId, member.id)
    await grantVisibility('task', taskId, viewer.id)
    await grantVisibility('task', taskId, pm.id)

    const before = await countTaskVisibility(taskId)
    expect(before).toBe(3) // 实测：删除前 3 条

    const response = await deleteTask()
    expect(response.status).toBe(204)

    const after = await countTaskVisibility(taskId)
    expect(after).toBe(0) // ★ 实测：删除后 0 条（反事实探针即针对此断言）
    expect(await ctx.prisma.task.count({ where: { id: taskId } })).toBe(0)
  })

  it('A3 隔离性：删除任务不得误删同故事其它任务 / 兄弟故事 / 故事级可见性记录', async () => {
    // 同一故事下的另一条任务
    const keptTask = await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: pm.id,
      acceptorUserId: member.id,
      title: '保留任务',
    })
    // 另一故事的故事级记录与任务级记录
    const siblingStory = await createSiblingStory('兄弟故事')
    const siblingTask = await createTaskRow(ctx.prisma, {
      projectId,
      storyId: siblingStory.id,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '兄弟任务',
    })

    // 「可见名单里同时含被删任务与其它任务」：member 同时看得到 taskId 与 keptTask，
    // 删除 taskId 时绝不能按 userId 误删 keptTask 的记录。
    await grantVisibility('task', taskId, member.id)
    await grantVisibility('task', taskId, viewer.id)
    await grantVisibility('task', keptTask.id, member.id)
    await grantVisibility('task', siblingTask.id, viewer.id)
    await grantVisibility('story', siblingStory.id, member.id)

    const before = {
      deleted: await countTaskVisibility(taskId),
      kept: await countTaskVisibility(keptTask.id),
      siblingTask: await countTaskVisibility(siblingTask.id),
      siblingStory: await countVisibility('story', siblingStory.id),
    }
    expect(before).toEqual({ deleted: 2, kept: 1, siblingTask: 1, siblingStory: 1 })

    expect((await deleteTask()).status).toBe(204)

    const after = {
      deleted: await countTaskVisibility(taskId),
      kept: await countTaskVisibility(keptTask.id),
      siblingTask: await countTaskVisibility(siblingTask.id),
      siblingStory: await countVisibility('story', siblingStory.id),
    }
    // 仅 deleted 归零，其余逐条原封不动。
    expect(after).toEqual({ deleted: 0, kept: 1, siblingTask: 1, siblingStory: 1 })

    // 其它对象仍可用：保留任务与兄弟任务都还能被读到。
    expect(await ctx.prisma.task.count({ where: { id: keptTask.id } })).toBe(1)
    expect(await ctx.prisma.task.count({ where: { id: siblingTask.id } })).toBe(1)
  })

  it('A4 事务原子性：任务删除失败时，同事务内先执行的可见性清理必须回滚', async () => {
    // 对一个「只有可见性记录、没有任务行」的幽灵 id 执行与实现完全相同的 $transaction：
    // 第一步 deleteMany 会删掉记录，第二步 task.delete 抛 P2025，整体必须回滚。
    const ghostTaskId = 'ghost-task-without-row'
    await grantVisibility('task', ghostTaskId, member.id)
    const before = await countTaskVisibility(ghostTaskId)
    expect(before).toBe(1)

    await expect(
      ctx.prisma.$transaction([
        ctx.prisma.objectVisibility.deleteMany({
          where: { objectType: 'task', objectId: ghostTaskId },
        }),
        ctx.prisma.task.delete({ where: { id: ghostTaskId } }),
      ]),
    ).rejects.toMatchObject({ code: 'P2025' })

    // 回滚生效：可见性记录仍在，幽灵任务仍然不存在。
    expect(await countTaskVisibility(ghostTaskId)).toBe(before)
    expect(await ctx.prisma.task.count({ where: { id: ghostTaskId } })).toBe(0)
  })
})

// ===========================================================================
// B. 契约与权限
// ===========================================================================

describe('B 契约：204 / 列表详情消失 / 权限矩阵 / 响应一致性', () => {
  it('B5 删除成功 → 204 且响应体为空（不是 200、不是 {}）', async () => {
    const response = await deleteTask()

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expect(response.body).toEqual({})
  })

  it('B6 删除后任务从列表与详情消失，详情返回 404', async () => {
    expect((await listTasks()).body).toMatchObject({
      items: [expect.objectContaining({ id: taskId })],
    })
    expect((await getTask()).status).toBe(200)

    expect((await deleteTask()).status).toBe(204)

    const list = await listTasks()
    expect((list.body as { items: TaskView[] }).items).toHaveLength(0)

    const detail = await getTask()
    expect(detail.status).toBe(404)
    expect((detail.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('B7 MEMBER / VIEWER → 403；非成员 → 404 无字段；未登录 → 401', async () => {
    const byMember = await deleteTask(member.id)
    expect(byMember.status).toBe(403)
    expect((byMember.body as ErrorBody).error.code).toBe('FORBIDDEN')

    const byViewer = await deleteTask(viewer.id)
    expect(byViewer.status).toBe(403)
    expect((byViewer.body as ErrorBody).error.code).toBe('FORBIDDEN')

    const byOutsider = await deleteTask(outsider.id)
    const serialized = JSON.stringify(byOutsider.body)
    expect(byOutsider.status).toBe(404)
    expect((byOutsider.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(serialized).not.toContain('待删除任务')
    expect(serialized).not.toContain('待删除描述')
    expect(serialized).not.toContain(projectId)

    const unauth = await request(ctx.app.server).delete(`/tasks/${taskId}`)
    expect(unauth.status).toBe(401)
    expect((unauth.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('B8 「删除不存在的任务」与「无权限」响应逐字一致（状态码 / code / message）', async () => {
    const missing = await deleteTask(pm.id, 'does-not-exist')
    const forbidden = await deleteTask(outsider.id, taskId)

    expect(missing.status).toBe(forbidden.status)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual(forbidden.body)
    expect(missing.body).toEqual({ error: { code: 'NOT_FOUND', message: '资源不存在' } })
  })

  it('B9 敏感任务：未授权 MEMBER 删除 → 404，不得因 403 泄漏存在性', async () => {
    const sensitive = await createTaskRow(ctx.prisma, {
      projectId,
      storyId,
      ownerUserId: member.id,
      acceptorUserId: pm.id,
      title: '敏感任务标题',
      isSensitive: true,
    })
    // 刻意只给 viewer 授权，不给 member（删除者）授权。
    await grantVisibility('task', sensitive.id, viewer.id)

    const response = await deleteTask(member.id, sensitive.id)
    const missing = await deleteTask(pm.id, 'does-not-exist')

    expect(response.status).toBe(404) // 不是 403
    expect(response.body).toEqual(missing.body)
    expect(JSON.stringify(response.body)).not.toContain('敏感任务标题')
    // 存在性不泄漏且对象未被删除
    expect(await ctx.prisma.task.count({ where: { id: sensitive.id } })).toBe(1)
  })

  it('B10 连续删除同一任务两次：第二次与「不存在」响应完全一致', async () => {
    expect((await deleteTask()).status).toBe(204)

    const second = await deleteTask()
    const missing = await deleteTask(pm.id, 'does-not-exist')

    expect(second.status).toBe(404)
    expect(second.body).toEqual(missing.body)
  })
})

// ===========================================================================
// C. 用户故事删除保护（数据库层，外键 Restrict）
// ===========================================================================

describe('C 用户故事删除保护：外键 Restrict 不依赖应用层', () => {
  it('C11 直接 prisma.userStory.delete() 删除挂有任务的故事 → P2003，任务与故事都仍在', async () => {
    await grantVisibility('task', taskId, member.id)

    await expect(ctx.prisma.userStory.delete({ where: { id: storyId } })).rejects.toMatchObject({
      code: 'P2003',
    })

    expect(await ctx.prisma.userStory.count({ where: { id: storyId } })).toBe(1)
    expect(await ctx.prisma.task.count({ where: { storyId } })).toBe(1)
    expect(await countTaskVisibility(taskId)).toBe(1)
  })

  it('C12 移除任务后，同一条故事删除语句必须成功（证明保护确实来自外键）', async () => {
    await expect(ctx.prisma.userStory.delete({ where: { id: storyId } })).rejects.toMatchObject({
      code: 'P2003',
    })

    // 通过端点 29 移除子任务（含同事务清理可见性）。
    expect((await deleteTask()).status).toBe(204)

    await expect(
      ctx.prisma.userStory.delete({ where: { id: storyId } }),
    ).resolves.toMatchObject({ id: storyId })
    expect(await ctx.prisma.userStory.count({ where: { id: storyId } })).toBe(0)
  })
})
