/**
 * #31 US-11 AI 建议共享存储 —— 数据库仓储 + 权限适配器测试（ROLE-B）
 *
 * 覆盖 B 的裁定：
 *   ① 唯一最终处置（并发两次 finalize → 恰好一次成功，另一次冲突）；
 *   ② 幂等三元组 `(suggestionId, actorUserId, requestId)`（同 actor 同 requestId 同 digest →
 *      重放；异 digest → 冲突；不同 actor → 不算同一请求）；
 *   ③ `updateApplication(id, patch, expectedStatus)` 的 CAS 语义（失败不写）；
 *   ④ 应用失败可重试（`APPLICATION_FAILED` → 再次成功，M7）；
 *   ⑤ 查询层可见性过滤（MEMBER 看不到不可见对象；PM 全量；不可见与不存在同一条 404）；
 *   ⑥ 列表上限 + 截断标记（L15）；
 *   ⑦ 事务上下文（调用方事务回滚 → 不落库）；
 *   ⑧ 理由规则（`MODIFIED` / `REJECTED` 无理由 → 422；`ACCEPTED` 可不填）；
 *   ⑨ `src/app.ts` 组装注入（AI 路由已注册）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AI_SUGGESTION_LIST_LIMIT,
  canonicalAiJson,
  canonicalAiJsonDigest,
  type AiDispositionStatus,
  type AiSuggestionStatus,
  type RequirementBreakdownRecord,
} from '../shared/ai.js'
import { createTestContext, type HttpTestContext } from '../../test/helpers.js'
import { PrismaAiSuggestionRepository, createAiAuthorizationPort } from './ai-repository.js'

let ctx: HttpTestContext
let repo: PrismaAiSuggestionRepository<RequirementBreakdownRecord>
let authz: ReturnType<typeof createAiAuthorizationPort>

beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
  repo = new PrismaAiSuggestionRepository<RequirementBreakdownRecord>(ctx.db)
  authz = createAiAuthorizationPort(ctx.db)
})

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

let seq = 0
function unique(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

async function makeUser() {
  const account = unique('user')
  return ctx.db.user.create({ data: { account, displayName: account, passwordHash: 'hash' } })
}

async function makeProject(ownerUserId: string) {
  return ctx.db.project.create({ data: { name: unique('project'), ownerUserId } })
}

async function addMember(projectId: string, userId: string, role: 'PM' | 'MEMBER' | 'VIEWER') {
  await ctx.db.projectMember.create({ data: { projectId, userId, role } })
}

async function makeStory(projectId: string, isSensitive = false) {
  const goal = await ctx.db.businessGoal.create({
    data: { projectId, name: unique('goal'), sortOrder: 1 },
  })
  const activity = await ctx.db.userActivity.create({
    data: { projectId, goalId: goal.id, name: unique('activity'), sortOrder: 1 },
  })
  return ctx.db.userStory.create({
    data: {
      projectId,
      activityId: activity.id,
      title: unique('story'),
      roleText: 'r',
      capabilityText: 'c',
      valueText: 'v',
      businessValue: 'bv',
      priority: 'P0',
      isSensitive,
    },
  })
}

function makeRecord(
  projectId: string,
  sourceObject: { objectType: string; objectId: string },
  status: AiSuggestionStatus = 'PENDING',
  id = unique('suggestion'),
): RequirementBreakdownRecord {
  const generatedAt = '2026-10-21T10:00:00.000Z'
  return {
    id,
    scenario: 'REQUIREMENT_BREAKDOWN',
    projectId,
    sourceObject,
    status,
    inputScope: {
      projectId,
      populationBasis: 'OBJECT',
      objects: [sourceObject],
      filters: {},
      includedFields: ['title'],
      excludedFields: ['isSensitive'],
      population: { sourceCount: 1, includedCount: 1, excludedSensitiveCount: 0 },
      containsSensitiveData: false,
    },
    snapshot: {
      asOf: generatedAt,
      data: {
        title: 'Story',
        roleText: 'PM',
        capabilityText: 'plan',
        valueText: 'value',
        businessValue: 'value',
        acceptanceCriteria: null,
      },
      fingerprint: 'fingerprint',
      fingerprintAlgorithm: 'SHA-256_CANONICAL_JSON_V1',
    },
    model: {
      provider: 'local-stub',
      model: 'deterministic-requirement-breakdown',
      version: '1.0.0',
      mode: 'STUB',
      execution: 'LOCAL',
    },
    generation: {
      requestId: id,
      status: 'SUCCEEDED',
      generatedAt,
      error: null,
    },
    generatedByUserId: 'pm-1',
    suggestion: { summary: 'summary', workItems: [] },
    disposition: {
      status: 'PENDING',
      requestId: null,
      contentDigest: null,
      disposedByUserId: null,
      disposedAt: null,
      reason: null,
      modification: null,
      finalContent: null,
    },
    application: {
      status: 'PENDING_DISPOSITION',
      appliedAt: null,
      appliedByUserId: null,
      result: null,
      targetReferences: [],
    },
  }
}

function disposeInput(
  suggestionId: string,
  actorUserId: string,
  requestId: string,
  contentDigest: string,
  status: Exclude<AiDispositionStatus, 'PENDING'>,
) {
  return {
    suggestionId,
    actorUserId,
    requestId,
    contentDigest,
    status,
    reason: status === 'ACCEPTED' ? null : '理由',
    modification: null,
    finalContent: status === 'REJECTED' ? null : { summary: 'summary', workItems: [] },
    disposedAt: '2026-10-21T11:00:00.000Z',
  }
}

function applicationPatch(
  suggestionStatus: 'APPLIED' | 'APPLICATION_FAILED',
  actorUserId: string,
  summary: string,
) {
  return {
    suggestionStatus,
    appliedAt: '2026-10-21T12:00:00.000Z',
    appliedByUserId: actorUserId,
    result: { summary },
    targetReferences: [{ objectType: 'task', objectId: 'task-1' }],
  }
}

// ---------------------------------------------------------------------------
// ① 唯一最终处置（并发）
// ---------------------------------------------------------------------------

describe('finalizeDisposition：唯一最终处置', () => {
  it('并发两次 finalize → 恰好一次 APPLIED，另一次 CONFLICT；库中只有一条处置', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)

    const settled = await Promise.allSettled([
      repo.finalizeDisposition(disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED')),
      repo.finalizeDisposition(disposeInput(record.id, owner.id, 'req-2', 'digest-2', 'REJECTED')),
    ])

    const kinds = settled
      .map((result) =>
        result.status === 'fulfilled' ? result.value.kind : `REJECTED:${String(result.reason)}`,
      )
      .sort()
    expect(kinds).toEqual(['APPLIED', 'CONFLICT'])
    expect(await ctx.db.aiDisposition.count()).toBe(1)
    const stored = await repo.findById(record.id)
    expect(stored?.status).toBe('DISPOSED')
  })

  it('非 PENDING（生成失败）的建议不能处置：返回 CONFLICT 且不写处置', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(
      project.id,
      { objectType: 'story', objectId: story.id },
      'GENERATION_FAILED',
    )
    await repo.create(record)

    const result = await repo.finalizeDisposition(
      disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
    )
    expect(result.kind).toBe('CONFLICT')
    expect(await ctx.db.aiDisposition.count()).toBe(0)
  })

  it('重复提交同一条最终处置直接插入被数据库唯一约束拒绝（P2002）', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)
    await repo.finalizeDisposition(
      disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
    )

    await expect(
      ctx.db.aiDisposition.create({
        data: {
          suggestionId: record.id,
          status: 'REJECTED',
          disposedByUserId: owner.id,
          disposedAt: new Date('2026-10-21T11:00:00.000Z'),
          requestId: 'req-2',
          contentDigest: 'digest-2',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})

// ---------------------------------------------------------------------------
// ② 幂等三元组
// ---------------------------------------------------------------------------

describe('finalizeDisposition：幂等三元组 (suggestionId, actorUserId, requestId)', () => {
  it('同 actor 同 requestId 同 digest → REPLAY；异 digest / 异 actor → CONFLICT', async () => {
    const pm = await makeUser()
    const other = await makeUser()
    const project = await makeProject(pm.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)

    const input = disposeInput(record.id, pm.id, 'req-1', 'digest-1', 'ACCEPTED')
    expect((await repo.finalizeDisposition(input)).kind).toBe('APPLIED')
    expect((await repo.finalizeDisposition(input)).kind).toBe('REPLAY')
    expect(
      (await repo.finalizeDisposition({ ...input, contentDigest: 'digest-2' })).kind,
    ).toBe('CONFLICT')
    expect(
      (await repo.finalizeDisposition({ ...input, actorUserId: other.id })).kind,
    ).toBe('CONFLICT')
    expect(
      (await repo.finalizeDisposition({ ...input, actorUserId: other.id, requestId: 'req-2' }))
        .kind,
    ).toBe('CONFLICT')
  })
})

// ---------------------------------------------------------------------------
// ③ updateApplication 的 CAS
// ---------------------------------------------------------------------------

describe('updateApplication：字段级补丁 + CAS', () => {
  it('expectedStatus 不匹配时 CAS 失败返回 null，且不写入 application', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)
    await repo.finalizeDisposition(
      disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
    )

    const failed = await repo.updateApplication(
      record.id,
      applicationPatch('APPLIED', owner.id, 'x'),
      'APPLICATION_FAILED',
    )
    expect(failed).toBeNull()
    expect((await repo.findById(record.id))?.status).toBe('DISPOSED')
    expect((await repo.findById(record.id))?.application.appliedAt).toBeNull()
    expect(await ctx.db.aiApplication.count()).toBe(0)
  })

  it('expectedStatus 匹配时只更新 application 字段，不整行覆盖', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)
    await repo.finalizeDisposition(
      disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
    )

    const updated = await repo.updateApplication(
      record.id,
      applicationPatch('APPLIED', owner.id, 'done'),
      'DISPOSED',
    )
    expect(updated?.status).toBe('APPLIED')
    expect(updated?.application).toMatchObject({
      status: 'APPLIED',
      appliedByUserId: owner.id,
      result: { summary: 'done' },
      targetReferences: [{ objectType: 'task', objectId: 'task-1' }],
    })
    // 建议正文 / 快照 / 处置未被整行覆盖
    expect(updated?.suggestion).toEqual(record.suggestion)
    expect(updated?.snapshot).toEqual(record.snapshot)
    expect(updated?.disposition.status).toBe('ACCEPTED')
  })

  it('兼容形式 updateApplication(record, expectedStatus) 行为不变', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)
    await repo.finalizeDisposition(
      disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
    )
    const current = (await repo.findById(record.id))!
    const legacyRecord: RequirementBreakdownRecord = {
      ...current,
      status: 'APPLIED',
      application: {
        status: 'APPLIED',
        appliedAt: '2026-10-21T12:00:00.000Z',
        appliedByUserId: owner.id,
        result: { summary: 'legacy' },
        targetReferences: [],
      },
    }
    const updated = await repo.updateApplication(legacyRecord, 'DISPOSED')
    expect(updated?.status).toBe('APPLIED')
    expect(updated?.application.result).toEqual({ summary: 'legacy' })
  })
})

// ---------------------------------------------------------------------------
// ④ 应用失败可重试
// ---------------------------------------------------------------------------

describe('updateApplication：应用失败可重试（M7）', () => {
  it('DISPOSED → APPLICATION_FAILED → 再次 APPLIED 成功', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)
    await repo.finalizeDisposition(
      disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
    )

    const failed = await repo.updateApplication(
      record.id,
      applicationPatch('APPLICATION_FAILED', owner.id, 'boom'),
      'DISPOSED',
    )
    expect(failed?.status).toBe('APPLICATION_FAILED')
    expect(failed?.application.status).toBe('FAILED')

    const retried = await repo.updateApplication(
      record.id,
      applicationPatch('APPLIED', owner.id, 'done'),
      'APPLICATION_FAILED',
    )
    expect(retried?.status).toBe('APPLIED')
    expect(retried?.application.status).toBe('APPLIED')
    expect(retried?.application.result).toEqual({ summary: 'done' })
  })
})

// ---------------------------------------------------------------------------
// ⑤ 查询层可见性过滤 + 权限适配器
// ---------------------------------------------------------------------------

describe('可见性与权限', () => {
  it('MEMBER 列表看不到不可见敏感故事的建议；PM 全量', async () => {
    const pm = await makeUser()
    const member = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    await addMember(project.id, member.id, 'MEMBER')

    const visibleStory = await makeStory(project.id, false)
    const hiddenStory = await makeStory(project.id, true)
    await repo.create(
      makeRecord(project.id, { objectType: 'story', objectId: visibleStory.id }, 'PENDING', 's-visible'),
    )
    await repo.create(
      makeRecord(project.id, { objectType: 'story', objectId: hiddenStory.id }, 'PENDING', 's-hidden'),
    )

    const memberView = await repo.list({ projectId: project.id, actorUserId: member.id })
    expect(memberView.map((record) => record.id)).toEqual(['s-visible'])

    const pmView = await repo.list({ projectId: project.id, actorUserId: pm.id })
    expect(pmView.map((record) => record.id).sort()).toEqual(['s-hidden', 's-visible'])
  })

  it('不可见与不存在同一条 404；可见对象允许；生成 / 处置仅 PM', async () => {
    const pm = await makeUser()
    const member = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    await addMember(project.id, member.id, 'MEMBER')
    const visibleStory = await makeStory(project.id, false)
    const hiddenStory = await makeStory(project.id, true)

    const invisible = await authz.decide(member.id, 'ai.suggestion.read', {
      projectId: project.id,
      scenario: 'REQUIREMENT_BREAKDOWN',
      sourceObject: { objectType: 'story', objectId: hiddenStory.id },
    })
    const missing = await authz.decide(member.id, 'ai.suggestion.read', {
      projectId: project.id,
      scenario: 'REQUIREMENT_BREAKDOWN',
      sourceObject: { objectType: 'story', objectId: 'does-not-exist' },
    })
    expect(invisible).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
    expect(missing).toEqual(invisible)

    expect(
      await authz.decide(member.id, 'ai.suggestion.read', {
        projectId: project.id,
        scenario: 'REQUIREMENT_BREAKDOWN',
        sourceObject: { objectType: 'story', objectId: visibleStory.id },
      }),
    ).toEqual({ allow: true })

    // 生成 / 处置仅 PM（MEMBER 403）；outsider 404（逐字一致）
    const outsider = await makeUser()
    expect(
      await authz.decide(member.id, 'ai.suggestion.generate', {
        projectId: project.id,
        scenario: 'REQUIREMENT_BREAKDOWN',
        sourceObject: { objectType: 'story', objectId: visibleStory.id },
      }),
    ).toEqual({ allow: false, status: 403, code: 'FORBIDDEN' })
    expect(
      await authz.decide(member.id, 'ai.suggestion.dispose', {
        projectId: project.id,
        scenario: 'REQUIREMENT_BREAKDOWN',
        sourceObject: { objectType: 'story', objectId: visibleStory.id },
      }),
    ).toEqual({ allow: false, status: 403, code: 'FORBIDDEN' })
    expect(
      await authz.decide(pm.id, 'ai.suggestion.dispose', {
        projectId: project.id,
        scenario: 'REQUIREMENT_BREAKDOWN',
        sourceObject: { objectType: 'story', objectId: visibleStory.id },
      }),
    ).toEqual({ allow: true })
    expect(
      await authz.decide(outsider.id, 'ai.suggestion.generate', {
        projectId: project.id,
        scenario: 'REQUIREMENT_BREAKDOWN',
        sourceObject: { objectType: 'story', objectId: visibleStory.id },
      }),
    ).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
  })

  it('死能力 ai.suggestion.audit fail-closed，PM 也被拒绝', async () => {
    const pm = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    expect(
      await authz.decide(pm.id, 'ai.suggestion.audit', {
        projectId: project.id,
        scenario: 'INSIGHT_QUALITY',
        populationBasis: 'GLOBAL',
      }),
    ).toEqual({ allow: false, status: 403, code: 'FORBIDDEN' })
  })

  it('populationBasis = GLOBAL 退回项目级判定', async () => {
    const pm = await makeUser()
    const member = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    await addMember(project.id, member.id, 'MEMBER')
    expect(
      await authz.decide(member.id, 'ai.suggestion.read', {
        projectId: project.id,
        scenario: 'INSIGHT_QUALITY',
        populationBasis: 'GLOBAL',
      }),
    ).toEqual({ allow: true })
  })
})

// ---------------------------------------------------------------------------
// ⑥ 列表上限 + 截断标记
// ---------------------------------------------------------------------------

describe('列表上限与截断标记', () => {
  it('limit 生效时置 truncated 且 total 为精确值', async () => {
    const pm = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    for (let index = 0; index < 3; index += 1) {
      await repo.create(
        makeRecord(project.id, { objectType: 'story', objectId: `story-${index}` }, 'PENDING', `s-${index}`),
      )
    }

    const page = await repo.listPage({ projectId: project.id, actorUserId: pm.id, limit: 2 })
    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(3)
    expect(page.truncated).toBe(true)
    expect(page.limit).toBe(2)

    const all = await repo.list({ projectId: project.id, actorUserId: pm.id })
    expect(all).toHaveLength(3)
    expect(AI_SUGGESTION_LIST_LIMIT).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 采纳质量统计（口径沿用 D：pending = 未产生最终处置）
// ---------------------------------------------------------------------------

describe('adoptionStats', () => {
  it('按最终处置统计采纳率，pending 不含已处置；可见性过滤同样生效', async () => {
    const pm = await makeUser()
    const member = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    await addMember(project.id, member.id, 'MEMBER')
    const visibleStory = await makeStory(project.id, false)
    const hiddenStory = await makeStory(project.id, true)

    const accepted = makeRecord(
      project.id,
      { objectType: 'story', objectId: visibleStory.id },
      'PENDING',
      's-accepted',
    )
    const rejected = makeRecord(
      project.id,
      { objectType: 'story', objectId: visibleStory.id },
      'PENDING',
      's-rejected',
    )
    await repo.create(accepted)
    await repo.create(rejected)
    await repo.create(
      makeRecord(project.id, { objectType: 'story', objectId: visibleStory.id }, 'PENDING', 's-pending'),
    )
    // 不可见对象的建议不计入 MEMBER 的统计
    await repo.create(
      makeRecord(project.id, { objectType: 'story', objectId: hiddenStory.id }, 'PENDING', 's-hidden'),
    )

    await repo.finalizeDisposition(
      disposeInput(accepted.id, pm.id, 'req-a', 'digest-a', 'ACCEPTED'),
    )
    await repo.finalizeDisposition(
      disposeInput(rejected.id, pm.id, 'req-r', 'digest-r', 'REJECTED'),
    )

    await expect(
      repo.adoptionStats({ projectId: project.id, actorUserId: pm.id }),
    ).resolves.toEqual({ pending: 2, accepted: 1, modified: 0, rejected: 1, adoptionRate: 0.5 })
    await expect(
      repo.adoptionStats({ projectId: project.id, actorUserId: member.id }),
    ).resolves.toEqual({ pending: 1, accepted: 1, modified: 0, rejected: 1, adoptionRate: 0.5 })
  })
})

// ---------------------------------------------------------------------------
// ⑦ 事务上下文
// ---------------------------------------------------------------------------

describe('finalizeDisposition 接受调用方事务上下文', () => {
  it('调用方事务回滚 → 处置与状态都不落库', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)

    await expect(
      ctx.db.$transaction(async (tx) => {
        await repo.finalizeDisposition(
          disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
          tx,
        )
        throw new Error('rollback on purpose')
      }),
    ).rejects.toThrow('rollback on purpose')

    expect((await repo.findById(record.id))?.status).toBe('PENDING')
    expect(await ctx.db.aiDisposition.count()).toBe(0)
  })

  it('调用方事务提交 → 处置落库', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const story = await makeStory(project.id)
    const record = makeRecord(project.id, { objectType: 'story', objectId: story.id })
    await repo.create(record)

    await ctx.db.$transaction(async (tx) => {
      const result = await repo.finalizeDisposition(
        disposeInput(record.id, owner.id, 'req-1', 'digest-1', 'ACCEPTED'),
        tx,
      )
      expect(result.kind).toBe('APPLIED')
    })
    expect((await repo.findById(record.id))?.status).toBe('DISPOSED')
  })
})

// ---------------------------------------------------------------------------
// ⑧ 理由规则（经 HTTP：Zod → 422）+ ⑨ app 组装注入
// ---------------------------------------------------------------------------

describe('HTTP 链路：app 组装注入 + 理由规则', () => {
  it('AI 路由已在真实 app 上注册', () => {
    expect(
      ctx.app.hasRoute({
        method: 'POST',
        url: '/projects/:projectId/stories/:storyId/ai-suggestions',
      }),
    ).toBe(true)
    expect(
      ctx.app.hasRoute({
        method: 'GET',
        url: '/projects/:projectId/stories/:storyId/ai-suggestions',
      }),
    ).toBe(true)
    expect(
      ctx.app.hasRoute({
        method: 'POST',
        url: '/projects/:projectId/stories/:storyId/ai-suggestions/:suggestionId/disposition',
      }),
    ).toBe(true)
  })

  it('MODIFIED / REJECTED 无理由 → 422；ACCEPTED 可不填理由 → 200', async () => {
    const pm = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    const story = await makeStory(project.id)
    const token = ctx.loginAs(pm.id)
    const base = `/projects/${project.id}/stories/${story.id}/ai-suggestions`

    const generated = await ctx.asUser(token).post(base)
    expect(generated.status).toBe(201)
    const suggestionId = generated.body.id as string

    const modifiedSuggestion = {
      summary: '人工修改后的建议',
      workItems: [
        {
          title: '人工确认任务',
          description: '保留人工裁决',
          acceptanceCriteria: ['由项目经理确认'],
          sourceTrace: ['human-review'],
        },
      ],
    }

    const modifiedNoReason = await ctx
      .asUser(token)
      .post(`${base}/${suggestionId}/disposition`)
      .send({ requestId: 'req-mod', decision: 'MODIFIED', modifiedSuggestion })
    expect(modifiedNoReason.status).toBe(422)

    const rejectedNoReason = await ctx
      .asUser(token)
      .post(`${base}/${suggestionId}/disposition`)
      .send({ requestId: 'req-rej', decision: 'REJECTED' })
    expect(rejectedNoReason.status).toBe(422)

    const accepted = await ctx
      .asUser(token)
      .post(`${base}/${suggestionId}/disposition`)
      .send({ requestId: 'req-acc', decision: 'ACCEPTED' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.disposition.status).toBe('ACCEPTED')
    expect(accepted.body.application.status).toBe('PENDING_INTEGRATION')
  })

  it('MEMBER 生成被拒绝（403），且本地桩不写正式任务', async () => {
    const pm = await makeUser()
    const member = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    await addMember(project.id, member.id, 'MEMBER')
    const story = await makeStory(project.id)
    const base = `/projects/${project.id}/stories/${story.id}/ai-suggestions`

    const denied = await ctx.asUser(ctx.loginAs(member.id)).post(base)
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('FORBIDDEN')

    const allowed = await ctx.asUser(ctx.loginAs(pm.id)).post(base)
    expect(allowed.status).toBe(201)
    expect(await ctx.db.task.count()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 规范化 JSON 规则（L12）
// ---------------------------------------------------------------------------

describe('规范化 JSON 规则 SHA-256_CANONICAL_JSON_V1', () => {
  it('键序稳定（与书写顺序无关），且用码元比较而非 localeCompare', () => {
    const left = { b: 1, a: { d: 2, c: 3 } }
    const right = { a: { c: 3, d: 2 }, b: 1 }
    expect(canonicalAiJsonDigest(left)).toBe(canonicalAiJsonDigest(right))
    expect(canonicalAiJsonDigest(left)).toHaveLength(64)
    // 码元比较：'B'(66) < 'a'(97)；localeCompare 会得到相反的键序。
    expect(canonicalAiJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}')
  })
})
