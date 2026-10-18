# US-09 任务验收 · 接口与规则说明（本票新增）

> 归属：**角色 A / 工单 #29**。实现位置：`src/modules/acceptance/`（后端）、
> `web/src/pages/acceptance/`（前端）。
> **本文件不修改** `docs/sprint1-spec-interface-contract.md`：那份是 Sprint 1 冻结契约，
> 改动需走「提出 → 全员确认 → 单人修改 → 通知」流程。本票按该流程**提出**新增端点如下，
> 并入契约由技术负责人执行。处理方式与 `docs/us-08-workbench-api.md` 一致。

---

## 1. 为什么必须新增端点（现状缺口，先摆事实）

本票开工前的真实代码状态（工作树基线 `b02265d`）：

| 缺口 | 证据 | 后果 |
|---|---|---|
| **驳回路径不存在** | `src/modules/task/routes.ts:415-431`：请求体只含 `status/progress/blockedReason` 时，`status === 'CLOSED'` → 需要 `task.accept`，**否则** → 需要 `task.progress`；而 `task.progress` 只认负责人（`src/modules/authz/permissions.ts:158`） | 验收人（≠ 负责人，Sprint 1 决策 3 强制）发 `{status:'DOING'}` **必然 403** ⇒ **AC4「驳回后任务返回执行阶段」无法实现** |
| **无验收结论载体** | `src/db/schema.prisma` 无验收记录表；`Task` 只有 `status/progress/blockedReason`；`blockedReason` 语义是"卡住原因"，且非 `BLOCKED` 态会被清空（`routes.ts:487`） | **AC5「全过程可追溯」无处可落**；把驳回原因塞进 `blockedReason` 是语义挪用 |
| **无法区分"提交"与"验收"** | `DONE` = 执行人提交（`DONE != 验收关闭`，交接文档 §6） | 需要一个能表达"谁、何时、什么结论、什么原因"的写动作 |

**为什么不扩展现有端点 28**（已与人工确认，记为决策 3）：
端点 28 属 `src/modules/task/`（旧模块，改动需原 owner 书面授权），且它的字段集合是
"任务编辑"（标题/负责人/验收人/计划/状态/进度），把"验收结论 + 驳回原因"塞进去会
让弱动作的字段白名单继续变复杂 —— 上一票正是被 `{status:'CLOSED', title:...}`
这类捎带写坑过一次（US-08 审查 B-1）。**独立端点只碰 `status` 与新增的记录表，
字段集合天然封闭。**

---

## 2. 端点定义

### 2.1 `POST /tasks/:taskId/acceptance` —— 执行验收（通过 / 驳回）

| 项 | 值 |
|---|---|
| 权限 | `can(actorUserId, 'task.accept', { kind: 'task', projectId, objectId: taskId })`。**唯一鉴权入口**，本模块不自行判角色 |
| 请求体 | `{ "conclusion": "PASS" \| "REJECT", "reason"?: string }` |
| 成功响应 | `200`，`{ "task": TaskView, "record": AcceptanceRecordView }` |
| 副作用 | `PASS`：`status: DONE → CLOSED`；`REJECT`：`status: DONE → DOING`；两种都**追加一条** `AcceptanceRecord` |

> 请求体只接受这两个字段。多余字段由 Zod 默认剥离（与端点 28 的既有做法一致），
> **不存在**"借验收捎带改标题 / 负责人 / 计划"的字段通道。

### 2.2 `GET /tasks/:taskId/acceptances` —— 某任务的验收历史（AC5）

| 项 | 值 |
|---|---|
| 权限 | `can(actorUserId, 'project.read', { kind: 'task', … })` + 查询层 `visibilityScope()` |
| 成功响应 | `200`，`{ "items": AcceptanceRecordView[] }`，按 `createdAt` **升序**（旧→新，读起来就是一条时间线） |
| 空历史 | `200` + `items: []`（**不是** 404：任务存在、只是还没验收过） |

### 2.3 `GET /projects/:projectId/acceptance-queue` —— 待我验收的任务（界面主链路）

| 项 | 值 |
|---|---|
| 权限 | `can(actorUserId, 'project.read', { kind: 'project', projectId })` + 查询层 `visibilityScope(actor, projectId, 'task')` |
| 查询参数 | `?scope=acceptor \| owner`，**省略时默认 `acceptor`**（原行为不变）。取值非法或重复传参 → `422 scope: INVALID_VALUE` |
| 筛选（`scope=acceptor`） | `acceptorUserId = 我` **且** `status = 'DONE'` ⇒ 轮到我验收 |
| 筛选（`scope=owner`） | `ownerUserId = 我` 且该任务**最近一次**验收结论是 `REJECT` ⇒ 轮到我整改 |
| 成功响应 | `200`，`{ "items": AcceptanceQueueItem[] }`，按 `planEnd` 升序 |

其中 `AcceptanceQueueItem = TaskView & { latestAcceptance: AcceptanceRecordView \| null }` ——
每行内嵌该任务**最近一次**验收记录（从未验收过为 `null`），避免前端逐行再发请求。

**`scope=owner` 是 2026-10-18 走查后补的**：在那之前，驳回理由只存在于"验收人那一侧的
展开历史"里，**执行人一处都看不到** —— 而 AC4 要求"驳回必须填原因"，原因传不到执行人
就等于没传达；AC5 的"全过程可追溯"也应当是双向的。

> 为什么不在前端用端点 26 自己筛：那是**内存过滤**，与决策 I-6「列表与计数必须在
> 查询层过滤」冲突；而且端点 26 只支持 `ownerUserId` 过滤，加 `acceptorUserId`
> 参数等于改旧模块文件（需授权）。新增一个只读端点更干净。
>
> `scope=owner` 分支内部有一次 `latest.filter(...)`：**它不是可见性过滤** —— 可见性已由
> 同一个 `where` 里的 `visibilityScope()` 完成，这一步只是在"我已有权看到的、我自己负责
> 的任务记录"上判定"最近一条是否驳回"，不含任何权限判断，因此不违反 I-6（不会泄漏敏感
> 对象的存在性）。

---

## 3. 状态机（依据 #24，不自造）

```
TODO ⇄ DOING ──→ BLOCKED（必填原因）──→ DOING（清空原因）
          └──→ SUSPENDED ──→ ？（见 §9 待确认）
          └──→ DONE（执行人提交验收）
                 └──→ CLOSED   （验收人 PASS）
                 └──→ DOING    （验收人 REJECT，必填原因）──→ …修复后重新提交 DONE …
```

**本端点强制的前置条件**：`status` 必须是 `DONE`。
否则返回 `409 CONFLICT`（错误码表已有 `CONFLICT`），并保证**状态未变、无记录落库**。

这也正是 AC3「**未通过不得关闭**」在本端点内的落点：不存在 `TODO → CLOSED` 的通道。
「重验」= 驳回后任务回到 `DOING`，执行人重新提交 `DONE`，验收人再次调用本端点 ——
同一任务因此会有多条记录（AC5）。

---

## 4. 授权口径（人工确认于 2026-10-17，**沿用现状、不改任何现有约定**）

| 问题（C11） | 本票口径 | 依据 |
|---|---|---|
| 谁能执行验收 | 任务的**验收人**（`Task.acceptorUserId`）+ PM（PM 在 `can()` 第 3 条放行，保留全部权限） | `#24` comment 6233430993；`permissions.ts:133,159` |
| 验收人可选范围 | **沿用现有规则**：本项目成员且 ≠ 负责人（含 VIEWER） | `src/modules/task/rules.ts:53-99`，**本票一行不改** |
| VIEWER 是否允许验收 | **不允许**，一律 403 | `permissions.ts:150-152`（US-08 已落地） |
| 是否需要改 `rules.ts` / `permissions.ts` | **都不需要**。`Action` 里 `task.accept` 已存在（`src/shared/types.ts:219`） | — |

**已登记的已知取舍（不是本票新增缺陷）**：由于 `rules.ts` 不限制验收人角色，PM 可以把
一个 VIEWER 指为验收人；该任务此后**无法由它的验收人关闭**（VIEWER 执行验收恒 403）。
本票的处理：① 前端验收页对 VIEWER **不渲染验收按钮**并给出说明（只发生在本票新增页面，
不改任何现有文件）；② 服务端侧这条列为**跨模块遗留**登记，交 task 模块 owner 裁决。

**AC2（验收人 ≠ 负责人）**：创建/编辑时已由 `rules.ts:88-91` 强制
（`acceptorUserId: ACCEPTOR_EQUALS_OWNER`）。本票在验收端点**再加一道运行时防御**：
若数据层不变量被破坏（`acceptorUserId === ownerUserId`），拒绝执行并保证状态未变。

---

## 5. 敏感与可见性（契约决策 I-6）

- **2.2 读历史**：只走 `can(actor, 'project.read', { kind: 'task' })` —— 对**单个对象**的读，
  `can()` 第 4 条会直接按该对象的敏感白名单判定，比 `visibilityScope()` 更严格；
  因此这里**不调** `visibilityScope()`（独立审查 S4：本节上一版写成"2.2 / 2.3 都调"，
  与代码不符，已改）。列表用的 where 只有 `{ taskId }`，**不是**内存过滤 ——
  可见性在查询层由 `can()` 查 `ObjectVisibility` 完成。
- **2.3 读队列**：`can('project.read')` + `visibilityScope(actor, projectId, 'task')`，
  作用域条件与该端点自己的条件（`acceptorUserId` / `status`）拼进**同一个 where**；
  **不存在**"先查全量再在内存剔除"的路径（生产代码里 `.filter(` 零命中）。
- 写路径（2.1）先过 `can('task.accept')`：`can()` 第 4 条会按敏感白名单先拦，
  非白名单成员得到 **404**（与"任务不存在"逐字一致，不泄漏存在性）。
- 端点 2.3 的筛选条件不含敏感字段，但敏感任务会因作用域不含该 id 而**自然不出现**在
  队列里；计数与列表同源，不泄漏。

---

## 6. 错误码

| 场景 | HTTP | 顶层码 | 字段码 |
|---|---|---|---|
| 未登录 | 401 | `UNAUTHENTICATED` | — |
| 对象可见但操作不允许（非验收人 / VIEWER） | 403 | `FORBIDDEN` | — |
| 任务不存在 / 非项目成员 / 敏感未授权 | 404 | `NOT_FOUND` | — |
| 请求体形状非法（结论取值非法、非枚举） | 422 | `VALIDATION_FAILED` | `conclusion: INVALID_VALUE` |
| 清单视角取值非法 / 重复传参 | 422 | `VALIDATION_FAILED` | `scope: INVALID_VALUE` |
| **驳回未填原因**（服务端强制） | 422 | `VALIDATION_FAILED` | `reason: REQUIRED` |
| 原因超长 | 422 | `VALIDATION_FAILED` | `reason: TOO_LONG` |
| **当前状态不是 `DONE`**（如对 `TODO`/`DOING` 直接验收） | 409 | `CONFLICT` | — |
| 数据不变量被破坏（验收人 = 负责人） | 409 | `CONFLICT` | — |

> 未新增任何错误码/字段码 —— 全部复用 `src/shared/types.ts` 的既有取值。
> `409 CONFLICT` 属**本票拟案**（契约未定义），已登记待确认（§9）。

---

## 7. 界面侧三条硬约定（吸收上一票踩过的坑）

1. **同一件事只留一条路径**：验收只有"验收页上的验收表单"这一个入口；
   **不**在任务表格里再加一个"状态下拉"或"关闭"按钮。US-08 的 B-1/坑 3
   （两个控件改同一件事，弱入口绕过必填校验）不重演。
2. **按 target 切换的表单必须带 `key`**：`<AcceptanceForm key={task.id} …>`。
   否则从任务 A 切到 B 时组件复用、`useState` 初值不重跑，会把 A 的结论/原因写进 B。
3. **驳回原因由界面拦一次、服务端再强制一次**：界面不填不发请求；服务端
   `422 reason: REQUIRED`（不靠界面，US-08 坑 5 / B-5）。

---

## 8. 与工单 AC 的对照

| AC | 落点 | 状态 |
|---|---|---|
| AC1 仅验收人可验，他人 403 | 2.1 走 `can('task.accept')`；用例覆盖 验收人 200 / 非验收人 MEMBER 403 / VIEWER 403 / outsider 404 | ⚠️ member 用例需 §4 口径留痕后才可勾 |
| AC2 验收人 ≠ 负责人 | 创建/编辑由 `rules.ts` 强制；验收端点再加运行时防御（409） | ✅ |
| AC3 通过后关闭并有记录；未通过不得关闭 | `DONE → CLOSED` + 记录；非 `DONE` → 409；无 `TODO → CLOSED` 通道 | ✅ |
| AC4 驳回必填原因；返回执行阶段 | `REJECT` 无原因 → 422 `reason: REQUIRED`；合法 → `DONE → DOING` + 记录。**原因对执行人可见**（`scope=owner` 清单，2026-10-18 走查后补） | ✅ |
| AC5 重验可再次通过/驳回，全过程可追溯 | 同任务多条记录（2.2 读接口，旧→新）；who/when/结论/原因/状态前后；验收人清单还会标出「上一轮被驳回」。**双向可追溯**：验收人 2.2 展开，执行人 `scope=owner` 直接看原因 | ✅ |
| AC6 验收结果进入质量信号（供 #30 / #33） | 2.2 只读接口即信号来源；**不建跨模块 service 调用**（决策 I-9）；#37 事件只出类型 | ✅（按设计交付） |
| AC7 敏感任务验收仅相关有权者可见 | §5；用例覆盖 敏感 + 非白名单成员读记录 404 / 尝试验收 404 | ✅ |

---

## 9. 待确认与已登记的跨模块事项（不自行拍定）

**待澄清（契约未定义，本票按拟案实现并在本文件留痕）**：

1. 非法状态执行验收取 **409 CONFLICT**（代替 422/403）。
2. 验收人 = 负责人的数据不一致取 **409 CONFLICT**。
3. 通过/驳回后是否要改 `progress`（置 100 / 清零）—— 本票**不动**。
4. **`SUSPENDED` 如何回主线**：#24 的 ROLE-A 结论只写了 `DOING → SUSPENDED`，
   没写回程。属**契约空白**，本票不涉及、不改。
5. 「`DONE` 是否只由负责人置」：现状 PM 也能置（`permissions.ts:133` + 端点 28 无前置状态
   检查）。属 #28 已交付范围，本票只登记。
6. **★ AC1 字面与 `can()` 既有行为的张力（独立审查 S3 提出）**：工单 AC1 写「仅任务验收人
   可执行验收；**他人 403**」，而 `can()` 第 3 条让 **PM 对任何任务都能 `task.accept`**
   （`permissions.ts:133`），即 **PM 不是该任务的验收人也能验收**。#24 的 ROLE-A 结论写的是
   「验收人可 CLOSED 或驳回；**PM 保留全部权限**」，两者可以并存，但"他人"是否包含 PM
   需要一次书面裁定。本票**把现有行为钉进用例并留在此登记**（`acceptance.test.ts` 的
   「PM 即使不是该任务的验收人也能验收」），**不自行改 `can()`**（改它属跨票、且 `permissions.ts`
   是冻结区）。⇒ 开发侧对 AC1 的勾选状态：验收人路径已勾；**PM 例外这一条待裁定**。

**已登记的跨模块发现（不动手，交归属人裁决）**：

7. **端点 28 对 PM 可在任意状态直接把任务置 `CLOSED`** ⇒ 存在"跳过验收直接关闭"的路径。
   本票**只堵自己端点内的通道**（要求 `status = DONE`），旧模块那条路径登记在此。
8. `rules.ts` 不限制验收人角色（见 §4 已知取舍）。
9. **前端骨架依赖**：`web/src/pages/acceptance/shared-types.typecheck.ts` 以 `import type`
   从 `src/modules/acceptance/types.ts` 引类型（仅类型、构建时擦除、不进产物），是本票唯一
   一处 web 侧直接依赖后端模块文件的地方（独立审查 S8）。若该模块将来被移动/删除，
   `web` 的 typecheck 会红。**建议**（非阻塞）按 §11 把 `AcceptanceConclusion` /
   `AcceptanceRecordView` 上提到 `src/shared/types.ts`，护栏改为对齐共享类型；这属冻结区改动，
   本票不擅自做。

---

## 10. 接口先行（#36 / #37）—— 只出类型，**未接线**

`src/modules/acceptance/types.ts` 里给出两个**明确标注未接线**的类型：

- `AcceptanceEvidenceRef`（#36 验收证据附件）：请求体当前**不接受**附件字段。
- `AcceptanceEventPayload`（#37 验收结果事件）：本模块当前**不发布**任何事件，
  不 import 任何事件模块（决策 I-9 禁止跨模块调 service；接入方式待 #24 第 3 点结论）。

**不为了让 AC6 好看而假装事件已通。**

---

## 11. 冻结区与旧模块改动清单

> **授权状态口径（独立审查 S5 的修正）**：下表 6 项**均已按申请口径写进代码**，但
> **尚无原 owner 的书面授权**。事实上已有的只有：① #24 comment 6235528115 的申请
> （下同 6235532250 为 #29 开工留言）；② 人类（ROLE-A 负责人）口头同意继续。
> 而 B 在自己的 CONTRACT 补充确认（#24 comment 6232875888 第 1 条）里被指定为
> **公共范围唯一修改/集成人**，其原话是"D 按能力提供补丁，**不并发写公共文件**"、
> "权限模块、未确认状态转换、C11/C12 及其他域规则**不自动获批**"。
> ⇒ 正确表述是「**已落地，待原 owner/B 书面确认后由单人合入**」，**不是**"已授权"。
> 上一版本节写"申请中"、而 `ProjectLayout.tsx` 的注释写"已获口头同意"，两处不一致，已统一为本口径。

| 对象 | 改动 | 归属 | 状态 |
|---|---|---|---|
| `src/routes.ts` | +1 行 `registerAcceptanceRoutes(app, context)` | 技术负责人 | 已落地，**待书面授权 + 单人合入** |
| `src/db/schema.prisma` | +1 model `AcceptanceRecord`（并在 `Task`/`User`/`Project` 各加 1 行反向关系） | 技术负责人 | 已落地，**待书面授权 + 单人合入** |
| `src/db/migrations/20261017230000_add_acceptance_record/` | +1 迁移（纯 `CREATE TABLE` + 索引） | 技术负责人 | 已落地，**待书面授权 + 单人合入** |
| `web/src/routes.tsx` | +1 行挂载 `/projects/:projectId/acceptance` | 前端骨架唯一修改人 | 已落地，**待书面授权 + 单人合入** |
| `web/src/layouts/ProjectLayout.tsx` | 左导航 +1 项「验收」 | 前端骨架唯一修改人 | 已落地，**待书面授权 + 单人合入** |
| `docs/frontend-routes.md` | 路由表 +1 行 | 前端骨架唯一修改人 | 已落地，**待书面授权 + 单人合入** |
| `src/modules/task/`、`src/modules/authz/permissions.ts` | **零改动** | — | 不需要 |
| `src/shared/types.ts` | **零改动**；建议技术负责人将 `AcceptanceConclusion` / `AcceptanceRecordView` **上提**到共享契约（与 `TaskView` 同级），本票暂放模块内并在编译期护栏钉住 | 技术负责人 | 建议，非阻塞（独立审查 S8） |

**表关系设计（关键）**：`AcceptanceRecord.task` 用 `onDelete: Cascade`。
理由：端点 29 删除任务时验收记录随库级联清理，因此**不需要**改
`src/modules/task/routes.ts`（手写清理）也**不需要**改 `src/db/test-support.ts`
（`resetDatabase` 的删除顺序）。

---

## 12. 已知限制（如实登记，不粉饰）

1. **不做 PM 的"全项目待验收总览"**：2.3 固定返回"我是验收人"的清单。跨项目的个人视角
   已由 US-08 的工作台「待验收」块覆盖。
2. **界面上的验收历史按任务查**：验收页第一块（待我验收）里可逐行展开历史；任务一旦
   通过验收就离开队列，因此该任务的历史只能在其仍在队列时展开查看。
   （已被驳回的任务不必再"按任务查"：执行人可在第二块直接看到最近一次的结论与原因。）
3. **无验收证据附件**：依赖 #36（未交付）。当前验收只有"结论 + 文字原因"。
4. **验收结果不外发**：依赖 #37（未交付），通知模块的「验收」类通知因此暂不可送达。
5. **`scope=owner` 只给"最近一次"，不给完整时间线**：第二块显示的是**最近一条**验收
   记录。要看完整往返历史（驳回→重提→再驳…），仍走 2.2 端点或第一块的展开历史。
   这是刻意的取舍：执行人最需要的是"这次要改什么"。
