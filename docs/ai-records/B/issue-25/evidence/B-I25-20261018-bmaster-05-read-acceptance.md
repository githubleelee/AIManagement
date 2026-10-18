# #25 只读看板验收证据（本地 #17）

- 记录 ID：`B-I25-20261018-bmaster-05`（主控 `bmaster`，会话 `01a14937-8196-76e2-acad-127e782877dd`）
- 分支：`feat/US04-story-board`（基线 main `501b5a0`）；worktree `/home/lee/aim-wt/b-us04`
- 记录时间：2026-10-18 15:00 +08:00
- 环境：Node v24.9.0；`.env` + `npm run db:migrate` + `npm run db:seed`；`dev:server`(3000) + `dev:web`(5173)

## 1. 静态与测试（真实执行）

```text
命令：npm run typecheck
工作目录：/home/lee/aim-wt/b-us04
结果：exit 0

命令：npx vitest run src/modules/board
工作目录：/home/lee/aim-wt/b-us04
结果：1 文件 / 10 用例通过

命令：npm test（全量）
工作目录：/home/lee/aim-wt/b-us04
结果：52 文件 / 1216 用例全部通过（基线 51/1206；本票 +1 文件 / +10 用例）
```

## 2. 夹具数据（**Prisma 脚本写入，非 UI 创建** —— 写路径属 #18 未实现，如实登记）

演示项目 `a975b155-…`（业务目标：交付 / 用户活动：下单）：
- 故事1「浏览商品」`DRAFT`
- 故事2「加入购物车」`PLANNING`
- 故事3「下单支付」`PLANNING`
- 故事4「内部结算（敏感）」`DONE`，`isSensitive`，**无可见行**
- 故事5「敏感需求（已授权）」`DRAFT`，`isSensitive`，可见行 → member1

## 3. 浏览器验证（headless Chromium）

| 场景 | 期望 | 实测 | 截图 |
|---|---|---|---|
| PM 三列 | 列序 `DRAFT → PLANNING → DONE`，标签 待规划 / 规划中 / 已完成，计数 2/2/1 | 一致；范围「全项目」 | `B-I25-20261018-pm-board.png` |
| 卡片字段 | 标题 + 目标/活动路径 + 优先级标签 + 状态徽标；**无敏感标记** | 一致（`业务目标：交付 / 用户活动：下单`、`P0（Must）`） | 同上 |
| MEMBER（member2，敏感未授权） | 范围「可见范围」；敏感故事不出现、不计数 | 待规划 **1**（故事5 被隐藏）、规划中 2、已完成 **0**；页面无「敏感」字样 | `B-I25-20261018-member2-visible-range.png` |
| 空列 | **不合并、不隐藏**，显示空态文案 | 已完成列显示「该状态暂无所见故事。」 | 同上 |
| MEMBER（member1，被指名可见） | 敏感故事可见并计数 | 待规划 **2**（故事1 + 故事5「敏感需求（已授权）」） | — |
| outsider | 404 与「项目不存在」逐字一致 | 页面「项目不存在或无权访问」；`GET /api/projects/:id/board` → 404 `{"code":"NOT_FOUND","message":"项目不存在"}` | — |

## 4. 未做 / 未验证（#18 起）

- **状态写入**（AC2/AC3/AC6 的写部分）：端点 21 `PATCH /stories/:storyId` 的状态调整、`who/when/before/after` 审计、状态事件、跨视图同步 —— 全部属 **#18**，待 **C11**（成员能否改故事状态）与 **C13**（requirement 旧文件具体授权）。
- 敏感计数一致性、越权 403 的**浏览器**验证：本批未做（模块测试已覆盖 MEMBER/VIEWER/outsider 与敏感计数）；页面本批无写操作按钮，故 AC6 的「前端隐藏不算拒绝」待 #18 用真实 HTTP 越权请求验证。
- 夹具为脚本写入，非通过 UI 创建；`truncated`（>200 行）仅模块测试覆盖。
