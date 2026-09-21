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
 * 不改动共享测试基建（`test/helpers.ts` / `test/factories.ts`）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Response as SuperTestResponse } from 'supertest'
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
/** beforeEach 重建的合法任务（owner=member、acceptor=pm）。 */
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
  viewer = await makeUser('viewer@example.com', '只读成员')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const project = await createProjectWithStory(ctx.db, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await makeMember(projectId, member.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')

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
// 本地辅助
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

function grantVisibility(
  objectType: 'story' | 'task',
  objectId: string,
  userId: string,
): Promise<unknown> {
  return ctx.db.objectVisibility.create({
    data: { projectId, objectType, objectId, userId },
  })
}

function countVisibility(objectType: 'story' | 'task', objectId: string): Promise<number> {
  return ctx.db.objectVisibility.count({ where: { objectType, objectId } })
}

function countTaskVisibility(id: string): Promise<number> {
  return countVisibility('task', id)
}

/**
 * 故障注入（D3 原子性断言）：把共享 Prisma 单例上的 `task.delete` 换成一条必然失败的
 * 原始 SQL（访问不存在的表），使端点 29 事务的第二句炸掉。
 *
 * 注：Prisma 6.19.3 已移除 `$use` 中间件，这里用「替换委托方法为等价 PrismaPromise」
 * 的方式注入 —— 注入的是数据库客户端边界上的故障，而非 mock 应用内部函数。
 * 返回的仍是真正的 PrismaPromise，会被 `$transaction` 当作**同一事务的第二句**执行；
 * 失败后第一步的 `deleteMany` 会被整体回滚（这正是 A4 要断言的事务语义）。
 *
 * 返回 restore 函数，务必在 finally 中调用。
 */
function installFailingTaskDelete(): () => void {
  const delegate = ctx.db.task as unknown as {
    delete: (...args: unknown[]) => unknown
  }
  const original = delegate.delete
  delegate.delete = () => ctx.db.$queryRawUnsafe('SELECT * FROM "__t5_injected_missing_table__"')
  return () => {
    delegate.delete = original
  }
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
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(0)
  })

  it('A3 隔离性：删除任务不得误删同故事其它任务 / 兄弟故事 / 故事级可见性记录', async () => {
    // 同一故事下的另一条任务
    const keptTask = await createTaskRow(ctx.db, {
      projectId,
      storyId,
      ownerUserId: pm.id,
      acceptorUserId: member.id,
      title: '保留任务',
    })
    // 另一故事的故事级记录与任务级记录
    const siblingStory = await createSiblingStory('兄弟故事')
    const siblingTask = await createTaskRow(ctx.db, {
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
    expect(await ctx.db.task.count({ where: { id: keptTask.id } })).toBe(1)
    expect(await ctx.db.task.count({ where: { id: siblingTask.id } })).toBe(1)
  })

  it('A4 事务原子性（真正经端点 29）：task.delete 注入未预期失败 → 500，且可见性清理回滚（实测 count 不变）', async () => {
    // 断言语义：端点 29 的 `$transaction([deleteMany(visibility), delete(task)])` 是
    // 一个原子单元。这里用故障注入让第二句 `task.delete` 以**未预期错误**失败，从而：
    //   (a) 端点必须返回 500（未预期错误不得被 P2025 映射误吞成 404）；
    //   (b) 第一句 `deleteMany` 必须回滚，可见性记录保持删除前后一致的**真实 count**。
    //
    // 为什么必须经端点：此前 A4 只是在测试里复刻 `$transaction`（模式验证），
    // 没有走真实 handler，无法证明实现确实使用了事务。这里改为真实 HTTP 请求 +
    // 真实断言的组合。
    await grantVisibility('task', taskId, member.id)
    await grantVisibility('task', taskId, viewer.id)
    const before = await countTaskVisibility(taskId)
    expect(before).toBe(2) // 实测：删除前 2 条

    const restore = installFailingTaskDelete()
    let response: SuperTestResponse
    try {
      response = await deleteTask()
    } finally {
      restore()
    }

    // (a) 未预期错误 → 500 INTERNAL_ERROR（不是 404，证明只映射 P2025）
    expect(response.status).toBe(500)
    expect((response.body as ErrorBody).error.code).toBe('INTERNAL_ERROR')

    // (b) 回滚生效：可见性记录仍为 2 条（若事务未回滚，deleteMany 已把它删成 0）
    expect(await countTaskVisibility(taskId)).toBe(before)
    // 注入的失败操作没有删除任务，任务行原样保留（若未回滚也不影响此断言，
    // 但与可见性 count 一起构成「事务原子性」的完整证据）
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
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

    const unauth = await ctx.asUser(null).delete(`/tasks/${taskId}`)
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
    const sensitive = await createTaskRow(ctx.db, {
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
    expect(await ctx.db.task.count({ where: { id: sensitive.id } })).toBe(1)
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

    await expect(ctx.db.userStory.delete({ where: { id: storyId } })).rejects.toMatchObject({
      code: 'P2003',
    })

    expect(await ctx.db.userStory.count({ where: { id: storyId } })).toBe(1)
    expect(await ctx.db.task.count({ where: { storyId } })).toBe(1)
    expect(await countTaskVisibility(taskId)).toBe(1)
  })

  it('C12 移除任务后，同一条故事删除语句必须成功（证明保护确实来自外键）', async () => {
    await expect(ctx.db.userStory.delete({ where: { id: storyId } })).rejects.toMatchObject({
      code: 'P2003',
    })

    // 通过端点 29 移除子任务（含同事务清理可见性）。
    expect((await deleteTask()).status).toBe(204)

    await expect(
      ctx.db.userStory.delete({ where: { id: storyId } }),
    ).resolves.toMatchObject({ id: storyId })
    expect(await ctx.db.userStory.count({ where: { id: storyId } })).toBe(0)
  })
})
