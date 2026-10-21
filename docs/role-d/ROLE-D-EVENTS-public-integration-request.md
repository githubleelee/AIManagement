# ROLE-D → ROLE-B：#37 公共接入申请

接口核对源：`docs/role-d/ROLE-D-EVENTS-interface-protocol.md`。

请 ROLE-B 按公共文件单写规则分批完成：

1. 从 `src/modules/events/contracts.ts` 提取最小事件信封与发布、订阅、查询、重放、生命周期端口；
2. 落事件表及唯一索引 `(projectId, eventName, idempotencyKey)`；
3. 提供数据库仓储适配器，并在 `src/app.ts` 注入 ROLE-D 的独立事件实现；
4. 在应用启动/停止时调用事件基础设施生命周期；
5. 各业务域只依赖 shared publisher，自己生产领域事件，不调用 D 的 service。

需要 B/A/C 核对：

- 接受重复 `publish()` 只去重、不自动重投；主动恢复调用 `redeliver(eventId)`；
- 接受订阅失败不回滚已提交业务，领域生产者记录集成失败证据；
- 接受当前无 outbox 时“业务提交后、事件存储前崩溃不可自动恢复”的明确限制；
- 接受消费方按 `event.id` 保证自身副作用幂等；
- 如需持久化 delivery 状态、自动重试或 outbox，另立字段、迁移与运行任务，不从本票隐式扩大。

本申请不授权 ROLE-D 修改 `src/shared/*`、schema/迁移、authz、`src/app.ts`、`src/routes.ts`，也
不表示公共接入或真实业务联调已完成。
