# Sprint 1 当前实现状态表（单一状态入口）

| 项目 | 内容 |
|---|---|
| 文档类型 | **当前状态（唯一维护入口）** —— 记录 Sprint 1 各故事、端点、页面、分支与验收证据的现状 |
| 盘点日期 | 2026-09-24 |
| 盘点分支 | `feat/sprint1-wrapup` @ `447c833`（+ 本轮任务 02/03/04 与阶段 A 的未提交改动） |
| 主干 | `main`（= `origin/main`）@ `cb2670e` |
| 维护人 | 协调 AI（唯一维护人；其他人只读，变更走「提出 → 确认 → 单人修改 → 通知」） |
| 权威关系 | **行为权威**：`docs/sprint1-spec-interface-contract.md`。**集成进度权威**：本文件。**前端约定**：`docs/frontend-routes.md`（约定部分）。 |

> **维护规则**：每次更新必须在本文件末尾「变更记录」追加一行，标注日期、分支、提交。不得用本文件替代接口契约做行为判定；本文件只回答「做到哪、在哪个分支、有没有验收」。

## 0. 文档分类（先分清冻结 / 历史 / 当前）

| 类别 | 文件 | 说明 |
|---|---|---|
| **冻结契约 / 基线** | `docs/sprint1-spec-interface-contract.md`、`docs/sprint1-baseline.md` | Sprint 1 的设计决策依据，不冒充当前实现快照。 |
| **历史快照** | `docs/T2-integration.md`、`docs/tickets-t5-task-management.md`、`docs/us-03-frontend-findings.md`、`docs/experiment2-reflection-external-input.md`、`docs/ai-interaction-log.md`（表5，只追加） | 保留原始过程与当时的验证结果；标题已标注适用时间/提交。 |
| **当前状态** | **本文件** + `docs/handoff.md` | 由指定维护人更新，反映现状；`handoff.md` 是面向接手者的综述，本文件是其明细索引。 |

## 1. 基线（分支与提交）

| 分支 | 提交 | 日期 | 相对关系 |
|---|---|---|---|
| `main`（= `origin/main`） | `cb2670e` | 2026-09-21 | 主干，已含 US-01/US-02/US-03/US-05 后端 |
| `feat/sprint1-wrapup` | `447c833` → `8583d23` → 任务 05 证据提交（见 §7） | 2026-09-23/24 | **线性领先 `main`**；`main` 无该分支缺失的提交（可干净快进） |

收尾分支的增量提交：
- `447c833`：US-05 任务前端（`web/src/pages/task/`、`ProjectTasksPage` 由占位改真实现）、需求详情接真实任务端点并删假数据层 `requirement/temporary-data.ts`、US-01 AC-04 文案与断言收尾、`docs/handoff.md`、表5 序号 102–105、`web/src/index.css`。
- `8583d23`：Sprint 1 统一收口——阶段 A 状态基线（本文件 + 历史边界标注 + `src/routes.ts` 注释修正）+ 任务 02/03/04 验收回归（3 个新测试文件、23 例）。
- 任务 05 证据提交：手工走查登记（§5.0.1）与本文档收尾更新。

> 状态：收尾分支**未合入 `main`**（用户决定），交付物以 `origin/feat/sprint1-wrapup` 为准。

## 2. 用户故事 → 端点 → 页面 → 集成状态

图例：✅ 已完成且在 `main`；🟡 已完成但**仅在 `feat/sprint1-wrapup`、尚未合入 `main`**；⬜ 占位/未实现。

| 用户故事 | 后端端点 | 后端集成 | 前端页面 | 前端集成 | 验收 |
|---|---|---|---|---|---|
| **US-01** 项目与成员 | 3–9 | ✅ `main` | 登录/项目列表/新建项目/成员管理/工作台 | ✅ `main` | ✅ 任务 02 |
| **US-02** 权限与敏感可见 | `can()`/`visibilityScope()`；23、30 | ✅ `main`（PR #19 / `51d464d`） | `SensitivityEditor`（story + task 两种 kind） | ✅ `main` | ✅ 任务 03/04 |
| **US-03** 需求层级 | 10–22 | ✅ `main`（`3048af9`） | 需求层级树 ✅；需求详情 🟡 | 层级树 ✅ `main`；详情任务区 🟡 收尾分支 | ✅ 任务 03 |
| **US-05** 任务 | 24–29（+30 由 M3 提供） | ✅ `main`（`routes.ts` 已注册） | 项目任务页 🟡；故事内任务区 🟡 | 🟡 收尾分支（`main` 上 `ProjectTasksPage` 仍是占位） | ✅ 任务 04（前端有 1 项未决 UI，见 §6.2） |

> **口径提醒**：「故事主体已进 `main`」不等于「该故事所有最新改动都已进 `main`」。US-01 的 AC-04、US-03 的需求详情任务区、US-05 的整个前端都仍在收尾分支。

## 3. 端点注册归属（30 个，均已在 `main` 注册）

| 模块 | 端点 | 注册文件 | 状态 |
|---|---|---|---|
| M1 身份与会话 | 1–2 | `src/auth/plugin.ts` | ✅ |
| M2 项目与成员 | 3–9 | `src/modules/project/plugin.ts` | ✅ |
| M3 授权与敏感可见 | **23、30** | `src/modules/authz/plugin.ts` | ✅ |
| M4 需求层级 | 10–22 | `src/modules/requirement/plugin.ts` | ✅ |
| M5 任务 | 24–29 | `src/modules/task/routes.ts` | ✅ |

- **端点 30（`PUT /tasks/:taskId/sensitivity`）唯一归属 = M3 的 `src/modules/authz/plugin.ts`**（与端点 23 同语义）。历史上 M5 曾重复注册端点 30，触发 Fastify `FST_ERR_DUPLICATED_ROUTE` 导致应用无法构建，已在 `0898a0d` 移除；`src/routes.ts` 注释已同步更正（阶段 A），M5 不再注册端点 30。
- 注册入口为冻结文件 `src/routes.ts`，集中注册，不接受各模块自行注册。

## 4. 前端路由与页面状态

| URL | 页面 | `main` 状态 | `feat/sprint1-wrapup` 状态 |
|---|---|---|---|
| `/login` | `LoginPage`（`?redirect=` 回跳） | ✅ | ✅ |
| `/projects` | `ProjectListPage`（端点 4） | ✅ | ✅ |
| `/projects/new` | `NewProjectPage`（端点 3） | ✅ | ✅ |
| `/projects/:projectId` → `overview` | `ProjectLayout` + `ProjectOverviewPage`（端点 5） | ✅ | ✅ |
| `/projects/:projectId/members` | `ProjectMembersPage`（端点 6–9） | ✅ | ✅ |
| `/projects/:projectId/requirements` | `ProjectRequirementsPage`（端点 10–22） | ✅ | ✅ |
| `/projects/:projectId/requirements/:storyId` | `RequirementDetailPage`（端点 20/21/23 + 故事任务） | ✅（任务区用假数据 `temporary-data.ts`） | ✅ 接真实端点 24/25/27/28/29/30，已删假数据层 |
| `/projects/:projectId/tasks` | `ProjectTasksPage`（端点 26 + `ownerUserId` 过滤） | ⬜ 占位 | ✅ 真实现 |
| `*` | `NotFoundPage` | ✅ | ✅ |

> 前端 API 统一走 `/api` 前缀（Vite 只代理并 rewrite `/api`），否则 SPA 深链会被 `/projects` 代理劫持。路由登记在 `web/src/routes.tsx`（冻结骨架，M2 维护）。

## 5. 验收证据与任务 02/03/04 登记

### 5.0 最新全量验证（2026-09-24，协调 AI 复核，权威）

运行环境：本机；命令用默认并发。分支 `feat/sprint1-wrapup`（含任务 02/03/04 与阶段 A 的未提交改动）。

| 检查 | 最新结果 | 证据 |
|---|---|---|
| `npm run typecheck` | ✅ 通过（0 错误） | `tsc -p tsconfig.json --noEmit && tsc -p web/tsconfig.json --noEmit`（exit 0） |
| `npm test` | ✅ **46 文件 / 1112 例全部通过** | `vitest run`（exit 0）；本轮**未**触发并发超时或 worker 退出 |
| `npm run build` | ✅ 通过 | server `tsc -p tsconfig.build.json` + web `vite build`（67 modules，产物 `dist/web`） |
| 手工走查（PM/MEMBER/VIEWER/非成员 + 深链/刷新） | ✅ 通过（44 项，0 失败） | 详见 §5.0.1 |

> 本条为最新一次干净运行，覆盖并取代各任务记录中因并发争用产生的偶发超时/worker 退出（见下）。未运行并记录结果前不得宣称通过（规格 §Testing Decisions）。

#### 5.0.1 手工走查结果（2026-09-24）

环境：Windows/PowerShell；dev 服务（web 5173 / api 3000）全程存活；演示项目 PID `90ac7bdb-edbd-4986-ba61-47b5b92cd38f`。**44 项全部通过，无失败项。**

| 组 | 项目 | 结果 |
|---|---|---|
| 1 认证与回跳 | 未登录跳转、错误口令、登录回跳、刷新保持、退出 | ✅ 5/5 |
| 2 项目隔离（outsider） | 列表隔离、overview/requirements/tasks/members 深链 404 | ✅ |
| 3 成员与角色（pm） | 加成员、改角色、拒自移除、拒降级最后 PM、member 写被拒 | ✅ |
| 4 需求层级（pm） | 三层树、创建、排序、删除保护（`HAS_CHILDREN`）、详情编辑 | ✅ |
| 5 故事敏感可见性 | PM 配置、白名单可见、未授权隐藏、计数不泄漏、关开关即时生效 | ✅ |
| 6 任务（pm） | 创建、`ACCEPTOR_EQUALS_OWNER`、`END_BEFORE_START`、部分更新、总表、负责人过滤、删除 | ✅ |
| 7 任务敏感 + 已知口径 | 白名单可见只读、未授权隐藏、故事敏感不传任务（§6.1 已确认） | ✅ |
| 8 深链与刷新 | 9 条路径（含 `/projects/xxx`、`*`）深链 + 刷新均正常渲染或正确 404；无 `/projects` 代理劫持空白页 | ✅ 9/9 |

备注：
- 3.2 原生 `select` 在自动化点击下无法展开，改用 API `PATCH` 验证角色即时更新（成功）并已还原为 MEMBER。
- 5.1/5.6/7.1 的敏感名单经全量 API 设置 + UI 复核开关态；6.6 过滤经 API 复核（owner=member2 → 2 条），与 UI 一致。
- 5.4/7.2 深链 404 与「对象不存在」响应完全一致（均 `NOT_FOUND`），不可区分；7.2 故事详情任务区显示「这条需求下还没有任务」（计数不泄漏）。
- 根因确认：Vite 仅代理 `/api` 并 rewrite，前端 API 统一走 `/api`，后端契约路径不变 —— 深链/刷新不产生劫持空白页。8.7 一次环境性工具超时，服务探活后重试通过，非应用缺陷。

### 5.1 任务 02 —— 认证 / 项目隔离 / 成员权限（端点 1–9）

证据：新增 `test/auth-project-contract.test.ts`（7 例）+ 既有 `src/auth/auth.test.ts`(9) / `project.test.ts`(13) / `project.members.test.ts`(28) / `project.isolation.test.ts`(7)。`typecheck` 通过；聚焦套件与新增用例全绿。

| 端点 | 契约要点 | 结论 |
|---|---|---|
| 1 `POST /auth/login` | 200 `{token,user}`；账号/密码错误同为 401；缺字段 422 REQUIRED | ✅ 一致 |
| 2 `GET /auth/me` | 200 `UserBrief`；无 / 篡改 / 非 Bearer / 空 Bearer → 401 | ✅ 一致 |
| 3 `POST /projects` | 201 `Project`；创建者同事务成为 PM；name REQUIRED/TOO_LONG | ✅ 一致 |
| 4 `GET /projects` | 仅返回参与项目，带 `myRole` | ✅ 一致 |
| 5 `GET /projects/:projectId` | 成员可读；非成员 / 不存在同为 404 且不泄漏字段 | ✅ 一致 |
| 6 `POST .../members` | 201；MEMBER/VIEWER→403；account REQUIRED/USER_NOT_FOUND/DUPLICATE；role REQUIRED/INVALID_VALUE；允许 PM 角色 | ✅ 一致 |
| 7 `GET .../members` | 200 列表按 joinedAt 升序；非成员 404 | ✅ 一致 |
| 8 `PATCH .../members/:userId` | 200；403/404；role INVALID_VALUE；LAST_PM | ✅ 一致 |
| 9 `DELETE .../members/:userId` | 204；403/404；SELF_REMOVAL_FORBIDDEN；移除即时生效 | ✅ 一致 |

- **未发现契约偏差；未改生产代码**。新增用例只补既有测试未覆盖的分支（VIEWER 写越权、端点 6 `role: REQUIRED` 与 PM 角色、非法 `Authorization` 头、MEMBER/VIEWER 读权限、成员生命周期主链），未改动任何既有断言。
- 前端令牌/回跳为**静态核对**（前端无自动化测试）：`web/src/api.ts` 令牌存 `localStorage`、统一带 `Authorization: Bearer`、走 `/api` 前缀、解析统一错误信封；`ProtectedRoute` 跳 `/login?redirect=<path>`；`LoginPage.safeRedirect` 仅接受站内绝对路径（防开放重定向）。与契约认证约定一致。

### 5.2 任务 03 —— 需求层级 / 敏感可见性（端点 10–23）

证据：既有 `src/modules/requirement/*.test.ts`（13 个）+ `src/modules/authz/sensitivity.http.test.ts`；新增 `src/modules/requirement/requirement.sensitivity.test.ts`（8 例）。`typecheck` 通过；`requirement`+`authz` 聚焦套件 14 文件 / 556 例全部通过。

| 端点 | 结论 | 依据 |
|---|---|---|
| 11/15 `POST .../goals`、`POST /goals/:goalId/activities` | ✅ | 201；`projectId` 由父级推导、注入被丢弃；`status=ACTIVE`、`sortOrder=最大值+1`（事务内读改写，并发用例绿）。 |
| 12/16 `PATCH /goals|activities/:id` | ✅ | 部分更新只提交出现字段；空补丁为只读 no-op；`status` 用 `GoalStatus`。 |
| 14/18 `PUT .../order` | ✅ | 全量替换为下标 0..n-1；集合不一致→422 且零副作用；幂等、可逆序。 |
| 13/17/22 `DELETE` | ✅ | 204 空体；有子项由外键 RESTRICT→409 `HAS_CHILDREN`（字段名各为 goalId/activityId/storyId）；删故事同事务清理 `ObjectVisibility`。 |
| 19 `POST /activities/:activityId/stories` | ✅ | 201 `UserStory`；五文本 `REQUIRED|TOO_LONG`、`priority` `INVALID_VALUE` 一次报全；`status=DRAFT`、`isSensitive=false` 默认且不可注入。 |
| 20 `GET /stories/:storyId` | ✅ | 200 `UserStory`；「不存在 / 非成员 / 敏感未授权」三者 404 文案与结构一致、不泄漏字段。 |
| 21 `PATCH /stories/:storyId` | ✅ | 部分更新；`status` 必须 `StoryStatus`（`ACTIVE`→422，三 DONE 陷阱）；**不含 `isSensitive`**。 |
| 10 `GET /projects/:projectId/goals` | ✅ | 200 `ListResponse<GoalNode>` 三层结构；goals/activities 按 sortOrder↑、stories 按 createdAt↑；按 `visibilityScope('story')` 在查询层过滤。 |
| 23 `PUT /stories/:storyId/sensitivity` | ✅ | 仅 PM；全量覆盖、关闭保留名单；非本项目成员→422 `NOT_PROJECT_MEMBER`；写审计；变更即时生效。 |

新增回归补齐 T2.5 合入前无法观测的空白：PM/白名单可见、未授权与 VIEWER 不可见且父级目标/活动保留；计数不泄漏；变更即时生效且全量覆盖；列表与详情一致、404 不可区分；白名单只授读；关闭后恢复并留名单。

本轮同步更正过期注释（**行为零变化**）：`requirement.goal-tree.test.ts`、`plugin.ts`、`service.ts`（端点 10）、`requirement.story-read-update.test.ts`（端点 23）——均从「T0.4 骨架 / 尚未实现」更正为「T2.5 / 端点 23 已合入」，并指向新增回归文件。

### 5.3 任务 04 —— 任务管理 / 任务敏感（端点 24–30）

证据：`src/modules/task/*.test.ts`（15 个）+ `src/modules/authz/sensitivity.http.test.ts`；新增 `src/modules/task/task-story-sensitivity.test.ts`（8 例）。`typecheck` 通过。

| 端点 | 结论 | 依据 |
|---|---|---|
| 24 `GET /stories/:storyId/tasks` | ✅ | 200 `ListResponse<TaskView>`；查询层 `visibilityScope('task')`；`planStart`↑、同值 `createdAt`↑；404 与「故事不可见」一致。 |
| 25 `POST /stories/:storyId/tasks` | ✅ | 201 `TaskView`（内嵌 owner/acceptor）；形状码 REQUIRED/TOO_LONG/INVALID_FORMAT；业务码 NOT_PROJECT_MEMBER / ACCEPTOR_EQUALS_OWNER / INSUFFICIENT_MEMBERS / END_BEFORE_START；`projectId` 由故事推导；`status=TODO`、`isSensitive=false` 默认不可注入。 |
| 26 `GET /projects/:projectId/tasks` | ✅ | `ownerUserId?` 与可见性在**同一 WHERE** 合并；404；422 NOT_PROJECT_MEMBER（含跨项目变体）。 |
| 27 `GET /tasks/:taskId` | ✅ | 200 `TaskView`；404 与「任务不存在」逐字一致、不含任务字段。 |
| 28 `PATCH /tasks/:taskId` | ✅ | 部分更新以「现有值 + 请求体覆盖」合并后再校验；ACCEPTOR_EQUALS_OWNER 三条绕过路径均拒绝；不含 `isSensitive`；P2025 竞争删除映射为 404。 |
| 29 `DELETE /tasks/:taskId` | ✅ | 204 空体；同事务清理 `ObjectVisibility`；403/404。 |
| 30 `PUT /tasks/:taskId/sensitivity` | ✅ | 全量覆盖；关闭保留名单；422 NOT_PROJECT_MEMBER；写审计；变更即时生效（M3 提供，唯一归属）。 |

新增回归补齐此前空白（故事级敏感 × 任务端点）：端点 24/25 以故事为鉴权对象，未授权成员 404、名单内 MEMBER 读 200 / 写 403、PM 不受限、关闭后即时恢复；并记录端点 26/27 与 24/25 的口径差异（见 §6.1）。

**前端核对**（只读走查，未新增自动化）：`web/src/pages/task/api.ts`、`task/TaskSection.tsx`、`ProjectTasksPage.tsx`、`SensitivityEditor.tsx` 的请求统一 `/api` 前缀，覆盖端点 24–30；错误呈现经 `ApiError.message`。发现 1 项 UI 缺陷（见 §6.2），非契约偏差。

### 5.4 复核结论

- 任务 02/03/04 **均未发现需要修改生产代码的契约偏差**；产出为新增回归测试 + 过期注释更正。
- 复核确认：生产代码改动**仅注释**；既有测试断言**未被弱化**（已逐行比对 `requirement.goal-tree.test.ts`、`requirement.story-read-update.test.ts` 的 diff）。
- 验收证据只登记于本文件；`docs/tickets/sprint1-unification/*` 保持草稿原样（经用户确认）。

## 6. 决策、未决项与风险

### 6.1 已决策（2026-09-24）

- **故事敏感不向下传递给其任务**：故事被标记为敏感、但其下任务未单独标敏感时，未授权成员仍可经端点 26（项目任务表）与端点 27（任务详情）看到这些任务；端点 24/25 因鉴权对象是故事而返回 404。经确认，**故事与任务的敏感是两个独立对象**（契约以 `ObjectVisibility.objectType = story | task` 分开建模），此行为**属契约内**，保持现状、不修改。回归由 `src/modules/task/task-story-sensitivity.test.ts` 钉住；`task-story-sensitivity.test.ts` 顶部原「待契约澄清」字样据此视为已澄清。

### 6.2 未决项（需处理）

- **【前端 UI 缺陷｜任务 04 发现】任务敏感编辑器初值不完整**：`web/src/pages/task/TaskSection.tsx` 传 `SensitivityEditor initial={{ isSensitive, visibleMemberIds: [] }}`，而 `TaskView` 不含可见名单。打开一条**已敏感**任务时名单显示为空，直接保存会**以空名单覆盖原名单**（契约端点 30 为全量覆盖）。修法需先确定读取名单的途径（`TaskView` 之外提供查询，或扩展响应）；**待定，尚未修**。

### 6.3 任务 05 收尾状态

- 手工走查：✅ 已完成（§5.0.1，44 项全通过）。
- 远端同步：✅ 2026-09-24 恢复，`origin/main` = `cb2670e` **未变动**；收尾分支线性领先，可干净快进。
- **合入 `main`：经用户决定，本轮不合并**。收尾提交（`8583d23` + 任务 05 走查证据提交）推送到 `origin/feat/sprint1-wrapup`；`main` 保持 `cb2670e` 不动。
- 整合后复核：因未合入 `main`，本轮在 `feat/sprint1-wrapup` 上完成复核（§5.0）；若后续决定合入，须在合并提交上重跑 `typecheck` / `test` / `build`。

### 6.4 已知风险 / 坑

- 表5 序号历史冲突：旧分支 `feat/US-01-m2-project-members` 用了 58–63，与 `main` 现存 58–101 重叠；收尾分支改用 102–105 规避，旧分支可归档。
- `feat/US-01-create-project-and-members` 是含重复且不兼容 T0 的旧分支，**勿合并**。
- **本机测试并发争用**：默认并发下偶发 `Hook timed out` / worker 异常退出 / `Unique constraint` 假失败（环境/资源问题，非回归）。已由 §5.0 的干净全量运行（46 文件 / 1112 例全绿）覆盖；任务 05 复核时可限制并发或提高 timeout。`requirement.adversarial2` 的并发用例属此类，本轮默认并发下通过。
- 前端无自动化测试，验收靠手工走查。
- 账号无注册端点，靠 `seed`；`POST /auth/login` 账号/密码错误统一 401 不区分。

## 7. 变更记录

| 日期 | 分支 | 提交 | 变更 |
|---|---|---|---|
| 2026-09-24 | `feat/sprint1-wrapup` | `447c833`（+ 未提交改动） | 初建本状态表；同步修正 `handoff.md` / `frontend-routes.md` / `T2-integration.md` 的过期状态与历史边界；更正 `src/routes.ts` 注释并明确端点 30 唯一归属。 |
| 2026-09-24 | `feat/sprint1-wrapup` | 工作区（未提交） | 任务 02/03/04 验收完成：新增 `test/auth-project-contract.test.ts`、`requirement.sensitivity.test.ts`、`task-story-sensitivity.test.ts`（共 23 例），更正需求模块过期注释。登记端点 1–30 逐条核对与验收证据。 |
| 2026-09-24 | `feat/sprint1-wrapup` | 工作区（未提交） | 协调 AI 全量复核：`typecheck` / `test`（46 文件 / 1112 例全通过）/ `build` 三项通过；合并各任务并发写入的重复记录为单一入口；登记决策（§6.1）与未决 UI 缺陷（§6.2）。 |
| 2026-09-24 | `feat/sprint1-wrapup` | `8583d23` | 上述阶段 A + 任务 02/03/04 的改动合并为**单个提交**（21 文件）落库；上表 02/03/04 中标注「工作区（未提交）」的记录即以该提交为准。 |
| 2026-09-24 | `feat/sprint1-wrapup` | 工作区（未提交） | 任务 05 手工走查登记：四角色 + 深链/刷新共 **44 项全通过**（§5.0.1）；登记远端 `fetch` 受阻事项（§6.3）。 |
| 2026-09-24 | `feat/sprint1-wrapup` | 任务 05 证据提交（本提交） | 任务 05 收尾：`typecheck`/`test`(1112 例)/`build` 全通过 + 手工走查 44 项全通过；远端恢复，确认 `origin/main` = `cb2670e` 未变动；**经用户决定本轮不合入 `main`**，收尾提交推送至 `origin/feat/sprint1-wrapup`（§6.3）。 |
