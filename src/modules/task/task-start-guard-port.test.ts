import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import { makeActivity, makeGoal, makeMember, makeProject, makeStory, makeUser } from '../../../test/factories.js'
import { assertTaskCanEnterDoing, createTaskStartGuardPort, writeAssignedTask, type TaskWriteDb } from './rules.js'

let ctx: HttpTestContext
let projectId: string
let storyId: string
let ownerId: string
let acceptorId: string

const PRED_END = '2026-11-10'
const NEXT_DAY = '2026-11-11'
const SAME_DAY = '2026-11-10'

beforeAll(async () => { ctx = await createTestContext() })
afterAll(async () => { await ctx.dispose() })
beforeEach(async () => { await ctx.reset() })

async function seedBase() {
  const pm = await makeUser('p-pm@example.com', '虚构PM')
  const owner = await makeUser('p-owner@example.com', '虚构负责人')
  const acceptor = await makeUser('p-acceptor@example.com', '虚构验收人')
  const created = await makeProject(pm.id, '窄端口项目')
  projectId = created.projectId
  ownerId = owner.id
  acceptorId = acceptor.id
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求', capabilityText: 'c', valueText: 'v', businessValue: 'b', priority: 'P0',
  })
  await makeMember(projectId, ownerId, 'MEMBER')
  await makeMember(projectId, acceptorId, 'MEMBER')
}

async function seedTask(overrides: Partial<{
  status: string; planStart: string; planEnd: string; isSensitive: boolean; title: string; forProjectId: string; forStoryId: string
}> = {}) {
  return ctx.db.task.create({
    data: {
      projectId: overrides.forProjectId ?? projectId,
      storyId: overrides.forStoryId ?? storyId,
      title: overrides.title ?? '虚构任务',
      ownerUserId: ownerId,
      acceptorUserId: acceptorId,
      planStart: overrides.planStart ?? NEXT_DAY,
      planEnd: overrides.planEnd ?? '2026-11-20',
      status: overrides.status ?? 'TODO',
      isSensitive: overrides.isSensitive ?? false,
    },
  })
}

function addFs(predecessorTaskId: string, successorTaskId: string) {
  return ctx.db.taskDependency.create({ data: { projectId, predecessorTaskId, successorTaskId, type: 'FS' } })
}

/** 生产装配点（`src/app.ts`）实际注入的端口对象。 */
const port = createTaskStartGuardPort<Prisma.TransactionClient>()

function viaPort(taskId: string, input: Partial<{ projectId: string; nextPlanStart: string }> = {}) {
  return ctx.db.$transaction((tx) =>
    port.assertCanEnterDoing(tx, {
      projectId: input.projectId ?? projectId,
      taskId,
      ...(input.nextPlanStart !== undefined ? { nextPlanStart: input.nextPlanStart } : {}),
    }),
  )
}

describe('TaskStartGuardPort：从各合法非 DOING 状态进入 DOING', () => {
  it.each(['TODO', 'BLOCKED', 'SUSPENDED', 'DONE', 'CLOSED'])(
    '当前 %s：前置未 CLOSED → 422 status:INVALID_VALUE；前置 CLOSED → 通过',
    async (from) => {
      await seedBase()
      const blockedBy = await seedTask({ status: 'DONE', planEnd: PRED_END })
      const successor = await seedTask({ status: from })
      await addFs(blockedBy.id, successor.id)

      await expect(viaPort(successor.id)).rejects.toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: '当前条件不允许开始执行',
        details: [{ field: 'status', code: 'INVALID_VALUE' }],
      })

      await ctx.db.task.update({ where: { id: blockedBy.id }, data: { status: 'CLOSED' } })
      await expect(viaPort(successor.id)).resolves.toBeUndefined()
    },
  )

  it('同一 DOING 不重查：前置未 CLOSED 也直接返回', async () => {
    await seedBase()
    const blockedBy = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask({ status: 'DOING' })
    await addFs(blockedBy.id, successor.id)
    await expect(viaPort(successor.id)).resolves.toBeUndefined()
  })

  it('隐藏（敏感）前置已 CLOSED：正常放行（服务端校验不受可见性影响）', async () => {
    await seedBase()
    const hidden = await seedTask({ status: 'CLOSED', planEnd: PRED_END, isSensitive: true, title: 'HIDDEN' })
    const successor = await seedTask()
    await addFs(hidden.id, successor.id)
    await expect(viaPort(successor.id)).resolves.toBeUndefined()
  })
})

describe('TaskStartGuardPort：projectId 强校验', () => {
  it('越项目 taskId：用本项目 projectId 查不到 → 404 NOT_FOUND', async () => {
    await seedBase()
    const other = await makeProject(ownerId, '另一个项目')
    const otherGoal = await makeGoal(other.projectId, 'g')
    const otherActivity = await makeActivity(otherGoal, 'a')
    const otherStory = await makeStory(otherActivity, { title: 's2', capabilityText: 'c', valueText: 'v', businessValue: 'b', priority: 'P0' })
    const foreign = await ctx.db.task.create({
      data: { projectId: other.projectId, storyId: otherStory, title: '外部任务', ownerUserId: ownerId, acceptorUserId: acceptorId, planStart: NEXT_DAY, planEnd: '2026-11-20', status: 'TODO' },
    })

    await expect(viaPort(foreign.id)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('不存在的 taskId → 404', async () => {
    await seedBase()
    await expect(viaPort('does-not-exist')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('TaskStartGuardPort：计划开始日', () => {
  it('缺省 nextPlanStart 用同事务内当前计划：同日拒绝、次日通过', async () => {
    await seedBase()
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const sameDay = await seedTask({ planStart: SAME_DAY })
    const nextDay = await seedTask({ planStart: NEXT_DAY })
    await addFs(predecessor.id, sameDay.id)
    await addFs(predecessor.id, nextDay.id)

    await expect(viaPort(sameDay.id)).rejects.toMatchObject({
      status: 422, code: 'VALIDATION_FAILED', details: [{ field: 'planStart', code: 'INVALID_VALUE' }],
    })
    await expect(viaPort(nextDay.id)).resolves.toBeUndefined()
  })

  it('显式 nextPlanStart 优先于库内当前计划', async () => {
    await seedBase()
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const successor = await seedTask({ planStart: NEXT_DAY })
    await addFs(predecessor.id, successor.id)

    await expect(viaPort(successor.id, { nextPlanStart: SAME_DAY })).rejects.toMatchObject({ status: 422 })
    await expect(viaPort(successor.id, { nextPlanStart: NEXT_DAY })).resolves.toBeUndefined()
  })
})

describe('TaskStartGuardPort：组装与误用', () => {
  it('组装工厂返回的是真实守卫（不是 no-op / 默认放行）', async () => {
    await seedBase()
    const blockedBy = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask()
    await addFs(blockedBy.id, successor.id)
    await expect(viaPort(successor.id)).rejects.toMatchObject({ status: 422 })
  })

  it('root PrismaClient 误用 fail-fast（端口不接受根客户端）', async () => {
    await seedBase()
    const successor = await seedTask()
    await expect(
      assertTaskCanEnterDoing(ctx.db as unknown as TaskWriteDb, { projectId, taskId: successor.id }),
    ).rejects.toThrow(/事务客户端/)
  })

  it('通用 writeAssignedTask(root, status=DOING) fail-fast，避免非原子两语句绕过', async () => {
    await seedBase()
    const successor = await seedTask()
    await expect(
      writeAssignedTask(ctx.db, projectId, successor.id, {
        ownerUserId: ownerId, acceptorUserId: acceptorId,
        planStart: NEXT_DAY, planEnd: '2026-11-20', status: 'DOING',
      }),
    ).rejects.toThrow(/事务客户端/)
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('TODO')
  })

  it('前置查询带确定 orderBy（predecessorTaskId asc）', async () => {
    await seedBase()
    let captured: unknown
    const fake = {
      task: { findUnique: async () => ({ status: 'TODO', planStart: NEXT_DAY }) },
      taskDependency: { findMany: async (args: unknown) => { captured = args; return [] } },
      projectMember: {},
    } as unknown as TaskWriteDb

    await assertTaskCanEnterDoing(fake, { projectId, taskId: 'target-task' })
    expect(captured).toMatchObject({
      where: { projectId, successorTaskId: 'target-task', type: 'FS' },
      orderBy: { predecessorTaskId: 'asc' },
    })
  })
})

/**
 * 同一调用方事务内的**顺序约束**（非跨事务竞态）。
 *
 * 守卫是「同事务内检查后写入」：它只反映自己读取那一刻的前置状态。下面用确定性的读后注入，
 * 验证同一事务内、守卫读取之后的写入仍会提交 —— 仅记录这一**顺序**边界存在。
 *
 * 不得据此宣称 SQLite 或跨事务并发不可靠：本用例不构成任何跨事务结论。跨事务结论需另有
 * 本仓库可复现的用例。当前可复现的定性仅为：独立复验用两个 PrismaClient 直连同库时，第二个
 * 连接**阻塞（约 550ms）后写入成功并持久**（即阻塞后串行持久）；**未观测到干净的冲突码**。
 * 因此不加数据库兼容支路 / 新隔离配置，也不推断“无锁所以一定出错”。
 */
describe('TaskStartGuardPort：同一调用方事务内的顺序约束（非跨事务竞态）', () => {
  it('守卫读取后同事务再建一条 FS 边：该顺序边界真实存在，写入仍提交', async () => {
    await seedBase()
    const late = await seedTask({ status: 'DONE', planEnd: PRED_END })
    const successor = await seedTask()
    // 初始无依赖：守卫通过。
    await ctx.db.$transaction(async (tx) => {
      const wrapped = {
        task: tx.task,
        projectMember: tx.projectMember,
        taskDependency: {
          findMany: async (args: unknown) => {
            const rows = await tx.taskDependency.findMany(args as never)
            // 守卫读取（空依赖）之后、真实写入之前，同事务内插入一条未满足的 FS 边。
            await tx.taskDependency.create({ data: { projectId, predecessorTaskId: late.id, successorTaskId: successor.id, type: 'FS' } })
            return rows
          },
        },
      } as unknown as TaskWriteDb
      await assertTaskCanEnterDoing(wrapped, { projectId, taskId: successor.id })
      await tx.task.update({ where: { id: successor.id }, data: { status: 'DOING' } })
    })
    // 真实结果：窗口内的建边未被守卫看到，DOING 仍落库（记录，不掩盖）。
    const row = await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })
    expect(row.status).toBe('DOING')
    expect(await ctx.db.taskDependency.count({ where: { successorTaskId: successor.id } })).toBe(1)
  })

  it('守卫读取后同事务重开前置：该顺序边界真实存在，写入仍提交', async () => {
    await seedBase()
    const predecessor = await seedTask({ status: 'CLOSED', planEnd: PRED_END })
    const successor = await seedTask()
    await addFs(predecessor.id, successor.id)

    await ctx.db.$transaction(async (tx) => {
      const wrapped = {
        task: tx.task,
        projectMember: tx.projectMember,
        taskDependency: {
          findMany: async (args: unknown) => {
            const rows = await tx.taskDependency.findMany(args as never)
            // 守卫读到 CLOSED 之后、真实写入之前，同事务内把前置重开为 DONE。
            await tx.task.update({ where: { id: predecessor.id }, data: { status: 'DONE' } })
            return rows
          },
        },
      } as unknown as TaskWriteDb
      await assertTaskCanEnterDoing(wrapped, { projectId, taskId: successor.id })
      await tx.task.update({ where: { id: successor.id }, data: { status: 'DOING' } })
    })

    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: successor.id } })).status).toBe('DOING')
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: predecessor.id } })).status).toBe('DONE')
  })
})
