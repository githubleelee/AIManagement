import type {
  AiGenerationRequest,
  AiGenerationResult,
  AiModelPort,
  AiProviderDescriptor,
  RequirementBreakdownInput,
  RequirementBreakdownSuggestion,
} from './contracts.js'

function isBreakdownInput(value: unknown): value is RequirementBreakdownInput {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RequirementBreakdownInput>
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.roleText === 'string' &&
    typeof candidate.capabilityText === 'string' &&
    typeof candidate.valueText === 'string' &&
    typeof candidate.businessValue === 'string' &&
    (candidate.acceptanceCriteria === null || typeof candidate.acceptanceCriteria === 'string')
  )
}

/**
 * 确定性的本地桩：不读环境密钥、不建立网络连接、不伪装成真实大模型。
 * 它用于把生成→人工审核→审计链路先跑通，界面会明确标注“本地桩”。
 */
export class LocalStubAiProvider implements AiModelPort {
  readonly descriptor: AiProviderDescriptor = {
    provider: 'local-stub',
    model: 'deterministic-requirement-breakdown',
    version: '1.0.0',
    mode: 'STUB',
    execution: 'LOCAL',
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    if (request.scenario !== 'REQUIREMENT_BREAKDOWN' || !isBreakdownInput(request.input)) {
      throw new Error('LocalStubAiProvider only supports validated requirement breakdown input')
    }

    const input = request.input
    const originalAcceptance = input.acceptanceCriteria?.trim()
    const output: RequirementBreakdownSuggestion = {
      summary: `围绕“${input.title}”生成 3 项可人工复核的工作建议；本地桩不会写入正式任务。`,
      workItems: [
        {
          title: `澄清：${input.title}`,
          description: `确认“${input.roleText}”使用该能力时的范围、前置条件与异常路径。`,
          acceptanceCriteria: [
            '范围、前置条件和不做项均有书面结论',
            '至少列出一个正常场景和一个异常场景',
          ],
          sourceTrace: ['title', 'roleText', 'valueText'],
        },
        {
          title: `实现：${input.capabilityText}`,
          description: `以“${input.businessValue}”为目标实现最小可交付能力，不自动扩大需求范围。`,
          acceptanceCriteria: [
            '核心路径可以独立验证',
            '失败不会留下部分写入或不一致状态',
          ],
          sourceTrace: ['capabilityText', 'businessValue'],
        },
        {
          title: `验证：${input.title}`,
          description: `验证交付是否真正支持“${input.valueText}”，并保留可追溯证据。`,
          acceptanceCriteria: originalAcceptance
            ? [originalAcceptance, '验证结果包含执行人、时间与结论']
            : ['正常与越权路径均有测试证据', '验证结果包含执行人、时间与结论'],
          sourceTrace: ['title', 'valueText', 'acceptanceCriteria'],
        },
      ],
    }

    return { requestId: request.requestId, output, descriptor: this.descriptor }
  }
}
