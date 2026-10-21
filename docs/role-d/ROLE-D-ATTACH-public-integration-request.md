# ROLE-D → ROLE-B：#36 公共接入申请

接口核对源：`docs/role-d/ROLE-D-ATTACH-interface-protocol.md`。

请 ROLE-B 按公共文件单写规则分批完成：

1. 新增附件元数据表、迁移和数据库仓储适配器；
2. 提供统一权限适配器：PM/MEMBER 可写，VIEWER 只读，不可见任务和 outsider 返回 404；
3. 在 `src/app.ts` 注入附件依赖，在 `src/routes.ts` 注册四条附件路由；
4. 在 `.gitignore` 忽略项目根 `var/uploads/`，不得把该目录注册为公开静态目录；
5. 在任务成功删除后接清理回调或同等 cleanup job，任务删除失败时不得先删实体；
6. 在 `web/src/pages/task/TaskSection.tsx` 最小挂载 `TaskAttachmentPanel`。

需要 B 明确一个数据库实现选择：

- 若 Attachment 随 Task 级联删除，必须在同一事务留下独立 cleanup job，否则实体删除失败无法追踪；
- 若 Attachment 记录保留到实体清理成功，则其关系不能阻止任务提交删除，后台需重试 `CLEANUP_FAILED`。

两种方案均可适配现有 D 端口；请勿采用“先删文件，再尝试删任务”的顺序。

本申请不授权 ROLE-D 修改 `src/shared/*`、schema/迁移、权限实现、`src/app.ts`、`src/routes.ts`、`.gitignore`、任务后端或前端公共骨架，也不表示数据库持久化、任务删除联动和浏览器端到端验收已经完成。
