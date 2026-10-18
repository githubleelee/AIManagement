/**
 * US-10 风险台账与项目关闭（工单 #30）测试。
 *
 * 授权口径按项目负责人 2026-10-18 批复：
 *   `risk.write` = PM + **MEMBER**（VIEWER 403）；`project.close` = **仅 PM**（MEMBER / VIEWER 403）。
 *
 * 覆盖：
 *   AC3 三级四态 + 非法值拒绝 + 四态流转（含回退）+ 状态变化写审计
 *   AC4 关闭阻断：未关闭任务 / 未处理风险任一成立即 409；风险解决后可关闭
 *   AC5 关闭留审计、可重开
 *   AC7 敏感风险继承关联任务可见性（不可见者既看不到也改不了）
 *   越权：MEMBER 不能关项目、VIEWER 只读、outsider 404
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeUser,
} from '../../../test/factories.js'
import type { ClosureCheckView, RiskView } from './types.js'

type ErrorBody = {
  error: { code: string; message: string; details?: Array<{ field: string; code: string }> }
}

let ctx: HttpTestContext
let pm: { id: string }
let member1: { id: string }
let member2: { id: string }
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
  member1 = await makeUser('m1@example.com', '成员一')
  member2 = await makeUser('m2@example.com', '成员二')
  viewer = await makeUser('viewer@example.com', '阅览者')
  outsider = await makeUser('outsider@example.com', '外部用户')

  const created = await makeProject(pm.id, '风险测试项目')
  projectId = created.projectId
  const goalId = await makeGoal(projectId, '目标')
  const activityId = await makeActivity(goalId, '活动')
  storyId = await makeStory(activityId, {
    title: '需求',
    capabilityText: '管风险',
    valueText: '可控交付',
    businessValue: '高',
    priority: 'P0',
  })
  await makeMember(projectId, member1.id, 'MEMBER')
  await makeMember(projectId, member2.id, 'MEMBER')
  await makeMember(projectId, viewer.id, 'VIEWER')
})

async function seedTask(options: { status?: string; isSensitive?: boolean } = {}): Promise<string> {
  const task = await ctx.db.task.create({
    data: {
      projectId,
      storyId,
      title: '任务',
      description: null,
      ownerUserId: member1.id,
      acceptorUserId: member2.id,
      planStart: '2026-11-01',
      planEnd: '2026-11-10',
      status: options.status ?? 'TODO',
      isSensitive: options.isSensitive ?? false,
    },
    select: { id: true },
  })
  return task.id
}

function postRisk(actorUserId: string, body: Record<string, unknown>) {
  return ctx.asUser(ctx.loginAs(actorUserId)).post(`/projects/${projectId}/risks`).send(body)
}

function patchRisk(actorUserId: string, riskId: string, body: Record<string, unknown>) {
  return ctx.asUser(ctx.loginAs(actorUserId)).patch(`/risks/${riskId}`).send(body)
}

function listRisks(actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${projectId}/risks`)
}

function closeProject(actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).post(`/projects/${projectId}/close`).send({})
}

function reopenProject(actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).post(`/projects/${projectId}/reopen`).send({})
}

function closureOf(actorUserId: string) {
  return ctx.asUser(ctx.loginAs(actorUserId)).get(`/projects/${projectId}/closure-check`)
}

async function makeRisk(actorUserId: string, body: Record<string, unknown> = {}): Promise<RiskView> {
  const res = await postRisk(actorUserId, {
    title: '第三方接口不稳定',
    level: 'HIGH',
    ownerUserId: member1.id,
    ...body,
  })
  expect(res.status).toBe(201)
  return res.body as RiskView
}

/* ===========================================================================
 * AC3 —— 三级 / 四态 / 非法值
 * =========================================================================== */

describe('AC3 风险三级四态', () => {
  it('新建风险：默认「未处理」，级别与负责人按请求落库', async () => {
    const risk = await makeRisk(pm.id, { level: 'MEDIUM' })

    expect(risk.status).toBe('OPEN')
    expect(risk.level).toBe('MEDIUM')
    expect(risk.ownerUserId).toBe(member1.id)
    expect(risk.owner.displayName).toBe('成员一')
    expect(risk.projectId).toBe(projectId)

    // 读-写-读闭环：从列表再读一次
    const items = ((await listRisks(pm.id)).body as { items: RiskView[] }).items
    expect(items.map((item) => item.id)).toContain(risk.id)
  })

  it('三个级别都能建（高 / 中 / 低）', async () => {
    for (const level of ['HIGH', 'MEDIUM', 'LOW']) {
      const risk = await makeRisk(pm.id, { level, title: `级别-${level}` })
      expect(risk.level).toBe(level)
    }
  })

  it('★ 级别非法值 → 422 INVALID_VALUE', async () => {
    const res = await postRisk(pm.id, {
      title: '非法级别',
      level: 'URGENT',
      ownerUserId: member1.id,
    })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'level',
      code: 'INVALID_VALUE',
    })
  })

  it('★ 状态非法值 → 422 INVALID_VALUE（用不存在的取值继续验证"非法被拒"）', async () => {
    const res = await postRisk(pm.id, {
      title: '非法状态',
      level: 'HIGH',
      ownerUserId: member1.id,
      status: 'PENDING', // 契约里没有这个取值
    })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'status',
      code: 'INVALID_VALUE',
    })
  })

  it('负责人不是本项目成员 → 422 NOT_PROJECT_MEMBER', async () => {
    const res = await postRisk(pm.id, {
      title: '外部负责人',
      level: 'HIGH',
      ownerUserId: outsider.id,
    })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'ownerUserId',
      code: 'NOT_PROJECT_MEMBER',
    })
  })

  it('关联任务不属于本项目 → 422 CROSS_PROJECT_REF', async () => {
    const res = await postRisk(pm.id, {
      title: '跨项目任务',
      level: 'HIGH',
      ownerUserId: member1.id,
      taskId: '00000000-0000-0000-0000-000000000000',
    })
    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'taskId',
      code: 'CROSS_PROJECT_REF',
    })
  })
})

/* ===========================================================================
 * AC3 —— 四态流转
 * =========================================================================== */

describe('AC3 四态流转', () => {
  it('未处理 → 处理中 → 已解决（需解决说明）→ 已关闭', async () => {
    const risk = await makeRisk(pm.id)

    const inProgress = await patchRisk(pm.id, risk.id, { status: 'IN_PROGRESS' })
    expect(inProgress.status).toBe(200)
    expect((inProgress.body as RiskView).status).toBe('IN_PROGRESS')

    const resolved = await patchRisk(pm.id, risk.id, {
      status: 'RESOLVED',
      resolution: '已与第三方确认接口稳定性',
    })
    expect(resolved.status).toBe(200)
    expect((resolved.body as RiskView).status).toBe('RESOLVED')
    expect((resolved.body as RiskView).resolution).toBe('已与第三方确认接口稳定性')

    const closed = await patchRisk(pm.id, risk.id, { status: 'CLOSED' })
    expect(closed.status).toBe(200)
    expect((closed.body as RiskView).status).toBe('CLOSED')
  })

  it('★ 改为「已解决」但不填解决说明 → 422 resolution REQUIRED', async () => {
    const risk = await makeRisk(pm.id)
    const res = await patchRisk(pm.id, risk.id, { status: 'RESOLVED' })

    expect(res.status).toBe(422)
    expect((res.body as ErrorBody).error.details).toContainEqual({
      field: 'resolution',
      code: 'REQUIRED',
    })
    // 状态未被改掉（查库确认）
    const row = await ctx.db.risk.findUnique({ where: { id: risk.id }, select: { status: true } })
    expect(row?.status).toBe('OPEN')
  })

  it('★ 允许回退（重开）：已解决 → 未处理（四态不强制单向，依据批复由本票定义）', async () => {
    const risk = await makeRisk(pm.id)
    await patchRisk(pm.id, risk.id, { status: 'RESOLVED', resolution: '临时规避' })

    const reopened = await patchRisk(pm.id, risk.id, { status: 'OPEN' })
    expect(reopened.status).toBe(200)
    expect((reopened.body as RiskView).status).toBe('OPEN')
  })

  it('状态变化写一条 risk.status 审计（不是普通 risk.update）', async () => {
    const risk = await makeRisk(pm.id)
    await patchRisk(pm.id, risk.id, { status: 'IN_PROGRESS' })

    const logs = await ctx.db.auditLog.findMany({ where: { objectType: 'risk', objectId: risk.id } })
    const actions = logs.map((log) => log.action)
    expect(actions).toContain('risk.create')
    expect(actions).toContain('risk.status')

    const statusLog = logs.find((log) => log.action === 'risk.status')
    expect(statusLog?.before).toContain('OPEN')
    expect(statusLog?.after).toContain('IN_PROGRESS')
  })
})

/* ===========================================================================
 * 授权（按批复：risk.write = PM + MEMBER；VIEWER 只读）
 * =========================================================================== */

describe('授权：风险写权限 = PM + MEMBER；VIEWER 只读', () => {
  it('MEMBER 可以新建与修改风险（批复明确 MEMBER 可写）', async () => {
    const risk = await makeRisk(member1.id, { title: '成员提的风险' })
    const patched = await patchRisk(member1.id, risk.id, { level: 'LOW' })
    expect(patched.status).toBe(200)
    expect((patched.body as RiskView).level).toBe('LOW')
  })

  it('★【fail-closed，临时】MEMBER 改风险状态 → 403（含自己负责的风险）', async () => {
    // 项目负责人 2026-10-18 批复 §1：已批准口径是「MEMBER 只能流转**自己负责**的风险」，
    // 该判定的正确落点是公共层新增 `risk.flow` 的对象关系判定（由 B 落地）。
    // 公共层就绪前，批复要求先 fail-closed：**成员一律不得流转任何风险状态（403）**。
    //
    // ★ 本条**不得用于勾最终 AC**（批复明确要求）：公共层落地后应改写为
    //   「成员可流转自己的风险 200 / 他人风险 403」。
    const ownRisk = await makeRisk(member1.id, { title: '成员自己的风险' })
    expect((await patchRisk(member1.id, ownRisk.id, { status: 'IN_PROGRESS' })).status).toBe(403)

    // 但**写台账本身**（改级别等非状态字段）仍允许 —— 批复第 4 节的票面更正口径
    const stillAllowed = await patchRisk(member1.id, ownRisk.id, { level: 'LOW' })
    expect(stillAllowed.status).toBe(200)

    // PM 不受影响
    const byPm = await patchRisk(pm.id, ownRisk.id, { status: 'IN_PROGRESS' })
    expect(byPm.status).toBe(200)
    expect((byPm.body as RiskView).status).toBe('IN_PROGRESS')
  })

  it('VIEWER 可以读清单，但不能写 → 403', async () => {
    await makeRisk(pm.id)

    const list = await listRisks(viewer.id)
    expect(list.status).toBe(200)

    const create = await postRisk(viewer.id, {
      title: '阅览者不能提风险',
      level: 'HIGH',
      ownerUserId: member1.id,
    })
    expect(create.status).toBe(403)
    expect((create.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('非项目成员 → 404（读与写都一样，不泄漏项目存在性）', async () => {
    await makeRisk(pm.id)
    expect((await listRisks(outsider.id)).status).toBe(404)
    const create = await postRisk(outsider.id, { title: 'x', level: 'HIGH', ownerUserId: outsider.id })
    expect(create.status).toBe(404)
  })
})

/* ===========================================================================
 * AC7 —— 敏感风险继承关联任务的可见性
 * =========================================================================== */

describe('AC7 敏感风险继承关联任务可见性', () => {
  it('★ 关联到"我看不到的敏感任务"的风险：清单不含、详情与修改都是 404', async () => {
    const sensitiveTask = await seedTask({ isSensitive: true })
    const risk = await makeRisk(pm.id, { title: '敏感任务的风险', taskId: sensitiveTask })

    // PM 不受白名单限制，能看到
    expect(((await listRisks(pm.id)).body as { items: RiskView[] }).items).toHaveLength(1)

    // 非白名单成员：既看不到，也改不了（404，与"不存在"一致）
    expect(((await listRisks(member1.id)).body as { items: RiskView[] }).items).toHaveLength(0)
    const patch = await patchRisk(member1.id, risk.id, { level: 'LOW' })
    expect(patch.status).toBe(404)
    const detail = await ctx
      .asUser(ctx.loginAs(member1.id))
      .get(`/risks/${risk.id}`)
    expect(detail.status).toBe(404)
  })

  it('白名单成员可以看到并修改该风险', async () => {
    const sensitiveTask = await seedTask({ isSensitive: true })
    const risk = await makeRisk(pm.id, { taskId: sensitiveTask })
    await ctx.db.objectVisibility.create({
      data: { projectId, objectType: 'task', objectId: sensitiveTask, userId: member1.id },
    })

    expect(((await listRisks(member1.id)).body as { items: RiskView[] }).items).toHaveLength(1)
    expect((await patchRisk(member1.id, risk.id, { level: 'LOW' })).status).toBe(200)
  })

  it('不关联任务的公开风险对普通成员可见', async () => {
    await makeRisk(pm.id, { title: '公开风险' })
    expect(((await listRisks(member1.id)).body as { items: RiskView[] }).items).toHaveLength(1)
  })
})

/* ===========================================================================
 * AC4 / AC5 —— 关闭阻断、审计与重开
 * =========================================================================== */

describe('AC4/AC5 项目关闭与重开', () => {
  it('★ 有未关闭任务 → 关闭被拒（409），项目仍是 ACTIVE', async () => {
    await seedTask({ status: 'DOING' })

    const res = await closeProject(pm.id)
    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.code).toBe('CONFLICT')

    const row = await ctx.db.project.findUnique({ where: { id: projectId }, select: { status: true } })
    expect(row?.status).toBe('ACTIVE')
  })

  it('★ 任务都关闭了，但还有「未处理」风险 → 关闭同样被拒（409）', async () => {
    await seedTask({ status: 'CLOSED' })
    await makeRisk(pm.id)

    const res = await closeProject(pm.id)
    expect(res.status).toBe(409)
    expect((res.body as ErrorBody).error.message).toContain('风险')
  })

  it('★ 风险改为「已解决」后条件解除 → 可以关闭，且留一条审计', async () => {
    await seedTask({ status: 'CLOSED' })
    const risk = await makeRisk(pm.id)
    await patchRisk(pm.id, risk.id, { status: 'RESOLVED', resolution: '已修复' })

    // 先确认预览已判定为"可以关闭"
    const preview = (await closureOf(pm.id)).body as ClosureCheckView
    expect(preview.verdict.state).toBe('clear')

    const res = await closeProject(pm.id)
    expect(res.status).toBe(200)
    expect((res.body as { project: { status: string } }).project.status).toBe('CLOSED')

    const row = await ctx.db.project.findUnique({ where: { id: projectId }, select: { status: true } })
    expect(row?.status).toBe('CLOSED')

    const logs = await ctx.db.auditLog.findMany({ where: { action: 'project.close' } })
    expect(logs).toHaveLength(1)
    // 审计的 before / after 是 **JSON 字符串**（与敏感设置端点同一做法）：
    // 这里解析后比对字段，比比对裸字符串更严，同时验证它确实可解析。
    // 原实现存的是裸字符串 'CLOSED'（JSON 编码后变成 '"CLOSED"'、没有字段名），
    // 已改为存 `{ status }` 对象。
    expect(JSON.parse(logs[0]!.after as string)).toEqual({ status: 'CLOSED' })
    expect(JSON.parse(logs[0]!.before as string)).toEqual({ status: 'ACTIVE' })
  })

  it('★ 并发双关闭：恰好一个 200、一个 409，且 project.close 审计只有 1 条（审查 B1 回归护栏）', async () => {
    await seedTask({ status: 'CLOSED' })

    // 原实现是「读状态 → 校验 → 无条件 update」：并发下两次都能过、各写一条审计
    // （独立审查 B1 实测 200/200、审计 2 条）。现改为 CAS
    // （updateMany where status='ACTIVE'），第二个请求影响 0 行 → 409。
    const [first, second] = await Promise.all([closeProject(pm.id), closeProject(pm.id)])

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409])

    const row = await ctx.db.project.findUnique({ where: { id: projectId }, select: { status: true } })
    expect(row?.status).toBe('CLOSED')
    expect(await ctx.db.auditLog.count({ where: { action: 'project.close' } })).toBe(1)
  })

  it('MEMBER 不能关闭项目（project.close 仅 PM）→ 403', async () => {
    await seedTask({ status: 'CLOSED' })
    const res = await closeProject(member1.id)
    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('VIEWER 与 outsider 也关不了（VIEWER 403 / outsider 404）', async () => {
    expect((await closeProject(viewer.id)).status).toBe(403)
    expect((await closeProject(outsider.id)).status).toBe(404)
  })

  it('重复关闭 → 409（已处于关闭状态）', async () => {
    await seedTask({ status: 'CLOSED' })
    expect((await closeProject(pm.id)).status).toBe(200)
    expect((await closeProject(pm.id)).status).toBe(409)
  })

  it('重开：仅 PM，且只有已关闭的项目能重开；重开写审计', async () => {
    await seedTask({ status: 'CLOSED' })

    // 未关闭就重开 → 409
    expect((await reopenProject(pm.id)).status).toBe(409)

    expect((await closeProject(pm.id)).status).toBe(200)

    // MEMBER 不能重开
    expect((await reopenProject(member1.id)).status).toBe(403)

    const res = await reopenProject(pm.id)
    expect(res.status).toBe(200)
    expect((res.body as { project: { status: string } }).project.status).toBe('ACTIVE')

    const logs = await ctx.db.auditLog.findMany({ where: { action: 'project.reopen' } })
    expect(logs).toHaveLength(1)
    // 重开的审计同样存对象：{ status: 'CLOSED' } → { status: 'ACTIVE' }
    expect(JSON.parse(logs[0]!.before as string)).toEqual({ status: 'CLOSED' })
    expect(JSON.parse(logs[0]!.after as string)).toEqual({ status: 'ACTIVE' })
  })

  it('★ 敏感风险不可见时不计入该成员的阻断清单（不泄漏存在性）', async () => {
    await seedTask({ status: 'CLOSED' })
    const sensitiveTask = await seedTask({ isSensitive: true, status: 'CLOSED' })
    await makeRisk(pm.id, { taskId: sensitiveTask, status: 'OPEN' })

    const pmView = (await closureOf(pm.id)).body as ClosureCheckView
    expect(pmView.blockingRisks.total).toBe(1)

    const memberView = (await closureOf(member1.id)).body as ClosureCheckView
    expect(memberView.blockingRisks.total).toBe(0)
  })
})
