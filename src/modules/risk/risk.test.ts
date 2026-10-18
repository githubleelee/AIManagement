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
 * 创建即「未处理」（DECISIONS `permissions.risk-ownership-change`）
 *
 * 裁定原文：**创建风险时状态只能为 `OPEN`，其余三态必须经流转产生。**
 * 原实现允许 `POST /projects/:id/risks {status:'CLOSED'}` 直接建出已关闭的风险 ——
 * 那是一条绕过 `risk.flow` 归属判定与流转审计的通道（独立评审列为裁定项，现已封死）。
 * =========================================================================== */

describe('创建风险：状态只能是「未处理」', () => {
  it('★ 直接建「处理中 / 已解决 / 已关闭」→ 422 INVALID_VALUE，且不落库、不写审计', async () => {
    for (const status of ['IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const) {
      const res = await postRisk(pm.id, {
        title: `不能直接建成-${status}`,
        level: 'HIGH',
        ownerUserId: member1.id,
        status,
        // 已解决 / 已关闭在流转路径上必须带解决说明；这里带上，免得被别的校验先拦掉
        ...(status === 'IN_PROGRESS' ? {} : { resolution: '想直接建已解决' }),
      })

      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.details).toContainEqual({
        field: 'status',
        code: 'INVALID_VALUE',
      })
    }

    // 三次都没落库，也没留下一条「创建成功」的审计
    expect(await ctx.db.risk.count()).toBe(0)
    expect(await ctx.db.auditLog.count({ where: { action: 'risk.create' } })).toBe(0)
  })

  it('★ 收窄不改变鉴权顺序：MEMBER 422 / VIEWER 403 / outsider 404 / 未登录 401', async () => {
    // 评审 P4：本次修复的安全价值建立在"检查写在 can() 之后"。若后人为了"早失败"把这段
    // 判断挪进 Zod schema 或挪到 createRisk 开头，outsider 就会从 404 变成 422 ——
    // 这条用例就是为了让那次改动变红。
    const body = { title: '越权试探', level: 'HIGH', ownerUserId: member1.id, status: 'CLOSED' }

    // PM 与 MEMBER 都过得了鉴权 ⇒ 落到业务规则 ⇒ 422
    for (const actor of [pm.id, member1.id]) {
      const res = await postRisk(actor, body)
      expect(res.status).toBe(422)
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
    }

    // VIEWER 对象可见但无写权 ⇒ 403（不是 422：不能靠请求体形状判断"我能不能写"）
    expect((await postRisk(viewer.id, body)).status).toBe(403)

    // 非成员 ⇒ 404，且与"项目不存在"逐字一致（不泄漏项目存在性）
    const outsiderRes = await postRisk(outsider.id, body)
    expect(outsiderRes.status).toBe(404)
    const missingProject = await ctx
      .asUser(ctx.loginAs(outsider.id))
      .post('/projects/00000000-0000-0000-0000-000000000000/risks')
      .send(body)
    expect(outsiderRes.body).toEqual(missingProject.body)

    // 未登录 ⇒ 401
    expect((await ctx.asUser(null).post(`/projects/${projectId}/risks`).send(body)).status).toBe(401)
  })

  it('显式传 OPEN 或缺省 → 都建成「未处理」（不能把合法的也拦了）', async () => {
    const explicit = await postRisk(pm.id, {
      title: '显式 OPEN',
      level: 'LOW',
      ownerUserId: member1.id,
      status: 'OPEN',
    })
    expect(explicit.status).toBe(201)
    expect((explicit.body as RiskView).status).toBe('OPEN')

    const omitted = await makeRisk(pm.id, { title: '缺省状态' })
    expect(omitted.status).toBe('OPEN')
  })

  it('创建时带的解决说明被归一为 null（不留「未处理却有解决说明」的脏数据）', async () => {
    const risk = await makeRisk(pm.id, { title: '带说明的新建', resolution: '不该生效' })
    expect(risk.status).toBe('OPEN')
    expect(risk.resolution).toBeNull()
  })

  it('封死的是「创建」，不是「流转」：建成后仍能一路走到已关闭', async () => {
    const risk = await makeRisk(pm.id, { title: '正常流转' })
    expect((await patchRisk(pm.id, risk.id, { status: 'IN_PROGRESS' })).status).toBe(200)
    expect(
      (await patchRisk(pm.id, risk.id, { status: 'RESOLVED', resolution: '已处理' })).status,
    ).toBe(200)
    const closed = await patchRisk(pm.id, risk.id, { status: 'CLOSED' })
    expect(closed.status).toBe(200)
    expect((closed.body as RiskView).status).toBe('CLOSED')
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

  /* ---------------------------------------------------------------------------
   * 审计字段完整性（2026-10-19 独立评审 ③）
   *
   * 原实现 before / after 只记 title / level / status（+resolution）：
   * 改绑负责人、改关联任务、改描述在审计里 before === after —— 等于没留痕，
   * 而且恰好把 H1 的越权痕迹一起掩盖了。
   * ------------------------------------------------------------------------- */

  it('★ 审计覆盖**全部可写字段**：改绑负责人 / 改关联任务 / 改描述都看得见', async () => {
    const taskId = await seedTask()
    const risk = await makeRisk(pm.id, { title: '原题', description: '原描述', level: 'LOW' })

    // 只改台账字段、不动状态 ⇒ `risk.update`
    const res = await patchRisk(pm.id, risk.id, {
      description: '新描述',
      ownerUserId: member2.id,
      taskId,
    })
    expect(res.status).toBe(200)

    const log = await ctx.db.auditLog.findFirst({
      where: { objectType: 'risk', objectId: risk.id, action: 'risk.update' },
      orderBy: { createdAt: 'desc' },
    })
    const before = JSON.parse(log?.before as string)
    const after = JSON.parse(log?.after as string)

    expect(before.ownerUserId).toBe(member1.id)
    expect(after.ownerUserId).toBe(member2.id)
    expect(before.taskId).toBeNull()
    expect(after.taskId).toBe(taskId)
    expect(before.description).toBe('原描述')
    expect(after.description).toBe('新描述')
  })

  it('★ 审计覆盖 create 的全部可写字段（原实现漏 description 与 resolution）', async () => {
    const risk = await makeRisk(pm.id, { description: '建档描述' })

    const log = await ctx.db.auditLog.findFirst({
      where: { objectType: 'risk', objectId: risk.id, action: 'risk.create' },
    })
    expect(log?.before).toBeNull()

    const after = JSON.parse(log?.after as string)
    expect(after.description).toBe('建档描述')
    expect(after.ownerUserId).toBe(member1.id)
    expect(after.taskId).toBeNull()
    expect(after).toHaveProperty('resolution', null)
  })

  it('★ 状态回退清空解决说明，在审计里也看得见（resolution 前后值）', async () => {
    const risk = await makeRisk(pm.id)
    await patchRisk(pm.id, risk.id, { status: 'RESOLVED', resolution: '临时规避' })
    await patchRisk(pm.id, risk.id, { status: 'OPEN' })

    const logs = await ctx.db.auditLog.findMany({
      where: { objectId: risk.id, action: 'risk.status' },
      orderBy: { createdAt: 'asc' },
    })
    const lastLog = logs[logs.length - 1]
    expect(JSON.parse(lastLog?.before as string).resolution).toBe('临时规避')
    expect(JSON.parse(lastLog?.after as string).resolution).toBeNull()
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

  it('★ 成员只能流转**自己负责**的风险（公共层 risk.flow 对象关系判定，2026-10-18 落地）', async () => {
    // 批复最终口径：PM 全部；MEMBER 仅 `ownerUserId` = 本人的风险；VIEWER / 他人 403。
    // 公共层未就绪时本票按批复 §1 做过临时 fail-closed（成员一律 403）；
    // `risk.flow` 落地后本用例改为断言**最终口径**。
    const ownRisk = await makeRisk(member1.id, { title: '成员自己的风险' })
    // ★ 注意：`makeRisk` 的 `ownerUserId` **默认是 member1**，与"由谁调用"无关。
    //   第一版这里写成 `makeRisk(member2.id, { title: '别人负责的风险' })` ——
    //   调用者换成了 member2，但负责人仍是 member1，于是"流转别人的风险"实际成了
    //   "流转自己的风险"（200 正确），用例假红。必须显式指定 ownerUserId。
    const othersRisk = await makeRisk(pm.id, {
      title: '别人负责的风险',
      ownerUserId: member2.id,
    })

    // 自己的 → 可以流转
    const ownFlow = await patchRisk(member1.id, ownRisk.id, { status: 'IN_PROGRESS' })
    expect(ownFlow.status).toBe(200)
    expect((ownFlow.body as RiskView).status).toBe('IN_PROGRESS')

    // 别人的 → 403（服务端强制，与前端是否渲染按钮无关）
    expect((await patchRisk(member1.id, othersRisk.id, { status: 'IN_PROGRESS' })).status).toBe(403)

    // 改非状态字段（台账写入）不受影响
    expect((await patchRisk(member1.id, ownRisk.id, { level: 'LOW' })).status).toBe(200)

    // PM 可以流转任何人的
    expect((await patchRisk(pm.id, othersRisk.id, { status: 'IN_PROGRESS' })).status).toBe(200)

    // VIEWER 一律 403
    expect((await patchRisk(viewer.id, ownRisk.id, { status: 'OPEN' })).status).toBe(403)
  })

  /* ---------------------------------------------------------------------------
   * H1 回归（2026-10-19 独立评审，裁定方案 (b)：归属变更视同流转）
   *
   * 原实现只在 `statusChanged` 时调 `risk.flow`，而 `ownerUserId` 的写入只受
   * `risk.write`（PM + MEMBER）约束 ⇒ 成员可以「先把自己改绑成负责人、再流转」，
   * 两步拿到对他人风险的流转权（B 的实跑复现）。
   * ------------------------------------------------------------------------- */

  it('★ H1：成员不能"先改绑、再流转"绕过 risk.flow（评审实跑的三步复现）', async () => {
    const othersRisk = await makeRisk(pm.id, { title: '别人负责的风险', ownerUserId: member2.id })

    // ① 直接流转 → 403（原有行为，正确）
    expect((await patchRisk(member1.id, othersRisk.id, { status: 'IN_PROGRESS' })).status).toBe(403)

    // ② 把负责人改绑给自己 → 修复后同样 403（原实现是 200，这就是被绕过的那一步）
    const rebind = await patchRisk(member1.id, othersRisk.id, { ownerUserId: member1.id })
    expect(rebind.status).toBe(403)

    // 查库确认负责人与状态真的没被改动（不能只看状态码就说"拦住了"）
    const row = await ctx.db.risk.findUnique({
      where: { id: othersRisk.id },
      select: { ownerUserId: true, status: true },
    })
    expect(row?.ownerUserId).toBe(member2.id)
    expect(row?.status).toBe('OPEN')

    // ③ 再流转 → 仍然 403（负责人仍是 member2，组合漏洞已关闭）
    expect((await patchRisk(member1.id, othersRisk.id, { status: 'IN_PROGRESS' })).status).toBe(403)
  })

  it('★ H1：「关联任务」变更与负责人改绑同一口径，也走 risk.flow', async () => {
    const taskId = await seedTask()
    const othersRisk = await makeRisk(pm.id, { title: '他人风险', ownerUserId: member2.id })

    // 成员改他人风险的关联任务 → 403（该任务本身对他可见，所以不是可见性拦下的）
    expect((await patchRisk(member1.id, othersRisk.id, { taskId })).status).toBe(403)

    // PM 改绑任何人的归属都允许（can() 第 3 条）
    const byPm = await patchRisk(pm.id, othersRisk.id, { taskId })
    expect(byPm.status).toBe(200)
    expect((byPm.body as RiskView).taskId).toBe(taskId)
  })

  it('H1 的边界（如实登记，不代表已定案）：成员改**自己负责**风险的归属仍允许', async () => {
    // 裁定 (b) 的字面结果：收窄的是"别人的风险"，不是把 risk.write 整体削弱。
    // ⚠️ 「成员能否把自己负责的风险改派给他人」是 B 列出的待裁定项之一
    //    （risk.write 的范围），本条只钉住当前实现；若日后裁定"改派仅 PM"，
    //    本条应当随之改写 —— 这正是留一条用例的目的。
    const ownRisk = await makeRisk(member1.id, { title: '自己的风险' })
    const res = await patchRisk(member1.id, ownRisk.id, { ownerUserId: member2.id })
    expect(res.status).toBe(200)
    expect((res.body as RiskView).ownerUserId).toBe(member2.id)
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

/* ===========================================================================
 * 排序（2026-10-19 独立评审 ④）
 *
 * 原实现把排序交给数据库的 `orderBy: [{ status: 'asc' }, { level: 'asc' }]`，
 * 而注释声称「未处理排前、高危优先」—— 实际拿到的是字典序：
 *   status: CLOSED → IN_PROGRESS → OPEN → RESOLVED
 *   level : HIGH → LOW → MEDIUM
 * 两处都用到了它，且 `closure-check` 还带 `take: 50`：先按错序截断会把**中危**
 * 挤出阻断清单（B 的实跑结论）。现改为按 `ordering.ts` 的显式 rank 排序。
 * =========================================================================== */

describe('排序：未处理排前、高危优先', () => {
  it('★ 清单按「状态 → 等级 → 创建时间」排序，而不是字典序', async () => {
    // 刻意造出"字典序与意图相反"的组合：
    //   字典序会给 IN_PROGRESS 在 OPEN 之前、LOW 在 MEDIUM 之前。
    const inProgressMedium = await makeRisk(pm.id, { title: 'A-处理中-中', level: 'MEDIUM' })
    await patchRisk(pm.id, inProgressMedium.id, { status: 'IN_PROGRESS' })

    await makeRisk(pm.id, { title: 'B-未处理-低', level: 'LOW' })
    await makeRisk(pm.id, { title: 'C-未处理-高', level: 'HIGH' })

    const resolvedMedium = await makeRisk(pm.id, { title: 'D-已解决-中', level: 'MEDIUM' })
    await patchRisk(pm.id, resolvedMedium.id, { status: 'RESOLVED', resolution: '已规避' })

    const items = ((await listRisks(pm.id)).body as { items: RiskView[] }).items

    // 字典序会得到 [A-处理中-中, B-未处理-低, C-未处理-高, D-已解决-中]；
    // 按意图应当是：未处理在前、同级高危在前。
    expect(items.map((item) => item.title)).toEqual([
      'C-未处理-高',
      'B-未处理-低',
      'A-处理中-中',
      'D-已解决-中',
    ])
  })

  it('★ closure-check：排序发生在 50 条截断**之前**，中危不会被低危挤出清单', async () => {
    await seedTask({ status: 'CLOSED' }) // 任务侧不阻断，让风险侧单独说话

    // 50 条低危（先建）+ 1 条高危 + 1 条中危（后建，基准序靠后）。
    // 旧实现 `orderBy: [{ level: 'asc' }] + take: 50` 的字典序是 HIGH → LOW → MEDIUM，
    // 于是 50 条低危正好占满上限，**中危被截掉**。
    await ctx.db.risk.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        projectId,
        title: `低危-${i}`,
        description: null,
        level: 'LOW',
        status: 'OPEN',
        ownerUserId: member1.id,
        taskId: null,
        resolution: null,
      })),
    })
    await makeRisk(pm.id, { title: '高危', level: 'HIGH' })
    await makeRisk(pm.id, { title: '中危', level: 'MEDIUM' })

    const view = (await closureOf(pm.id)).body as ClosureCheckView
    expect(view.blockingRisks.total).toBe(52) // total 始终精确，不受行数上限影响
    expect(view.blockingRisks.rows).toHaveLength(50)
    expect(view.blockingRisks.rows[0]!.title).toBe('高危')
    expect(view.blockingRisks.rows[1]!.title).toBe('中危')
  })
})
