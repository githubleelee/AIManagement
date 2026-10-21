/**
 * ROLE-D / #31 module-local reference contract.
 *
 * Public copies belong in `src/shared/` and must be written by ROLE-B. Keeping
 * this executable reference in the D-owned module lets #31, #32 and #33 agree
 * on semantics without creating a cross-module service dependency.
 */

export type AiScenario =
  | 'REQUIREMENT_BREAKDOWN'
  | 'SCHEDULING'
  | 'INSIGHT_QUALITY'
  | 'INSIGHT_PROGRESS'
  | 'INSIGHT_RISK'
  | 'INSIGHT_EFFICIENCY'

export type AiCapability =
  | 'ai.suggestion.read'
  | 'ai.suggestion.generate'
  | 'ai.suggestion.dispose'
  | 'ai.suggestion.audit'

export type AiAccessDecision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

export type AiSourceObjectRef = { objectType: string; objectId: string }

export type AiResourceRef = {
  projectId: string
  scenario: AiScenario
  sourceObject?: AiSourceObjectRef
  suggestionId?: string
}

/** The framework asks `can()` through this port; it never hard-codes roles. */
export interface AiAuthorizationPort {
  decide(actorUserId: string, capability: AiCapability, ref: AiResourceRef): Promise<AiAccessDecision>
}

export type AiRunMode = 'STUB' | 'API'

export type AiProviderDescriptor = {
  /** Stable adapter/provider id, never an SDK object. */
  provider: string
  model: string
  /** Actual version when supplied by the provider; otherwise the literal `未提供`. */
  version: string
  mode: AiRunMode
  execution: 'LOCAL' | 'EXTERNAL'
}

export type AiDataClassification = 'SYNTHETIC_DEMO' | 'PROJECT_DATA'

/**
 * Per-call trace context. The model adapter cannot use this as authority to
 * load more data. `containsSensitiveData` is deliberately fail-closed.
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

/** A/C consume this port; they validate their own scenario-specific output. */
export interface AiModelPort {
  readonly descriptor: AiProviderDescriptor
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>
}

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

export type AiSnapshot<TSnapshot = unknown> = {
  asOf: string
  data: TSnapshot
  fingerprint: string
  fingerprintAlgorithm: 'SHA-256_CANONICAL_JSON_V1'
}

export type AiGenerationStatus = 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT'

export type AiGenerationError = {
  code: string
  message: string
  retryable: boolean
}

export type AiGenerationTrace = {
  requestId: string
  status: AiGenerationStatus
  generatedAt: string
  error: AiGenerationError | null
}

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
  status: AiSuggestionStatus
  inputScope: AiInputScope
  snapshot: AiSnapshot<TSnapshot>
  model: AiProviderDescriptor
  generation: AiGenerationTrace
  generatedByUserId: string
  /** Immutable model output. Human edits live in disposition.finalContent. */
  suggestion: TSuggestion | null
  disposition: AiDispositionRecord<TModification, TSuggestion>
  application: AiApplicationRecord<TApplicationResult>
}

export type AiSuggestionAccessMetadata = Pick<
  AiSuggestionRecord,
  'id' | 'projectId' | 'scenario' | 'sourceObject' | 'status'
>

export type AiSuggestionQuery = {
  projectId: string
  scenario?: AiScenario
  sourceObject?: AiSourceObjectRef
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
  /** (accepted + modified) / all final dispositions; null when none are final. */
  adoptionRate: number | null
}

/**
 * Shared suggestion-store port proposal.
 *
 * `TTransaction` is deliberately generic: serializable DTOs never contain a
 * Prisma transaction client, while C/A can pass their current transaction to
 * the B-owned adapter so business writes + disposition + success audit commit
 * atomically.
 */
export interface AiSuggestionRepository<
  TRecord extends AiSuggestionRecord = AiSuggestionRecord,
  TTransaction = undefined,
> {
  create(record: TRecord): Promise<TRecord>
  /** Safe metadata read used before authorization; no suggestion body. */
  findAccessMetadata(id: string, transaction?: TTransaction): Promise<AiSuggestionAccessMetadata | null>
  findById(id: string, transaction?: TTransaction): Promise<TRecord | null>
  list(query: AiSuggestionQuery): Promise<TRecord[]>
  finalizeDisposition(
    input: FinalizeDispositionInput,
    transaction?: TTransaction,
  ): Promise<FinalizeDispositionResult<TRecord>>
  updateApplication(
    record: TRecord,
    expectedStatus: 'DISPOSED',
    transaction?: TTransaction,
  ): Promise<TRecord | null>
  adoptionStats(query: AiSuggestionQuery): Promise<AiAdoptionStats>
}

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
