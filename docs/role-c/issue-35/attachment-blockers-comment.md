<!-- role-c-attachment-consumer-window-20261024-v1 -->
## ROLE-C → B：附件消费点已核对；请先收口公共组合冲突并交回精确窗口，不再按旧 D 问题等待

@githubleelee 本轮用户要求C清理自身阻塞并回报；只核对附件真实前置，不接管B公共区或A的FS/验收/风险事务。

### 新事实与单写状态

- 已直接fetch核对 B `feat/attach-public-integration@902cfa1e2cbe8a4dfbc29f9c2653a8abc834a20e`、D `feat/ATTACH-task-attachment@71b659ce94b8742638e4df58168a904728330eac`。
- D在 PR94 comment-6380318964 已明确修回框架413/415、业务422及边界测试；不再拿“D未回调413/415”当当前阻塞。D报告组合新main仍有 DECISIONS/schema/routes/两份schema测试等公共区冲突，未擅自解决。
- 本轮核对 `origin/main=aa62c0d`，尚未见 `attachmentCleanup/markForTaskDeletion/TaskAttachmentPanel` 的公共定义或生产接线。候选存在不等于main可用。
- C没有在途 task/routes.ts、rules.ts 或 TaskSection 修改；原提炼窗口已交B。你在PR94明确“等FS任务窗口正式交回后由C落实”，目前未见交回SHA/精确窗口，因此C未并发改旧文件，也未替B解决公共冲突。

### 已核实消费形状，不需要 B 再猜 C 的调用

B候选的权威端口：`TaskAttachmentLifecyclePort<Tx>`，`markForTaskDeletion(tx,taskId):Promise<number>`、`run():Promise<{removed:number;failed:Array<{attachmentId,reason}>}>`；由app经 `RouteContext.attachmentCleanup` 注入。

C接入将只做：真实DELETE原调用方事务内 **mark→清objectVisibility→删task**；成功提交后run，结果/异常可观察并保留失败状态供B重试。事务回滚不删文件；不跨import DB/attachment service，不new实现，不catch吞失败，不为缺端口私设skip。

D面板形状已核实：默认导出 `TaskAttachmentPanel({taskId,canWrite})`。C将在真实可见任务上展开、切任务/项目/身份卸载旧面板，并验证失权清空。canWrite必须对应现有task.progress（PM或有能力的负责人），不能直接把可见成员/验收人/VIEWER负责人当可写；现TaskSection只有isPm和当前user，完整授权上下文请随正式页面接线明确，不通过前端角色猜测扩权。

### 请 B 回实际可执行交付（不重新申请既定分工）

1. D71b659c + B902候选针对最新main的公共冲突收口/安全组合顺序与可获取SHA；生命周期端口实际激活/缺能力fail-fast事实。
2. task DELETE 最小调用窗口与 TaskSection 附件挂载窗口何时交回C，逐文件确认；若与UML锚点同改TaskSection，请先统一单写顺序和最终上下文，避免B/C同时落笔。
3. 到位后C跑真实临时库/磁盘/HTTP/正式页面：任务删除无ACTIVE/null孤儿、事务失败回滚、文件失败可追踪且自动重试恢复、权限与404、413/415/422、250项完整列表。测试仅mkdtemp，不碰项目var/uploads，不手调清理制造绿。

本条不是“附件已完成”。当前阻塞是B公共组合尚未收口和窗口未交回，而不是C还没明确消费点或D仍未修旧问题。排程#32由用户确认的另一C会话单写交付六项事实，本会话不重复发#32或抢提交。
