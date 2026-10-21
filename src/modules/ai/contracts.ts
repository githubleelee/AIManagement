/**
 * ROLE-D AI 契约的**转发**文件（公共接入后，唯一权威定义已上提到 `src/shared/ai.ts`）。
 *
 * 依据：`docs/role-d/ROLE-D-US11-public-integration-request.md` 第 1 项、
 * `DECISIONS.md` `arch.shared-ports-and-assembly`（公共 AI 类型与端口放 `src/shared/`）。
 *
 * 本文件**只做 re-export**，不再持有任何定义 —— 避免 shared 与模块各留一份会漂移的类型。
 * D 的 `service.ts` / `factory.ts` / `in-memory-repository.ts` / `schemas.ts` / `plugin.ts`
 * 继续 `import … from './contracts.js'`，经此处解析到 `src/shared/ai.ts`，实现零改动。
 *
 * 字段名与语义与提取前逐字一致；新增项均为**向后兼容的可选扩展**或纯增量：
 *   - `AiResourceRef.populationBasis?`、`AiSuggestionQuery.actorUserId?` / `limit?`
 *     （可选，由调用方 / 组装层注入，供 DB 仓储做查询层可见性过滤与行数上限）；
 *   - `AiSuggestionRepository` 各写方法的可选 `transaction?`；
 *   - 增量：`AiDomainFailureCode`、`canonicalAiJsonDigest`、`AI_SUGGESTION_LIST_LIMIT`、
 *     `AiSuggestionListResult`、`AiApplicationPatch` / `AiApplicationExpectedStatus`。
 */
export * from '../../shared/ai.js'
