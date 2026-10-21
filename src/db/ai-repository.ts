/**
 * #31 US-11 AI 建议 —— 数据库仓储 + 权限适配器（ROLE-B 单写）
 *
 * 实现 `src/shared/ai.ts` 的 `AiSuggestionRepository`（D 的 `AiBreakdownService` 依赖它），
 * 把建议 / 处置 / 应用落到 `AiSuggestion` / `AiDisposition` / `AiApplication` 三张表
 * （迁移 `20261021150000_add_ai_suggestion_store`）。
 *
 * 依据：
 *   - `docs/role-d/ROLE-D-US11-public-integration-request.md`（第 4、5 项）；
 *   - `DECISIONS.md` `ai.suggestion-store-shared` / `permissions.ai-suggestion-disposal` /
 *     `arch.shared-ports-and-assembly`；
 *   - PR #82 评审结论：H1（应用路径只走共享仓储端口，业务域自带事务）、H3（字段级补丁 CAS）、
 *     M7（应用失败可重试）、M8（`status` 唯一真源）、L12（规范化 JSON 由 B 冻结）、
 *     L15（列表上限 + 截断）。
 *
 * ===========================================================================
 * 三个必须点
 * ===========================================================================
 *
 * 1. **唯一最终处置 + CAS（裁定 3）**：`AiDisposition.suggestionId` 是主键（1:1 子表），
 *    同一建议的第二条处置在物理上无法落库；`finalizeDisposition` 再叠加唯一真源
 *    `AiSuggestion.status` 的 `PENDING → DISPOSED` 条件更新（CAS），并发下恰好一次成功。
 * 2. **事务（裁定 2 / H1）**：全部方法接受调用方事务上下文（`db?`），传入时**不自行提交**；
 *    缺省时适配器在内部 `$transaction` 里完成多步写，**不提前提交**。
 * 3. **查询层可见性过滤（裁定 8 / L15）**：`list` / `listPage` / `adoptionStats` 用统一入口
 *    `visibilityScope()` 生成 `where` 条件，**直接拼进同一条 SQL**；**禁止**「先取全量再在内存里
 *    剔除」——后者会让不可见对象的存在性从计数 / 截断标记里泄漏。列表另有行数上限
 *    `AI_SUGGESTION_LIST_LIMIT`（超出只置 `truncated`，不用行数冒充 `total`）。
 *
 * ===========================================================================
 * 应用路径（H1 / H3 / M7 / M8）
 * ===========================================================================
 *
 * - `updateApplication` 支持 `(id, patch, expectedStatus, tx?)`（规范）与
 *   `(record, expectedStatus, tx?)`（D 的 service 预留 hook 的兼容形式）；两种形式都只做
 *   **字段级补丁**更新，**不整行覆盖**。
 * - CAS 在唯一真源 `AiSuggestion.status` 上：`expectedStatus` 取
 *   `'DISPOSED'`（首次应用）或 `'APPLICATION_FAILED'`（应用失败后重试，M7）。
 * - `application.status` 不落库，读取时按 `src/shared/ai.ts` 的派生规则计算（M8）。
 *
 * ===========================================================================
 * 详情可见性（裁定 8）
 * ===========================================================================
 *
 * `findAccessMetadata` 必须能读到「不可见建议」的归属元数据（供 `can()` 判定后返回同一 404），
 * 因此**不**做可见性过滤；详情的可见性由适配器 `decide()` → `can()` 在**查询层**完成
 * （`loadTarget` 现查对象真实项目 / 敏感性 + `projectMember` / `objectVisibility`），
 * 不可见与不存在返回逐字一致、不泄漏正文的 404。列表 / 统计则直接在仓储 `where` 里过滤。
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { createAuthorization } from '../modules/authz/permissions.js'
import {
  AI_SUGGESTION_LIST_LIMIT,
  type AiAdoptionStats,
  type AiApplicationPatch,
  type AiApplicationStatus,
  type AiAuthorizationPort,
  type AiCapability,
  type AiDispositionStatus,
  type AiGenerationStatus,
  type AiResourceRef,
  type AiRunMode,
  type AiScenario,
  type AiSourceObjectRef,
  type AiSuggestionAccessMetadata,
  type AiSuggestionListResult,
  type AiSuggestionQuery,
  type AiSuggestionRecord,
  type AiSuggestionRepository,
  type AiSuggestionStatus,
  type FinalizeDispositionInput,
  type FinalizeDispositionResult,
  SHA256_CANONICAL_JSON_V1,
} from '../shared/ai.js'
import type { Action, Decision, ObjectRef } from '../shared/types.js'

/**
 * 仓储实际用到的 Prisma 形状（窄 `Pick`）。
 *
 * 与 `permissions.ts` 的 `AuthzDb` / `event-repository.ts` 的 `EventDb` 同款理由：
 * `Prisma.TransactionClient` 不满足完整 `PrismaClient`，但结构上满足这个窄 `Pick`，
 * 因此仓储方法可在调用方事务内复用。
 */
export type AiDb = Pick<PrismaClient, 'aiSuggestion' | 'aiDisposition' | 'aiApplication'>

/** `include` 后的行形状；时间列由 Prisma 反序列化为 `Date`。 */
type SuggestionRow = Prisma.AiSuggestionGetPayload<{
  include: { disposition: true; application: true }
}>

const SUGGESTION_INCLUDE = { disposition: true, application: true } as const

// ---------------------------------------------------------------------------
// 行 ↔ 记录映射
// ---------------------------------------------------------------------------

/**
 * `application.status` 派生规则（M8；唯一真源 = `AiSuggestion.status`）。
 *
 * `REJECTED` 的处置不适用应用；`DISPOSED` 且未拒绝 → 等待业务域登记应用结果。
 */
function deriveApplicationStatus(
  suggestionStatus: string,
  dispositionStatus: string | null | undefined,
): AiApplicationStatus {
  switch (suggestionStatus) {
    case 'APPLIED':
      return 'APPLIED'
    case 'APPLICATION_FAILED':
      return 'FAILED'
    case 'DISPOSED':
      return dispositionStatus === 'REJECTED' ? 'NOT_APPLICABLE' : 'PENDING_INTEGRATION'
    default:
      return 'PENDING_DISPOSITION'
  }
}

function toRecord<TRecord extends AiSuggestionRecord>(row: SuggestionRow): TRecord {
  const disposition = row.disposition
  const application = row.application
  const record: AiSuggestionRecord = {
    id: row.id,
    scenario: row.scenario as AiScenario,
    projectId: row.projectId,
    sourceObject: { objectType: row.sourceObjectType, objectId: row.sourceObjectId },
    status: row.status as AiSuggestionStatus,
    inputScope: row.inputScope as unknown as AiSuggestionRecord['inputScope'],
    snapshot: {
      asOf: row.snapshotAsOf.toISOString(),
      data: row.snapshotData as unknown,
      fingerprint: row.snapshotFingerprint,
      fingerprintAlgorithm: row.snapshotFingerprintAlgorithm as typeof SHA256_CANONICAL_JSON_V1,
    },
    model: {
      provider: row.modelProvider,
      model: row.modelName,
      version: row.modelVersion,
      mode: row.modelMode as AiRunMode,
      execution: row.modelExecution as 'LOCAL' | 'EXTERNAL',
    },
    generation: {
      requestId: row.generationRequestId,
      status: row.generationStatus as AiGenerationStatus,
      generatedAt: row.generatedAt.toISOString(),
      error:
        row.generationErrorCode === null
          ? null
          : {
              code: row.generationErrorCode,
              message: row.generationErrorMessage ?? '',
              retryable: row.generationRetryable ?? false,
            },
    },
    generatedByUserId: row.generatedByUserId,
    suggestion: row.suggestion as unknown,
    disposition: {
      status: disposition ? (disposition.status as AiDispositionStatus) : 'PENDING',
      requestId: disposition?.requestId ?? null,
      contentDigest: disposition?.contentDigest ?? null,
      disposedByUserId: disposition?.disposedByUserId ?? null,
      disposedAt: disposition?.disposedAt.toISOString() ?? null,
      reason: disposition?.reason ?? null,
      modification: disposition ? (disposition.modification as unknown) : null,
      finalContent: disposition ? (disposition.finalContent as unknown) : null,
    },
    application: {
      status: deriveApplicationStatus(row.status, disposition?.status),
      appliedAt: application?.appliedAt.toISOString() ?? null,
      appliedByUserId: application?.appliedByUserId ?? null,
      result: application ? (application.result as unknown) : null,
      targetReferences: application
        ? (application.targetReferences as unknown as AiSourceObjectRef[])
        : [],
    },
  }
  return record as TRecord
}

function nullableJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue)
}

function toSuggestionRow(record: AiSuggestionRecord): Prisma.AiSuggestionUncheckedCreateInput {
  return {
    id: record.id,
    projectId: record.projectId,
    scenario: record.scenario,
    sourceObjectType: record.sourceObject.objectType,
    sourceObjectId: record.sourceObject.objectId,
    status: record.status,
    generatedByUserId: record.generatedByUserId,
    generatedAt: new Date(record.generation.generatedAt),
    generationStatus: record.generation.status,
    generationRequestId: record.generation.requestId,
    generationErrorCode: record.generation.error?.code ?? null,
    generationErrorMessage: record.generation.error?.message ?? null,
    generationRetryable: record.generation.error?.retryable ?? null,
    modelProvider: record.model.provider,
    modelName: record.model.model,
    modelVersion: record.model.version,
    modelMode: record.model.mode,
    modelExecution: record.model.execution,
    suggestion: nullableJson(record.suggestion),
    inputScope: record.inputScope as unknown as Prisma.InputJsonValue,
    snapshotAsOf: new Date(record.snapshot.asOf),
    snapshotData: record.snapshot.data as Prisma.InputJsonValue,
    snapshotFingerprint: record.snapshot.fingerprint,
    snapshotFingerprintAlgorithm: record.snapshot.fingerprintAlgorithm,
  }
}

/** 读出 Prisma 已知错误码（`P2002` / `P2003` 等），非 Prisma 错误返回 `null`。 */
function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null
}

/** 缺失建议的稳定错误（正常路径由 service 的 `findById` 先拦成 404）。 */
export class AiSuggestionNotFoundError extends Error {
  constructor(public readonly suggestionId: string) {
    super(`AI suggestion does not exist: ${suggestionId}`)
    this.name = 'AiSuggestionNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// 查询层可见性过滤
// ---------------------------------------------------------------------------

/**
 * 生成建议表上的对象级可见性 `where` 条件（裁定 8；契约 I-6 同款理由）。
 *
 * - PM（两类作用域都 `all`）→ `null`（不加条件）；
 * - MEMBER / VIEWER → 按 `sourceObjectType` 判定：非 `story` / `task` 的类型恒可见；
 *   `story` / `task` 必须落在 `visibilityScope()` 给出的可见 id 集合内。
 *
 * 空 id 集合经 `in: []` 表达「该类型一条都不可见」，与「不泄漏存在性」一致。
 */
async function visibilityWhere(
  authorization: ReturnType<typeof createAuthorization>,
  actorUserId: string,
  projectId: string,
): Promise<Prisma.AiSuggestionWhereInput | null> {
  const [story, task] = await Promise.all([
    authorization.visibilityScope(actorUserId, projectId, 'story'),
    authorization.visibilityScope(actorUserId, projectId, 'task'),
  ])
  if (story.mode === 'all' && task.mode === 'all') return null

  const clauses: Prisma.AiSuggestionWhereInput[] = [
    { sourceObjectType: { notIn: ['story', 'task'] } },
  ]
  clauses.push(
    story.mode === 'all'
      ? { sourceObjectType: 'story' }
      : { sourceObjectType: 'story', sourceObjectId: { in: story.ids } },
  )
  clauses.push(
    task.mode === 'all'
      ? { sourceObjectType: 'task' }
      : { sourceObjectType: 'task', sourceObjectId: { in: task.ids } },
  )
  return { OR: clauses }
}

/** 组合「归属过滤 + 可见性过滤」。 */
async function scopeWhere(
  authorization: ReturnType<typeof createAuthorization>,
  query: AiSuggestionQuery,
): Promise<Prisma.AiSuggestionWhereInput> {
  const base: Prisma.AiSuggestionWhereInput = { projectId: query.projectId }
  if (query.scenario) base.scenario = query.scenario
  if (query.sourceObject) {
    base.sourceObjectType = query.sourceObject.objectType
    base.sourceObjectId = query.sourceObject.objectId
  }
  if (!query.actorUserId) return base
  const visibility = await visibilityWhere(authorization, query.actorUserId, query.projectId)
  return visibility ? { AND: [base, visibility] } : base
}

// ---------------------------------------------------------------------------
// 仓储
// ---------------------------------------------------------------------------

export class PrismaAiSuggestionRepository<
  TRecord extends AiSuggestionRecord = AiSuggestionRecord,
> implements AiSuggestionRepository<TRecord, AiDb>
{
  private readonly authorization: ReturnType<typeof createAuthorization>

  constructor(private readonly prisma: PrismaClient) {
    this.authorization = createAuthorization(prisma)
  }

  /** 缺省时在内部事务里执行（不提前提交）；传入调用方事务时直接复用、不自行提交。 */
  private run<T>(db: AiDb | undefined, operation: (client: AiDb) => Promise<T>): Promise<T> {
    if (db) return operation(db)
    return this.prisma.$transaction((tx) => operation(tx))
  }

  async create(record: TRecord, transaction?: AiDb): Promise<TRecord> {
    const client = transaction ?? this.prisma
    const row = await client.aiSuggestion.create({
      data: toSuggestionRow(record),
      include: SUGGESTION_INCLUDE,
    })
    return toRecord<TRecord>(row)
  }

  async findAccessMetadata(
    id: string,
    transaction?: AiDb,
  ): Promise<AiSuggestionAccessMetadata | null> {
    const client = transaction ?? this.prisma
    const row = await client.aiSuggestion.findUnique({ where: { id } })
    if (!row) return null
    return {
      id: row.id,
      projectId: row.projectId,
      scenario: row.scenario as AiScenario,
      sourceObject: { objectType: row.sourceObjectType, objectId: row.sourceObjectId },
      status: row.status as AiSuggestionStatus,
    }
  }

  async findById(id: string, transaction?: AiDb): Promise<TRecord | null> {
    const client = transaction ?? this.prisma
    const row = await client.aiSuggestion.findUnique({ where: { id }, include: SUGGESTION_INCLUDE })
    return row ? toRecord<TRecord>(row) : null
  }

  /** 列表：查询层可见性过滤 + 行数上限（兼容 D 的 service；截断标记见 `listPage`）。 */
  async list(query: AiSuggestionQuery, transaction?: AiDb): Promise<TRecord[]> {
    const page = await this.listPage(query, transaction)
    return page.items
  }

  async listPage(query: AiSuggestionQuery, transaction?: AiDb): Promise<AiSuggestionListResult<TRecord>> {
    const client = transaction ?? this.prisma
    const where = await scopeWhere(this.authorization, query)
    const limit = query.limit ?? AI_SUGGESTION_LIST_LIMIT
    // 多取 1 行只用于判定截断；total 仍是同一 where 的精确计数，不由行数反推。
    const rows = await client.aiSuggestion.findMany({
      where,
      include: SUGGESTION_INCLUDE,
      orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
    })
    const total = await client.aiSuggestion.count({ where })
    const truncated = rows.length > limit
    const shown = truncated ? rows.slice(0, limit) : rows
    return {
      items: shown.map((row) => toRecord<TRecord>(row)),
      total,
      limit,
      truncated,
    }
  }

  /**
   * 唯一最终处置 + CAS（裁定 3）。
   *
   * 顺序：先把唯一真源 `status` 做 `PENDING → DISPOSED` 条件更新（占写锁、并发下只有一个
   * 赢家），再插入 1:1 处置行（`suggestionId` 主键兜底唯一）。`status` 已非 `PENDING` 时
   * 读取既有处置，按 `(suggestionId, actorUserId, requestId, contentDigest)` 判定 REPLAY / CONFLICT。
   */
  async finalizeDisposition(
    input: FinalizeDispositionInput,
    transaction?: AiDb,
  ): Promise<FinalizeDispositionResult<TRecord>> {
    return this.run(transaction, async (client) => {
      const updated = await client.aiSuggestion.updateMany({
        where: { id: input.suggestionId, status: 'PENDING' },
        data: { status: 'DISPOSED' },
      })

      if (updated.count === 0) {
        const existing = await client.aiSuggestion.findUnique({
          where: { id: input.suggestionId },
          include: SUGGESTION_INCLUDE,
        })
        if (!existing) throw new AiSuggestionNotFoundError(input.suggestionId)
        const disposed = existing.disposition
        const sameRequest =
          disposed !== null &&
          disposed.disposedByUserId === input.actorUserId &&
          disposed.requestId === input.requestId &&
          disposed.contentDigest === input.contentDigest
        return { kind: sameRequest ? 'REPLAY' : 'CONFLICT', record: toRecord<TRecord>(existing) }
      }

      await client.aiDisposition.create({
        data: {
          suggestionId: input.suggestionId,
          status: input.status,
          disposedByUserId: input.actorUserId,
          disposedAt: new Date(input.disposedAt),
          requestId: input.requestId,
          contentDigest: input.contentDigest,
          reason: input.reason,
          modification: nullableJson(input.modification),
          finalContent: nullableJson(input.finalContent),
        },
      })

      const row = await client.aiSuggestion.findUnique({
        where: { id: input.suggestionId },
        include: SUGGESTION_INCLUDE,
      })
      if (!row) throw new AiSuggestionNotFoundError(input.suggestionId)
      return { kind: 'APPLIED', record: toRecord<TRecord>(row) }
    })
  }

  /**
   * 应用结果登记（H3 / M7 / M8）：字段级补丁 + CAS，绝不整行覆盖。
   *
   * 支持两种调用形式（见 `src/shared/ai.ts` 的端口注释）；CAS 失败返回 `null` 且**不写入**。
   */
  async updateApplication(
    target: TRecord | string,
    patchOrExpectedStatus: AiApplicationPatch | 'DISPOSED' | 'APPLICATION_FAILED',
    expectedStatusOrTransaction?: 'DISPOSED' | 'APPLICATION_FAILED' | AiDb,
    transaction?: AiDb,
  ): Promise<TRecord | null> {
    const normalized = normalizeApplicationUpdate(
      target,
      patchOrExpectedStatus,
      expectedStatusOrTransaction,
    )
    return this.run(normalized.transaction ?? transaction, async (client) => {
      const expectedStatuses =
        normalized.expectedStatus === undefined
          ? ['DISPOSED', 'APPLICATION_FAILED']
          : [normalized.expectedStatus]
      // CAS 在唯一真源 status 上；期望集合见裁定 5（应用失败可重试）。
      const updated = await client.aiSuggestion.updateMany({
        where: { id: normalized.id, status: { in: expectedStatuses } },
        data: { status: normalized.patch.suggestionStatus },
      })
      if (updated.count === 0) return null

      const applicationData = {
        appliedAt: new Date(normalized.patch.appliedAt),
        appliedByUserId: normalized.patch.appliedByUserId,
        result: nullableJson(normalized.patch.result),
        targetReferences: normalized.patch.targetReferences as unknown as Prisma.InputJsonValue,
      }
      await client.aiApplication.upsert({
        where: { suggestionId: normalized.id },
        create: { suggestionId: normalized.id, ...applicationData },
        update: applicationData,
      })

      const row = await client.aiSuggestion.findUnique({
        where: { id: normalized.id },
        include: SUGGESTION_INCLUDE,
      })
      return row ? toRecord<TRecord>(row) : null
    })
  }

  /** 采纳质量：口径沿用 D 的定义（pending = 未产生最终处置的建议，含生成失败）。 */
  async adoptionStats(query: AiSuggestionQuery, transaction?: AiDb): Promise<AiAdoptionStats> {
    const client = transaction ?? this.prisma
    const suggestionWhere = await scopeWhere(this.authorization, query)
    const total = await client.aiSuggestion.count({ where: suggestionWhere })
    const groups = await client.aiDisposition.groupBy({
      by: ['status'],
      where: { suggestion: suggestionWhere },
      _count: { _all: true },
    })
    const countOf = (status: AiDispositionStatus): number =>
      groups.find((group) => group.status === status)?._count._all ?? 0
    const accepted = countOf('ACCEPTED')
    const modified = countOf('MODIFIED')
    const rejected = countOf('REJECTED')
    const finalCount = accepted + modified + rejected
    return {
      pending: total - finalCount,
      accepted,
      modified,
      rejected,
      adoptionRate: finalCount === 0 ? null : (accepted + modified) / finalCount,
    }
  }
}

/** 把两种 `updateApplication` 调用形式归一为 `(id, patch, expectedStatus?, transaction?)`。 */
function normalizeApplicationUpdate<TRecord extends AiSuggestionRecord>(
  target: TRecord | string,
  patchOrExpectedStatus: AiApplicationPatch | 'DISPOSED' | 'APPLICATION_FAILED',
  expectedStatusOrTransaction?: 'DISPOSED' | 'APPLICATION_FAILED' | AiDb,
): {
  id: string
  patch: AiApplicationPatch
  expectedStatus?: 'DISPOSED' | 'APPLICATION_FAILED'
  transaction?: AiDb
} {
  if (typeof target === 'string') {
    return {
      id: target,
      patch: patchOrExpectedStatus as AiApplicationPatch,
      expectedStatus: expectedStatusOrTransaction as 'DISPOSED' | 'APPLICATION_FAILED' | undefined,
      transaction: undefined,
    }
  }
  // 兼容 D 的 service 预留 hook：只从整条记录里提取 application 字段，仍不整行覆盖。
  return {
    id: target.id,
    patch: {
      suggestionStatus: target.status === 'APPLICATION_FAILED' ? 'APPLICATION_FAILED' : 'APPLIED',
      appliedAt: target.application.appliedAt ?? new Date().toISOString(),
      appliedByUserId: target.application.appliedByUserId ?? '',
      result: target.application.result,
      targetReferences: target.application.targetReferences,
    },
    expectedStatus: patchOrExpectedStatus as 'DISPOSED' | 'APPLICATION_FAILED',
    transaction: expectedStatusOrTransaction as AiDb | undefined,
  }
}

// ---------------------------------------------------------------------------
// 权限适配器
// ---------------------------------------------------------------------------

/**
 * capability → 统一 `Action` 映射（裁定 1）。
 *
 * `ai.suggestion.read` 复用 `project.read`；`generate` / `dispose` 是仅 PM 的写类动作；
 * `ai.suggestion.audit` 是**死能力**，本批不实现 —— 映射为 `null` 并 fail-closed 拒绝。
 */
const CAPABILITY_ACTION: Record<AiCapability, Action | null> = {
  'ai.suggestion.read': 'project.read',
  'ai.suggestion.generate': 'ai.suggestion.generate',
  'ai.suggestion.dispose': 'ai.suggestion.dispose',
  'ai.suggestion.audit': null,
}

/**
 * `AiResourceRef` → `ObjectRef`。
 *
 * - `populationBasis: 'GLOBAL'` 或缺少可用来源对象 → 退回项目级 `{ kind: 'project' }`；
 * - 否则按来源对象类型映射为 `{ kind: 'story' | 'task', projectId, objectId }`。
 *
 * 调用方**只传 id**，权限相关字段一律由 `can()` 现查库决定（契约 I-5 约束 1）。
 */
export function aiResourceRefToObjectRef(ref: AiResourceRef): ObjectRef {
  const source = ref.sourceObject
  if (
    ref.populationBasis !== 'GLOBAL' &&
    source &&
    (source.objectType === 'story' || source.objectType === 'task')
  ) {
    return { kind: source.objectType, projectId: ref.projectId, objectId: source.objectId }
  }
  return { kind: 'project', projectId: ref.projectId }
}

/**
 * AI 权限适配器（`AiAuthorizationPort`）。
 *
 * **只用统一鉴权入口 `can()`**，零角色名字面判断。调用顺序由 service 保证：
 * `findAccessMetadata`（定位真实归属）→ `decide()`（本适配器 → `can()`）→ `findById`（读正文）。
 */
export function createAiAuthorizationPort(prisma: PrismaClient): AiAuthorizationPort {
  const { can } = createAuthorization(prisma)
  return {
    async decide(actorUserId: string, capability: AiCapability, ref: AiResourceRef) {
      const action = CAPABILITY_ACTION[capability]
      // 死能力 / 未登记能力：fail-closed，绝不因缺少映射而放行。
      if (action === null) return { allow: false, status: 403 as const, code: 'FORBIDDEN' as const }
      const decision: Decision = await can(actorUserId, action, aiResourceRefToObjectRef(ref))
      return decision.allow
        ? { allow: true as const }
        : { allow: false as const, status: decision.status, code: decision.code }
    },
  }
}
