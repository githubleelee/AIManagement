/**
 * #34 任务域事件 → 通知行的**真实进程**端到端探针（ROLE-A，2026-10-24）。
 *
 * 为什么需要它（而不是放进 vitest 套件）：
 *   `src/app.ts` 在 `NODE_ENV === 'test'` 下传 `autoStartLoops: false`，消费桥接的
 *   2 秒定时器不会启动 —— 测试进程里事件会正常落库，但通知行不会被产生。
 *   因此端到端通知验证必须**以非 test 环境**跑真实 app（桥接 + 调度都运行）。
 *
 * 验证两条链路：
 *   1. POST /stories/:storyId/tasks   → `task.assigned`         → 收件人 = 任务负责人
 *   2. PATCH /tasks/:taskId {DONE}    → `acceptance.submitted`  → 收件人 = 任务验收人
 *
 * 判据：`Notification` 行存在、收件人正确、`contentTitle` 命中目录名、
 *      `latencyMs` 与 `withinDeliveryTarget` 为**实测值**（不伪造）。
 *
 * 运行（必须不带 NODE_ENV=test）：
 *   npx tsx docs/ai-records/A/issue-34/evidence/probe-task-events.mts
 */
import { createHttpTestContext } from '../../../../../test/http-support.js'
import { setActiveDatabase } from '../../../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeUser,
} from '../../../../../test/factories.js'

type NotificationRow = {
  recipientUserId: string
  sourceEventName: string
  referenceObjectId: string
  contentTitle: string | null
  latencyMs: number
  withinDeliveryTarget: boolean
  storedAt: Date
}

const ctx = await createHttpTestContext()
setActiveDatabase(ctx.db)
await ctx.app.ready()

const out: Record<string, unknown> = {
  nodeEnv: process.env.NODE_ENV ?? '(未设置)',
  startedAt: new Date().toISOString(),
}

try {
  const pm = await makeUser('probe-pm@example.invalid', '探针项目经理')
  const owner = await makeUser('probe-owner@example.invalid', '探针负责人')
  const acceptor = await makeUser('probe-acceptor@example.invalid', '探针验收人')

  const { projectId } = await makeProject(pm.id, '通知探针项目')
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  const storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '拆任务',
    valueText: '可交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, owner.id, 'MEMBER')
  await makeMember(projectId, acceptor.id, 'MEMBER')

  out.ids = { projectId, storyId, pm: pm.id, owner: owner.id, acceptor: acceptor.id }

  // ---- 链路 1：创建任务 → task.assigned → 负责人 ----
  const created = await ctx
    .asUser(ctx.loginAs(pm.id))
    .post(`/stories/${storyId}/tasks`)
    .send({
      title: '探针任务',
      ownerUserId: owner.id,
      acceptorUserId: acceptor.id,
      planStart: '2026-11-01',
      planEnd: '2026-11-10',
    })
  if (created.status !== 201) throw new Error(`创建任务失败：${created.status}`)
  const taskId = created.body.id as string
  out.taskId = taskId

  async function waitFor(
    predicate: (row: NotificationRow) => boolean,
    label: string,
    timeoutMs = 30_000,
  ): Promise<NotificationRow> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const rows = (await ctx.db.notification.findMany({
        where: { projectId },
        orderBy: { storedAt: 'asc' },
      })) as NotificationRow[]
      const hit = rows.find(predicate)
      if (hit) return hit
      if (Date.now() > deadline) throw new Error(`等待通知超时：${label}`)
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  const assignedRow = await waitFor(
    (r) => r.sourceEventName === 'task.assigned' && r.referenceObjectId === taskId,
    'task.assigned',
  )
  out.taskAssigned = {
    recipient: assignedRow.recipientUserId === owner.id ? 'owner' : assignedRow.recipientUserId,
    expectedRecipient: 'owner',
    recipientMatches: assignedRow.recipientUserId === owner.id,
    contentTitle: assignedRow.contentTitle,
    latencyMs: assignedRow.latencyMs,
    withinDeliveryTarget: assignedRow.withinDeliveryTarget,
    storedAt: assignedRow.storedAt.toISOString(),
  }

  // ---- 链路 2：进入 DONE → acceptance.submitted → 验收人 ----
  const patched = await ctx
    .asUser(ctx.loginAs(owner.id))
    .patch(`/tasks/${taskId}`)
    .send({ status: 'DONE' })
  if (patched.status !== 200) throw new Error(`提交验收失败：${patched.status}`)

  const submittedRow = await waitFor(
    (r) => r.sourceEventName === 'acceptance.submitted' && r.referenceObjectId === taskId,
    'acceptance.submitted',
  )
  out.acceptanceSubmitted = {
    recipient: submittedRow.recipientUserId === acceptor.id ? 'acceptor' : submittedRow.recipientUserId,
    expectedRecipient: 'acceptor',
    recipientMatches: submittedRow.recipientUserId === acceptor.id,
    contentTitle: submittedRow.contentTitle,
    latencyMs: submittedRow.latencyMs,
    withinDeliveryTarget: submittedRow.withinDeliveryTarget,
    storedAt: submittedRow.storedAt.toISOString(),
  }

  // ---- 附：DomainEvent 侧的事实（事件确实由任务域生产） ----
  const events = await ctx.db.domainEvent.findMany({
    where: { projectId },
    select: { eventName: true, objectId: true, sensitive: true },
    orderBy: { storedAt: 'asc' },
  })
  out.domainEvents = events

  out.result =
    out.taskAssigned &&
    (out.taskAssigned as { recipientMatches: boolean }).recipientMatches &&
    out.acceptanceSubmitted &&
    (out.acceptanceSubmitted as { recipientMatches: boolean }).recipientMatches
      ? 'PASS'
      : 'FAIL'
} catch (error) {
  out.result = 'ERROR'
  out.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  out.finishedAt = new Date().toISOString()
  console.log(JSON.stringify(out, null, 2))
  await ctx.dispose()
}
