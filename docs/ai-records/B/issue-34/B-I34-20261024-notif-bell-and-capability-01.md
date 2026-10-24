# B-I34-20261024-notif-bell-and-capability-01

- 负责人 / GitHub：githubleelee；角色B；Issue：https://github.com/githubleelee/AIManagement/issues/34（本地 #40/#41 的一部分）
- 工具 / 模型：pi 主控（浏览器走查 + 真实 HTTP/DB 核对），实际版本未记录
- 指令来源：主控依 #40 Done when 与 `docs/frontend-routes.md` §「本轮三个接入点」执行；父记录：[运行时交付](B-I34-20261024-notif-runtime-main-01.md)
- 基线：main `ec4e638`（含 PR #104）→ 本批合入 `cdb39d1`（PR #105 挂载）与 `295e694`（PR #106 能力改判）
- 环境：worktree /home/lee/aim-wt/b-notif-mount 与 b-risk-cap；隔离库 /tmp/notif-bell/dev.db（迁移 + seed）；API 3210（定时器开启，NODE_ENV 未设）、Vite 5280、headless Chromium
- 记录时间：2026-10-24T01:12:00+08:00

## 表 5 摘要

| 序号 | 时间 | AI智能体角色 | 任务场景 | 人类输入摘要 | AI输出要点 | 团队处置及理由 |
|---|---|---|---|---|---|---|
| 1 | 2026-10-24 00:5x–01:0x | B主控 | 顶栏挂载与真实走查 | 按 #40：仅嵌入组件、不接管通知业务 | AppLayout 顶栏渲染 NotificationBell；PM 登录见未读 2，面板含真实逾期+风险通知与未接来源 UNAVAILABLE；点第一条未读 2→1 且 DB `isRead/readAt` 落库；typecheck/build:web 均 0 | 待确认；文档同步三个端点与"未接来源必须如实展示" |
| 2 | 同批 | B主控 | `risk.created` 能力改判 | 走查发现面板同时出现真实"新增风险"通知与"风险新建：未接入"说明，自相矛盾 | 真实链路已通（risk.created 事件 → 桥接 → 2 条通知行，latency≈1.4s、withinDeliveryTarget=1，账本 DELIVERED），故如实改判 AVAILABLE；真实 HTTP 复核 9 项能力清单；测试 5 文件 61 例通过 | 待确认；只改该项，其余六项保持 UNAVAILABLE |

## 实际步骤与证据

1. **挂载**（PR #105，2 文件 +6/−1）：`web/src/layouts/AppLayout.tsx` 顶栏右侧 `<NotificationBell/>`；`docs/frontend-routes.md` 补充入口与 `GET /me/notifications`、`GET /notifications/:notificationId`、`PATCH /notifications/:notificationId/read`，并写明不得展示内部字段。
2. **真实数据准备**：隔离库 seed 后以 PM 建 目标/活动/故事，创建任务（`planEnd=2026-10-21`、owner=member1、acceptor=PM）与风险（owner=member1）。
3. **端到端结果（DB 直读，[db-state](evidence/B-I34-20261024-bell-db-state.txt)）**：真实事件 `risk.created` 与 `task.overdue`（`occurredAt`=planEnd 次日 00:00 上海、`idempotencyKey=task.overdue:<task>:2026-10-21`、sensitive=0）；账本两条 DELIVERED；通知 4 条（每种各 2：任务负责人 + PM）；逾期通知 `latencyMs≈175895352`（约 48.9 小时）且 `withinDeliveryTarget=0`（如实不归零）。
4. **浏览器走查**（[PM 面板](evidence/B-I34-20261024-bell-panel-pm.png)）：顶栏未读数 2；面板列出"任务逾期/已逾期演示任务"、"风险提醒/新增风险"，并逐条列出未接来源的 UNAVAILABLE 说明；点击第一条后 [未读 2→1](evidence/B-I34-20261024-bell-after-read.png)，DB `isRead=1`、`readAt` 落库。
5. **能力改判后复核**（[面板](evidence/B-I34-20261024-bell-panel-after-capability-flip.png)、[9 项清单](evidence/B-I34-20261024-capabilities-after-flip.json)）：`task.overdue`/`milestone.due`/`risk.created` = AVAILABLE；`task.assigned`/`task.mentioned`/`acceptance.submitted`/`acceptance.approved`/`acceptance.rejected`/`risk.level-raised` = UNAVAILABLE 且带诚实说明；`total=2, unreadCount=1`。
6. **命令**：`npm run typecheck` exit 0（[mount](evidence/B-I34-20261024-mount-typecheck.txt)）；`npm run build:web` exit 0（[build](evidence/B-I34-20261024-mount-build-web.txt)）；改判后 `npx vitest run src/db/notification-runtime.test.ts src/db/notification-http.test.ts src/modules/notification` → 5 文件 61 例通过（[tests](evidence/B-I34-20261024-risk-cap-tests.txt)、[typecheck](evidence/B-I34-20261024-risk-cap-typecheck.txt)）。

## 限制

- 里程碑到点（上海 09:00）在深夜窗口无法真实触发；其边界由运行时独立 tester 的注入时钟探针覆盖（08:59:59 不触发 / 09:00:00 触发），本记录不据此声称浏览器端到端已覆盖。
- `task.assigned`、`task.mentioned`、`acceptance.*`、`risk.level-raised` 仍无真实生产方，保持 UNAVAILABLE；**#34 最终 AC1/AC2 不由此勾选**。
- `risk.created` 的改判依据是"生产方已在 + 本运行时端到端验证"，不代表六类送达全部完成。

## 人工复核
- 处置：待确认
