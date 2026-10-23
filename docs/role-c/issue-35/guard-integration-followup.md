<!-- role-c-us15-guard-integrated-followup-v1 -->
## ROLE-C：guard 接入与新基线验证已完成；请确认 P4/P5/任务锚点落地窗口

@githubleelee C 已落实 #24 comment-6315739437 的关联时 guard，不再等待该审批、不重写编辑器。

- 分支 `feat/US15-uml`，本地业务提交 `cefe96c`，已合入 main `0998f626df3459a709370bfb59d938dde77658ed`。**推送因工具自动审核失败尚未执行，请勿假定远端已含此 SHA。**
- 普通空图/普通关联图 MEMBER、VIEWER 可读；写操作仍 PM-only。敏感任务/故事建联在同事务永久置位，解绑/删除/标题/内容/owner/普通关联改动不自动清零；白名单成员也不可读 guard=true 的图。DTO 无新增敏感开关。
- 最新基线：UML HTTP 54 + B schema 25 + authz 9 = **88 passed / 0 todo**；runner 已记录正常完成，外层 WSL 随后报告超时，完整日志保留，未把外层超时说成成功。
- 最新基线真实 API Chromium **9 项通过**（新增普通 VIEWER 只读与敏感建联后解绑仍拒绝/清空旧图草稿）；前后端 typecheck 与 build 均 exit 0。仅隔离合成迁移库、真实 app/plugin/Vite proxy，非生产挂载。

### 请 B 确认仍待完成的正式接线（延续 comment-6295349205）

1. **P4**：`src/routes.ts` 正式注册 `registerUmlRoutes(app, context)`，后端无 `/api` 前缀。
2. **P5**：ProjectLayout 下 `/projects/:projectId/uml`，默认导出 `UmlPage`，`useOutletContext<ProjectView>()`；详情 `?diagram=<id>`；补导航与 `docs/frontend-routes.md`。
3. **AC4**：TaskSection 采用 comment-6282421130 的可见行 hash/聚焦最小 diff 或等价方案。链接 `/projects/:projectId/requirements/:storyId#task-<encodeURIComponent(taskId)>`；未知/非法/不可见 id 不新增请求、不泄漏。

请回复是否采用、具体写窗口及落地 SHA；C 收到后跑正式页面链路、点击精确任务行、刷新深链、同页换 hash 和前进/后退。C 未越权修改上述旧文件；现有证据仍仅证明 task href 正确，不冒充 AC4 已过。

### 仍需安全确认，不把本批当全票完成

“先关联普通对象、后将目标标敏感”不会在当前敏感写点同步 sticky 置位，已实测解绑/删目标/恢复普通后图重新 200，另向 #24 登记精确反例和写点确认。此边界落地前不宣称 AC5 全生命周期通过、不建议将当前分支当安全上线完成。

证据入口：`docs/role-c/issue-35/guard-progress.md`。对象关联仍为真实 ID 输入，选择器易用性尚未完善；补充图片上传/高级 UML/业务事件接线均未扩围。未合 PR、未关 Issue、未勾整票 AC。
