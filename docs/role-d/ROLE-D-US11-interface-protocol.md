# ROLE-D 接口协议提案：共享 AI 建议与人工处置（#31）

> 版本：`role-d.us11.v0.3-draft`
> 日期：2026-10-21（业务日期 `Asia/Shanghai`；记录时间使用 ISO 8601 UTC）
> 代码基线：`origin/main@37287c2`
> 实现分支：`feat/US11-ai-framework`
> 状态：ROLE-D 可执行提案；公共契约、数据库和运行时接线尚未由 ROLE-B 落地。

本文回应 Issue #31、`DECISIONS.md` 的 `ai.suggestion-store-shared` 与
`permissions.ai-suggestion-disposal`，并覆盖 #32 排期和 #33 四类分析复用共享建议存储时需要的
最小字段、端口、事务与幂等语义。

## 1. 范围与边界

- #31 提供多场景模型端口，以及“不可变原建议 → 唯一最终处置 → 应用结果”的共享记录协议。
- 支持 `REQUIREMENT_BREAKDOWN`、`SCHEDULING`、`INSIGHT_QUALITY`、
  `INSIGHT_PROGRESS`、`INSIGHT_RISK`、`INSIGHT_EFFICIENCY`。
- #32/#33 不另建建议表，`AuditLog` 不充当建议存储。
- 生成在数据库写事务外执行；处置使用已保存建议，不重新调用模型替换原建议。
- 处置仅 PM 可操作；框架通过统一权限端口判定，不在业务实现中比较角色字符串。
- 本分支不修改 `src/shared/*`、数据库 schema/迁移、`src/app.ts`、`src/routes.ts` 或 authz。

## 2. 模型生成端口

```ts
interface AiModelPort {
  readonly descriptor: {
    provider: string
    model: string
    version: string
    mode: 'STUB' | 'API'
    execution: 'LOCAL' | 'EXTERNAL'
  }
  generate(request: {
    requestId: string
    scenario: AiScenario
    context: {
      projectId: string
      actorUserId: string
      sourceObjectType: string
      sourceObjectId: string
      dataClassification: 'SYNTHETIC_DEMO' | 'PROJECT_DATA'
      containsSensitiveData: false
    }
    input: unknown
  }): Promise<{
    requestId: string
    output: unknown
    descriptor: AiProviderDescriptor
  }>
}
```

- 端口不绑定供应商 SDK，不自行读取数据库。
- `STUB` 与 `API` 必须可辨识，API 失败不得静默回退 Stub。
- 实际版本无法取得时固定记为“未提供”，不得猜测。
- 只有显式标记的普通虚构演示数据可进入外部 API；项目数据默认拒绝外发。
- 密码、token、密钥、真实个人信息、未授权资料及敏感对象始终不得进入模型上下文。
- 返回 `requestId` 与请求不一致时按无效响应处理。

## 3. 共享建议记录

| 分组 | 最小字段 | 约束 |
|---|---|---|
| 归属 | `id`, `projectId`, `scenario`, `sourceObject` | 服务端核对项目归属 |
| 输入范围 | `populationBasis`, `objects`, `filters`, `includedFields`, `excludedFields` | 不含敏感正文与密钥 |
| 基数 | `sourceCount`, `includedCount`, `excludedSensitiveCount` | 不以 AI 子集冒充全项目 |
| 快照 | `asOf`, `data`, `fingerprint` | 支持来源复核和过期判断 |
| 模型 | `provider`, `model`, `version`, `mode`, `execution` | Stub/API 可区分 |
| 生成 | `requestId`, `status`, `generatedAt`, `error` | 失败信息不得含 prompt、响应正文或密钥 |
| 原建议 | `suggestion` | 生成成功后不可变 |
| 处置 | `status`, `requestId`, `contentDigest`, `disposedByUserId`, `disposedAt`, `reason` | 仅一个最终处置 |
| 人工修改 | `modification`, `finalContent` | 不覆盖原建议 |
| 应用 | `status`, `result`, `targetReferences` | 与最终处置分开记录 |

处置状态为 `PENDING / ACCEPTED / MODIFIED / REJECTED`；应用状态为
`PENDING_DISPOSITION / NOT_APPLICABLE / PENDING_INTEGRATION / APPLIED / FAILED`。

## 4. 共享存储端口

```ts
interface AiSuggestionRepository<TRecord, TTransaction> {
  create(record: TRecord): Promise<TRecord>
  findAccessMetadata(id: string, tx?: TTransaction):
    Promise<AiSuggestionAccessMetadata | null>
  findById(id: string, tx?: TTransaction): Promise<TRecord | null>
  list(query: AiSuggestionQuery): Promise<TRecord[]>
  finalizeDisposition(input: FinalizeDispositionInput, tx?: TTransaction):
    Promise<{ kind: 'APPLIED' | 'REPLAY' | 'CONFLICT'; record: TRecord }>
  updateApplication(record: TRecord, expectedStatus: 'DISPOSED', tx?: TTransaction):
    Promise<TRecord | null>
  adoptionStats(query: AiSuggestionQuery): Promise<AiAdoptionStats>
}
```

`TTransaction` 是不可序列化的调用方事务上下文。数据库适配器不得自行提前提交；#32/#33 可以把
正式业务写入、最终处置、应用结果和成功审计放入同一事务。读取顺序必须是：
`findAccessMetadata → can() → findById`，不得在鉴权前返回正文或幂等历史结果。

## 5. 唯一处置与幂等

逻辑请求身份为：

```text
projectId + suggestionId + actorUserId + dispositionRequestId + normalizedContentDigest
```

- 同一 actor、requestId 和 digest：返回第一次结果，类型为 `REPLAY`；不重复写业务、不发事件。
- 同 requestId 不同 digest：`CONFLICT`。
- 不同 actor 不是同一请求；已有最终处置时返回 `CONFLICT`，不得覆盖首次处置人。
- 所有重放判断前必须重新鉴权；撤权后返回 403/404，不泄漏历史正文。
- 数据库实现使用 `PENDING` 条件更新或唯一约束，保证并发仅一个最终处置成功。
- 来源快照过期与人工拒绝是不同语义；应用失败也不得冒充成功采纳。

## 6. 调用顺序

1. 生成入口鉴权并读取调用者本来有权看到的数据。
2. 排除敏感对象，形成输入范围、快照和 fingerprint。
3. 在数据库写事务外调用模型。
4. 重新鉴权并用短事务保存不可变原建议或脱敏失败记录。
5. 处置时先读归属元数据并重新鉴权。
6. 已处置时先执行重放/冲突判断；仍为 `PENDING` 时复核快照和业务约束。
7. 在调用方事务中写正式数据、最终处置、应用结果和成功审计。
8. 提交后再发布领域事件；事件失败不得重写已提交业务，也不得重新调用模型。

## 7. 错误与统计

需要区分模型超时、服务不可用、输出非法、数据策略违规、来源过期、已处置冲突、同请求异内容
冲突及应用失败。公共错误码由 ROLE-B 对齐；在新增错误码前，不伪装成功或回退 Stub。

采纳统计至少返回 `pending / accepted / modified / rejected / adoptionRate`：

```text
adoptionRate = (accepted + modified) / (accepted + modified + rejected)
```

分母为零时返回 `null`，并至少按项目与场景过滤。

## 8. 公共层接入申请

ROLE-B 负责：

1. 从 `src/modules/ai/contracts.ts` 提取最小 DTO 和端口到 `src/shared/`；
2. 加入统一的建议读取、生成、处置与审计 Action，其中处置仅 PM；
3. 落一套共享建议/处置表和数据库适配器；
4. 在 `src/app.ts` 显式注入模型、仓储、权限与源数据端口；
5. 注册路由并由需求页 owner 挂载 `AiBreakdownPanel`。

## 9. 当前实现状态

已实现：多场景契约、显式 Stub/API、本地确定性 Stub、需求拆分建议、输入策略、共享记录生命周期、
唯一处置、重放/冲突、应用结果和采纳率统计，以及模块级测试。

尚未完成：公共 shared 提取、数据库持久化、真实权限与 app/routes 接线、真实 #32/#33 联调、外部模型
API、浏览器端到端。上述未完成项不得用内存仓储或 Stub 冒充通过。
