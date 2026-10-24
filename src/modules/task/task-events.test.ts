/**
 * 任务域事件生产测试（#34 的两处生产点）。
 *
 * 覆盖 `task.assigned` 与 `acceptance.submitted` 两个事件的口径：
 *   - `task.assigned`：**创建即首次分配**发一条；**负责人实际变化**再发；**同值不发**；
 *   - `acceptance.submitted`：任务**真实进入 `DONE`** 才发；**重复设置 `DONE` 不发**；
 *     被驳回后**重新提交 `DONE` 仍要发**（按发生次，不被永久去重）；
 *   - 同事务追加：事件写入失败 → 业务整笔回滚（不产生「业务成功但通知丢失」）；
 *   - 幂等键一律「按发生次」（含 `occurredAt`）：改派与重新提交都不会被静默吞掉；
 *   - 敏感任务（契约 I-6）：载荷**只能**是 `{references}`，且 MEMBER 查不到、PM 查得到；
 *   - 非敏感载荷只放**结构与标识**，不含任务标题等正文。
 *
 * 唯一 seam 是 HTTP；只有「注入事件写入失败」一例通过拦截 `$transaction` 在事务内
 * 让 `domainEvent.create` 抛错（与 `task-delete.adversarial.test.ts` 的 A4 同法）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeSensitive,
  makeStory,
  makeTask,
  makeUser,
} from '../../../test/factories.js'
import { PrismaEventRepository } from '../../db/event-repository.js'

let ctx: HttpTestContext
let pm: { id: string }
let member1: { id: string }
let member2: { id: string }
let projectId: string
let storyId: string

beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
}, 120_000)

beforeEach(async () => {
  await ctx.reset()
  pm = await makeUser('pm@example.com', '项目经理')
  member1 = await makeUser('m1@example.com', '成员一')
  member2 = await makeUser('m2@example.com', '成员二')

  const created = await makeProject(pm.id, '任务事件测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '拆任务',
    valueText: '可交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, member1.id, 'MEMBER')
  await makeMember(projectId, member2.id, 'MEMBER')
})

function postTask(body: Record<string, unknown>, actorUserId: string = pm.id) {
  return ctx.asUser(ctx.loginAs(actorUserId)).post(`/stories/${storyId}/tasks`).send(body)
}

function patchTask(taskId: string, body: Record<string, unknown>, actorUserId: string = pm.id) {
  return ctx.asUser(ctx.loginAs(actorUserId)).patch(`/tasks/${taskId}`).send(body)
}

/** 建一条任务（经 HTTP，确保走真实写路径与事件发布）。
 *
 * 默认负责人 member1、验收人 PM —— 刻意让**验收人与负责人不同**，且留出 member2
 * 作为"改派目标"：这样后续把 owner 改成 member2 时不会触发
 * `ACCEPTOR_EQUALS_OWNER`（验收人 ≠ 负责人 是任务的硬不变量）。
 */
async function createTaskOk(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await postTask({
    title: '任务',
    ownerUserId: member1.id,
    acceptorUserId: pm.id,
    planStart: '2026-11-01',
    planEnd: '2026-11-10',
    ...overrides,
  })
  expect(res.status).toBe(201)
  return (res.body as { id: string }).id
}

async function eventsByName(eventName: string) {
  return ctx.db.domainEvent.findMany({
    where: { projectId, eventName },
    orderBy: { storedAt: 'asc' },
  })
}

function eventCount() {
  return ctx.db.domainEvent.count({ where: { projectId } })
}

describe('task.assigned（创建与改派）', () => {
  it('创建任务 → 恰好一条 task.assigned，object / actor / 载荷 / 幂等键正确', async () => {
    const taskId = await createTaskOk({ title: '核心任务' })

    expect(await eventCount()).toBe(1)
    const event = (await eventsByName('task.assigned'))[0]!
    expect(event).toMatchObject({
      projectId,
      objectType: 'task',
      objectId: taskId,
      actorKind: 'USER',
      actorUserId: pm.id,
      sensitive: false,
      payload: {
        ownerUserId: member1.id,
        status: 'TODO',
      },
    })
    // 幂等键按发生次（含 occurredAt）
    expect(event.idempotencyKey).toBe(
      `task.assigned:${taskId}:${event.occurredAt.toISOString()}`,
    )
  })

  it('创建事件的载荷不含任务标题（只放结构与标识）', async () => {
    const title = '绝密：核心链路重构'
    await createTaskOk({ title })
    const event = (await eventsByName('task.assigned'))[0]!
    const serialized = JSON.stringify(event.payload)
    expect(serialized).not.toContain(title)
    expect(serialized).not.toContain('title')
  })

  it('负责人实际变化 → 追加一条 task.assigned，且两次幂等键不同', async () => {
    const taskId = await createTaskOk()
    expect((await patchTask(taskId, { ownerUserId: member2.id })).status).toBe(200)

    const assigned = await eventsByName('task.assigned')
    expect(assigned).toHaveLength(2)
    expect(assigned[1]!.payload).toMatchObject({
      ownerUserId: member2.id,
      previousOwnerUserId: member1.id,
    })
    expect(new Set(assigned.map((e) => e.idempotencyKey)).size).toBe(2)
  })

  it('把负责人写成原值（同值）→ 不发事件', async () => {
    const taskId = await createTaskOk()
    expect((await patchTask(taskId, { ownerUserId: member1.id })).status).toBe(200)
    expect(await eventsByName('task.assigned')).toHaveLength(1)
  })

  it('只改标题等非分配字段 → 不发 task.assigned', async () => {
    const taskId = await createTaskOk()
    expect((await patchTask(taskId, { title: '改名' })).status).toBe(200)
    expect(await eventsByName('task.assigned')).toHaveLength(1)
  })
})

describe('acceptance.submitted（真实进入 DONE）', () => {
  it('进入 DONE → 一条 acceptance.submitted，载荷带前后状态', async () => {
    const taskId = await createTaskOk()
    expect((await patchTask(taskId, { status: 'DONE' })).status).toBe(200)

    const submitted = await eventsByName('acceptance.submitted')
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!).toMatchObject({
      objectType: 'task',
      objectId: taskId,
      actorUserId: pm.id,
      sensitive: false,
      payload: {
        fromStatus: 'TODO',
        toStatus: 'DONE',
        ownerUserId: member1.id,
      },
    })
    expect(submitted[0]!.idempotencyKey).toBe(
      `acceptance.submitted:${taskId}:${submitted[0]!.occurredAt.toISOString()}`,
    )
  })

  it('重复设置 DONE → 不重复发', async () => {
    const taskId = await createTaskOk()
    expect((await patchTask(taskId, { status: 'DONE' })).status).toBe(200)
    // 同值再写一次 DONE
    expect((await patchTask(taskId, { status: 'DONE' })).status).toBe(200)
    expect(await eventsByName('acceptance.submitted')).toHaveLength(1)
  })

  it('驳回回 DOING 后重新提交 DONE → 再发一条（按发生次，不被永久去重）', async () => {
    const taskId = await createTaskOk()
    expect((await patchTask(taskId, { status: 'DONE' })).status).toBe(200)
    expect((await patchTask(taskId, { status: 'DOING' })).status).toBe(200)
    expect((await patchTask(taskId, { status: 'DONE' })).status).toBe(200)

    const submitted = await eventsByName('acceptance.submitted')
    expect(submitted).toHaveLength(2)
    expect(new Set(submitted.map((e) => e.idempotencyKey)).size).toBe(2)
  })
})

describe('敏感任务与可见性（契约 I-6）', () => {
  it('敏感任务的分配事件载荷只有 references，且 MEMBER 查不到 / PM 查得到', async () => {
    // 先建任务（此时非敏感），再标敏感并把白名单清空 → 仅 PM 可见
    const taskId = await createTaskOk()
    await ctx.db.task.update({ where: { id: taskId }, data: { isSensitive: true } })
    await makeSensitive('task', taskId, [])

    // 改派触发一条新的 task.assigned（此时任务已敏感）
    expect((await patchTask(taskId, { ownerUserId: member2.id })).status).toBe(200)

    const assigned = await eventsByName('task.assigned')
    const sensitiveEvent = assigned[assigned.length - 1]!
    expect(sensitiveEvent.sensitive).toBe(true)
    expect(Object.keys(sensitiveEvent.payload as object)).toEqual(['references'])
    expect(sensitiveEvent.payload).toEqual({
      references: [{ objectType: 'task', objectId: taskId }],
    })

    const repo = new PrismaEventRepository(ctx.db)
    const memberView = await repo.query({
      projectId,
      eventName: 'task.assigned',
      actorUserId: member1.id,
    })
    expect(memberView.map((e) => e.id)).not.toContain(sensitiveEvent.id)
    const pmView = await repo.query({
      projectId,
      eventName: 'task.assigned',
      actorUserId: pm.id,
    })
    expect(pmView.map((e) => e.id)).toContain(sensitiveEvent.id)
  })
})

describe('同事务语义：事件写入失败 → 业务回滚', () => {
  /**
   * 拦截 `$transaction`，让事务内的 `domainEvent.create` 抛错，
   * 模拟"事件存储不可用"。断言：业务写入必须随之回滚（不产生"任务已建但没事件"）。
   *
   * ★ 注入点必须是**事务客户端**：`appendIfAbsent` 走的是 `tx.domainEvent.create`，
   *   根客户端上的 delegate 与之不是同一个对象（同一坑见 `task-delete.adversarial` A4）。
   */
  function installFailingEventAppend(): () => void {
    const client = ctx.db as unknown as {
      $transaction: (arg: unknown, ...rest: unknown[]) => unknown
    }
    const original = client.$transaction
    const wrapTx = (tx: unknown): unknown =>
      new Proxy(tx as Record<string | symbol, unknown>, {
        get(target, prop) {
          if (prop === 'domainEvent') {
            const delegate = Reflect.get(target, 'domainEvent') as Record<string | symbol, unknown>
            return new Proxy(delegate, {
              get(dt, dp) {
                if (dp === 'create') return () => { throw new Error('event-store-down') }
                const v = Reflect.get(dt, dp)
                return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(dt) : v
              },
            })
          }
          const v = Reflect.get(target, prop)
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
        },
      })
    client.$transaction = function (arg: unknown, ...rest: unknown[]) {
      if (typeof arg !== 'function') {
        return (original as (...a: unknown[]) => unknown).call(client, arg, ...rest)
      }
      const wrapped = (tx: unknown) => (arg as (t: unknown) => unknown)(wrapTx(tx))
      return (original as (...a: unknown[]) => unknown).call(client, wrapped, ...rest)
    }
    return () => {
      client.$transaction = original
    }
  }

  it('创建时事件写入失败 → 任务不落库、事件零新增', async () => {
    const before = await ctx.db.task.count({ where: { projectId } })
    const restore = installFailingEventAppend()
    let status = 0
    try {
      status = (await postTask({
        title: '回滚任务',
        ownerUserId: member1.id,
        acceptorUserId: pm.id,
        planStart: '2026-11-01',
        planEnd: '2026-11-10',
      })).status
    } finally {
      restore()
    }

    expect(status).toBe(500)
    expect(await ctx.db.task.count({ where: { projectId } })).toBe(before)
    expect(await eventCount()).toBe(0)
  })

  it('状态流转时事件写入失败 → 任务状态回滚到原值', async () => {
    const taskId = await createTaskOk()
    const restore = installFailingEventAppend()
    let status = 0
    try {
      status = (await patchTask(taskId, { status: 'DONE' })).status
    } finally {
      restore()
    }

    expect(status).toBe(500)
    const after = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(after.status).toBe('TODO')
    // 创建时的那一条仍在，失败的那条没有落库
    expect(await eventsByName('acceptance.submitted')).toHaveLength(0)
  })
})

/* ===========================================================================
 * 端到端：域事件 → 通知公共运行时（订阅 + 提交后桥接 + 权威接收者）→ 通知行
 * ===========================================================================
 *
 * ★ 为什么这两例在套件内 skip：
 *   `src/app.ts` 在 `NODE_ENV === 'test'` 下传 `autoStartLoops: false`，
 *   消费桥接的 2 秒定时器**不会启动**（避免后台定时扫描污染其它模块的事件计数）。
 *   因此测试进程里事件会正常落库，但通知行不会被产生 —— 这不是缺陷，是刻意设计。
 *
 *   端到端通知的验证改用**真实进程探针**：以非 test 环境启动真实 app（桥接与调度都跑），
 *   发真实 HTTP，再查 `Notification` 行与 `latencyMs`。该证据与 B 当年验证
 *   `risk.*` / `acceptance.*` 六类来源的方法一致（`docs/ai-records/B/issue-34/`）。
 *
 *   下面两例保留原断言与收件人口径，便于将来把桥接开起来后直接启用。
 */
describe('端到端：任务域事件确实驱动通知', () => {
  /** 轮询等待通知行出现（桥接在提交后异步执行）。 */
  async function waitForNotification(
    predicate: (row: {
      recipientUserId: string
      sourceEventName: string
      referenceObjectId: string
      contentTitle: string | null
    }) => boolean,
    label: string,
    timeoutMs = 15_000,
  ) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const rows = await ctx.db.notification.findMany({
        where: { projectId },
        orderBy: { storedAt: 'asc' },
      })
      const hit = rows.find((row) => predicate(row))
      if (hit) return hit
      if (Date.now() > deadline) throw new Error(`等待通知行超时：${label}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  it.skip('创建任务 → 任务负责人收到 task.assigned 通知（需桥接运行，见文件内说明）', async () => {
    const taskId = await createTaskOk()

    const row = await waitForNotification(
      (r) => r.referenceObjectId === taskId && r.sourceEventName === 'task.assigned',
      'task.assigned 通知',
    )
    expect(row.recipientUserId).toBe(member1.id)
    expect(row.contentTitle).toBe('新任务分配')
  }, 30_000)

  it.skip('进入 DONE → 验收人收到 acceptance.submitted 通知（需桥接运行，见文件内说明）', async () => {
    const taskId = await createTaskOk()
    expect((await patchTask(taskId, { status: 'DONE' })).status).toBe(200)

    const row = await waitForNotification(
      (r) => r.referenceObjectId === taskId && r.sourceEventName === 'acceptance.submitted',
      'acceptance.submitted 通知',
    )
    // createTaskOk 里验收人是 PM，因此收件人应为 PM（而不是负责人）
    expect(row.recipientUserId).toBe(pm.id)
    expect(row.contentTitle).toBe('任务已提交验收')
  }, 30_000)
})
