# ROLE-D → ROLE-B：#34 公共接入申请

接口核对源：`docs/role-d/ROLE-D-US14-interface-protocol.md`。

请 ROLE-B 按公共文件单写规则分批完成：

1. 在 schema/迁移中新增通知表，以 `dedupeKey` 建唯一约束，并提供数据库仓储适配器；
2. 显式适配 #37 注册端口与通知专用提交后消费桥接，透传 handler 的消费结果和 health()/sourceCapabilities，在应用生命周期调用 start/stop；
3. 在 `src/app.ts` 注入仓储和接收者解析器，在 `src/routes.ts` 注册三条通知路由；
4. 在 `web/src/layouts/AppLayout.tsx` 最小挂载 `NotificationBell`；
5. 协调各生产方在业务写成功后发布对应事件，并落实逾期次日 00:00、里程碑当日 09:00 的 `Asia/Shanghai` 调度。

需要 B/A/C/D 共同核对：

- 接收者只从权威业务数据解析，不信任事件 payload；
- 敏感通知只存对象引用，不保存标题、摘要或用户信息；
- 列表/详情/未读计数/条件已读均按 actor + recipient + 当前可见性查询；原受限引用及当前关联都必须考虑；
- listByRecipient 一次快照返回真实 total/unreadCount，最多200项并明示 limit/truncated；
- 逾期事件必须携带可由解析器取得的 `planEnd` 去重依据；
- 公共事件源未接入时列表返回 `state='UNAVAILABLE' / total=null / note`；
- 60 秒口径从 `occurredAt` 到通知 `storedAt`，不是用户打开或阅读时间；
- @提及真实链路证据是后置单向联调项，其余类别可先用模块事件验证本票能力。

按 2026-10-23 B 裁定：首次启用在同事务持久化激活记录并将可见历史事件标为 SKIPPED_BASELINE；以 (consumerId,eventId) 记录消费结果，UNAVAILABLE/抛错不记成功，失败可重试且不堵后续。启动补扫/每10秒定时扫描、消费桥接、目录例外与 DB 过滤由 B 单写。模块验证不替代六类真实联调 AC1/AC2。

本申请不授权 ROLE-D 修改 `src/shared/*`、schema/迁移、`src/app.ts`、`src/routes.ts`、前端公共骨架或其他角色业务模块，也不表示公共接入和端到端联调已经完成。
