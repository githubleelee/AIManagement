/**
 * ROLE-D 事件契约的**转发**文件（公共接入后，唯一权威定义已上提到 `src/shared/events.ts`）。
 *
 * 依据：`docs/role-d/ROLE-D-EVENTS-public-integration-request.md` 第 1 项、
 * `DECISIONS.md` `arch.shared-ports-and-assembly`（公共事件类型与端口放 `src/shared/`）。
 *
 * 本文件**只做 re-export**，不再持有任何定义 —— 避免 shared 与模块各留一份会漂移的类型。
 * D 的 `service.ts` / `factory.ts` / `in-memory-repository.ts` / `validation.ts` 继续
 * `import … from './contracts.js'`，经此处解析到 `src/shared/events.ts`，实现零改动。
 *
 * 字段名与语义与提取前逐字一致；唯一的**新增**是 `EventQuery.actorUserId?`（可选，
 * 由 `src/app.ts` 的公共 query 端口注入，供 DB 仓储做查询层可见性过滤），属向后兼容的
 * 可选扩展，不影响 D 的既有实现与测试。
 */
export * from '../../shared/events.js'
