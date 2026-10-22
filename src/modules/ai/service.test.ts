import { describe, expect, it } from 'vitest'
import type {
  AiAuthorizationPort,
  AiModelPort,
  AiStorySource,
  AiStorySourcePort,
  RequirementBreakdownSuggestion,
} from './contracts.js'
import { AiServiceError } from './errors.js'
import { InMemoryAiSuggestionRepository } from './in-memory-repository.js'
import { LocalStubAiProvider } from './local-stub-provider.js'
import { AiBreakdownService } from './service.js'

const source: AiStorySource = {
  projectId: 'project-1',
  storyId: 'story-1',
  title: '项目经理拆解需求',
  roleText: '项目经理',
  capabilityText: '获得需求拆解建议',
  valueText: '更快形成可执行计划',
  businessValue: '减少遗漏',
  acceptanceCriteria: '建议必须经人工确认',
  isSensitive: false,
  dataClassification: 'PROJECT_DATA',
}

const allowAll: AiAuthorizationPort = {
  async decide() {
    return { allow: true }
  },
}

function sourcePort(value: AiStorySource | null = source): AiStorySourcePort {
  return {
    async find() {
      return value
    },
  }
}

function createService(overrides: {
  authorization?: AiAuthorizationPort
  provider?: AiModelPort
  storySource?: AiStorySourcePort
} = {}) {
  return new AiBreakdownService({
    authorization: overrides.authorization ?? allowAll,
    provider: overrides.provider ?? new LocalStubAiProvider(),
    repository: new InMemoryAiSuggestionRepository(),
    storySource: overrides.storySource ?? sourcePort(),
    now: () => new Date('2026-10-17T10:00:00.000Z'),
    createId: () => 'suggestion-1',
  })
}

describe('AiBreakdownService', () => {
  it('生成建议时保留输入范围、模型版本且保持建议态', async () => {
    const service = createService()

    const record = await service.generate('pm-1', 'project-1', 'story-1')

    expect(record.status).toBe('PENDING')
    expect(record.generatedByUserId).toBe('pm-1')
    expect(record.model).toEqual({
      provider: 'local-stub',
      model: 'deterministic-requirement-breakdown',
      version: '1.0.0',
      mode: 'STUB',
      execution: 'LOCAL',
    })
    expect(record.inputScope.containsSensitiveData).toBe(false)
    expect(record.inputScope.includedFields).toContain('acceptanceCriteria')
    expect(record.inputScope.excludedFields).toContain('passwords')
    expect(record.suggestion?.workItems).toHaveLength(3)
    expect(record.snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(record.disposition.status).toBe('PENDING')
    expect(record.application.status).toBe('PENDING_DISPOSITION')
  })

  it('模型端口收到可追溯的项目、操作者与来源对象上下文', async () => {
    let received: Parameters<AiModelPort['generate']>[0] | undefined
    const stub = new LocalStubAiProvider()
    const provider: AiModelPort = {
      descriptor: stub.descriptor,
      async generate(request) {
        received = request
        return stub.generate(request)
      },
    }

    const record = await createService({ provider }).generate('pm-1', 'project-1', 'story-1')

    expect(received).toMatchObject({
      requestId: record.id,
      scenario: 'REQUIREMENT_BREAKDOWN',
      context: {
        projectId: 'project-1',
        actorUserId: 'pm-1',
        sourceObjectType: 'story',
        sourceObjectId: 'story-1',
        dataClassification: 'PROJECT_DATA',
        containsSensitiveData: false,
      },
    })
  })

  it('敏感需求默认拒绝进入 AI 上下文，且不会调用模型端口', async () => {
    let calls = 0
    const provider: AiModelPort = {
      descriptor: new LocalStubAiProvider().descriptor,
      async generate(request) {
        calls += 1
        return { requestId: request.requestId, output: {}, descriptor: this.descriptor }
      },
    }
    const service = createService({
      provider,
      storySource: sourcePort({ ...source, isSensitive: true }),
    })

    await expect(service.generate('pm-1', 'project-1', 'story-1')).rejects.toMatchObject({
      status: 422,
      kind: 'VALIDATION_FAILED',
    })
    expect(calls).toBe(0)
  })

  it('外部提供方在未批准时被服务层拦截，且不会收到项目输入', async () => {
    let calls = 0
    const provider: AiModelPort = {
      descriptor: {
        provider: 'public-cloud',
        model: 'example',
        version: '1',
        mode: 'API',
        execution: 'EXTERNAL',
      },
      async generate(request) {
        calls += 1
        return { requestId: request.requestId, output: {}, descriptor: this.descriptor }
      },
    }

    await expect(
      createService({ provider }).generate('pm-1', 'project-1', 'story-1'),
    ).rejects.toMatchObject({ status: 422 })
    expect(calls).toBe(0)
  })

  it.each(['ACCEPTED', 'MODIFIED', 'REJECTED'] as const)(
    '审核结论 %s 被完整记录，但不自动写正式数据',
    async decision => {
      const service = createService()
      const generated = await service.generate('pm-1', 'project-1', 'story-1')
      const modified: RequirementBreakdownSuggestion = {
        summary: '人工调整后的拆解',
        workItems: [
          {
            title: '人工任务',
            description: '由项目经理调整',
            acceptanceCriteria: ['通过人工复核'],
            sourceTrace: ['human-review'],
          },
        ],
      }

      const reviewed = await service.review('pm-2', 'project-1', 'story-1', generated.id, {
        requestId: `dispose-${decision}`,
        decision,
        note: '项目经理复核',
        ...(decision === 'MODIFIED' ? { modifiedSuggestion: modified } : {}),
      })

      expect(reviewed.status).toBe('DISPOSED')
      expect(reviewed.disposition).toMatchObject({
        disposedByUserId: 'pm-2',
        status: decision,
        reason: '项目经理复核',
      })
      expect(reviewed.disposition.finalContent).toEqual(
        decision === 'REJECTED' ? null : decision === 'MODIFIED' ? modified : generated.suggestion,
      )
      expect(reviewed.application.status).toBe(
        decision === 'REJECTED' ? 'NOT_APPLICABLE' : 'PENDING_INTEGRATION',
      )
      expect(reviewed.application.targetReferences).toEqual([])
    },
  )

  it('同一建议不能重复审核', async () => {
    const service = createService()
    const generated = await service.generate('pm-1', 'project-1', 'story-1')
    await service.review('pm-1', 'project-1', 'story-1', generated.id, {
      requestId: 'dispose-1',
      decision: 'ACCEPTED',
    })

    await expect(
      service.review('pm-1', 'project-1', 'story-1', generated.id, {
        requestId: 'dispose-2',
        decision: 'REJECTED',
        note: '拒绝原因',
      }),
    ).rejects.toBeInstanceOf(AiServiceError)
  })

  it('并发审核只允许一个结论成功', async () => {
    const service = createService()
    const generated = await service.generate('pm-1', 'project-1', 'story-1')

    const results = await Promise.allSettled([
      service.review('pm-1', 'project-1', 'story-1', generated.id, {
        requestId: 'dispose-1',
        decision: 'ACCEPTED',
      }),
      service.review('pm-2', 'project-1', 'story-1', generated.id, {
        requestId: 'dispose-2',
        decision: 'REJECTED',
        note: '拒绝原因',
      }),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { status: 409, kind: 'CONFLICT' } })
  })

  it('应用结果只能在人工采纳后登记，并保存目标引用', async () => {
    const service = createService()
    const generated = await service.generate('pm-1', 'project-1', 'story-1')
    await service.review('pm-1', 'project-1', 'story-1', generated.id, {
      requestId: 'dispose-1',
      decision: 'ACCEPTED',
    })

    const applied = await service.recordApplicationResult({
      suggestionId: generated.id,
      actorUserId: 'pm-1',
      succeeded: true,
      resultSummary: '由公共写入事务创建 3 个任务',
      targetReferences: [
        { objectType: 'task', objectId: 'task-1' },
        { objectType: 'task', objectId: 'task-2' },
        { objectType: 'task', objectId: 'task-3' },
      ],
    })

    expect(applied.status).toBe('APPLIED')
    expect(applied.application).toMatchObject({
      status: 'APPLIED',
      appliedByUserId: 'pm-1',
      targetReferences: [
        { objectType: 'task', objectId: 'task-1' },
        { objectType: 'task', objectId: 'task-2' },
        { objectType: 'task', objectId: 'task-3' },
      ],
    })
  })

  it('权限端口拒绝时不读取需求内容', async () => {
    let sourceReads = 0
    const service = createService({
      authorization: {
        async decide() {
          return { allow: false, status: 403, code: 'FORBIDDEN' }
        },
      },
      storySource: {
        async find() {
          sourceReads += 1
          return source
        },
      },
    })

    await expect(service.generate('member-1', 'project-1', 'story-1')).rejects.toMatchObject({
      status: 403,
    })
    expect(sourceReads).toBe(0)
  })
})
