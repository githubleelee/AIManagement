# #27 验收证据（本地 #08）

- 记录 ID：`B-I27-20261018-bmaster-08`（主控 `bmaster`，会话 `01a14937-8196-76e2-acad-127e782877dd`）
- 分支：`feat/US07-member-workload`（基线 main `7758541`）；worktree `/home/lee/aim-wt/b-us07`
- 记录时间：2026-10-18 12:35 +08:00
- 环境：本机 Node v24.9.0 / npm 11.6.0；`.env` 由 `.env.example` 复制；`npm run db:migrate` + `npm run db:seed` 成功；`dev:server`(3000) + `dev:web`(5173) 已启动

## 1. 静态与模块测试（真实执行）

```text
命令：npm run typecheck
工作目录：/home/lee/aim-wt/b-us07
结果：exit 0（tsc -p tsconfig.json --noEmit && tsc -p web/tsconfig.json --noEmit）

命令：npx vitest run src/modules/workload
工作目录：/home/lee/aim-wt/b-us07
结果：1 文件 / 11 用例全部通过（PM 全项目标签与非 CLOSED 计数含 DONE、零任务成员 0、未登录 401、
      MEMBER 可见范围与敏感排除、被指名敏感可见、VIEWER 同口径、outsider/外项目/不存在 404 逐字一致、
      详情目标非成员 404、跨项目不混入、total 精确 + planEnd/createdAt 排序、超上限截断且 total 仍精确）

命令：npm test（全量回归）
工作目录：/home/lee/aim-wt/b-us07
结果：50 文件 / 1193 用例全部通过（基线为 49 文件 / 1182；本票 +1 文件 / +11 用例）
```

## 2. 浏览器验证（headless Chromium，`http://localhost:5173`，seed 账号）

**夹具数据（由 Prisma 脚本写入，非 UI 创建 —— 如实登记）**：演示项目 `7201a0ae-…`
- pm：`PM-待办任务`(TODO)、`PM-已提交待验收`(DONE)、`PM-已验收关闭`(CLOSED)
- member1：`李工-进行中`(DOING)、`李工-已提交待验收`(DONE)、`李工-敏感任务（已授权可见）`(TODO, isSensitive, ObjectVisibility→member1)
- member2：`张工-阻塞中`(BLOCKED)、`张工-敏感任务（未授权）`(DOING, isSensitive, 无可见行)
- viewer1：无任务

| 场景 | 操作 | 结果 | 截图 |
|---|---|---|---|
| PM 总览 | 以 `pm` 登录 → `/projects/:id/workload` | 范围标签「全项目」；计数 刘总 0 / 张工 2 / 李工 3 / 王经理 2；左导航出现「成员负载」 | — |
| PM 成员详情 | 点击「李工」 | 「3 条未关闭任务」；`李工-已提交待验收` 显示 **「已提交待验收」**（DONE ≠ 已完成/关闭）；敏感任务（已授权）出现；CLOSED 任务不出现；按 `planEnd` 升序 | `B-I27-20261018-pm-workload-detail.png` |
| MEMBER 可见范围 | 以 `member1` 登录 → 同一页 | 范围标签「**可见范围**」；计数 刘总 0 / **张工 1**（未授权敏感任务被排除）/ 李工 3 / 王经理 2 | `B-I27-20261018-member1-visible-range.png` |
| outsider | 以 `outsider` 登录 → 同一 URL | 页面显示「**项目不存在或无权访问**」（与项目不存在一致，不泄漏存在性） | `B-I27-20261018-outsider-denied.png` |

**HTTP 层探测（浏览器会话内 fetch，带会话 token）**

```text
PM  GET /api/projects/:id/workload
    → 200 basis={"scopeLabel":"全项目"}；members 字段恰为 userId/role/account/displayName/joinedAt/openTaskCount
PM  GET /api/projects/:id/workload/:member1Id
    → 200 total=3 truncated=false；items 字段恰为 id/title/status/planStart/planEnd/progress（不含 isSensitive）
PM  GET /api/projects/:id/workload/:outsiderId（非本项目成员）
    → 404 {"code":"NOT_FOUND","message":"项目不存在"}（与不存在项目逐字一致）
outsider GET /api/projects/:id/workload 与 .../workload/:outsiderId
    → 404，响应体与「项目不存在」逐字一致
```

**与个人工作台同账号同授权核对（AC3）**

```text
PM  GET /api/me/workbench → blocks.todo.total = 2
    workload 中 pm 行 openTaskCount = 2
    ⇒ 同一 actor、同一「非 CLOSED」谓词下一致（未把工作台五块相加、未用截断明细推计数）
```

## 3. 未验证 / 边界（不冒充）

- **VIEWER 浏览器走查**未单独做（角色口径已由模块测试覆盖：可见范围 + 只读）；如需补，可后续以 `viewer1` 再走一次。
- **AI 子集**：本票不含 AI 端点（设计 §5：AI 消费由 C 侧另行排敏感 + 最小字段投影），故「AI 子集不冒充全局基数」在本票无运行对象，登记为 N/A。
- **>200 行截断**仅在模块测试中覆盖（`truncated=true`、`total` 精确），未造 200+ 行夹具做浏览器验证。
- **响应式/移动端**未验证（本票不做）。
- 夹具数据为脚本写入，非通过 UI 创建；页面「计数与清单一致」是拿同一 `where` 的 count 与列表对照（模块测试 + 上表 total=3 与 3 行明细）。
