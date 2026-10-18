/**
 * US-09 任务验收（工单 #29）测试 —— 端点 A / B / C。
 *
 * ===========================================================================
 * 为什么每个写路径都要"读-写-读"闭环 + 查库
 * ===========================================================================
 *
 * 上一票（US-08）实锤过一次"绿着但坏了"：`npm test` 全绿的同时进度根本没写进库
 * （字段被加进计算对象、没进写库的 data）。测试没覆盖写路径就等于没保护。
 * 因此本文件里凡涉及写入的用例，**都在调完写接口后再从读接口读一次**，
 * 关键处再直接查一次库；不接受"只看响应体"。
 *
 * 覆盖（与工单 AC 一一对应）：
 *   AC1 仅验收人可验（他人 403 / outsider 404 / VIEWER 403）
 *   AC2 验收人 ≠ 负责人（数据不变量被破坏时拒绝）
 *   AC3 通过后关闭并有记录；**未提交验收不得关闭**（非 DONE → 409）
 *   AC4 驳回必填原因（服务端强制）；驳回后回到执行阶段（DOING）
 *   AC5 重验可再次通过 / 驳回；全过程可追溯（who / when / 结论 / 原因）
 *   AC6 验收结果可被读取（读接口即质量信号来源）
 *   AC7 敏感任务：非白名单成员既看不到记录、也不能验收（404，不泄漏存在性）
 *   另：越权写防护（请求体捎带 title / ownerUserId / planStart 必须无效）
 *       鉴权先于形状校验（非成员 + 非法请求体 → 404，不是 422）
 *       并发重复验收（CAS，第二次 409 且不多写记录）
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
import type { AcceptanceRecordView, AcceptanceSubmitResult } from './types.js'

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

let ctx: HttpTestContext
let pm: { id: string }
let owner: { id: string }
let acceptor: { id: string }
let bystander: { id: string }
let viewer: { id: string }
let outsider: { id: string }
let projectId: string
let storyId: string

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
  viewer = await makeUser('viewer@example.com', '阅览者')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const created = await makeProject(pm.id, '验收测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '验收任务',
    valueText: '闭环交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, owner.id, 'MEMBER')
  await makeMember(projectId, acceptor.id, 'MEMBER')
  await makeMember(projectId, bystander.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

/** 直接造一个任务（工厂不含任务，与既有测试同一做法）。 */
async function seedTask(options: {
  status?: string
  ownerUserId?: string
  acceptorUserId?: string
  isSensitive?: boolean
  title?: string
  planEnd?: string
} = {}): Promise<string> {
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: options.title ?? '待验收任务',
      description: null,
      ownerUserId: options.ownerUserId ?? owner.id,
      acceptorUserId: options.acceptorUserId ?? acceptor.id,
      planStart: '2026-11-01',
      planEnd: options.planEnd ?? '2026-11-10',
      status: options.status ?? 'DONE',
      isSensitive: options.isSensitive ?? false,
    },
    select: { id: true },
  })
  return task.id
}

function postAcceptance(taskId: string, body: unknown, actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).post(`/tasks/${taskId}/acceptance`).send(body as object)
}

function getHistory(taskId: string, actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/tasks/${taskId}/acceptances`)
}

function getTask(taskId: string, actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/tasks/${taskId}`)
}

function getQueue(actorUserId: string, targetProjectId = projectId) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${targetProjectId}/acceptance-queue`)
}

/* ===========================================================================
 * AC3 —— 通过：任务进入 CLOSED，并有记录
 * =========================================================================== */

describe('AC3 通过验收', () => {
  it('验收人 PASS：任务变 CLOSED，且从任务详情接口读得回来（读-写-读闭环）', async () => {
    const taskId = await seedTask()

    const res = await postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id)
    expect(res.status).toBe(200)
    const result = res.body as AcceptanceSubmitResult
    expect(result.task.status).toBe('CLOSED')
    expect(result.record.conclusion).toBe('PASS')
    expect(result.record.statusBefore).toBe('DONE')
    expect(result.record.statusAfter).toBe('CLOSED')
    expect(result.record.actorUserId).toBe(acceptor.id)
    expect(result.record.reason).toBeNull()

    // 不只信响应：换一个读接口再读一次
    const reread = await getTask(taskId, acceptor.id)
    expect((reread.body as TaskView).status).toBe('CLOSED')

    // 再直接查一次库，确认真的落盘
    const row = await ctx.db.task.findUnique({ where: { id: taskId }, select: { status: true } })
    expect(row?.status).toBe('CLOSED')
  })

  it('通过时留的原因会被记录（选填）', async () => {
    const taskId = await seedTask()
    const res = await postAcceptance(taskId, { conclusion: 'PASS', reason: '抽检通过' }, acceptor.id)
    expect(res.status).toBe(200)
    expect((res.body as AcceptanceSubmitResult).record.reason).toBe('抽检通过')
  })

  it('未提交验收（TODO / DOING / BLOCKED / SUSPENDED）一律 409，且状态未变、无记录落库', async () => {
    for (const status of ['TODO', 'DOING', 'BLOCKED', 'SUSPENDED']) {
      const taskId = await seedTask({ status })

      const res = await postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id)
      expect(res.status, `status=${status} 应被拒绝`).toBe(409)
      const error = (res.body as ErrorBody).error
      expect(error.code).toBe('CONFLICT')
      // 钉住**前置状态检查**这条防线的文案（独立审查 S1）：删掉它、只留 CAS 时
      // 文案会变成"任务状态已变化，请刷新后重试"（cf6 实测 36/36 全绿），本断言即失败。
      expect(error.message).toContain('只有「待验收」')

      // 状态未变（查库）+ 没有多出记录（查库）
      const row = await ctx.db.task.findUnique({ where: { id: taskId }, select: { status: true } })
      expect(row?.status).toBe(status)
      const count = await ctx.db.acceptanceRecord.count({ where: { taskId } })
      expect(count).toBe(0)
    }
  })
})

/* ===========================================================================
 * AC4 —— 驳回：必填原因；任务回到执行阶段
 * =========================================================================== */

describe('AC4 驳回验收', () => {
  it('验收人 REJECT：任务回到 DOING，原因逐字落库', async () => {
    const taskId = await seedTask()

    const res = await postAcceptance(
      taskId,
      { conclusion: 'REJECT', reason: '验收条件 2 未达成：导出报表是空表' },
      acceptor.id,
    )
    expect(res.status).toBe(200)
    const result = res.body as AcceptanceSubmitResult
    expect(result.task.status).toBe('DOING')
    expect(result.record.statusAfter).toBe('DOING')

    // 读-写-读：任务状态从详情接口读回
    const reread = await getTask(taskId, acceptor.id)
    expect((reread.body as TaskView).status).toBe('DOING')

    // 原因从验收历史接口读回，逐字一致
    const history = await getHistory(taskId, acceptor.id)
    const items = (history.body as { items: AcceptanceRecordView[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.reason).toBe('验收条件 2 未达成：导出报表是空表')
  })

  it('驳回而不给原因 → 422 reason: REQUIRED（服务端强制，不靠界面）', async () => {
    const taskId = await seedTask()

    for (const body of [
      { conclusion: 'REJECT' },
      { conclusion: 'REJECT', reason: null },
      { conclusion: 'REJECT', reason: '   ' },
    ]) {
      const res = await postAcceptance(taskId, body, acceptor.id)
      expect(res.status).toBe(422)
      const error = (res.body as ErrorBody).error
      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.details).toContainEqual({ field: 'reason', code: 'REQUIRED' })
    }

    // 三次失败都不得留下痕迹
    const row = await ctx.db.task.findUnique({ where: { id: taskId }, select: { status: true } })
    expect(row?.status).toBe('DONE')
    expect(await ctx.db.acceptanceRecord.count({ where: { taskId } })).toBe(0)
  })
})

/* ===========================================================================
 * AC5 —— 重验与全过程可追溯
 * =========================================================================== */

describe('AC5 重验与可追溯', () => {
  it('提交 → 驳回 → 再提交 → 通过：两条记录、旧到新、字段齐备', async () => {
    const taskId = await seedTask()

    // 第一次验收：驳回
    const reject = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '缺验收证据' }, acceptor.id)
    expect(reject.status).toBe(200)

    // 执行人修复后重新提交验收（走既有端点 28 的 task.progress 路径）
    const resubmit = await ctx
      .asUser(ctx.loginAs(owner.id))
      .patch(`/tasks/${taskId}`)
      .send({ status: 'DONE' })
    expect(resubmit.status).toBe(200)

    // 第二次验收（重验）：通过
    const pass = await postAcceptance(taskId, { conclusion: 'PASS', reason: '复验通过' }, acceptor.id)
    expect(pass.status).toBe(200)

    const history = await getHistory(taskId, acceptor.id)
    const items = (history.body as { items: AcceptanceRecordView[] }).items

    expect(items).toHaveLength(2)
    // 旧 → 新
    expect(items[0]?.conclusion).toBe('REJECT')
    expect(items[1]?.conclusion).toBe('PASS')
    // who / when / 结论 / 原因 / 状态前后 全部可追溯
    for (const record of items) {
      expect(record.actorUserId).toBe(acceptor.id)
      expect(record.actor.displayName).toBe('验收人')
      expect(record.statusBefore).toBe('DONE')
      expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false)
      expect(record.projectId).toBe(projectId)
      expect(record.taskId).toBe(taskId)
    }
    expect(items[0]?.statusAfter).toBe('DOING')
    expect(items[0]?.reason).toBe('缺验收证据')
    expect(items[1]?.statusAfter).toBe('CLOSED')
    expect(items[1]?.reason).toBe('复验通过')

    // 库中确实两行（不只信接口）
    expect(await ctx.db.acceptanceRecord.count({ where: { taskId } })).toBe(2)
  })

  it('没有验收过的任务：历史为空数组（200 + []），不是 404', async () => {
    const taskId = await seedTask()
    const res = await getHistory(taskId, acceptor.id)
    expect(res.status).toBe(200)
    expect((res.body as { items: AcceptanceRecordView[] }).items).toEqual([])
  })
})

/* ===========================================================================
 * AC1 —— 授权
 * =========================================================================== */

describe('AC1 授权：只有验收人（与 PM）能验收', () => {
  it('非验收人的同项目成员 → 403', async () => {
    const taskId = await seedTask()
    const res = await postAcceptance(taskId, { conclusion: 'PASS' }, bystander.id)
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(await ctx.db.acceptanceRecord.count({ where: { taskId } })).toBe(0)
  })

  it('负责人不能验收自己的任务 → 403（自验自收被拦）', async () => {
    const taskId = await seedTask()
    const res = await postAcceptance(taskId, { conclusion: 'PASS' }, owner.id)
    expect(res.status).toBe(403)
  })

  it('VIEWER 即使被指为验收人也一律 403（现状口径：阅览者只读）', async () => {
    // 现状允许把 VIEWER 指为验收人（rules.ts 不限角色），但执行验收必被拒 —— 这是
    // 已知取舍，界面层已不向 VIEWER 显示验收按钮（见 docs/us-09-acceptance-api.md §4）。
    const taskId = await seedTask({ acceptorUserId: viewer.id })
    const res = await postAcceptance(taskId, { conclusion: 'PASS' }, viewer.id)
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员 → 404，且与"任务不存在"的响应完全一致（不泄漏存在性）', async () => {
    const taskId = await seedTask()
    const missing = await postAcceptance('00000000-0000-0000-0000-000000000000', { conclusion: 'PASS' }, outsider.id)
    const notMember = await postAcceptance(taskId, { conclusion: 'PASS' }, outsider.id)
    expect(notMember.status).toBe(404)
    expect(notMember.body).toEqual(missing.body)
  })

  it('未登录 → 401', async () => {
    const taskId = await seedTask()
    const res = await ctx
      .asUser(null)
      .post(`/tasks/${taskId}/acceptance`)
      .send({ conclusion: 'PASS' })
    expect(res.status).toBe(401)
  })

  it('鉴权先于形状校验：非成员提交非法请求体仍是 404，不是 422', async () => {
    const taskId = await seedTask()
    const res = await postAcceptance(taskId, { conclusion: '通过' }, outsider.id)
    expect(res.status).toBe(404)
  })

  it('合法验收人提交非法结论 → 422 conclusion: INVALID_VALUE（中文标签不是线上常量）', async () => {
    const taskId = await seedTask()
    for (const body of [{ conclusion: '通过' }, { conclusion: 'REWORK' }, { conclusion: null }, {}]) {
      const res = await postAcceptance(taskId, body, acceptor.id)
      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    }
    expect(await ctx.db.acceptanceRecord.count({ where: { taskId } })).toBe(0)
  })

  it('PM 即使不是该任务的验收人也能验收（can() 第 3 条「PM 保留全部权限」）', async () => {
    // 口径依据：#24 的 ROLE-A 结论「PM 保留全部权限」+ `permissions.ts:133`（PM 直接放行）。
    // ⚠️ 与工单 AC1 字面「仅任务验收人可执行验收；他人 403」存在张力 —— 严格说 PM 也是"他人"。
    //    本用例把**现有行为**钉住并留痕（登记见 docs/us-09-acceptance-api.md §9），
    //    若团队裁定 PM 不属例外，应改 can()，属跨票事项，**不在本票内自造规则**。
    const taskId = await seedTask() // 验收人是 acceptor，不是 pm

    const res = await postAcceptance(taskId, { conclusion: 'PASS' }, pm.id)
    expect(res.status).toBe(200)
    const result = res.body as AcceptanceSubmitResult
    expect(result.record.actorUserId).toBe(pm.id)
    expect(result.task.status).toBe('CLOSED')
  })

  it('PM 的待验收清单只含「PM 自己是验收人」的任务（不是全项目清单）', async () => {
    await seedTask({ title: '别人的待验收' }) // 验收人 = acceptor
    await seedTask({ acceptorUserId: pm.id, title: 'PM 自己的' })

    const items = ((await getQueue(pm.id)).body as { items: TaskView[] }).items
    expect(items.map((task) => task.title)).toEqual(['PM 自己的'])
  })
})

/* ===========================================================================
 * AC2 —— 验收人 ≠ 负责人（数据不变量被破坏时的兜底）
 * =========================================================================== */

describe('AC2 验收人 ≠ 负责人', () => {
  it('库中不变量的被破坏（acceptor === owner）时拒绝验收，且状态未变', async () => {
    // 绕过 rules.ts 直接写库造出违规数据
    const taskId = await seedTask({ ownerUserId: owner.id, acceptorUserId: owner.id })

    const res = await postAcceptance(taskId, { conclusion: 'PASS' }, owner.id)
    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('CONFLICT')

    const row = await ctx.db.task.findUnique({ where: { id: taskId }, select: { status: true } })
    expect(row?.status).toBe('DONE')
    expect(await ctx.db.acceptanceRecord.count({ where: { taskId } })).toBe(0)
  })
})

/* ===========================================================================
 * 越权写防护（US-08 审查 B-1 那类"借弱动作捎带改字段"）
 * =========================================================================== */

describe('验收端点不存在"捎带改字段"的通道', () => {
  it('请求体带 title / ownerUserId / planStart / acceptorUserId → 200 但这些字段逐字不变', async () => {
    const taskId = await seedTask()
    const before = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })

    const res = await postAcceptance(
      taskId,
      {
        conclusion: 'PASS',
        title: '被篡改的标题',
        description: '被篡改的描述',
        ownerUserId: bystander.id,
        acceptorUserId: bystander.id,
        planStart: '2020-01-01',
        planEnd: '2020-01-02',
        progress: 100,
        isSensitive: true,
      },
      acceptor.id,
    )
    expect(res.status).toBe(200)

    const after = await ctx.db.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(after.status).toBe('CLOSED')
    // 只有 status 变了（blockedReason 按不变式归一为 null，本用例里本来就是 null）
    expect(after.title).toBe(before.title)
    expect(after.description).toBe(before.description)
    expect(after.ownerUserId).toBe(before.ownerUserId)
    expect(after.acceptorUserId).toBe(before.acceptorUserId)
    expect(after.planStart).toBe(before.planStart)
    expect(after.planEnd).toBe(before.planEnd)
    expect(after.progress).toBe(before.progress)
    expect(after.isSensitive).toBe(before.isSensitive)
  })
})

/* ===========================================================================
 * AC7 —— 敏感任务
 * =========================================================================== */

describe('AC7 敏感任务的验收', () => {
  it('非白名单成员：读历史 404、验收 404（与"任务不存在"一致）', async () => {
    const taskId = await seedTask({ isSensitive: true })
    // ★ 本用例的白名单是**空**的：只把 isSensitive 置真，**没有**写 ObjectVisibility 行。
    //   所以它验证的是"白名单为空 ⇒ 除 PM 外无人可见"。
    //   （独立审查 S2：上一版注释写成"白名单只给负责人"，与代码相反，已改。）
    //   "名单里有别的成员、而验收人不在其中"这一更强的情形由下一条用例覆盖。

    const history = await getHistory(taskId, acceptor.id)
    expect(history.status).toBe(404)
    const attempt = await postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id)
    expect(attempt.status).toBe(404)
    expect(attempt.body).toEqual(
      (await postAcceptance('00000000-0000-0000-0000-000000000000', { conclusion: 'PASS' }, acceptor.id)).body,
    )
  })

  it('白名单里有**别的成员**但不含验收人：验收人仍然看不到、也不能验收', async () => {
    const taskId = await seedTask({ isSensitive: true })
    await ctx.db.objectVisibility.create({
      data: { projectId, objectType: 'task', objectId: taskId, userId: bystander.id },
    })

    // 与上一条的区别：上一条是空名单，这一条证明"名单与**我**无关"同样不可见
    expect((await getHistory(taskId, acceptor.id)).status).toBe(404)
    expect((await postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id)).status).toBe(404)
    // 而名单内的人可见（对照，证明隐藏的不是"整个端点坏了"）
    expect((await getHistory(taskId, bystander.id)).status).toBe(200)
  })

  it('白名单内的验收人可以正常验收', async () => {
    const taskId = await seedTask({ isSensitive: true })
    await ctx.db.objectVisibility.create({
      data: { projectId, objectType: 'task', objectId: taskId, userId: acceptor.id },
    })

    const res = await postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id)
    expect(res.status).toBe(200)
    expect((res.body as AcceptanceSubmitResult).task.status).toBe('CLOSED')

    const history = await getHistory(taskId, acceptor.id)
    expect(history.status).toBe(200)
    expect((history.body as { items: AcceptanceRecordView[] }).items).toHaveLength(1)
  })

  it('敏感任务不出现在非白名单成员的待验收清单里（查询层过滤，计数同源）', async () => {
    await seedTask({ isSensitive: true, title: '敏感待验收' })
    await seedTask({ isSensitive: false, title: '普通待验收' })

    const res = await getQueue(acceptor.id)
    expect(res.status).toBe(200)
    const items = (res.body as { items: TaskView[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('普通待验收')
  })
})

/* ===========================================================================
 * AC6 / 界面主链路 —— 待验收清单
 * =========================================================================== */

describe('待我验收清单（端点 C）', () => {
  it('只返回"我是验收人且状态为 DONE"的任务，按 planEnd 升序', async () => {
    await seedTask({ title: '晚一点', planEnd: '2026-12-01' })
    await seedTask({ title: '早一点', planEnd: '2026-11-15' })
    await seedTask({ title: '还没提交', status: 'DOING', planEnd: '2026-11-01' })
    await seedTask({ title: '别人的', acceptorUserId: bystander.id, planEnd: '2026-11-02' })

    const res = await getQueue(acceptor.id)
    expect(res.status).toBe(200)
    const items = (res.body as { items: TaskView[] }).items
    expect(items.map((task) => task.title)).toEqual(['早一点', '晚一点'])
  })

  it('验收完成后该任务立刻离开清单（状态不再是 DONE）', async () => {
    const taskId = await seedTask()
    expect(((await getQueue(acceptor.id)).body as { items: TaskView[] }).items).toHaveLength(1)

    await postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id)

    const after = await getQueue(acceptor.id)
    expect((after.body as { items: TaskView[] }).items).toHaveLength(0)
  })

  it('VIEWER 可以读清单（只读），但清单里的任务它验收不了', async () => {
    await seedTask({ acceptorUserId: viewer.id })
    const res = await getQueue(viewer.id)
    expect(res.status).toBe(200)
    expect((res.body as { items: TaskView[] }).items).toHaveLength(1)
  })

  it('非项目成员读清单 → 404', async () => {
    const res = await getQueue(outsider.id)
    expect(res.status).toBe(404)
  })

  it('未登录 → 401', async () => {
    const res = await ctx.asUser(null).get(`/projects/${projectId}/acceptance-queue`)
    expect(res.status).toBe(401)
  })
})

/* ===========================================================================
 * 并发 —— 两道防线分开钉（独立审查 B1 的修复）
 *
 * ★ 上一版把"并发"写成**串行**（先 await 第一次、再 await 第二次），并在注释里写
 *   "走的是同一个 CAS 分支" —— 那是**错的**，而且错得有害：串行时第二次请求会被
 *   `service.ts` 的 `statusBefore !== 'DONE'` **前置检查**拦下，**根本进不到 CAS**。
 *   后果是：把 CAS 改成无条件 `update` 之后，那条用例**依然全绿**（独立审查用 cf1
 *   反事实实测：并发变体 200,200 / 2 条记录，而串行那条仍 PASS）—— 即它对 CAS 没有
 *   任何保护力，属"空转用例"。
 *
 * 现在**两条防线各有一条用例**，各自删掉都会真红：
 *   - 「同时发出两个请求」→ 只能由 CAS 兜住（前置检查拦不住，因为两者都先读到 DONE）；
 *   - 「已验收后再验收」  → 由前置状态检查兜住（串行路径，钉住它的文案）。
 * =========================================================================== */

describe('并发重复验收', () => {
  it('两个验收请求**同时**发出：恰好一个 200、一个 409，且只落一条记录（CAS 的护栏）', async () => {
    const taskId = await seedTask()

    // 必须 Promise.all：两个请求都要在对方写库之前读到 DONE，才可能同时越过前置检查。
    const [first, second] = await Promise.all([
      postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id),
      postAcceptance(taskId, { conclusion: 'REJECT', reason: '并发竞态' }, acceptor.id),
    ])

    // 恰好一次成功：排序后必须是 [200, 409]。
    //   若 CAS 失效 → 两个都成功，得到 [200, 200]（且记录 2 条）；
    //   若两道防线都误伤 → [409, 409]。两种都会在此红。
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409])

    const records = await ctx.db.acceptanceRecord.findMany({ where: { taskId } })
    expect(records).toHaveLength(1)

    // 赢家的结论必须与最终状态一致（PASS→CLOSED / REJECT→DOING）
    const row = await ctx.db.task.findUnique({ where: { id: taskId }, select: { status: true } })
    expect(row?.status).toBe(records[0]?.conclusion === 'PASS' ? 'CLOSED' : 'DOING')
  })

  it('已验收过的任务再验收：409（由前置状态检查拦下）且不新增记录', async () => {
    const taskId = await seedTask()

    const first = await postAcceptance(taskId, { conclusion: 'PASS' }, acceptor.id)
    expect(first.status).toBe(200)

    const second = await postAcceptance(taskId, { conclusion: 'REJECT', reason: '想改成驳回' }, acceptor.id)
    expect(second.status).toBe(409)
    // 钉住**前置状态检查**这条防线本身：删掉它、只留 CAS 时，文案会变成
    // "任务状态已变化，请刷新后重试"（独立审查 cf6 实测 36/36 全绿），本断言即失败。
    // 顺带防止"对未提交验收的任务回一句'状态已变化'"这种误导性文案。
    expect((second.body as ErrorBody).error.message).toContain('只有「待验收」')

    expect(await ctx.db.acceptanceRecord.count({ where: { taskId } })).toBe(1)
  })
})
