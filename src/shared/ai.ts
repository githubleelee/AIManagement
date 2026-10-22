/**
 * AI 建议域公共契约（#31 / US-11 公共接入，ROLE-B 单写）
 *
 * 权威来源：
 *   - `src/modules/ai/contracts.ts`（ROLE-D 的模块内契约 —— 本文件是**唯一权威定义**，
 *     该文件改为只 `export *`，不留第二份会漂移的定义）；
 *   - `docs/role-d/ROLE-D-US11-interface-protocol.md`（D 的接口协议）；
 *   - `docs/role-d/ROLE-D-US11-public-integration-request.md`（D 的公共接入申请）；
 *   - `DECISIONS.md` `ai.suggestion-store-shared`（一套共享的「建议 + 处置」存储）、
 *     `permissions.ai-suggestion-disposal`（处置仅 PM）、
 *     `arch.shared-ports-and-assembly`（公共类型与端口放 `src/shared/`）。
 *
 * 依赖方向：`src/shared/` **不** import 任何业务模块；业务模块（A/C/D）只依赖本文件的
 * 端口，不 import D 的 `service.ts`（契约 I-9「不跨模块调 service」）。
 *
 * ===========================================================================
 * 本批（B 的公共接入批次）冻结的 8 条语义 —— 引用方必须遵守
 * ===========================================================================
 *
 * 1. **两个 Action**：`ai.suggestion.generate` 与 `ai.suggestion.dispose`，**均仅 PM**
 *    （加入 `WRITE_ACTIONS`：MEMBER / VIEWER 403，PM 由 `can()` 第 3 条放行）；read 复用
 *    `project.read` + 可见性作用域。**不实现** D 的 `ai.suggestion.audit`（死能力，本批不加动作）。
 * 2. **事务**：共享仓储端口接受调用方事务上下文（`transaction?`），**不自行提交**；
 *    `finalizeDisposition` 用**条件更新（CAS）**保护唯一最终处置；`updateApplication`
 *    只做**字段级补丁**更新，**不整行覆盖**。
 * 3. **唯一最终处置**：DB 级约束兜底（`AiDisposition.suggestionId` 1:1 主键）+
 *    `PENDING → 最终` 的 CAS；重复请求按 `(suggestionId, actorUserId, requestId)` 幂等
 *    （同 actor 同 requestId 同 digest 才算重放；异 digest → 409；不同 actor 不算同一请求）。
 * 4. **理由规则**：`ACCEPTED` 可不填理由；`MODIFIED` / `REJECTED` **必须**填理由（校验层强制）。
 * 5. **应用失败可重试**：`updateApplication` 的 CAS 期望状态集合为
 *    `{DISPOSED, APPLICATION_FAILED}`；应用失败后再次登记成功结果必须被允许。
 * 6. **`status` 为唯一真源**：`AiSuggestionRecord.status`（生命周期）是唯一真源；
 *    `application.status` 是**派生视图**（派生规则见 `AiApplicationRecord.status` 注释）。
 * 7. **外部 API 仅合成数据可用**：`EXTERNAL + PROJECT_DATA` 一律拒绝（在此登记，业务层执行）。
 * 8. **可见性**：建议的**列表 / 详情**必须在**查询层**按调用者可见性过滤（PM 全量；
 *    MEMBER / VIEWER 按 `visibilityScope` 过滤其 `inputScope` 对象引用，不可见与不存在
 *    同一条 404）；列表加行数上限（`AI_SUGGESTION_LIST_LIMIT`）+ 截断标记。
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// 场景 / 能力 / 权限
// ---------------------------------------------------------------------------

export type AiScenario =
  | 'REQUIREMENT_BREAKDOWN'
  | 'SCHEDULING'
  | 'INSIGHT_QUALITY'
  | 'INSIGHT_PROGRESS'
  | 'INSIGHT_RISK'
  | 'INSIGHT_EFFICIENCY'

/**
 * AI 能力（供权限适配器映射到统一 `Action`）。
 *
 * `ai.suggestion.audit` 是 D 协议中的**死能力**：本批按 B 的裁定**不实现**、不新增 Action；
 * 适配器对它 fail-closed（拒绝），避免留下无人判定语义的空壳能力。
 */
export type AiCapability =
  | 'ai.suggestion.read'
  | 'ai.suggestion.generate'
  | 'ai.suggestion.dispose'
  | 'ai.suggestion.audit'

export type AiAccessDecision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

export type AiSourceObjectRef = { objectType: string; objectId: string }

/**
 * 权限判定用的资源引用。
 *
 * `populationBasis` 可选：`'GLOBAL'` 表示该建议的输入基数是整个项目（无单一来源对象），
 * 适配器据此退回项目级 `{ kind: 'project' }` 判定；缺省按 `sourceObject` 判定对象级。
 */
export type AiResourceRef = {
  projectId: string
  scenario: AiScenario
  sourceObject?: AiSourceObjectRef
  suggestionId?: string
  populationBasis?: AiPopulationBasis
}

/** 框架通过此端口询问权限；**绝不**在业务代码里硬编码角色名字面判断。 */
export interface AiAuthorizationPort {
  decide(actorUserId: string, capability: AiCapability, ref: AiResourceRef): Promise<AiAccessDecision>
}

// ---------------------------------------------------------------------------
// 模型端口
// ---------------------------------------------------------------------------

export type AiRunMode = 'STUB' | 'API'

export type AiProviderDescriptor = {
  /** 稳定 adapter/provider id，绝不是 SDK 对象。 */
  provider: string
  model: string
  /** 提供方给出版本时记录实际值；否则固定为字面量 `未提供`。 */
  version: string
  mode: AiRunMode
  execution: 'LOCAL' | 'EXTERNAL'
}

export type AiDataClassification = 'SYNTHETIC_DEMO' | 'PROJECT_DATA'

/**
 * 单次调用的追溯上下文。模型适配器**不得**把它当作扩大数据加载的授权。
 * `containsSensitiveData` 刻意 fail-closed（恒为 false）。
 */
export type AiInvocationContext = {
  projectId: string
  actorUserId: string
  sourceObjectType: string
  sourceObjectId: string
  dataClassification: AiDataClassification
  containsSensitiveData: false
}

export type AiGenerationRequest = {
  requestId: string
  scenario: AiScenario
  context: AiInvocationContext
  input: unknown
}

export type AiGenerationResult = {
  requestId: string
  output: unknown
  descriptor: AiProviderDescriptor
}

/** A/C 只消费此端口，并各自校验场景相关的输出结构。 */
export interface AiModelPort {
  readonly descriptor: AiProviderDescriptor
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>
}

// ---------------------------------------------------------------------------
// 需求拆解（第一个落地场景；A/C 复用同一存储时另附各自场景类型）
// ---------------------------------------------------------------------------

export type RequirementBreakdownInput = {
  title: string
  roleText: string
  capabilityText: string
  valueText: string
  businessValue: string
  acceptanceCriteria: string | null
}

export type RequirementBreakdownItem = {
  title: string
  description: string
  acceptanceCriteria: string[]
  sourceTrace: string[]
}

export type RequirementBreakdownSuggestion = {
  summary: string
  workItems: RequirementBreakdownItem[]
}

// ---------------------------------------------------------------------------
// 输入范围 / 快照 / 生成追溯
// ---------------------------------------------------------------------------

export type AiPopulationBasis = 'OBJECT' | 'GLOBAL' | 'VISIBLE'

export type AiInputScope = {
  projectId: string
  populationBasis: AiPopulationBasis
  objects: AiSourceObjectRef[]
  filters: Record<string, unknown>
  includedFields: string[]
  excludedFields: string[]
  population: {
    sourceCount: number
    includedCount: number
    excludedSensitiveCount: number
  }
  containsSensitiveData: false
}

/**
 * 规范化 JSON 规则（本批由 B 冻结）。
 *
 * - 稳定键序：对象键按 **UTF-16 码元升序**（`<` / `>` 直接比较），**绝不用 `localeCompare`**
 *   —— 后者受区域设置影响，同一份数据在不同环境会得到不同摘要；
 * - 数组保持顺序；其余值原样 `JSON.stringify`；
 * - 摘要算法固定为 `SHA-256_CANONICAL_JSON_V1`。
 */
export const SHA256_CANONICAL_JSON_V1 = 'SHA-256_CANONICAL_JSON_V1' as const

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>)
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return Object.fromEntries(entries.map(([key, nested]) => [key, canonicalize(nested)]))
}

/** 规范化 JSON 字符串（稳定键序 + 码元比较）。 */
export function canonicalAiJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/** `SHA-256_CANONICAL_JSON_V1` 摘要（hex）。 */
export function canonicalAiJsonDigest(value: unknown): string {
  return createHash('sha256').update(canonicalAiJson(value)).digest('hex')
}

export type AiSnapshot<TSnapshot = unknown> = {
  asOf: string
  data: TSnapshot
  fingerprint: string
  fingerprintAlgorithm: typeof SHA256_CANONICAL_JSON_V1
}

export type AiGenerationStatus = 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT'

export type AiGenerationError = {
  code: string
  message: string
  retryable: boolean
}

/**
 * 域内 AI 失败码联合（与顶层 `ErrorCode` 明确区分）。
 *
 * 顶层 `ErrorCode`（`src/shared/types.ts`）描述的是 **HTTP 错误信封**的码；
 * 这里的码描述的是 **AI 生成域**的失败原因，会写进 `AiGenerationTrace.error.code` 与
 * `AiGenerationError.code`。它们**不是** HTTP 码，不得混用。
 *   - `AI_TIMEOUT`：模型调用超时（可重试）；
 *   - `AI_GENERATION_FAILED`：生成失败（未知原因，默认不可重试）；
 *   - `AI_INVALID_RESPONSE`：模型输出结构无效（不可重试）；
 *   - `AI_SERVICE_UNAVAILABLE`：模型服务不可用（可重试）。
 */
export type AiDomainFailureCode =
  | 'AI_TIMEOUT'
  | 'AI_GENERATION_FAILED'
  | 'AI_INVALID_RESPONSE'
  | 'AI_SERVICE_UNAVAILABLE'

export type AiGenerationTrace = {
  requestId: string
  status: AiGenerationStatus
  generatedAt: string
  error: AiGenerationError | null
}

// ---------------------------------------------------------------------------
// 处置 / 应用 / 记录
// ---------------------------------------------------------------------------

export type AiDispositionStatus = 'PENDING' | 'ACCEPTED' | 'MODIFIED' | 'REJECTED'
export type AiReviewDecision = Exclude<AiDispositionStatus, 'PENDING'>

export type AiDispositionRecord<TModification = unknown, TFinalContent = unknown> = {
  status: AiDispositionStatus
  requestId: string | null
  contentDigest: string | null
  disposedByUserId: string | null
  disposedAt: string | null
  reason: string | null
  modification: TModification | null
  finalContent: TFinalContent | null
}

export type AiApplicationStatus =
  | 'PENDING_DISPOSITION'
  | 'NOT_APPLICABLE'
  | 'PENDING_INTEGRATION'
  | 'APPLIED'
  | 'FAILED'

/**
 * 应用记录。**`status` 是派生视图，不是第二真源**（见 `AiSuggestionRecord.status`）。
 *
 * 派生规则（唯一真源 = `AiSuggestionRecord.status`）：
 *   - `APPLIED`            → `APPLIED`；
 *   - `APPLICATION_FAILED` → `FAILED`；
 *   - `DISPOSED`           → `disposition.status === 'REJECTED' ? 'NOT_APPLICABLE' : 'PENDING_INTEGRATION'`；
 *   - 其它（`GENERATION_FAILED` / `PENDING`）→ `PENDING_DISPOSITION`。
 */
export type AiApplicationRecord<TResult = unknown> = {
  status: AiApplicationStatus
  appliedAt: string | null
  appliedByUserId: string | null
  result: TResult | null
  targetReferences: AiSourceObjectRef[]
}

export type AiSuggestionStatus =
  | 'GENERATION_FAILED'
  | 'PENDING'
  | 'DISPOSED'
  | 'APPLIED'
  | 'APPLICATION_FAILED'

export type AiSuggestionRecord<
  TSuggestion = unknown,
  TSnapshot = unknown,
  TModification = unknown,
  TApplicationResult = unknown,
> = {
  id: string
  scenario: AiScenario
  projectId: string
  sourceObject: AiSourceObjectRef
  /** **唯一真源**（生命周期状态）；`application.status` 只是它的派生视图。 */
  status: AiSuggestionStatus
  inputScope: AiInputScope
  snapshot: AiSnapshot<TSnapshot>
  model: AiProviderDescriptor
  generation: AiGenerationTrace
  generatedByUserId: string
  /** 不可变的模型输出；人工修改放在 `disposition.finalContent`。 */
  suggestion: TSuggestion | null
  disposition: AiDispositionRecord<TModification, TSuggestion>
  application: AiApplicationRecord<TApplicationResult>
}

export type AiSuggestionAccessMetadata = Pick<
  AiSuggestionRecord,
  'id' | 'projectId' | 'scenario' | 'sourceObject' | 'status'
>

/**
 * 查询过滤条件。
 *
 * `actorUserId`：**由调用方 / 组装层注入**，供 DB 仓储做**查询层**对象级可见性过滤（裁定 8）。
 * 缺省时不做对象级过滤（无可见性上下文）。
 *
 * `limit`：调用方要求的上限；缺省用 `AI_SUGGESTION_LIST_LIMIT`。仓储**不得**超过该上限。
 */
export type AiSuggestionQuery = {
  projectId: string
  scenario?: AiScenario
  sourceObject?: AiSourceObjectRef
  actorUserId?: string
  limit?: number
}

/** 列表行数上限（超出只置 `truncated`，**不得**用 `items.length` 冒充 `total`）。 */
export const AI_SUGGESTION_LIST_LIMIT = 200

/** 带截断标记的列表结果。 */
export type AiSuggestionListResult<TRecord extends AiSuggestionRecord = AiSuggestionRecord> = {
  items: TRecord[]
  /** 精确总数（同一 `where`，不受上限影响）。 */
  total: number
  /** 生效的行数上限。 */
  limit: number
  /** 明细是否因达到上限被截断。 */
  truncated: boolean
}

export type FinalizeDispositionInput<TModification = unknown, TFinalContent = unknown> = {
  suggestionId: string
  actorUserId: string
  requestId: string
  contentDigest: string
  status: Exclude<AiDispositionStatus, 'PENDING'>
  reason: string | null
  modification: TModification | null
  finalContent: TFinalContent | null
  disposedAt: string
}

export type FinalizeDispositionResult<TRecord extends AiSuggestionRecord = AiSuggestionRecord> =
  | { kind: 'APPLIED'; record: TRecord }
  | { kind: 'REPLAY'; record: TRecord }
  | { kind: 'CONFLICT'; record: TRecord }

export type AiAdoptionStats = {
  pending: number
  accepted: number
  modified: number
  rejected: number
  /** (accepted + modified) / all final dispositions；无最终处置时为 null。 */
  adoptionRate: number | null
}

/**
 * `updateApplication` 的 CAS 期望状态集合（裁定 5）：处置完成或应用失败都可再次登记。
 */
export type AiApplicationExpectedStatus = 'DISPOSED' | 'APPLICATION_FAILED'

/**
 * `updateApplication` 的字段级补丁（裁定 2：**不整行覆盖**）。
 *
 * 只更新 application 相关列，并把唯一真源 `AiSuggestionRecord.status` 置为
 * `suggestionStatus`；`application.status` 由读取时按派生规则计算，不落库、不补丁。
 */
export type AiApplicationPatch<TResult = unknown> = {
  suggestionStatus: Extract<AiSuggestionStatus, 'APPLIED' | 'APPLICATION_FAILED'>
  appliedAt: string
  appliedByUserId: string
  result: TResult | null
  targetReferences: AiSourceObjectRef[]
}

/**
 * 共享建议仓储端口（DB 适配器实现）。
 *
 * `TTransaction` 刻意保持泛型：序列化 DTO 绝不包含 Prisma 事务对象，而 A/C 可以把
 * 自己的当前事务传给 B 的适配器，使「业务写入 + 最终处置 + 应用结果」在同一事务内原子提交
 * （`DECISIONS.md` `ai.suggestion-store-shared`；接入申请的「不自行提前提交」）。
 *
 * 全部写方法接受可选 `transaction`，**缺省时适配器自行保证原子性、不提前提交**；
 * 传入调用方事务时**不自行提交**，由调用方回滚 / 提交。
 */
export interface AiSuggestionRepository<
  TRecord extends AiSuggestionRecord = AiSuggestionRecord,
  TTransaction = undefined,
> {
  create(record: TRecord, transaction?: TTransaction): Promise<TRecord>
  /** 鉴权前使用的最小元数据读取；**不含**建议正文。 */
  findAccessMetadata(
    id: string,
    transaction?: TTransaction,
  ): Promise<AiSuggestionAccessMetadata | null>
  findById(id: string, transaction?: TTransaction): Promise<TRecord | null>
  /**
   * 列表（查询层可见性过滤 + 行数上限）。
   *
   * 保持返回 `TRecord[]` 以兼容 D 的 service；需要截断标记时用 `listPage`。
   */
  list(query: AiSuggestionQuery, transaction?: TTransaction): Promise<TRecord[]>
  /** 带 `total` / `truncated` / `limit` 的列表（裁定 8 / L15）；DB 适配器实现。 */
  listPage?(
    query: AiSuggestionQuery,
    transaction?: TTransaction,
  ): Promise<AiSuggestionListResult<TRecord>>
  /**
   * 登记最终处置。CAS 保护 `PENDING → 最终`；唯一最终处置由 DB 约束兜底。
   *
   * 重复请求幂等（裁定 3）：同 actor 同 requestId 同 digest → `REPLAY`；否则 `CONFLICT`。
   */
  finalizeDisposition(
    input: FinalizeDispositionInput,
    transaction?: TTransaction,
  ): Promise<FinalizeDispositionResult<TRecord>>
  /**
   * 登记应用结果（裁定 2 / H3：字段级补丁 + CAS，**不整行覆盖**）。
   *
   * 两种调用形式（重载）：
   *   - **规范形式**（H3）`updateApplication(id, patch, expectedStatus, transaction?)` ——
   *     只更新 application 字段 + 唯一真源 `status`；
   *   - **兼容形式** `updateApplication(record, expectedStatus, transaction?)` —— D 的 service
   *     预留 hook 仍传整条记录，适配器**只从中提取 application 字段**做条件更新（同样不整行覆盖）。
   *
   * CAS 在唯一真源 `status` 上进行；`expectedStatus` 取值见 `AiApplicationExpectedStatus`
   * （`APPLICATION_FAILED` 允许重试，裁定 5）。CAS 失败返回 `null`，且**不产生任何写入**。
   */
  updateApplication(
    record: TRecord,
    expectedStatus: AiApplicationExpectedStatus,
    transaction?: TTransaction,
  ): Promise<TRecord | null>
  updateApplication(
    id: string,
    patch: AiApplicationPatch,
    expectedStatus: AiApplicationExpectedStatus,
    transaction?: TTransaction,
  ): Promise<TRecord | null>
  adoptionStats(query: AiSuggestionQuery, transaction?: TTransaction): Promise<AiAdoptionStats>
}

// ---------------------------------------------------------------------------
// 需求拆解具体记录
// ---------------------------------------------------------------------------

export type RequirementBreakdownSnapshot = RequirementBreakdownInput
export type RequirementBreakdownApplicationResult = { summary: string }
export type RequirementBreakdownRecord = AiSuggestionRecord<
  RequirementBreakdownSuggestion,
  RequirementBreakdownSnapshot,
  RequirementBreakdownSuggestion,
  RequirementBreakdownApplicationResult
>

export type AiStorySource = RequirementBreakdownInput & {
  projectId: string
  storyId: string
  isSensitive: boolean
  dataClassification: AiDataClassification
}

export interface AiStorySourcePort {
  find(projectId: string, storyId: string): Promise<AiStorySource | null>
}
