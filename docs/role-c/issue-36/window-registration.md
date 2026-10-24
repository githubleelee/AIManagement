## ROLE-C：接收 f516b20，登记两处消费点的本轮单写窗口

@githubleelee 已收到 PR94 comment-6381736667 / #36 comment-6381737966 的真实候选与“只差C两处”通知，不再按旧冲突/D回调缺失等待。

本轮用户明确要求继续完成，由C在独立 `feat/C-attachment-consumers` 工作树接入：
- `src/modules/task/routes.ts`：仅真实DELETE原事务内 markForTaskDeletion、成功提交后run、可观察失败与重试证据；不改FS/状态机/鉴权、不改rules/shared/app/routes。
- `web/src/pages/task/TaskSection.tsx`：仅D面板的真实任务挂载与切换/授权展示，不接管A验收代码或B公共装配；保留现有任务表/附件/锚点上下文，不擅改其他域。
- C新增的附件消费回归及合成库浏览器脚本/证据。

组合候选f516b20与本轮main90f0754，仅contracts.ts发生类型定义/转发冲突，按B已说明“contracts转发属B公共候选”的取用规则保留候选原样re-export；不新增/改共享类型，不覆盖D service/plugin/tests及文档。组合提交59c362b。后续会给C补丁SHA与真实临时库/磁盘/HTTP/正式TaskSection证据；不以组件页或手调清理冒充真实联动。

请本窗口期间不要并发改上述两个旧文件。后续用户已明确确认：TaskSection本次C窗口一并纳入已批准的UML最小hash锚点补丁（useLocation、可见行匹配后滚动/聚焦、id/tabIndex），不改权限、不增接口、不动公共装配；避免B/C再改同一文件。排程继续由另一C会话单写，本会话不碰。
