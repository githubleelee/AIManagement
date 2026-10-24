/**
 * US-15 后置标敏 · UML 粘性置位（`everRestricted`）—— 行为级回归
 *
 * 权威来源：
 *   - `DECISIONS.md` `uml.no-auto-declassification-guard`（2026-10-21 负责人裁定 A）：
 *     图一旦曾关联敏感对象即 `everRestricted = true` 且**永不自动清除**，
 *     置位与查询 guard 必须在**同一事务**内实现。
 *   - `docs/role-b-uml-design.md` §5 / §Z3：非 PM 可见 = 当前关联交集可见 且
 *     `everRestricted = false`；解除关联或目标被删**不**恢复可见性。
 *
 * 本文件锁定的缺口：**先关联普通对象、之后该对象才被标为敏感**时，已关联的图必须被
 * 粘性置位；否则之后解绑 / 删任务会走「交集为空 → 正文公开」的降密路径。
 *
 * 真实 SQLite：`createTestContext()` 用 `mkdtempSync` 建独立临时库并应用全部迁移，
 * 绝不触碰项目 `var/`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { setSensitivity } from './sensitivity.js'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeTask,
  makeUser,
} from '../../../test/factories.js'

let ctx: HttpTestContext

beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

type Fixture = {
  pmId: string
  memberId: string
  projectId: string
  storyId: string
  taskId: string
}

async function setup(): Promise<Fixture> {
  const pm = await makeUser('pm')
  const member = await makeUser('member')
  const { projectId } = await makeProject(pm.id)
  await makeMember(projectId, member.id)
  const goalId = await makeGoal(projectId)
  const activityId = await makeActivity(goalId)
  const storyId = await makeStory(activityId)
  const taskId = await makeTask(storyId, member.id, pm.id)
  return { pmId: pm.id, memberId: member.id, projectId, storyId, taskId }
}

async function makeDiagram(projectId: string, ownerUserId: string, title = '图'): Promise<string> {
  const diagram = await ctx.db.umlDiagram.create({
    data: { projectId, kind: 'USECASE', title, ownerUserId },
    select: { id: true },
  })
  return diagram.id
}

async function everRestricted(diagramId: string): Promise<boolean> {
  const diagram = await ctx.db.umlDiagram.findUniqueOrThrow({
    where: { id: diagramId },
    select: { everRestricted: true },
  })
  return diagram.everRestricted
}

function setSensitiveViaHttp(pmId: string, kind: 'stories' | 'tasks', id: string, body: {
  isSensitive: boolean
  visibleMemberIds: string[]
}) {
  return ctx.asUser(ctx.loginAs(pmId)).put(`/${kind}/${id}/sensitivity`).send(body)
}

describe('后置标敏：关联普通对象的图被粘性置位', () => {
  it('建图并关联非敏感任务/故事时 everRestricted 保持 false', async () => {
    const { pmId, projectId, storyId, taskId } = await setup()
    const taskDiagram = await makeDiagram(projectId, pmId, '任务图')
    const storyDiagram = await makeDiagram(projectId, pmId, '故事图')
    await ctx.db.umlDiagramTask.create({ data: { diagramId: taskDiagram, taskId } })
    await ctx.db.umlDiagramStory.create({ data: { diagramId: storyDiagram, storyId } })

    expect(await everRestricted(taskDiagram)).toBe(false)
    expect(await everRestricted(storyDiagram)).toBe(false)

    // 未打开敏感（isSensitive=false）不触发置位
    const res = await setSensitiveViaHttp(pmId, 'tasks', taskId, { isSensitive: false, visibleMemberIds: [] })
    expect(res.status).toBe(200)
    expect(await everRestricted(taskDiagram)).toBe(false)
    expect(await everRestricted(storyDiagram)).toBe(false)
  })

  it('之后把已关联的任务设为敏感：同一请求返回后 everRestricted 立即为 true', async () => {
    const { pmId, memberId, projectId, taskId } = await setup()
    const diagramId = await makeDiagram(projectId, pmId)
    await ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } })
    expect(await everRestricted(diagramId)).toBe(false)

    const res = await setSensitiveViaHttp(pmId, 'tasks', taskId, {
      isSensitive: true,
      visibleMemberIds: [memberId],
    })
    expect(res.status).toBe(200)
    expect(await everRestricted(diagramId)).toBe(true)
    // 任务本身也已在同事务内置敏
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).isSensitive).toBe(true)
  })

  it('之后把已关联的故事设为敏感：同一请求返回后 everRestricted 立即为 true', async () => {
    const { pmId, memberId, projectId, storyId } = await setup()
    const diagramId = await makeDiagram(projectId, pmId)
    await ctx.db.umlDiagramStory.create({ data: { diagramId, storyId } })

    const res = await setSensitiveViaHttp(pmId, 'stories', storyId, {
      isSensitive: true,
      visibleMemberIds: [memberId],
    })
    expect(res.status).toBe(200)
    expect(await everRestricted(diagramId)).toBe(true)
  })

  it('已置位后再设敏感：幂等，不报错且仍为 true', async () => {
    const { pmId, memberId, projectId, taskId } = await setup()
    const diagramId = await makeDiagram(projectId, pmId)
    await ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } })
    const body = { isSensitive: true, visibleMemberIds: [memberId] }
    expect((await setSensitiveViaHttp(pmId, 'tasks', taskId, body)).status).toBe(200)
    const once = await everRestricted(diagramId)
    expect((await setSensitiveViaHttp(pmId, 'tasks', taskId, body)).status).toBe(200)
    expect(once).toBe(true)
    expect(await everRestricted(diagramId)).toBe(true)
    expect(await ctx.db.umlDiagramTask.count({ where: { diagramId, taskId } })).toBe(1)
  })

  it('解除关联（删链行）或删除任务/故事后 everRestricted 仍为 true', async () => {
    const { pmId, memberId, projectId, storyId, taskId } = await setup()
    const taskDiagram = await makeDiagram(projectId, pmId, '任务图')
    const storyDiagram = await makeDiagram(projectId, pmId, '故事图')
    await ctx.db.umlDiagramTask.create({ data: { diagramId: taskDiagram, taskId } })
    await ctx.db.umlDiagramStory.create({ data: { diagramId: storyDiagram, storyId } })
    expect((await setSensitiveViaHttp(pmId, 'tasks', taskId, {
      isSensitive: true, visibleMemberIds: [memberId],
    })).status).toBe(200)
    expect((await setSensitiveViaHttp(pmId, 'stories', storyId, {
      isSensitive: true, visibleMemberIds: [memberId],
    })).status).toBe(200)
    expect(await everRestricted(taskDiagram)).toBe(true)
    expect(await everRestricted(storyDiagram)).toBe(true)

    // 只解除关联（不降密）
    await ctx.db.umlDiagramTask.delete({ where: { diagramId_taskId: { diagramId: taskDiagram, taskId } } })
    expect(await ctx.db.umlDiagramTask.count({ where: { diagramId: taskDiagram } })).toBe(0)
    expect(await everRestricted(taskDiagram)).toBe(true)

    // 删除目标对象：关联行由 Cascade 移除，但 guard 不清除
    await ctx.db.task.delete({ where: { id: taskId } })
    await ctx.db.userStory.delete({ where: { id: storyId } })
    expect(await ctx.db.umlDiagramTask.count({ where: { diagramId: taskDiagram } })).toBe(0)
    expect(await ctx.db.umlDiagramStory.count({ where: { diagramId: storyDiagram } })).toBe(0)
    expect(await everRestricted(taskDiagram)).toBe(true)
    expect(await everRestricted(storyDiagram)).toBe(true)
  })

  it('设为敏感但未关联任何图：对其它图无副作用', async () => {
    const { pmId, memberId, projectId, storyId, taskId } = await setup()
    // 一张图关联的是故事，另一张图完全没有关联
    const linkedToStory = await makeDiagram(projectId, pmId, '故事图')
    const freeDiagram = await makeDiagram(projectId, pmId, '无关图')
    await ctx.db.umlDiagramStory.create({ data: { diagramId: linkedToStory, storyId } })

    // 对未被任何图关联的任务置敏
    const res = await setSensitiveViaHttp(pmId, 'tasks', taskId, {
      isSensitive: true,
      visibleMemberIds: [memberId],
    })
    expect(res.status).toBe(200)
    expect(await everRestricted(linkedToStory)).toBe(false)
    expect(await everRestricted(freeDiagram)).toBe(false)
  })

  it('粘性置位失败时整个敏感设置事务回滚', async () => {
    const { pmId, memberId, projectId, taskId } = await setup()
    const diagramId = await makeDiagram(projectId, pmId)
    await ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } })
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).isSensitive).toBe(false)

    const failing = makeFailingStickyClient(ctx.db)
    await expect(setSensitivity(failing, pmId, 'task', taskId, {
      isSensitive: true,
      visibleMemberIds: [memberId],
    })).rejects.toThrow(/injected sticky failure/)

    // 名单替换、对象置敏、审计全部随事务回滚；guard 也没被留下
    expect((await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })).isSensitive).toBe(false)
    expect(await ctx.db.objectVisibility.count({ where: { objectType: 'task', objectId: taskId } })).toBe(0)
    expect(await ctx.db.auditLog.count()).toBe(0)
    expect(await everRestricted(diagramId)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 受控故障注入：只替换 `umlDiagram.updateMany`，其余委托真实临时库。
// 用于证明粘性置位与名单替换 / 置敏 / 审计同处一个 `$transaction`。
// ---------------------------------------------------------------------------

function injectStickyFailure(tx: object): object {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'umlDiagram') {
        const delegate = Reflect.get(target, prop, receiver) as object
        return new Proxy(delegate, {
          get(delegateTarget, delegateProp, delegateReceiver) {
            if (delegateProp === 'updateMany') {
              return () => {
                throw new Error('injected sticky failure')
              }
            }
            const value = Reflect.get(delegateTarget, delegateProp, delegateReceiver)
            return typeof value === 'function' ? value.bind(delegateTarget) : value
          },
        })
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** `setSensitivity` 只用 `$transaction`，故注入客户端只需实现该入口。 */
function makeFailingStickyClient(db: PrismaClient): PrismaClient {
  return {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      db.$transaction(tx => fn(injectStickyFailure(tx))),
  } as unknown as PrismaClient
}
