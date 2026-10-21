import { describe, expect, it } from 'vitest'
import type { AiModelPort } from './contracts.js'
import { AiPortError } from './errors.js'
import { createAiModelPort } from './factory.js'

describe('AI provider factory', () => {
  it('显式 LOCAL_STUB 模式创建可辨识的本地桩', () => {
    const provider = createAiModelPort({ mode: 'LOCAL_STUB' })

    expect(provider.descriptor).toMatchObject({
      provider: 'local-stub',
      execution: 'LOCAL',
    })
  })

  it('EXTERNAL 模式只接受显式注入的外部 adapter', () => {
    const external: AiModelPort = {
      descriptor: {
        provider: 'example-external-adapter',
        model: 'not-selected',
        version: '未提供',
        mode: 'API',
        execution: 'EXTERNAL',
      },
      async generate(request) {
        return { requestId: request.requestId, output: {}, descriptor: this.descriptor }
      },
    }

    expect(createAiModelPort({ mode: 'EXTERNAL', provider: external })).toBe(external)
  })

  it('模式与 adapter 不一致时失败，不静默回退本地桩', () => {
    const local = createAiModelPort({ mode: 'LOCAL_STUB' })

    expect(() => createAiModelPort({ mode: 'EXTERNAL', provider: local })).toThrowError(AiPortError)
  })
})
