# US-11 公共冻结区整合申请

关联 Issue：#31；申请方：ROLE-D。

本文件只描述需由负责人合入的公共改动。角色 D 分支没有直接修改下列冻结文件。

## 1. 需要负责人确认的业务规则

1. 人工采纳后，拆解结果最终写成“任务”“用户故事”还是“验收标准”。
2. PM / MEMBER / VIEWER 对 `read / generate / dispose / audit` 四种 AI Action 的精确矩阵；
   `dispose` 按负责人决策仅 PM。
3. 是否允许已书面批准、已脱敏的数据进入其他本地模型；未批准时继续拒绝敏感对象。

在上述第 1 项确认前，当前实现只记录审核结论，应用状态为 `PENDING_INTEGRATION`，
不会自动创建任务或修改需求。

## 2. `src/shared/` 申请

建议由技术负责人从 `src/modules/ai/contracts.ts` 提取以下跨模块最小接口：

- `AiScenario`
- `AiProviderDescriptor`
- `AiInvocationContext` / `AiDataClassification`
- `AiGenerationRequest` / `AiGenerationResult`
- `AiModelPort`
- `AiPortErrorCode`（是否提升为公共错误类型由 B 核对）
- `AiInputScope`
- `AiSuggestionRecord` 中供 A/C 读取的公共视图

A（#33）和 C（#32）只调用公共 `AiModelPort`，不 import 或调用 D 的 service。

## 3. 权限模块申请

由权限负责人为现有唯一鉴权入口增加并实现：

- `ai.suggestion.read`
- `ai.suggestion.generate`
- `ai.suggestion.dispose`
- `ai.suggestion.audit`

并提供 `AiAuthorizationPort` 适配器。当前模块测试中的 PM-only 策略只是测试夹具，
不会进入生产组装，也不作为最终权限规则。

## 4. 数据库申请

建议新增“建议主记录 + 人工审核/应用记录”，字段至少覆盖：

| 类别 | 字段 |
|---|---|
| 来源 | projectId、scenario、sourceObjectType、sourceObjectId |
| 生成 | inputScope、modelProvider、modelName、modelVersion、execution、generatedByUserId、generatedAt |
| 内容 | suggestion、status |
| 处置 | dispositionRequestId、contentDigest、disposedByUserId、disposedAt、decision、reason、modification |
| 应用 | applicationStatus、appliedByUserId、appliedAt、resultSummary、targetReferences |

SQLite 下结构化对象可先按 JSON 字符串存储，但必须在模块仓储适配器中统一序列化/校验，
不得由每条路由自行拼 JSON。迁移需由 schema 唯一修改人按顺序合入。

## 5. 路由和 app 组装申请

- `src/routes.ts`：由唯一修改人注册 `registerAiRoutes`。
- `src/app.ts`：调用 `createAiBreakdownService()`，注入权限端口、数据库仓储和只读故事来源。
- 本轮显式传入 `{ mode: 'LOCAL_STUB' }`；外部模式必须显式注入 adapter，配置错误直接失败，禁止 API 失败时静默降级为桩。

## 6. 前端挂载申请

由需求页 owner 在 `web/src/pages/RequirementDetailPage.tsx` 最小挂载：

```tsx
<AiBreakdownPanel
  projectId={project.id}
  storyId={story.id}
  canRead={/* 权限适配结果 */}
  canGenerate={/* 权限适配结果 */}
  canReview={/* dispose 权限适配结果；仅 PM */}
/>
```

组件位于 `web/src/pages/ai/AiBreakdownPanel.tsx`。挂载时不得把前端布尔值当成服务端鉴权；
三个接口仍必须经过服务端权限端口。

## 7. 整合后的验收补项

- 数据库重启后建议、审核和应用记录仍存在；
- MEMBER / VIEWER 权限按负责人矩阵逐项验证，outsider 返回不泄漏的 404；
- 真实浏览器走通“生成 → 修改/采纳/拒绝 → 查看审计”；
- 只有人工采纳后才调用正式写入事务；事务失败必须记录 `FAILED`，不能部分写入；
- 用出站探针证明本地 Stub 零网络请求，敏感需求默认零模型调用；
- 全量 `npm test`、`npm run typecheck`、`npm run build` 通过。
