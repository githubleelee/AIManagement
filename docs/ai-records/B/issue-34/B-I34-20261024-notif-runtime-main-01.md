# B-I34-20261024-notif-runtime-main-01

- 负责人 / GitHub：githubleelee；角色B；Issue：https://github.com/githubleelee/AIManagement/issues/34（本地 #38/#39）
- 工具 / 模型：pi senior-worker（实现）+ pi 主控（裁定与记录），实际版本未记录
- agent：b-notif-runtime；指令来源：主控；归档者：B主控
- 基线：origin/main 3ed5eaa（分支起点）；合入 main `ec4e638a47a335c07c979ae42142c7b4370b3f67`（PR #104）
- 交付 head：`e3d31c56fbb96553b1d79cca82facebe3bbb0080`
- 独立验证：[tester](B-I34-20261024-notif-runtime-verify-01.md)
- 记录时间：2026-10-24T01:10:00+08:00

## 表 5 摘要

| 序号 | 时间 | AI智能体角色 | 任务场景 | 人类输入摘要 | AI输出要点 | 团队处置及理由 |
|---|---|---|---|---|---|---|
| 1 | 精确时刻未记录；本批归档 | B senior-worker | 通知公共运行时实现 | 主控：按四条 `notifications.*` 决策落存储/桥接/定时/装配，不改 D 模块 | 三表+迁移、真实 DB 仓储（查询层可见性含原事件 references）、权威接收者、#37 适配、提交后桥接、B 自产定时、app/routes 装配；定向 129 例 + 真实 listen 探测全过 | 待确认；D 模块零改动 |
| 2 | 同批 | B主控 | D 测试装配裁定 | worker 提问：D `plugin.test.ts` 与真实注册重复 | 采纳 (A) 最小改 `plugin.test.ts` 装配（bare Fastify + 真实 session），禁用 test-only 生产回退 (B)/(C)；断言与用例名不变 | 待确认；这是 B 改公共注册后必须做的测试装配修正，不是改 D 业务实现 |
| 3 | 同批 | B主控 | 定时器开关复核 | — | `autoStartLoops: NODE_ENV !== 'test'`；默认（NODE_ENV 未设）启动；仅当误设 test 才不启动，届时能力如实降级 | 待确认；已在验证记录中标注为配置风险，非代码缺陷 |

## 交付内容

- 迁移 `20261023180000_add_notification_runtime`：`Notification`（`dedupeKey @unique`；`sourceEventId → DomainEvent onDelete: Restrict`；project/recipient Restrict；`(recipientUserId,isRead,storedAt)` 与 `sourceEventId` 索引）、`NotificationConsumer`（`activatedDay` 上海自然日）、`NotificationConsumption`（`(consumerId,eventId)` 唯一账本）。
- `src/db/notification-repository.ts`：`appendIfAbsent` 先核对原事件存在与 projectId/eventName/object 归属（拒绝伪造/缺失），P2002 鸭子判断 → DUPLICATE；`listByRecipient` 单条 SQL 快照（items/total/unreadCount/limit/truncated，limit 上限 200）；`markRead` 条件 UPDATE + `COALESCE` 保留首次 readAt。可见性在同一 SQL 内校验：收件人、当前成员/owner、来源事件存在且归属一致、敏感原 `payload.references` 全部引用可见（`json_each`）、当前业务关联（task/story/Risk.taskId/Milestone→TaskMilestone）可见。
- `src/db/notification-consumer-store.ts`：首次启用同事务写激活记录 + 既有支持事件 `SKIPPED_BASELINE`；`(consumerId,eventId)` 账本仅 `DELIVERED` 落账。
- `src/db/notification-event-source.ts`：显式适配 #37 订阅（真实 disposer、动态 health、逐事件能力）；无订阅者时显式报错而非 no-op。
- `src/db/notification-bridge.ts`：提交后分批读取已提交事件、复用同一 handler；UNAVAILABLE/异常不落账本可重试；单条失败不阻塞后续。
- `src/db/notification-scheduler.ts`：`task.overdue`（planEnd 次日 00:00 上海、非 CLOSED 含 DONE、occurredAt=条件成立时间、启动补扫）与 `milestone.due`（dueDate 当日 09:00、只补启用日及之后）；确定性幂等键含计划日期；10s 扫描、同实例不重叠、关闭停止。
- `src/db/notification-recipient-resolver.ts`：权威 Task.ownerUserId/acceptorUserId、Risk.ownerUserId、Milestone 负责人/PM；成员与对象可见性过滤；逾期 `dedupeDiscriminator = planEnd`；不信任 payload 接收者/正文；`task.mentioned` 与未接来源 UNAVAILABLE。
- 组装：`src/app.ts` 与事件基础设施共用同一 `PrismaEventRepository`，`onReady/onClose` 驱动 start/stop，启动失败 log 后抛出；`src/routes.ts` 注册 D 的 `registerNotificationRoutes`，缺 service 同步 fail-fast（无 hasRoute/skip/默认回退）。

## 测试装配修正（披露）

- `src/modules/notification/plugin.test.ts`（+89/−7）：改 bare Fastify + `registerErrorHandler` + 真实 `sessionTokenHash` 走 `requireAuth`；用例名与断言与 main 版一致（401 / 列表 / 已读+unreadOnly / 非接收者读写同形 404 / 非法 422），**未伪造 actorUserId、未削弱覆盖**（独立 tester 逐条核对）。
- `test/error-handler.test.ts`（+7/−1）：注入临时库（`buildApp` 现在 `onReady` 会写激活记录）。
- `test/db-schema*.test.ts`：表集合 16→19 的等值断言同步。

## 限制

- 六类真实生产证据未齐：`task.assigned`/`task.mentioned`/`acceptance.*`/`risk.level-raised` 生产方未接；`risk.created` 在本批保守标 UNAVAILABLE，随后由 PR #106 改判（见 [bell/capability 记录](B-I34-20261024-notif-bell-and-capability-01.md)）。
- 未跑全量（合并后由主控跑）；未含顶栏挂载（单独 PR #105）。
- 运维约束：部署不得设 `NODE_ENV=test`，否则定时生产静默不启动（能力会如实降级而非伪造）。

## 人工复核
- 处置：待确认
