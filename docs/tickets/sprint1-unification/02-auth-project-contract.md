# 02 — 验收认证、项目隔离与成员权限链路

**What to build:** 登录用户可以按 Sprint 1 契约登录并进入其有权访问的项目；项目成员、角色和非成员访问在前后端行为一致，越权请求得到契约约定的响应。

**Blocked by:** None — can start immediately.

**Status:** done（2026-09-24，`feat/sprint1-wrapup` @ `447c833` + 未提交验收件；本地草稿，尚未发布到工单系统）。

- [x] 核对登录、当前用户和前端令牌/回跳流程的请求响应与错误口径。
- [x] 核对项目创建、列表、详情和成员管理的角色限制及项目隔离。
- [x] 通过 HTTP 接口行为确认服务端强制权限，不能只依赖前端隐藏按钮。
- [x] 发现偏差时增加或修复契约层回归用例，并保留既有断言力度。
- [x] 将验收证据和未解决问题登记到当前状态表。

**验收证据（2026-09-24）：**

- 新增 `test/auth-project-contract.test.ts`（7 例）补齐既有测试的空白分支：认证头形态（非 Bearer / 空 Bearer / 篡改 → 401 `UNAUTHENTICATED`）、MEMBER+VIEWER 对端点 6/8/9 的写权限矩阵（403 `FORBIDDEN` 且零副作用）、端点 6 `role: REQUIRED` 与「直接以 PM 角色添加成员」、MEMBER/VIEWER 对端点 4/5/7 只读与 `myRole`、成员生命周期主链（端点 1→3→6→8→9，含移除后令牌即时失效）。
- 既有 `src/auth/auth.test.ts`（9）、`src/modules/project/project.test.ts`（13）、`project.members.test.ts`（28）、`project.isolation.test.ts`（7）全部复核通过；`LAST_PM`（端点 8）、`SELF_REMOVAL_FORBIDDEN`、`DUPLICATE` 409、`USER_NOT_FOUND` 均由既有用例覆盖。
- 命令：`npx vitest run --no-file-parallelism --testTimeout=30000 test/auth-project-contract.test.ts src/auth/auth.test.ts src/modules/project` → 4 文件 58 例 + 单跑 7 例全通过；`npm run typecheck` 退出码 0。
- 前端令牌/回跳静态核对：`AuthContext` 启动读 `/auth/me`、失败清令牌；`ProtectedRoute` 未登录跳 `/login?redirect=`；`LoginPage.safeRedirect` 仅接受站内绝对路径（防开放重定向）；`apiFetch` 统一 `Authorization: Bearer` 与错误信封。与契约一致（前端无自动化测试，真实浏览器走查归任务 05）。
- **未发现问题，无契约偏差**，未新增/修改生产代码。
- 未解决/已登记：端点 9 的 `LAST_PM` 分支在权限模型下不可达（唯一 PM 只能移除自己，先命中 `SELF_REMOVAL_FORBIDDEN`），属防御性代码、非缺陷；前端链路未经真实浏览器走查（任务 05）。
