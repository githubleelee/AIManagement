# US-02 / T2 接入说明

> **⚠ 历史快照（勿当作现状）**
> - 适用时间：2026-09-20；当时基点：`main` 上的 US-02 集成分支。
> - 本文记录的是 **US-02 接入当时的验证结果**，其中「US-05 尚未进入 `main`」等表述已被后续提交取代。
> - 当前集成状态与验收证据以 [`docs/sprint1-current-status.md`](sprint1-current-status.md) 为准；本文只作为历史过程来源保留。

本分支已重新对齐 2026-09-20 的最新 `main`，保留旧版 US-02 的权限与敏感可见逻辑，并完成与认证、US-01、US-03、T0.5/T0-06 的冲突整合：

- `src/modules/authz/permissions.ts`：`can()` 直接查对象、成员关系与敏感白名单；`visibilityScope()` 返回数据库查询可直接使用的可见 id 子集。
- `src/modules/authz/plugin.ts`、`sensitivity.ts`：故事和任务敏感设置的 PUT 端点，名单全量覆盖，成员校验、状态变更和 `AuditLog` 同事务写入。关闭敏感时保留旧名单。
- `src/routes.ts`：注册敏感设置路由。
- `src/modules/project/service.ts`：角色变更与成员移除和对应 `AuditLog` 在同一事务完成。
- `web/src/pages/SensitivityEditor.tsx`：敏感开关及成员选择器统一使用 `apiFetch`，兼容最新的 `/api` 代理和登录令牌机制。
- `web/src/pages/RequirementDetailPage.tsx`：故事敏感开关已从进程内假数据切换到端点 23。
- `src/modules/authz/sensitivity.http.test.ts`：通过真实 `buildApp` 和临时 SQLite 测试鉴权、即时撤权、敏感列表过滤及审计。

## 跨模块接入

1. US-01 的角色编辑与成员删除审计已接入并有 HTTP 测试覆盖。
2. US-03 层级树已经复用 `visibilityScope()`，未授权成员在查询层看不到敏感故事，父级目标与活动保留。
3. ~~US-05 尚未进入 `main`~~（历史表述，已被取代：US-05 后端端点 24–29 已进入 `main`，任务读取路径已接入 `can()` / `visibilityScope()`；现状见当前状态表）。任务敏感设置端点和权限判断当时已经可用，任务列表、详情、计数及按负责人过滤在 T5 合入时复用。

## 验证结果

- `npm run typecheck`：通过。
- `npm test -- --run --maxWorkers=1 --minWorkers=1`：29 个测试文件、745 个测试全部通过。
- `npm run build`：服务端与 Web 生产构建均通过。

本分支不修改冻结的数据库 schema 或共享类型。由于 T5 尚未合入，任务读取路径的过滤仍是明确的跨模块待接入项，不能冒充已经完成。
