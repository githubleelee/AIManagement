import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import type {
  AiAuthorizationPort,
  AiInputScope,
  AiModelPort,
  AiSuggestionRepository,
  AiStorySourcePort,
  RequirementBreakdownInput,
  RequirementBreakdownRecord,
  RequirementBreakdownSuggestion,
} from './contracts.js'
import { AiPortError, AiServiceError } from './errors.js'
import { canonicalJsonDigest } from './integrity.js'
import { breakdownSuggestionSchema, type ReviewSuggestionInput } from './schemas.js'

export type AiServiceDependencies = {
  authorization: AiAuthorizationPort
  provider: AiModelPort
  repository: AiSuggestionRepository<RequirementBreakdownRecord>
  storySource: AiStorySourcePort
  now?: () => Date
  createId?: () => string
}

export type RecordApplicationInput = {
  suggestionId: string
  actorUserId: string
  succeeded: boolean
  resultSummary: string
  targetReferences: Array<{ objectType: string; objectId: string }>
}

function inputFromSource(source: Awaited<ReturnType<AiStorySourcePort['find']>>): RequirementBreakdownInput {
  if (!source) throw new AiServiceError(404, 'NOT_FOUND', '需求不存在或不可见')
  return {
    title: source.title,
    roleText: source.roleText,
    capabilityText: source.capabilityText,
    valueText: source.valueText,
    businessValue: source.businessValue,
    acceptanceCriteria: source.acceptanceCriteria,
  }
}

function inputScope(projectId: string, storyId: string): AiInputScope {
  return {
    projectId,
    populationBasis: 'OBJECT',
    objects: [{ objectType: 'story', objectId: storyId }],
    filters: {},
    includedFields: [
      'title',
      'roleText',
      'capabilityText',
      'valueText',
      'businessValue',
      'acceptanceCriteria',
    ],
    excludedFields: [
      'isSensitive',
      'sensitive visibility list',
      'member personal data',
      'passwords',
      'tokens',
      'attachments',
    ],
    population: { sourceCount: 1, includedCount: 1, excludedSensitiveCount: 0 },
    containsSensitiveData: false,
  }
}

function generationFailure(error: unknown) {
  if (error instanceof AiPortError) {
    return {
      status: error.code === 'AI_TIMEOUT' ? ('TIMED_OUT' as const) : ('FAILED' as const),
      error: { code: error.code, message: 'AI 生成失败', retryable: error.retryable },
    }
  }
  if (error instanceof ZodError) {
    return {
      status: 'FAILED' as const,
      error: { code: 'AI_INVALID_RESPONSE', message: 'AI 输出结构无效', retryable: false },
    }
  }
  return {
    status: 'FAILED' as const,
    error: { code: 'AI_GENERATION_FAILED', message: 'AI 生成失败', retryable: false },
  }
}

export class AiBreakdownService {
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly deps: AiServiceDependencies) {
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? randomUUID
  }

  private async authorize(
    actorUserId: string,
    capability: Parameters<AiAuthorizationPort['decide']>[1],
    ref: Parameters<AiAuthorizationPort['decide']>[2],
  ): Promise<void> {
    const decision = await this.deps.authorization.decide(actorUserId, capability, ref)
    if (!decision.allow) {
      throw new AiServiceError(
        decision.status,
        decision.code,
        decision.status === 404 ? '资源不存在或不可见' : '你没有执行该操作的权限',
      )
    }
  }

  async generate(actorUserId: string, projectId: string, storyId: string): Promise<RequirementBreakdownRecord> {
    const sourceObject = { objectType: 'story', objectId: storyId }
    await this.authorize(actorUserId, 'ai.suggestion.generate', {
      projectId,
      scenario: 'REQUIREMENT_BREAKDOWN',
      sourceObject,
    })

    const source = await this.deps.storySource.find(projectId, storyId)
    if (!source) throw new AiServiceError(404, 'NOT_FOUND', '需求不存在或不可见')
    if (source.isSensitive) {
      throw new AiServiceError(422, 'VALIDATION_FAILED', '敏感需求默认不进入 AI 上下文')
    }
    if (
      this.deps.provider.descriptor.execution === 'EXTERNAL' &&
      source.dataClassification !== 'SYNTHETIC_DEMO'
    ) {
      throw new AiServiceError(
        422,
        'VALIDATION_FAILED',
        '外部 AI API 只允许普通虚构教学或演示数据；项目数据未获授权外发',
      )
    }

    const suggestionId = this.createId()
    const input = inputFromSource(source)
    const generatedAt = this.now().toISOString()
    const base = {
      id: suggestionId,
      scenario: 'REQUIREMENT_BREAKDOWN' as const,
      projectId,
      sourceObject,
      inputScope: inputScope(projectId, storyId),
      snapshot: {
        asOf: generatedAt,
        data: input,
        fingerprint: canonicalJsonDigest(input),
        fingerprintAlgorithm: 'SHA-256_CANONICAL_JSON_V1' as const,
      },
      generatedByUserId: actorUserId,
      disposition: {
        status: 'PENDING' as const,
        requestId: null,
        contentDigest: null,
        disposedByUserId: null,
        disposedAt: null,
        reason: null,
        modification: null,
        finalContent: null,
      },
      application: {
        status: 'PENDING_DISPOSITION' as const,
        appliedAt: null,
        appliedByUserId: null,
        result: null,
        targetReferences: [],
      },
    }

    try {
      const generated = await this.deps.provider.generate({
        requestId: suggestionId,
        scenario: 'REQUIREMENT_BREAKDOWN',
        context: {
          projectId,
          actorUserId,
          sourceObjectType: 'story',
          sourceObjectId: storyId,
          dataClassification: source.dataClassification,
          containsSensitiveData: false,
        },
        input,
      })
      if (generated.requestId !== suggestionId) {
        throw new AiServiceError(422, 'VALIDATION_FAILED', 'AI 返回的请求标识与调用不一致')
      }

      const suggestion = breakdownSuggestionSchema.parse(generated.output)
      return this.deps.repository.create({
        ...base,
        status: 'PENDING',
        model: generated.descriptor,
        generation: {
          requestId: suggestionId,
          status: 'SUCCEEDED',
          generatedAt,
          error: null,
        },
        suggestion,
      })
    } catch (error) {
      const failed = generationFailure(error)
      await this.deps.repository.create({
        ...base,
        status: 'GENERATION_FAILED',
        model: this.deps.provider.descriptor,
        generation: {
          requestId: suggestionId,
          status: failed.status,
          generatedAt,
          error: failed.error,
        },
        suggestion: null,
      })
      if (error instanceof ZodError) {
        throw new AiServiceError(422, 'VALIDATION_FAILED', 'AI 输出不符合需求拆解结构')
      }
      throw error
    }
  }

  async list(actorUserId: string, projectId: string, storyId: string): Promise<RequirementBreakdownRecord[]> {
    const sourceObject = { objectType: 'story', objectId: storyId }
    await this.authorize(actorUserId, 'ai.suggestion.read', {
      projectId,
      scenario: 'REQUIREMENT_BREAKDOWN',
      sourceObject,
    })
    return this.deps.repository.list({
      projectId,
      scenario: 'REQUIREMENT_BREAKDOWN',
      sourceObject,
    })
  }

  async review(
    actorUserId: string,
    projectId: string,
    storyId: string,
    suggestionId: string,
    input: ReviewSuggestionInput,
  ): Promise<RequirementBreakdownRecord> {
    const metadata = await this.deps.repository.findAccessMetadata(suggestionId)
    if (
      !metadata ||
      metadata.projectId !== projectId ||
      metadata.scenario !== 'REQUIREMENT_BREAKDOWN' ||
      metadata.sourceObject.objectType !== 'story' ||
      metadata.sourceObject.objectId !== storyId
    ) {
      throw new AiServiceError(404, 'NOT_FOUND', 'AI 建议不存在或不可见')
    }
    await this.authorize(actorUserId, 'ai.suggestion.dispose', {
      projectId: metadata.projectId,
      scenario: metadata.scenario,
      sourceObject: metadata.sourceObject,
      suggestionId,
    })

    const record = await this.deps.repository.findById(suggestionId)
    if (!record || record.generation.status !== 'SUCCEEDED' || !record.suggestion) {
      throw new AiServiceError(409, 'CONFLICT', '生成失败的记录不能处置')
    }

    const finalContent =
      input.decision === 'REJECTED'
        ? null
        : input.decision === 'MODIFIED'
          ? input.modifiedSuggestion ?? null
          : record.suggestion
    const dispositionPayload = {
      decision: input.decision,
      reason: input.note?.trim() || null,
      modification: input.decision === 'MODIFIED' ? input.modifiedSuggestion ?? null : null,
    }
    const result = await this.deps.repository.finalizeDisposition({
      suggestionId,
      actorUserId,
      requestId: input.requestId,
      contentDigest: canonicalJsonDigest(dispositionPayload),
      status: input.decision,
      reason: input.note?.trim() || null,
      modification: input.decision === 'MODIFIED' ? input.modifiedSuggestion ?? null : null,
      finalContent,
      disposedAt: this.now().toISOString(),
    })

    if (result.kind === 'CONFLICT') {
      throw new AiServiceError(409, 'CONFLICT', '该 AI 建议已有不同的最终处置')
    }
    return result.record
  }

  /**
   * Hook for a business-owned write transaction. The public database adapter
   * will receive the same transaction context; this module does not decide the
   * target domain write.
   */
  async recordApplicationResult(input: RecordApplicationInput): Promise<RequirementBreakdownRecord> {
    const metadata = await this.deps.repository.findAccessMetadata(input.suggestionId)
    if (!metadata) throw new AiServiceError(404, 'NOT_FOUND', 'AI 建议不存在或不可见')
    await this.authorize(input.actorUserId, 'ai.suggestion.dispose', {
      projectId: metadata.projectId,
      scenario: metadata.scenario,
      sourceObject: metadata.sourceObject,
      suggestionId: metadata.id,
    })

    const record = await this.deps.repository.findById(input.suggestionId)
    if (!record) throw new AiServiceError(404, 'NOT_FOUND', 'AI 建议不存在或不可见')
    if (record.status !== 'DISPOSED' || record.disposition.status === 'REJECTED') {
      throw new AiServiceError(409, 'CONFLICT', '只有已采纳或修改后采纳的建议可以登记应用结果')
    }

    const updated = await this.deps.repository.updateApplication(
      {
        ...record,
        status: input.succeeded ? 'APPLIED' : 'APPLICATION_FAILED',
        application: {
          status: input.succeeded ? 'APPLIED' : 'FAILED',
          appliedAt: this.now().toISOString(),
          appliedByUserId: input.actorUserId,
          result: { summary: input.resultSummary },
          targetReferences: [...input.targetReferences],
        },
      },
      'DISPOSED',
    )
    if (!updated) {
      throw new AiServiceError(409, 'CONFLICT', 'AI 建议状态已变化，应用结果未登记')
    }
    return updated
  }
}
