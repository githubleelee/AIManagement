import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AiGenerationRequest } from './contracts.js'
import { createSchedulingAiModelPort, createSchedulingAiModelPortFromEnvironment } from './scheduling-provider.js'

const changes = [{ taskId: 't1', planStart: '2099-02-01', planEnd: '2099-02-02' }]
function input() {
  return { scenario: 'SCHEDULING', projectId: 'synthetic-project', capturedAt: '2026-10-24T00:00:00.000Z',
    scope: '非敏感参与子集', tasks: [
      { id: 't1', title: 'Synthetic task', ownerUserId: 'm1', status: 'TODO', planStart: '2099-02-01', planEnd: '2099-02-03' },
      { id: 't2', title: 'Synthetic fixed task', ownerUserId: 'm2', status: 'DONE', planStart: '2099-01-01', planEnd: '2099-01-02' },
    ], dependencies: [{ predecessorId: 't2', successorId: 't1' }],
    milestones: [{ id: 'm1', taskIds: ['t1'], date: '2099-02-10' }],
    workload: [{ userId: 'm1', openTaskCount: 1 }, { userId: 'm2', openTaskCount: 1 }],
  }
}
function request(): AiGenerationRequest {
  return { requestId: 'caller-request', scenario: 'SCHEDULING', context: {
    projectId: 'synthetic-project', actorUserId: 'private-actor-not-for-model',
    sourceObjectType: 'project', sourceObjectId: 'synthetic-project',
    dataClassification: 'SYNTHETIC_DEMO', containsSensitiveData: false,
  }, input: input() }
}
function completion(output: unknown = { changes }) {
  return { id: 'synthetic-http-response', model: 'synthetic-scheduler',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }] }
}

/** A real loopback HTTP server with synthetic completions, NOT a real AI model. */
let endpoint: string
let calls: Array<{ path: string; method: string; authorization?: string; body: unknown }> = []
let reply: (response: ServerResponse, request: IncomingMessage) => void
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk.toString()
  calls.push({ path: req.url!, method: req.method!, authorization: req.headers.authorization, body: JSON.parse(body) })
  reply(res, req)
})
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`
})
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
beforeEach(() => {
  calls = []
  reply = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(completion())) }
})
function options() { return { endpoint, providerId: 'synthetic-http-test', model: 'synthetic-scheduler', apiKey: 'test-only-not-a-real-credential' } }

describe('D SCHEDULING API adapter: real loopback HTTP, synthetic model responses', () => {
  it('constructs from explicit server configuration and does not contact a model at startup', () => {
    const port = createSchedulingAiModelPortFromEnvironment({
      SCHEDULING_AI_MODE: 'EXTERNAL_CHAT_COMPLETIONS', SCHEDULING_AI_ENDPOINT: endpoint,
      SCHEDULING_AI_PROVIDER_ID: 'synthetic-http-test', SCHEDULING_AI_MODEL: 'synthetic-scheduler',
      SCHEDULING_AI_API_KEY: 'test-only-not-a-real-credential', SCHEDULING_AI_TIMEOUT_MS: '5000',
    })
    expect(port.descriptor).toMatchObject({ mode: 'API', execution: 'EXTERNAL', model: 'synthetic-scheduler' })
    expect(calls).toHaveLength(0)
  })

  it.each([{}, { SCHEDULING_AI_MODE: 'LOCAL_STUB' }, { SCHEDULING_AI_MODE: 'EXTERNAL_CHAT_COMPLETIONS' }])
    ('rejects missing/unknown mode or incomplete config instead of returning a stub %#', (config) => {
      expect(() => createSchedulingAiModelPortFromEnvironment(config)).toThrowError(/配置/)
      expect(calls).toHaveLength(0)
    })

  it('sends C-compatible minimal data and returns request-correlated API metadata and dates', async () => {
    const port = createSchedulingAiModelPort(options())
    const result = await port.generate(request())
    expect(result).toEqual({ requestId: 'caller-request', output: { changes }, descriptor: {
      provider: 'synthetic-http-test', model: 'synthetic-scheduler', version: '未提供', mode: 'API', execution: 'EXTERNAL',
    } })
    expect(result.descriptor).toBe(port.descriptor)
    expect(Object.isFrozen(port.descriptor)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/v1/chat/completions', method: 'POST', authorization: 'Bearer test-only-not-a-real-credential' })
    const wire = calls[0]!.body as { model: string; response_format: unknown; messages: Array<{ content: string }> }
    expect(wire.model).toBe('synthetic-scheduler')
    expect(wire.response_format).toEqual({ type: 'json_object' })
    const userData = JSON.parse(wire.messages[1]!.content)
    expect(userData.input).toEqual(input())
    expect(userData.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(JSON.stringify(wire)).not.toContain('private-actor-not-for-model')
    expect(JSON.stringify(wire)).not.toContain('test-only-not-a-real-credential')
    expect(JSON.stringify(wire)).not.toContain('caller-request')
  })

  it.each(['PROJECT_DATA', undefined])('blocks non-approved external data (%s) before transport', async (classification) => {
    const req = request()
    req.context.dataClassification = classification as never
    await expect(createSchedulingAiModelPort(options()).generate(req)).rejects.toMatchObject({ code: 'AI_DATA_POLICY_VIOLATION' })
    expect(calls).toHaveLength(0)
  })

  it.each(['snapshot', 'revision', 'serverPrivate', 'pmProtected', 'memberRoles', 'apiKey'])('rejects protected extra input %s without sending it', async (field) => {
    const req = request()
    req.input = { ...input(), [field]: 'private-do-not-transmit' }
    await expect(createSchedulingAiModelPort(options()).generate(req)).rejects.toMatchObject({ code: 'AI_DATA_POLICY_VIOLATION' })
    expect(calls).toHaveLength(0)
  })

  it('blocks sensitive flags, cross-project and sensitive task fields at the boundary', async () => {
    for (const req of [
      { ...request(), context: { ...request().context, containsSensitiveData: true } },
      { ...request(), input: { ...input(), projectId: 'other-project' } },
      { ...request(), input: { ...input(), tasks: [{ ...input().tasks[0], isSensitive: true }] } },
    ]) await expect(createSchedulingAiModelPort(options()).generate(req as AiGenerationRequest)).rejects.toMatchObject({ code: 'AI_DATA_POLICY_VIOLATION' })
    expect(calls).toHaveLength(0)
  })

  it('does not route requirement breakdown to the scheduling model', async () => {
    await expect(createSchedulingAiModelPort(options()).generate({ ...request(), scenario: 'REQUIREMENT_BREAKDOWN' }))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    { tasks: [input().tasks[0], input().tasks[0]] },
    { tasks: [{ ...input().tasks[0], planStart: '2099-02-30' }] },
    { dependencies: [{ predecessorId: 'hidden', successorId: 't1' }] },
    { milestones: [{ id: 'mixed', taskIds: ['t1', 'hidden'], date: '2099-02-10' }] },
    { tasks: [{ ...input().tasks[0], title: 'x'.repeat(1_048_576) }] },
  ])('rejects invalid/oversized model input before any HTTP %#', async (patch) => {
    await expect(createSchedulingAiModelPort(options()).generate({ ...request(), input: { ...input(), ...patch } }))
      .rejects.toMatchObject({ code: expect.stringMatching(/^AI_(INVALID_RESPONSE|DATA_POLICY_VIOLATION)$/) })
    expect(calls).toHaveLength(0)
  })

  it.each([
    { tasks: [] },
    { tasks: [input().tasks[1]] },
  ])('does not fabricate successful empty/fixed-task suggestions %#', async (patch) => {
    const data = { ...input(), ...patch, dependencies: [], milestones: [] }
    await expect(createSchedulingAiModelPort(options()).generate({ ...request(), input: data }))
      .rejects.toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', retryable: false })
    expect(calls).toHaveLength(0)
  })

  it.each([
    { changes: [] },
    { changes: [...changes, ...changes] },
    { changes: [{ ...changes[0], taskId: 'not-in-input' }] },
    { changes: [{ ...changes[0], taskId: 't2' }] },
    { changes: [{ ...changes[0], planStart: '2099-02-30' }] },
    { changes: [{ ...changes[0], planEnd: '2099-01-01' }] },
    { changes: [{ ...changes[0], planStart: '2000-01-01' }] },
    { changes: [{ ...changes[0], ownerUserId: 'replacement' }] },
    { changes, explanation: 'private-model-text' },
  ])('rejects structurally unsafe/out-of-scope scheduling output %#', async (output) => {
    reply = (res) => res.end(JSON.stringify(completion(output)))
    await expect(createSchedulingAiModelPort(options()).generate(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', retryable: false })
    expect(calls).toHaveLength(1)
  })

  it.each(['length', 'content_filter', 'tool_calls'])('rejects incomplete/refused model generation: %s', async (finish_reason) => {
    reply = (res) => res.end(JSON.stringify({ ...completion(), choices: [{ ...completion().choices[0], finish_reason }] }))
    await expect(createSchedulingAiModelPort(options()).generate(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it.each(['not JSON', '```json\n{}\n```'])('rejects invalid JSON content: %s', async (content) => {
    reply = (res) => res.end(JSON.stringify({ ...completion(), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }))
    await expect(createSchedulingAiModelPort(options()).generate(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it.each([
    'not a JSON envelope',
    JSON.stringify({ model: 'synthetic-scheduler', choices: [] }),
    JSON.stringify({ ...completion(), choices: [{ finish_reason: 'stop', message: {
      role: 'assistant', content: JSON.stringify({ changes }), refusal: 'refused',
    } }] }),
  ])('rejects malformed or refused envelopes %#', async (body) => {
    reply = (res) => res.end(body)
    await expect(createSchedulingAiModelPort(options()).generate(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('records actual configured resolved model identity rather than silently accepting another model', async () => {
    const alias = { ...options(), model: 'deployment-alias', responseModel: 'synthetic-scheduler' }
    const result = await createSchedulingAiModelPort(alias).generate(request())
    expect(result.descriptor.model).toBe('synthetic-scheduler')
    expect((calls[0]!.body as { model: string }).model).toBe('deployment-alias')
    reply = (res) => res.end(JSON.stringify({ ...completion(), model: 'unexpected-model' }))
    await expect(createSchedulingAiModelPort(alias).generate(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it.each([401, 429, 500])('redacts provider HTTP %s body and never retries/falls back', async (status) => {
    reply = (res) => { res.statusCode = status; res.end('secret-provider-error-body') }
    const error = await createSchedulingAiModelPort(options()).generate(request()).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', retryable: status !== 401 })
    expect(String(error)).not.toContain('secret-provider-error-body')
    expect(calls).toHaveLength(1)
  })

  it('does not follow redirects carrying the authorization header or project input', async () => {
    reply = (res) => { res.statusCode = 302; res.setHeader('Location', endpoint + '/redirect-target'); res.end() }
    await expect(createSchedulingAiModelPort(options()).generate(request())).rejects.toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE' })
    expect(calls).toHaveLength(1)
  })

  it('bounds response bytes, rejecting oversized completions', async () => {
    reply = (res) => res.end('x'.repeat(1_048_577))
    await expect(createSchedulingAiModelPort(options()).generate(request())).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' })
  })

  it('times out waiting for headers and while streaming the response body', async () => {
    for (const headersFirst of [false, true]) {
      reply = (res) => { if (headersFirst) { res.writeHead(200); res.write('{') } }
      await expect(createSchedulingAiModelPort({ ...options(), timeoutMs: 100 }).generate(request()))
        .rejects.toMatchObject({ code: 'AI_TIMEOUT', retryable: true })
    }
    expect(calls).toHaveLength(2)
  })

  it.each([
    { apiKey: '' }, { apiKey: 'contains\nnewline' }, { timeoutMs: 0 }, { timeoutMs: NaN },
    { endpoint: 'http://example.invalid/v1/chat/completions' },
    { endpoint: 'https://user:secret@example.invalid/v1/chat/completions' },
    { endpoint: 'https://example.invalid/v1/chat/completions?apiKey=secret' },
    { model: '' },
  ])('fails fast on invalid configuration %# without echoing it', (patch) => {
    let error: unknown
    try { createSchedulingAiModelPort({ ...options(), ...patch }) } catch (cause) { error = cause }
    expect(error).toMatchObject({ code: 'AI_MODE_NOT_CONFIGURED' })
    expect(String(error)).not.toContain('secret')
    expect(calls).toHaveLength(0)
  })
})
