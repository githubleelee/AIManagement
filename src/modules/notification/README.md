# US-14 站内通知独立模块（#34）

本目录实现通知消费、幂等落库端口、本人列表/详情/已读、显式事件源降级以及 #37 订阅适配。

边界：

- 只做站内通知，不做邮件、短信、企业 IM 或实时推送协议。
- 不修改 `src/shared/*`、Prisma schema/迁移、`src/app.ts`、`src/routes.ts` 或前端骨架。
- 接收者由服务端 `NotificationRecipientResolverPort` 从权威数据解析，不能信任事件 payload。
- 敏感事件强制只保存对象引用，解析器即使返回文案也会被丢弃。
- #37 未接入时返回 `UNAVAILABLE + total=null + note`，不得用空数组或 0 冒充“没有通知”。
- 正式数据库仓储、公共事件端口、运行时注入与顶栏挂载由 ROLE-B 单写接入。

事件映射：

| 通知类型 | 事件名 |
|---|---|
| 分配 | `task.assigned` |
| @提及 | `task.mentioned` |
| 逾期 | `task.overdue` |
| 验收 | `acceptance.submitted/approved/rejected` |
| 风险 | `risk.created/level-raised` |
| 节点 | `milestone.due` |

逾期通知以 `projectId + taskId + planEnd + recipientUserId` 去重；其余类别以
`sourceEventId + recipientUserId` 去重。所有通知记录保存事件发生时间、入库时间、时延以及是否满足
60 秒目标。
