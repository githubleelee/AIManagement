<!-- role-c-attachment-consumers-delivered-20261024-v1 -->
## ROLE-C → B：#36 两处消费点已交付，附完整组合证据

@githubleelee 已按 #36 comment-6382747647 与 #120 comment6382741186 的分解直接落码，不再等 #32、不再等第二次窗口。

- 分支：[feat/C-attachment-consumers](https://github.com/githubleelee/AIManagement/tree/feat/C-attachment-consumers)
- 精确交付 SHA：**`fb4fe3089a561af217b093698bdaf45e1d95511a`**（已正常 push，`ls-remote` 独立核对一致）
- 基线：B 候选 `f516b20` + 最新 main `d898cdd`；组合落点 `0f13a3e`，本批测试/证据为 `fb4fe30`

### 两处消费点（只动授权窗口内文件）

1. **`src/modules/task/routes.ts`**
   - 注册时取 `context.attachmentCleanup`，缺失即 fail-fast（`任务删除需要已装配的附件生命周期端口`），不做 no-op、不自建实现。
   - 真实 `DELETE /tasks/:id` 改为 callback 事务：`markForTaskDeletion(tx, id)` → `objectVisibility.deleteMany` → `task.delete`。任一步失败整笔回滚，**事务内不碰物理文件**。
   - 提交成功后 `run()`；逐项失败或整体异常只做安全日志（`taskId`、失败计数），返回 204 不变。清理失败保持可观察/可重试，**不把已提交的删除谎报成失败**。
   - 未跨 import DB 适配器/attachment service，未改鉴权、FS、状态机、rules/shared/app/routes。

2. **`web/src/pages/task/TaskSection.tsx`** + 新增 `TaskAttachmentSlot.tsx`
   - 每个真实可见任务有附件展开入口，一次仅挂一个 D 的 `TaskAttachmentPanel`；不改表格列数、任务编辑/验收逻辑。
   - 挂载时用真实 `GET /projects/:id` + `GET /tasks/:id` 现查归属与角色，`canWrite = PM || (MEMBER && 当前用户是负责人)`；**VIEWER 即使是负责人也只读**。页面只控体验，实际上传/下载/删除仍由中央鉴权判定。
   - 切换任务/项目/身份、`focus`/`storage` 变化即卸载旧面板，失权后重新鉴权。
   - 用户额外确认的 UML 最小锚点已并入本窗口（`useLocation` + 可见行匹配后 `scrollIntoView`/`focus`，`id`/`tabIndex`）。未知/非法/不可见 id 不额外请求、不推导权限。

### 实测（都在上面这个 SHA 的组合上）

| 范围 | 结果 |
|---|---|
| 组合全量 17 文件（UML+authz+附件+task 消费+骨架+schema） | **218 passed / 0 failed / 0 todo，84.97 秒，exit 0** |
| 新C 真实 DELETE 生命周期 | 7 passed，exit 0 |
| 新C 上传输入 + 完整列表 | 1 passed（250 次真实上传），exit 0 |
| 正式 TaskSection Chromium | 9 项通过，exit 0 |
| 正式 UML 路由/导航/任务行 Chromium | 16 项通过，exit 0 |
| server/web typecheck、server build、web build | 全部 exit 0 |

关键行为（不是 mock、不是手调清理）：真实上传→DELETE→任务/附件行/磁盘文件同消失；真实 DB 删除 trigger 失败→标记、可见性、任务一起回滚且文件仍在；真实文件删除失败→`CLEANUP_FAILED`+`taskId=null`，恢复磁盘后由**生产 30 秒定时器**自动收尾（未手动 `run()`）；PM 确认删除后任务、元数据、物理文件全清除；VIEWER/非负责人只读、VIEWER 负责人仍只读、敏感撤权后清空并重新拒权、outsider 404。

上传边界按 D 契约实测并纠正过我前两版错误断言：`10,000,001 B → 业务 422 TOO_LONG`，`10,000,002 B → 框架 413`，列表为 `{ total, items }` 且 250 条全返。真实 TCP 客户端超 bodyLimit 会被服务端中断（ECONNRESET），故框架 413 用同一生产 app 实例 `inject` 断言，与 D 自己的插件测试同法，未改产品代码或阈值。

入口：[delivery.md](https://github.com/githubleelee/AIManagement/blob/fb4fe3089a561af217b093698bdaf45e1d95511a/docs/role-c/issue-36/delivery.md)

### 明确边界与仍存风险

- 组合全量绿**不等于全库绿**：本批没跑全库，旧 worker 异常根因仍未证明修复。
- 早期一轮组合运行出现 `success=true / exit1 / 4 pending` 不一致，日志保留；最终组合头已重跑 218 项完整 exit0 并取代该结论。
- 一轮浏览器 POST `ERR_CONNECTION_RESET` 根因未证实；另一轮 fixture 在 `loginAs` 阶段报 SQLite locked，已定位为“先 `listen`（启动真实后台写者）后签会话”，改成先签会话再 `listen`，未改公共 helper、未加掩盖性重试。
- 已失去关联、无可靠历史证据的旧 UML 图仍不能凭当前表宣称全覆盖保护；按既定口径由你/DRI 收口，不默认公开未知历史。
- **FS 已纠正**：`cc67e33` 是 main 祖先，`acceptance/service.ts:287` 实际调用 `assertCanEnterDoing`，不再当待交付项。
- 排程由另一 C 会话单写，本会话未碰其提交，也未代发 #32。

请从 `fb4fe30` 整体接续（不要只 cherry-pick 最后一笔而漏掉 UML 祖先修正）。未合 PR、未关闭 #36、未改 main。
