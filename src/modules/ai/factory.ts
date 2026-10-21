import type { AiModelPort } from './contracts.js'
import { AiPortError } from './errors.js'
import { LocalStubAiProvider } from './local-stub-provider.js'
import { AiBreakdownService, type AiServiceDependencies } from './service.js'

export type AiProviderFactoryOptions =
  | { mode: 'LOCAL_STUB' }
  | { mode: 'EXTERNAL'; provider: AiModelPort }

/**
 * 由 src/app.ts 调用的显式模型选择入口。外部模式必须注入真实 adapter；配置错误
 * 直接阻止启动，绝不在 API 失败或缺少配置时静默退回本地桩。
 */
export function createAiModelPort(options: AiProviderFactoryOptions): AiModelPort {
  if (options.mode === 'LOCAL_STUB') return new LocalStubAiProvider()
  if (
    options.provider.descriptor.execution !== 'EXTERNAL' ||
    options.provider.descriptor.mode !== 'API'
  ) {
    throw new AiPortError(
      'AI_MODE_NOT_CONFIGURED',
      'EXTERNAL mode requires an external AI provider adapter',
      false,
    )
  }
  return options.provider
}

export type AiBreakdownFactoryOptions = Omit<AiServiceDependencies, 'provider'> & {
  ai: AiProviderFactoryOptions
}

/** 独立实现工厂；公共组装根只需提供端口依赖，不调用 D 模块内部 service。 */
export function createAiBreakdownService(options: AiBreakdownFactoryOptions): AiBreakdownService {
  const { ai, ...dependencies } = options
  return new AiBreakdownService({
    ...dependencies,
    provider: createAiModelPort(ai),
  })
}
