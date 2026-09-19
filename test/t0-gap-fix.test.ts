/**
 * T0 缺口修补验证：HTTP 层注入缝隙 + actor 注入 + can() 骨架
 *
 * ===========================================================================
 * 本文件验证三件事（对应 A / B / C 三步修补）
 * ===========================================================================
 *
 * A. **HTTP 层注入缝隙**：`buildApp({ prisma })` 能让 app 指向独立临时库，
 *    从而让契约要求的「打接口」测试成立。验证方式是造数据→打接口→断言，
 *    整个过程不触碰 `.env` 的 dev.db。
 *
 * B. **actor 注入**：带有效令牌 → 被识别为对应用户；无令牌 / 令牌被篡改 /
 *    用户已删除 → 401 UNAUTHENTICATED；权限判定**每次请求现查库**
 *    （移除成员后下一次请求立即被拒，无需重新登录，契约决策 I-10）。
 *
 * C. **can() 骨架**：判定顺序第 1、2、3、5 条按契约决策 I-5 生效，
 *    含「非项目成员一律 404」与「写类动作对 MEMBER/VIEWER 返回 403」。
 *
 * 测试探针说明：本文件自行注册探针端点，原因与 `error-handler.test.ts` 相同 ——
 * 生产路由集中在 `src/routes.ts`（冻结文件）注册，而 30 个业务端点尚未实现，
 * 此处不能也不应往里加路由。探针只用于验证框架能力。
 * ===========================================================================
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../src/shared/errors.js'
import type { Action, ObjectRef } from '../src/shared/types.js'
import { createAuthorization } from '../src/modules/authz/permissions.js'
import { currentUserId, requireAuth } from '../src/auth/actor.js'
import {
  createHttpTestContext,
  makeMember,
  makeProject,
  makeUser,
  type HttpTestContext,
} from './http-support.js'

let ctx: HttpTestContext

beforeAll(async () => {
  ctx = await createHttpTestContext()

  // 探针 1：要求登录，回显识别到的 actor（验证 B）
  ctx.app.get('/__probe__/whoami', { preHandler: requireAuth }, async (req) => {
    return { actorUserId: currentUserId(req) }
  })

  // 探针 2：验证 can() 的接入方式（验证 C）
  ctx.app.get('/__probe__/can', { preHandler: requireAuth }, async (req) => {
    const query = req.query as { action?: string; projectId?: string }
    const { can } = createAuthorization(ctx.db)
    const decision = await can(currentUserId(req), query.action as Action, {
      kind: 'project',
      projectId: query.projectId ?? '',
    } satisfies ObjectRef)
    if (!decision.allow) {
      throw new AppError(decision.status, decision.code, '对象不存在')
    }
    return { allow: true }
  })

  // 探针注册完毕后才 ready —— Fastify booted 之后不允许再注册路由
  await ctx.app.ready()
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

// ---------------------------------------------------------------------------
// A + B：注入缝隙与 actor 注入
// ---------------------------------------------------------------------------

describe('A. HTTP 层注入缝隙：app 指向独立临时库', () => {
  it('工厂造出的数据能被 app 通过接口读到（证明 app 用的是临时库而非 dev.db）', async () => {
    const pmId = await makeUser(ctx.db, 'pm-inject', '临时库 PM')
    const projectId = await makeProject(ctx.db, pmId, '注入验证项目')
    const token = ctx.loginAs(pmId)

    const res = await ctx.asUser(token).get('/__probe__/whoami')

    expect(res.status).toBe(200)
    // 若 app 仍连 dev.db，此处不会拿到临时库里造出的用户 id
    expect(res.body).toEqual({ actorUserId: pmId })
    expect(projectId).toBeTruthy()
  })
})

describe('B. actor 注入与 401 语义', () => {
  it('无 Authorization 头 → 401 UNAUTHENTICATED', async () => {
    const res = await ctx.asUser(null).get('/__probe__/whoami')
    expect(res.status).toBe(401)
  })

  it('Bearer 前缀缺失 → 401', async () => {
    const userId = await makeUser(ctx.db, 'no-bearer')
    const token = ctx.loginAs(userId)
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/__probe__/whoami',
      headers: { authorization: token }, // 缺 "Bearer "
    })
    expect(res.statusCode).toBe(401)
  })

  it('令牌被篡改 → 401（签名校验生效）', async () => {
    const userId = await makeUser(ctx.db, 'tampered')
    const token = ctx.loginAs(userId)
    const res = await ctx.asUser(`${token}x`).get('/__probe__/whoami')
    expect(res.status).toBe(401)
  })

  it('令牌格式非法 → 401', async () => {
    const res = await ctx.asUser('not-a-valid-token').get('/__probe__/whoami')
    expect(res.status).toBe(401)
  })

  it('用户已被删除 → 其旧令牌立即失效（401）', async () => {
    const userId = await makeUser(ctx.db, 'deleted-user')
    const token = ctx.loginAs(userId)
    // 先确认有效
    expect((await ctx.asUser(token).get('/__probe__/whoami')).status).toBe(200)
    // 删除用户后再用同一令牌
    await ctx.db.user.delete({ where: { id: userId } })
    expect((await ctx.asUser(token).get('/__probe__/whoami')).status).toBe(401)
  })

  it('权限变更即时生效：移除成员后下一次请求即被拒（决策 I-10，不依赖重新登录）', async () => {
    const pmId = await makeUser(ctx.db, 'pm-live')
    const memberId = await makeUser(ctx.db, 'member-live')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, memberId, 'MEMBER')
    const token = ctx.loginAs(memberId)

    // 成员身份下 project.read 允许
    const before = await ctx
      .asUser(token)
      .get(`/__probe__/can?action=project.read&projectId=${projectId}`)
    expect(before.status).toBe(200)

    // 移除成员关系（不重新登录、不换 token）
    await ctx.db.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberId } },
    })

    // 同一下一次请求即被拒
    const after = await ctx
      .asUser(token)
      .get(`/__probe__/can?action=project.read&projectId=${projectId}`)
    expect(after.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// C：can() 骨架的判定顺序
// ---------------------------------------------------------------------------

describe('C. can() 骨架（契约决策 I-5）', () => {
  const READ: Action = 'project.read'
  const WRITE: Action = 'requirement.write'

  it('第 1 条：目标对象不存在 → 404', async () => {
    const pmId = await makeUser(ctx.db, 'pm-c1')
    const { can } = createAuthorization(ctx.db)
    const decision = await can(pmId, READ, { kind: 'project', projectId: 'not-exist' })
    expect(decision).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
  })

  it('第 2 条：非项目成员 → 404（一切动作，含只读）', async () => {
    const pmId = await makeUser(ctx.db, 'pm-c2')
    const outsiderId = await makeUser(ctx.db, 'outsider-c2')
    const projectId = await makeProject(ctx.db, pmId)
    const { can } = createAuthorization(ctx.db)

    for (const action of [READ, WRITE] as Action[]) {
      const decision = await can(outsiderId, action, { kind: 'project', projectId })
      expect(decision).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
    }
  })

  it('第 3 条：PM 允许一切动作', async () => {
    const pmId = await makeUser(ctx.db, 'pm-c3')
    const projectId = await makeProject(ctx.db, pmId)
    const { can } = createAuthorization(ctx.db)

    const actions: Action[] = [
      'project.read',
      'project.manage_members',
      'requirement.write',
      'task.write',
      'sensitivity.manage',
    ]
    for (const action of actions) {
      expect(await can(pmId, action, { kind: 'project', projectId })).toEqual({ allow: true })
    }
  })

  it('第 5 条：MEMBER 只读放行、写类动作 → 403', async () => {
    const pmId = await makeUser(ctx.db, 'pm-c5')
    const memberId = await makeUser(ctx.db, 'member-c5')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, memberId, 'MEMBER')
    const { can } = createAuthorization(ctx.db)

    expect(await can(memberId, READ, { kind: 'project', projectId })).toEqual({ allow: true })
    expect(await can(memberId, WRITE, { kind: 'project', projectId })).toEqual({
      allow: false,
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('第 5 条：VIEWER 与 MEMBER 同待遇（本轮不做多级授权范围）', async () => {
    const pmId = await makeUser(ctx.db, 'pm-c5b')
    const viewerId = await makeUser(ctx.db, 'viewer-c5b')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, viewerId, 'VIEWER')
    const { can } = createAuthorization(ctx.db)

    expect(await can(viewerId, READ, { kind: 'project', projectId })).toEqual({ allow: true })
    expect(await can(viewerId, WRITE, { kind: 'project', projectId })).toEqual({
      allow: false,
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('第 4 条（本轮保守实现）：敏感用户故事对非 PM 一律 404，PM 仍可见', async () => {
    const pmId = await makeUser(ctx.db, 'pm-c6')
    const memberId = await makeUser(ctx.db, 'member-c6')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, memberId, 'MEMBER')

    const goal = await ctx.db.businessGoal.create({
      data: { projectId, name: '目标', sortOrder: 0 },
    })
    const activity = await ctx.db.userActivity.create({
      data: { projectId, goalId: goal.id, name: '活动', sortOrder: 0 },
    })
    const story = await ctx.db.userStory.create({
      data: {
        projectId,
        activityId: activity.id,
        title: '敏感故事',
        roleText: 'r',
        capabilityText: 'c',
        valueText: 'v',
        businessValue: 'bv',
        priority: 'P0',
        isSensitive: true,
      },
    })

    const { can } = createAuthorization(ctx.db)

    // MEMBER：保守拒绝（待 T2.4 放开为「白名单成员可见」）
    expect(
      await can(memberId, READ, { kind: 'story', projectId, objectId: story.id }),
    ).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })

    // PM：契约决策 I-5 第 3 条 —— 允许（含敏感对象）
    expect(await can(pmId, READ, { kind: 'story', projectId, objectId: story.id })).toEqual({
      allow: true,
    })
  })

  it('can() 按 objectId 现查目标：跨项目的 ref.projectId 与真实归属不符 → 404', async () => {
    const pmA = await makeUser(ctx.db, 'pm-a')
    const pmB = await makeUser(ctx.db, 'pm-b')
    const projectA = await makeProject(ctx.db, pmA, 'A 项目')
    const projectB = await makeProject(ctx.db, pmB, 'B 项目')
    const goalInB = await ctx.db.businessGoal.create({
      data: { projectId: projectB, name: 'B 的目标', sortOrder: 0 },
    })

    const { can } = createAuthorization(ctx.db)

    // 谎称 B 的目标属于 A：can() 必须按 objectId 查库发现真实归属是 B，
    // 而调用者不是 B 的成员 → 404（不泄漏对象存在性）
    const decision = await can(pmA, WRITE, {
      kind: 'goal',
      projectId: projectA,
      objectId: goalInB.id,
    })
    expect(decision).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
  })
})
