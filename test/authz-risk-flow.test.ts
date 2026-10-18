/**
 * `risk.flow` 鉴权验证（#30 / 本地 authz 批次）
 *
 * 依据
 *   - `DECISIONS.md` `permissions.risk-flow-guard`（2026-10-18T19:09:17+08:00，随 PR #56 合入 main）：
 *     `ObjectRef` 增 `risk` 类型；`permissions.ts` 增与 `task.progress` / `task.accept` **同型**的
 *     对象关系判定 `risk.flow` —— PM 由第 3 条放行；MEMBER 仅当 `ownerUserId` = 调用者时允许，
 *     否则 403；VIEWER 一律 403；非成员 / outsider 404。
 *   - `DECISIONS.md` `permissions.risk-status-flow`：业务口径（成员只能流转自己负责的风险）。
 *
 * 覆盖（五类 + 两个边界）
 *   1. PM：本人 / 他人的风险都放行（第 3 条）
 *   2. MEMBER 本人负责的风险：允许
 *   3. MEMBER 他人负责的风险：403 FORBIDDEN
 *   4. VIEWER（即使被指为该风险负责人）：403 FORBIDDEN
 *   5. outsider（非成员）：404 NOT_FOUND（与「风险不存在」逐字一致，不泄漏存在性）
 *   6. 不存在的 riskId：404 NOT_FOUND
 *   7. 跨项目：A 项目 PM 对 B 项目的风险 → 404（真实归属按 riskId 现查，不信任 ref.projectId）
 *   8. `AuthzDb` 窄类型：`can()` 在**事务客户端**内同样可用（C 在 #24 的签名请求）
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Decision, ObjectRef } from '../src/shared/types.js'
import { createAuthorization } from '../src/modules/authz/permissions.js'
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
}, 120_000)

afterAll(async () => {
  await ctx?.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

const DENIED_403: Decision = { allow: false, status: 403, code: 'FORBIDDEN' }
const DENIED_404: Decision = { allow: false, status: 404, code: 'NOT_FOUND' }

async function makeRisk(projectId: string, ownerUserId: string, title = '风险') {
  return ctx.db.risk.create({
    data: { projectId, title, level: 'HIGH', ownerUserId },
  })
}

function refOf(projectId: string, riskId: string): ObjectRef {
  return { kind: 'risk', projectId, riskId }
}

describe('risk.flow（#30 风险状态流转鉴权）', () => {
  it('PM：本人与他人的风险都放行（第 3 条）', async () => {
    const pmId = await makeUser(ctx.db, 'rf-pm')
    const memberId = await makeUser(ctx.db, 'rf-m1')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, memberId, 'MEMBER')

    const own = await makeRisk(projectId, pmId, 'PM 自己的风险')
    const others = await makeRisk(projectId, memberId, '成员的风险')

    const { can } = createAuthorization(ctx.db)
    expect(await can(pmId, 'risk.flow', refOf(projectId, own.id))).toEqual({ allow: true })
    expect(await can(pmId, 'risk.flow', refOf(projectId, others.id))).toEqual({ allow: true })
  })

  it('MEMBER 本人负责的风险：允许', async () => {
    const pmId = await makeUser(ctx.db, 'rf-pm2')
    const memberId = await makeUser(ctx.db, 'rf-m2')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, memberId, 'MEMBER')
    const risk = await makeRisk(projectId, memberId, '我负责的风险')

    const { can } = createAuthorization(ctx.db)
    expect(await can(memberId, 'risk.flow', refOf(projectId, risk.id))).toEqual({ allow: true })
  })

  it('MEMBER 他人负责的风险：403 FORBIDDEN', async () => {
    const pmId = await makeUser(ctx.db, 'rf-pm3')
    const memberId = await makeUser(ctx.db, 'rf-m3')
    const otherId = await makeUser(ctx.db, 'rf-m3b')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, memberId, 'MEMBER')
    await makeMember(ctx.db, projectId, otherId, 'MEMBER')
    const risk = await makeRisk(projectId, otherId, '别人负责的风险')

    const { can } = createAuthorization(ctx.db)
    expect(await can(memberId, 'risk.flow', refOf(projectId, risk.id))).toEqual(DENIED_403)
  })

  it('VIEWER：即使被指为该风险负责人也一律 403', async () => {
    const pmId = await makeUser(ctx.db, 'rf-pm4')
    const viewerId = await makeUser(ctx.db, 'rf-v4')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, viewerId, 'VIEWER')
    // 故意把风险负责人设为该 VIEWER：不得因此获得写能力（与 task.progress 的 VIEWER 口径一致）
    const risk = await makeRisk(projectId, viewerId, 'VIEWER 名下的风险')

    const { can } = createAuthorization(ctx.db)
    expect(await can(viewerId, 'risk.flow', refOf(projectId, risk.id))).toEqual(DENIED_403)
  })

  it('非成员 / outsider：404（与「风险不存在」逐字一致，不泄漏存在性）', async () => {
    const pmId = await makeUser(ctx.db, 'rf-pm5')
    const outsiderId = await makeUser(ctx.db, 'rf-out5')
    const projectId = await makeProject(ctx.db, pmId)
    const risk = await makeRisk(projectId, pmId, '项目内的风险')

    const { can } = createAuthorization(ctx.db)
    expect(await can(outsiderId, 'risk.flow', refOf(projectId, risk.id))).toEqual(DENIED_404)
    // 对照：不存在的风险 id 同样是 404（文案/形状一致，无法据此探测存在性）
    expect(await can(outsiderId, 'risk.flow', refOf(projectId, 'not-exist'))).toEqual(DENIED_404)
  })

  it('不存在的 riskId：404 NOT_FOUND', async () => {
    const pmId = await makeUser(ctx.db, 'rf-pm6')
    const projectId = await makeProject(ctx.db, pmId)
    const { can } = createAuthorization(ctx.db)
    expect(await can(pmId, 'risk.flow', refOf(projectId, 'not-exist'))).toEqual(DENIED_404)
  })

  it('跨项目：按 riskId 现查真实归属 —— A 项目 PM 对 B 项目的风险 → 404', async () => {
    const pmA = await makeUser(ctx.db, 'rf-pmA')
    const pmB = await makeUser(ctx.db, 'rf-pmB')
    const projectA = await makeProject(ctx.db, pmA, 'A 项目')
    const projectB = await makeProject(ctx.db, pmB, 'B 项目')
    const riskInB = await makeRisk(projectB, pmB, 'B 项目的风险')

    const { can } = createAuthorization(ctx.db)
    // 谎称该风险属于 A：can() 必须按 riskId 查库发现真实归属是 B，而调用者不是 B 的成员 → 404
    expect(await can(pmA, 'risk.flow', refOf(projectA, riskInB.id))).toEqual(DENIED_404)
  })

  it('AuthzDb 窄类型：can() 在事务客户端内同样可用（C 的签名请求）', async () => {
    const pmId = await makeUser(ctx.db, 'rf-pm7')
    const memberId = await makeUser(ctx.db, 'rf-m7')
    const projectId = await makeProject(ctx.db, pmId)
    await makeMember(ctx.db, projectId, memberId, 'MEMBER')
    const risk = await makeRisk(projectId, memberId, '事务内判定')

    const decision = await ctx.db.$transaction(async (tx) => {
      // 关键：createAuthorization 现在接受窄 Pick（AuthzDb），Prisma.TransactionClient 结构上满足
      const { can } = createAuthorization(tx)
      const owner = await can(memberId, 'risk.flow', refOf(projectId, risk.id))
      const pm = await can(pmId, 'risk.flow', refOf(projectId, risk.id))
      return { owner, pm }
    })

    expect(decision.owner).toEqual({ allow: true })
    expect(decision.pm).toEqual({ allow: true })
  })
})
