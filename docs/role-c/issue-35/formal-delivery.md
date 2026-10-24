# UML评审修正与正式组合验收（2026-10-24）

## 交付和边界

- UML约束/纯映射测试源码提交：9456f2b（110项HTTP/schema/authz全部通过；新增5项约束HTTP+5项wire往返，无mock业务）。0e21041扩充隐藏任务hash用例；后续fixture修正和退出诊断在本分支及组合分支同步。
- 完整可验收候选：`feat/C-attachment-consumers`，业务/证据提交 **dba8f71aa0204da4d0e5c2742bea682d02ca2cd4**。它已合入上述UML修正、B附件公共候选f516b20和main90f0754，含用户授权C窗口的TaskSection最小锚点补丁；不把尚无该锚点的UML单分支冒充完整组合。
- 优先由B整合完整组合分支，避免只cherry-pick消费者最后一笔而漏掉UML祖先修正；没有由C改main/代合PR。

## 正式证据（不再停在dev HTML入口）

在实际ProjectLayout导航、正式`/projects/:projectId/uml`和真实鉴权/SQLite/文件系统组合上完成 **16项Chromium检查**（23.37秒、exit0），两类图创建/编辑/保存/刷新，四类关联与草稿，后置标敏真实setter+白名单拒绝，实际任务链接跳转滚动+焦点、刷新深链、同页hash、前进后退及不可见/未知hash不额外请求全部有断言。

- [完整报告/命令范围/失败保留](https://github.com/githubleelee/AIManagement/blob/dba8f71aa0204da4d0e5c2742bea682d02ca2cd4/docs/role-c/issue-36/delivery.md)
- [正式浏览器JSON/HTTP状态/请求路径](https://github.com/githubleelee/AIManagement/blob/dba8f71aa0204da4d0e5c2742bea682d02ca2cd4/docs/role-c/issue-35/evidence/formal/integration-browser-results.json)
- [真实任务行聚焦截图](https://github.com/githubleelee/AIManagement/blob/dba8f71aa0204da4d0e5c2742bea682d02ca2cd4/docs/role-c/issue-35/evidence/formal/formal-task-anchor.png)
- [VIEWER隐藏hash截图](https://github.com/githubleelee/AIManagement/blob/dba8f71aa0204da4d0e5c2742bea682d02ca2cd4/docs/role-c/issue-35/evidence/formal/formal-hidden-anchor.png)
- [组合退出0日志](https://github.com/githubleelee/AIManagement/blob/dba8f71aa0204da4d0e5c2742bea682d02ca2cd4/docs/role-c/issue-36/evidence/uml-formal-browser-diagnostic.txt)

只使用独占迁移测试SQLite和mkdtemp上传根目录，无API route mocks或生产fallback注册，未触碰真实DB、.env或var/uploads。

## 明确不冒称完成

- 组合联合测试出现Vitest JSON的success=true/exit1/106 passed且4 pending不一致，原始报告/失败日志保留；仅受影响文件独立复核54项通过，不能累加冒充“组合110一次全绿”。UML独立worktree先前110项确有完整exit0报告。
- 一次浏览器连接重置的根因未证明；增添fixture退出/stderr诊断后的完整16项通过不等于已修复环境不稳定。VIEWER测试首次因仅切token+hash保留PM React树的fixture错误已改为reload真实AuthContext，未放松断言。
- 不可重建的已失关联旧图历史仍无全覆盖保护证明，须B/负责人按未知历史口径收口，不把当前可见关联当可靠历史。LOW计时差异为既知非阻断项。
- **FS已纠正**：main已包含cc67e33，acceptance/service.ts:287实际调用assertCanEnterDoing，不再把A FS列待交付。排程由另一C会话单写，本会话不碰。

本批源码和正式证据可提交B复核；不将上述范围冒称全库绿、全工单验收通过或历史风险已关闭。旧AI记录/原有未提交文档保留。
