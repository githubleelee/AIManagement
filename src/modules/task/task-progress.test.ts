/**
 * US-08（工单 #28）写路径测试 —— 端点 28 的「状态 / 进度 / 卡住原因」。
 *
 * 为什么补这个文件：工作台的读接口已有测试，但**写路径一直是空的**。
 * 实锤过：`npm test` 全绿的同时，「改进度」其实根本没写进数据库
 * （字段被加进了计算用的对象、没进写库的 data）——测试没覆盖就等于没保护。
 *
 * 覆盖：
 *   - 进度能真正落库，并能从列表接口读回（读-写-读闭环，不是只看响应）；
 *   - 卡住原因能落库；切出卡住态时是否清空由调用方决定，这里只验写入；
 *   - 进度取值边界：101 / -1 / 60.5 → 422 且字段级错误指向 progress；
 *   - **授权（AC7）**：负责人可改自己任务的状态/进度；验收人可关闭（CLOSED）；
 *     负责人不能自行关闭；与该任务无关的成员不能改。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../shared/types.js'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeUser,
} from '../../../test/factories.js'

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

let ctx: HttpTestContext
let pm: { id: string }
let owner: { id: string }
let acceptor: { id: string }
let bystander: { id: string }
let projectId: string
let storyId: string
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
  owner = await makeUser('owner@example.com', '负责人')
  acceptor = await makeUser('acceptor@example.com', '验收人')
  bystander = await makeUser('bystander@example.com', '无关成员')

  const created = await makeProject(pm.id, '写路径测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '拆分任务',
    valueText: '推进交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, owner.id, 'MEMBER')
  await makeMember(projectId, acceptor.id, 'MEMBER')
  await makeMember(projectId, bystander.id, 'MEMBER')

  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: '测试任务',
      description: null,
      ownerUserId: owner.id,
      acceptorUserId: acceptor.id,
      planStart: '2026-11-01',
      planEnd: '2026-11-10',
      status: 'TODO',
      isSensitive: false,
    },
    select: { id: true },
  })
  taskId = task.id
})

function patch(body: Record<string, unknown>, actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).patch(`/tasks/${taskId}`).send(body)
}

function getTasks(storyIdArg: string, actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/stories/${storyIdArg}/tasks`)
}

describe('端点 28 写路径：进度与卡住原因真的落库', () => {
  it('改进度后能从列表读回（读-写-读闭环）', async () => {
    const res = await patch({ progress: 42 }, pm.id)
    expect(res.status).toBe(200)
    expect((res.body as TaskView).progress).toBe(42)

    // 关键：不只信响应，再从列表接口读一次
    const list = await getTasks(storyId, pm.id)
    const listed = (list.body as { items: TaskView[] }).items.find((item) => item.id === taskId)
    expect(listed?.progress).toBe(42)
  })

  it('改卡住态时原因能落库，且两者一起写入', async () => {
    const res = await patch({ status: 'BLOCKED', blockedReason: '等第三方接口' }, pm.id)
    expect(res.status).toBe(200)
    const view = res.body as TaskView
    expect(view.status).toBe('BLOCKED')
    expect(view.blockedReason).toBe('等第三方接口')
  })

  it('只改进度时不动状态、不动原因', async () => {
    await patch({ status: 'BLOCKED', blockedReason: '原因' }, pm.id)
    const res = await patch({ progress: 80 }, pm.id)
    expect(res.status).toBe(200)
    const view = res.body as TaskView
    expect(view.progress).toBe(80)
    expect(view.status).toBe('BLOCKED')
    expect(view.blockedReason).toBe('原因')
  })
})

describe('端点 28 写路径：进度取值边界', () => {
  it.each([
    ['超过上限', 101],
    ['负数', -1],
    ['小数', 60.5],
  ])('进度%s → 422 且错误指向 progress', async (_label, value) => {
    const res = await patch({ progress: value }, pm.id)
    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect((body.error.details ?? []).some((detail) => detail.field === 'progress')).toBe(true)
  })
})

describe('端点 28 授权（AC7）：按对象关系而不是只看角色', () => {
  it('负责人（MEMBER）可以改自己任务的状态与进度', async () => {
    const res = await patch({ status: 'DOING', progress: 30 }, owner.id)
    expect(res.status).toBe(200)
    const view = res.body as TaskView
    expect(view.status).toBe('DOING')
    expect(view.progress).toBe(30)
  })

  it('负责人不能把自己的任务改成「已验收关闭」→ 403', async () => {
    const res = await patch({ status: 'CLOSED' }, owner.id)
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('验收人可以把任务改成「已验收关闭」', async () => {
    await patch({ status: 'DONE' }, owner.id)
    const res = await patch({ status: 'CLOSED' }, acceptor.id)
    expect(res.status).toBe(200)
    expect((res.body as TaskView).status).toBe('CLOSED')
  })

  it('与该任务无关的成员改进度 → 403', async () => {
    const res = await patch({ progress: 50 }, bystander.id)
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('负责人不能改负责人/验收人/计划（那仍需 PM）→ 403', async () => {
    const res = await patch({ ownerUserId: bystander.id }, owner.id)
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })
})
