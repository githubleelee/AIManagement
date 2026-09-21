/**
 * T5-03 / T5-04 并发删除竞态回归测试（D1、D2）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-3：不可见 / 不存在时响应体不得含对象任何字段，`message` 与「不存在」一致
 *   - 决策 I-4：顶层错误码 `NOT_FOUND`(404) / `INTERNAL_ERROR`(500)
 *   - 决策 I-7：删除任务必须在同一事务内清理 `ObjectVisibility`
 *   - 决策 I-8 端点 28（PATCH）/ 端点 29（DELETE）
 *
 * 背景（缺陷）：两个请求都先读到同一任务，其中一个把任务删除后，另一个请求落库
 * `prisma.task.update` / `prisma.task.delete` 会抛 Prisma `P2025`（RecordNotFound）。
 * 修复前该错误既不是 `AppError` 也不是 Fastify 错误，被统一错误处理器归为 500，
 * 与契约「对象已不存在 → 404，且响应体与『任务不存在』逐字一致」不符。
 *
 * 唯一 seam 是 HTTP 接口层。为了在不引入真实并发抖动的前提下**确定性**复现竞态，
 * 本文件使用**故障注入**（允许的手段）：把 Prisma 委托对象上的某个查询方法临时
 * 替换成一个「先并发删除目标任务行、再调用原方法」的包装函数，让真实请求在
 * 「首次读取之后、落库之前」经历行被删除的中间态，从而触发**真实的 Prisma P2025**。
 *
 * 注：工单推荐的 Prisma `$use` 中间件在 Prisma 6.19.3 已被移除（生成客户端仅有
 * `$extends`，且路由使用共享单例，扩展无法反向作用到该单例），因此改用等价的
 * 委托层故障注入 —— 它注入的是数据库客户端边界上的并发副作用，而非 mock 应用
 * 内部函数，符合「唯一 seam」的精神。
 *
 * 不修改 `_test-harness.ts` / `test/factories.ts` / `test/helpers.ts`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
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
let projectId: string
let storyId: string
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
  viewer = await createUser(ctx.prisma, 'viewer@example.com', '管理者')

  const project = await createProjectWithStory(ctx.prisma, pm.id)
  projectId = project.projectId
  storyId = project.storyId
  await addMember(ctx.prisma, projectId, member.id, 'MEMBER')
  await addMember(ctx.prisma, projectId, viewer.id, 'VIEWER')

  const task = await createTaskRow(ctx.prisma, {
    projectId,
    storyId,
    ownerUserId: member.id,
    acceptorUserId: pm.id,
    title: '并发删除目标',
    description: '并发删除描述',
    planStart: '2026-09-01',
    planEnd: '2026-09-10',
  })
  taskId = task.id
})

// ---------------------------------------------------------------------------
// 本地辅助
// ---------------------------------------------------------------------------

function patchTask(body: Record<string, unknown>, actorUserId: string = pm.id, target: string = taskId) {
  return request(ctx.app.server)
    .patch(`/tasks/${target}`)
    .set('x-actor-user-id', actorUserId)
    .send(body)
}

function deleteTask(actorUserId: string = pm.id, target: string = taskId) {
  return request(ctx.app.server).delete(`/tasks/${target}`).set('x-actor-user-id', actorUserId)
}

function grantVisibility(objectId: string, userId: string): Promise<unknown> {
  return ctx.prisma.objectVisibility.create({
    data: { projectId, objectType: 'task', objectId, userId },
  })
}

function countTaskVisibility(id: string): Promise<number> {
  return ctx.prisma.objectVisibility.count({ where: { objectType: 'task', objectId: id } })
}

/**
 * 故障注入：在首次鉴权读取（`can()` 的 `projectMember.findUnique`）返回之后，
 * 用同一 Prisma 单例把目标任务行删除，模拟「另一个并发请求抢先删除」。
 *
 * 之后当前请求继续走原有流程：PATCH 会在 `task.update` 处、DELETE 会在
 * `$transaction` 的 `task.delete` 处遇到**真实的 Prisma P2025**。
 *
 * 返回 restore 函数，务必在 `finally` 中调用，避免污染后续用例。
 */
function installConcurrentDeleteAfterAuthRead(target: string): () => void {
  const delegate = ctx.prisma.projectMember as unknown as {
    findUnique: (...args: unknown[]) => unknown
  }
  const original = delegate.findUnique
  let injected = false
  delegate.findUnique = async (...args: unknown[]) => {
    const result = await original.apply(ctx.prisma.projectMember, args)
    if (!injected) {
      injected = true
      await ctx.prisma.task.delete({ where: { id: target } })
    }
    return result
  }
  return () => {
    delegate.findUnique = original
  }
}

// ---------------------------------------------------------------------------
// D1：PATCH /tasks/:taskId 的并发删除竞态
// ---------------------------------------------------------------------------

describe('D1 PATCH 并发删除竞态：P2025 映射为与「任务不存在」逐字一致的 404', () => {
  it('鉴权读取后、task.update 前任务被并发删除 → 404 NOT_FOUND，响应体与「不存在」逐字相等', async () => {
    // 基准：真正「任务不存在」的响应体（端点 28 早退分支）
    const missing = await patchTask({ title: '随便' }, pm.id, 'does-not-exist')
    expect(missing.status).toBe(404)
    expect((missing.body as ErrorBody).error.code).toBe('NOT_FOUND')

    const restore = installConcurrentDeleteAfterAuthRead(taskId)
    let raced: request.Response
    try {
      raced = await patchTask({ title: '并发改名' }, pm.id, taskId)
    } finally {
      restore()
    }

    expect(raced.status).toBe(404)
    expect((raced.body as ErrorBody).error.code).toBe('NOT_FOUND')
    // 逐字一致：code / message / 完整 body 都不得含任务字段
    expect(raced.body).toEqual(missing.body)
    expect(JSON.stringify(raced.body)).toBe(JSON.stringify(missing.body))
    expect(JSON.stringify(raced.body)).not.toContain('并发改名')
    expect(JSON.stringify(raced.body)).not.toContain('无权限')

    // 任务确实已被并发请求删除，PATCH 不得把它「复活」
    expect(await ctx.prisma.task.count({ where: { id: taskId } })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// D2：DELETE /tasks/:taskId 的并发双删
// ---------------------------------------------------------------------------

describe('D2 DELETE 并发双删：第二个请求 P2025 → 404 且可见性删除回滚', () => {
  it('并发删除后第二个 DELETE 的 task.delete 抛 P2025 → 404，且事务回滚使可见性记录保留', async () => {
    // 造 2 条可见性记录：事务第一句 deleteMany 若提交，会把这 2 条删掉。
    await grantVisibility(taskId, member.id)
    await grantVisibility(taskId, viewer.id)
    const visibilityBefore = await countTaskVisibility(taskId)
    expect(visibilityBefore).toBe(2)

    const missing = await deleteTask(pm.id, 'does-not-exist')
    expect(missing.status).toBe(404)

    const restore = installConcurrentDeleteAfterAuthRead(taskId)
    let second: request.Response
    try {
      second = await deleteTask(pm.id, taskId)
    } finally {
      restore()
    }

    expect(second.status).toBe(404)
    expect((second.body as ErrorBody).error.code).toBe('NOT_FOUND')
    // 与「任务不存在」逐字一致
    expect(second.body).toEqual(missing.body)
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(missing.body))

    // ★ 事务语义：第二句 task.delete 抛 P2025 → 第一句 deleteMany 必须回滚，
    //   可见性记录保持删除前的真实条数（若未回滚会变成 0）。
    expect(await countTaskVisibility(taskId)).toBe(visibilityBefore)
    // 任务被并发请求删除，第二个请求不得报 500、也不得重复删除
    expect(await ctx.prisma.task.count({ where: { id: taskId } })).toBe(0)
  })
})
