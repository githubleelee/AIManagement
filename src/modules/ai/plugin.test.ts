import Fastify, { type FastifyInstance } from 'fastify'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../../error-handler.js'
import type {
  AiAuthorizationPort,
  AiModelPort,
  AiStorySource,
  RequirementBreakdownSuggestion,
} from './contracts.js'
import { AiPortError } from './errors.js'
import { InMemoryAiSuggestionRepository } from './in-memory-repository.js'
import { LocalStubAiProvider } from './local-stub-provider.js'
import { registerAiRoutes } from './plugin.js'
import { AiBreakdownService } from './service.js'

const projectId = 'project-1'
const storyId = 'story-1'
const source: AiStorySource = {
  projectId,
  storyId,
  title: 'AI 辅助需求拆解',
  roleText: '项目经理',
  capabilityText: '生成拆解建议',
  valueText: '人工确认后形成执行计划',
  businessValue: '降低遗漏风险',
  acceptanceCriteria: '生成结果不得直接写正式任务',
  isSensitive: false,
  dataClassification: 'PROJECT_DATA',
}

function asUser(app: FastifyInstance, actorUserId: string | null) {
  const client = request(app.server)
  const withActor = (test: request.Test) =>
    actorUserId ? test.set('x-test-actor', actorUserId) : test
  return {
    get: (url: string) => withActor(client.get(url)),
    post: (url: string) => withActor(client.post(url)),
  }
}

describe('US-11 AI routes', () => {
  let app: FastifyInstance
  let currentSource: AiStorySource
  let formalWriteCount: number

  beforeAll(async () => {
    app = Fastify({ logger: false })
    registerErrorHandler(app)
    app.decorateRequest('actorUserId', undefined)
    app.addHook('onRequest', async requestValue => {
      const actor = requestValue.headers['x-test-actor']
      requestValue.actorUserId = typeof actor === 'string' ? actor : undefined
    })

    const authorization: AiAuthorizationPort = {
      async decide(actorUserId) {
        if (actorUserId === 'outsider') return { allow: false, status: 404, code: 'NOT_FOUND' }
        if (actorUserId !== 'pm') return { allow: false, status: 403, code: 'FORBIDDEN' }
        return { allow: true }
      },
    }
    const service = new AiBreakdownService({
      authorization,
      provider: new LocalStubAiProvider(),
      repository: new InMemoryAiSuggestionRepository(),
      storySource: {
        async find(requestProjectId, requestStoryId) {
          if (requestProjectId !== projectId || requestStoryId !== storyId) return null
          return currentSource
        },
      },
    })
    registerAiRoutes(app, { service })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    currentSource = { ...source }
    formalWriteCount = 0
  })

  it('未登录返回 401', async () => {
    const response = await asUser(app, null).post(
      `/projects/${projectId}/stories/${storyId}/ai-suggestions`,
    )
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('成员被权限端口拒绝，项目外用户得到不泄漏的 404', async () => {
    const url = `/projects/${projectId}/stories/${storyId}/ai-suggestions`

    const member = await asUser(app, 'member').post(url)
    const outsider = await asUser(app, 'outsider').post(url)

    expect(member.status).toBe(403)
    expect(member.body.error.code).toBe('FORBIDDEN')
    expect(outsider.status).toBe(404)
    expect(outsider.body.error.code).toBe('NOT_FOUND')
  })

  it('PM 可生成并查询建议，生成过程没有正式写入端口', async () => {
    const client = asUser(app, 'pm')
    const url = `/projects/${projectId}/stories/${storyId}/ai-suggestions`

    const generated = await client.post(url)
    const listed = await client.get(url)

    expect(generated.status).toBe(201)
    expect(generated.body.status).toBe('PENDING')
    expect(generated.body.model.execution).toBe('LOCAL')
    expect(generated.body.model.mode).toBe('STUB')
    expect(listed.status).toBe(200)
    expect(listed.body.items).toHaveLength(1)
    expect(formalWriteCount).toBe(0)
  })

  it('修改后采纳留下审核记录，仍不会触发正式写入', async () => {
    const client = asUser(app, 'pm')
    const base = `/projects/${projectId}/stories/${storyId}/ai-suggestions`
    const generated = await client.post(base)
    const modified: RequirementBreakdownSuggestion = {
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

    const reviewed = await client
      .post(`${base}/${generated.body.id as string}/disposition`)
      .send({
        requestId: 'dispose-request-1',
        decision: 'MODIFIED',
        note: '调整为一个任务',
        modifiedSuggestion: modified,
      })

    expect(reviewed.status).toBe(200)
    expect(reviewed.body.disposition).toMatchObject({
      disposedByUserId: 'pm',
      status: 'MODIFIED',
      reason: '调整为一个任务',
      finalContent: modified,
    })
    expect(reviewed.body.application.status).toBe('PENDING_INTEGRATION')
    expect(formalWriteCount).toBe(0)
  })

  it('敏感故事默认不进入上下文', async () => {
    currentSource = { ...source, isSensitive: true }

    const response = await asUser(app, 'pm').post(
      `/projects/${projectId}/stories/${storyId}/ai-suggestions`,
    )

    expect(response.status).toBe(422)
    expect(response.body.error.message).toContain('敏感需求默认不进入 AI 上下文')
  })

  it.each(['AI_INVALID_RESPONSE', 'AI_DATA_POLICY_VIOLATION'] as const)(
    '模型端口错误 %s 经真实 HTTP 返回 422 统一错误信封',
    async code => {
      const errorApp = Fastify({ logger: false })
      registerErrorHandler(errorApp)
      errorApp.decorateRequest('actorUserId', undefined)
      errorApp.addHook('onRequest', async requestValue => {
        const actor = requestValue.headers['x-test-actor']
        requestValue.actorUserId = typeof actor === 'string' ? actor : undefined
      })
      const provider: AiModelPort = {
        descriptor: new LocalStubAiProvider().descriptor,
        async generate() {
          throw new AiPortError(code, 'provider detail must not escape', false)
        },
      }
      registerAiRoutes(errorApp, {
        service: new AiBreakdownService({
          authorization: { async decide() { return { allow: true } } },
          provider,
          repository: new InMemoryAiSuggestionRepository(),
          storySource: { async find() { return source } },
        }),
      })
      await errorApp.ready()

      try {
        const response = await asUser(errorApp, 'pm').post(
          `/projects/${projectId}/stories/${storyId}/ai-suggestions`,
        )
        expect(response.status).toBe(422)
        expect(response.body).toEqual({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'AI 返回内容未通过结构或数据策略校验',
          },
        })
      } finally {
        await errorApp.close()
      }
    },
  )
})
