# ROLE-D → ROLE-B：#36 公共接入申请

接口核对源：`docs/role-d/ROLE-D-ATTACH-interface-protocol.md`。

请 ROLE-B 按公共文件单写规则分批完成：

1. 新增附件元数据表、迁移和数据库仓储适配器；
2. 提供统一权限适配器：WRITE 复用 task.progress（PM/有能力的任务负责人），其他可见成员只读，不可见任务和 outsider 返回统一 404；
3. 在 `src/app.ts` 注入附件依赖，在 `src/routes.ts` 注册四条附件路由；
4. 在 `.gitignore` 忽略项目根 `var/uploads/`，不得把该目录注册为公开静态目录；
5. 由 C 在任务删除事务内经 B 注入端口标 DELETING，提交后触发 B 状态扫描清理，任务删除失败时不得先删实体；
6. 在 `web/src/pages/task/TaskSection.tsx` 最小挂载 `TaskAttachmentPanel`。

2026-10-23 评审更新：

- SetNull 后不再按旧 taskId 查找附件，移除模块旧删除后回调；
- B 负责窄生命周期端口、状态扫描和启动/30秒失败重试，异常须可观察；
- 完整列表不截断200，不新增分页。

请勿采用“先删文件，再尝试删任务”的顺序。

本申请不授权 ROLE-D 修改 `src/shared/*`、schema/迁移、权限实现、`src/app.ts`、`src/routes.ts`、`.gitignore`、任务后端或前端公共骨架，也不表示数据库持久化、任务删除联动和浏览器端到端验收已经完成。
