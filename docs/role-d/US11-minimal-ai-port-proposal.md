# ROLE-D → ROLE-B：US-11 首批最小 AI 端口提案

> **历史提案（已被 2026-10-18 多场景共享存储决策扩展）。** 原需求拆分实现继续保留；
> 最新 #31 字段、处置幂等与事务协议见
> `docs/role-d/ROLE-D-US11-interface-protocol.md`。本文件不再作为公共层落地的最新签名源。

| 项目 | 内容 |
|---|---|
| 交付方 | ROLE-D / `Akagawa-leo` |
| 本次交付 | 最小 AI 端口（不含 #37 事件端口） |
| 对应 Issue | [#31 AI 需求拆解与 AI 框架接口](https://github.com/githubleelee/AIManagement/issues/31) |
| 交付分支 | `feat/US11-ai-framework` |
| 当前整理基线 | `origin/main@37287c2` |
| 历史实现基线 | `138de1519963f6ffa48dab3599819ff5d7e0191d` |

本提案响应 ROLE-B 的首批请求，只提交已经准备好的 AI 端口。#37 事件端口可独立交付，
本分支没有创建事件空壳，也不把 AI 模块测试当成事件交付证据。

## 1. 类型与端口签名

候选公共位置：`src/shared/ai.ts`。当前实现先放在
`src/modules/ai/contracts.ts`，由 ROLE-B 核对后提取最小公共子集。

```ts
type AiScenario = 'REQUIREMENT_BREAKDOWN'
type AiDataClassification = 'SYNTHETIC_DEMO' | 'PROJECT_DATA'

type AiProviderDescriptor = {
  provider: string
  model: string
  version: string
  execution: 'LOCAL' | 'EXTERNAL'
}

type AiInvocationContext = {
  projectId: string
  actorUserId: string
  sourceObjectType: 'story'
  sourceObjectId: string
  dataClassification: AiDataClassification
  containsSensitiveData: false
}

type AiGenerationRequest = {
  requestId: string
  scenario: AiScenario
  context: AiInvocationContext
  input: unknown
}

type AiGenerationResult = {
  requestId: string
  output: unknown
  descriptor: AiProviderDescriptor
}

interface AiModelPort {
  readonly descriptor: AiProviderDescriptor
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>
}
```

上下文字段用途：

- `projectId / actorUserId`：权限和审计关联，不表示模型端口可以自行读取项目数据；
- `sourceObjectType / sourceObjectId`：把调用、生成记录和源需求串联；
- `dataClassification`：区分虚构演示数据和项目数据，供外部 adapter 执行出站策略；
- `containsSensitiveData`：公共请求只接受 `false`，敏感对象在调用模型之前拒绝；
- `requestId`：关联调用、返回和建议记录，返回不一致即拒绝。

需求拆解场景的 `input` 由调用方按 `RequirementBreakdownInput` 构造，输出由业务实现按
`RequirementBreakdownSuggestion` 校验。公共端口本身只生成建议，不写任务、故事或验收标准。

## 2. 错误语义及现有契约兼容

模块内候选错误类型：

```ts
type AiPortErrorCode =
  | 'AI_TIMEOUT'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_DATA_POLICY_VIOLATION'
  | 'AI_MODE_NOT_CONFIGURED'
```

| 端口错误 | 最小语义 | 当前 HTTP 兼容方式 |
|---|---|---|
| `AI_TIMEOUT` | 外部调用超时，可重试 | 现有共享错误码没有 AI/503 项；交统一错误出口返回不泄漏细节的 `500 INTERNAL_ERROR`，是否新增公共码待 B 核对 |
| `AI_SERVICE_UNAVAILABLE` | 供应商或网络不可用，可重试 | 同上，不静默回退本地桩 |
| `AI_INVALID_RESPONSE` | 结果无法通过场景结构校验 | 业务层映射为 `422 VALIDATION_FAILED` |
| `AI_DATA_POLICY_VIOLATION` | 输入不允许进入所选执行模式 | 在模型调用前映射为 `422 VALIDATION_FAILED`，且保持零模型调用 |
| `AI_MODE_NOT_CONFIGURED` | 运行模式与 adapter 配置不一致 | 应用组装阶段直接失败，不启动为“看似成功”的桩模式 |

本提案不直接修改冻结的 `src/shared/types.ts` 或 `src/shared/errors.ts`。若需要新增 503 或 AI
专用顶层错误码，需由 B 单写并走公共错误契约核对；在此之前不私自扩大 `AppError`。

## 3. 显式运行模式、工厂与组装

独立实现导出：

```ts
type AiProviderFactoryOptions =
  | { mode: 'LOCAL_STUB' }
  | { mode: 'EXTERNAL'; provider: AiModelPort }

createAiModelPort(options: AiProviderFactoryOptions): AiModelPort

type AiBreakdownFactoryOptions = Omit<AiServiceDependencies, 'provider'> & {
  ai: AiProviderFactoryOptions
}

createAiBreakdownService(options: AiBreakdownFactoryOptions): AiBreakdownService
```

建议由 B 在 `src/app.ts` 中显式组装：

```ts
const aiBreakdown = createAiBreakdownService({
  ai: { mode: 'LOCAL_STUB' },
  authorization: aiAuthorization,
  repository: aiSuggestionRepository,
  storySource: aiStorySource,
})
```

测试可以直接注入内存仓储、固定时钟、固定 ID 和权限替身。业务模块不互调 service；A/C
只依赖提升到 shared 的 `AiModelPort`。本批不提供外部供应商 adapter，也不读取任何 key。
未来外部模式必须由后端显式注入 adapter；前端不接触 key，API 失败不得回退为本地桩。

## 4. 最小示例与正式数据不变证明

虚构输入示例：

```ts
await provider.generate({
  requestId: 'demo-request-1',
  scenario: 'REQUIREMENT_BREAKDOWN',
  context: {
    projectId: 'demo-project',
    actorUserId: 'demo-pm',
    sourceObjectType: 'story',
    sourceObjectId: 'demo-story',
    dataClassification: 'SYNTHETIC_DEMO',
    containsSensitiveData: false,
  },
  input: {
    title: 'AI 辅助拆解虚构需求',
    roleText: '项目经理',
    capabilityText: '获得拆解建议',
    valueText: '减少遗漏',
    businessValue: '提高计划完整性',
    acceptanceCriteria: '建议必须人工确认',
  },
})
```

本地桩返回 `descriptor.execution = 'LOCAL'`、`provider = 'local-stub'`，并回传相同
`requestId`。结果只保存为 `PROPOSED` 建议记录；没有正式任务写入端口。人工采纳或修改后，
当前也只进入 `PENDING_INTEGRATION`，待正式应用目标和公共事务写路径确认后再接入。

预期失败行为：敏感故事在读取后、模型调用前返回 422；无权用户在读取故事前返回
403/404；输出结构或 `requestId` 不一致返回 422；外部模式配置不一致在组装时失败。

## 5. 公共文件修改申请

ROLE-D 不直接修改下列文件，申请由 ROLE-B 分批集成：

1. `src/shared/`：提取最小 AI 类型、端口及经核对的错误语义；
2. `src/db/schema.prisma` 与迁移：建议、审核、应用审计持久化；
3. `src/app.ts`：显式选择 `LOCAL_STUB` 并注入权限、仓储、故事来源；
4. `src/routes.ts`：注册 `registerAiRoutes`；
5. `web/src/pages/RequirementDetailPage.tsx`：最小挂载 `AiBreakdownPanel`。

详细字段与挂载申请见 `docs/role-d/US11-integration-request.md`。

## 6. 已确认、待核对与尚未实现

### 已确认并已实现

- 本地桩身份可辨识、零 SDK、零密钥、零网络；
- 建议不自动写正式业务数据；
- 项目/操作者/来源对象/数据分类/模型版本可追溯；
- PM 人工采纳、修改、拒绝与审计结构；
- 敏感对象默认零模型调用；
- 显式运行模式，禁止静默回退；
- 独立服务工厂和测试注入入口。

### 待 B 核对

- 公共文件名及应提升的最小类型集合；
- 超时/不可用是否新增 503 与公共顶层错误码；
- PM/MEMBER/VIEWER 的 `read/generate/review` 精确权限矩阵；
- 建议采纳后最终写为任务、故事还是验收标准。

### 尚未实现，不作为本批通过证据

- 外部公有云供应商 adapter 与真实 API 调用；
- 数据库持久化和迁移；
- 公共路由/app 注入及需求详情页挂载；
- 真实浏览器端到端和真实生产方联调；
- #37 事件端口。

## 7. 测试证据

本次实际执行：

```text
npx vitest run src/modules/ai/factory.test.ts src/modules/ai/service.test.ts src/modules/ai/plugin.test.ts
npm run typecheck
npm run build
npm test
```

结果：

- AI 模块：3 个测试文件、19 个用例通过；
- 双端 TypeScript 类型检查通过；
- 服务端与 Web 生产构建通过，Vite 转换 72 个模块；
- 全仓最终复跑：49 个测试文件、1136 个用例全部通过。

过程说明：第一次全仓运行有 1 个既有 requirement 并发排序用例在 5 秒处超时，其他
1135 个通过；该文件单独复跑 71/71 通过，随后全仓独占复跑 1136/1136 通过。没有修改
既有用例、超时阈值或 requirement 代码。最初使用带引号的通配路径执行针对性测试时，
Vitest 没有匹配到文件并明确退出；随后改为三个明确文件路径，不能把前一次空运行计为通过。

## 8. 下一项可独立交付

待 B 对本提案反馈“可落公共层 / 需补充 / 待业务确认”后，可继续：

1. 根据反馈提供 shared 差异补丁；
2. 提交 AI 建议数据库字段与迁移提案；
3. 单独处理 #37 最小事件端口，不与本次 AI 提案混报完成。
