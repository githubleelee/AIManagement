# ROLE-B / 本地 #09：GitHub #26 甘特图模型、接口与验收设计

> **状态：DRAFT · 设计提案 · 不含实现代码 · 未冻结任何模型 / 路由 / 字段。**
> 本文只交付 GitHub #26 的**模型与接口设计、公共文件细化申请、逐 AC 测试方案**，供后续实现按公共层（B 单写授权）小批次顺序合入。
> 本文不改任何其他文件 / 代码 / tasks / shared / 公开契约，不提交、不推送、不写远端工单。

| 项目 | 内容 |
|---|---|
| 对应工单 | GitHub #26 甘特图；本地 `docs/tasks/role-b-development.md` #09 |
| 源码基线 | main `398aa76d02f66ce9d62e4e1c340de408f15a1f0f`，只读快照 `/tmp/role-b-main-398aa76.GvfwFS` |
| 提示 | 工作区 HEAD `fb5cee2` 较老，**本文全部行号以快照为准**；已合 US-08 工作台 / US-09 验收，但仍无 gantt / Milestone / TaskDependency / 事件运行时 |
| 依据 | `docs/role-b-baseline-review.md`、`docs/role-b-contract-register.md`、`DECISIONS.md`、`docs/role-c-issue-32-confirmation.md`；C 数据 `role-b-scheduling-data-contract.md` / 事务 `role-b-scheduling-transaction-proposal.md` 均**未冻结**，本文只引用其思想，不当作现有接口 |
| 估算 | 归原 #26 的 8 人日，不重复计算 D/C 的新集成工作 |

**标记约定**：✅ 已由项目负责人确认（不得改写）；🟡 候选（待 C / 负责人核对）；⛔ 待决（依赖他人交付或授权，无可引用证据）。已确认口径不等于代码已实现，源字段已存在不等于接口已注册。

---

## 1. 范围与边界（职责事实，非新业务规则）

- **B 负责**：`src/modules/gantt/`（后端）、`web/src/pages/gantt/`（前端）、`Milestone` / `TaskDependency` 模型与迁移、`src/shared/` 类型、`src/routes.ts` / `src/app.ts` 组装挂载、`docs/frontend-routes.md`。全部按公共层单写授权执行。
- **只做 FS**：不接受 SS / FF / SF，不做拖拽排程、自动调度、资源平衡、工作日 / 节假日 / 技能 / 并行度等高级排期（`DECISIONS.md` `scheduling.fs-release-closed-natural-days`）。
- **不新增故事排期状态**：沿用 `StoryStatus` 三态 `DRAFT / PLANNING / DONE`（`src/shared/types.ts:32`），甘特的故事排期 / 进度只做**聚合展示**，不落库、不新造状态。
- **C #32 集成方向**：C 只对 `TODO` 任务写 `planStart / planEnd`；**B 视图随 `Task` 数据自然刷新**，`#32` **不写** B 的派生聚合 / 依赖 / 里程碑结构；B 也不替 C 写运行时结构。
- **真实开工守卫**：C2 放行规则必须落在**实际写入口**，不能只靠甘特按钮禁用（见 §4.4）；旧 `task/routes.ts` 的具体授权 / 写窗口 ⛔ 待决。
- **事件**：本域负责业务事件的**发布动作**，D 只做传输 / 存储 / 订阅 / 幂等；**不承诺 outbox / exactly-once**（`DECISIONS.md` `arch.shared-ports-and-assembly`）。
- **不做**：不跨业务模块调 service、不复制角色判定、不改 `requirement` 写路径、不扩 C #32 授权到状态守卫 / 验收 / 六态转换。

---

## 2. 事实基线（快照 `398aa76`，逐条可核对）

| 事实 | 来源（相对路径:行） |
|---|---|
| 任务六态 `TODO/DOING/BLOCKED/SUSPENDED/DONE/CLOSED`（`DONE ≠ CLOSED`） | `src/shared/types.ts:38`、`src/shared/validation.ts:20` |
| `Task`：`id/projectId/storyId/ownerUserId/acceptorUserId/planStart/planEnd/status/progress/blockedReason/isSensitive/createdAt` | `src/db/schema.prisma:117`（字段 `:119-131`） |
| `planStart/planEnd` 为 `String 'YYYY-MM-DD'`；`status` 为 `String`，DB 不约束枚举 | `src/db/schema.prisma:125-127` |
| 现有读端点：按故事列任务 / 按项目列任务（可 `ownerUserId` 过滤）/ 任务详情 | `src/modules/task/routes.ts:204 / :248 / :373` |
| 现有写端点：`POST /stories/:storyId/tasks`、`PATCH /tasks/:taskId`、`DELETE /tasks/:taskId` | `task/routes.ts:307 / :402 / :526` |
| 唯一鉴权入口 `can()` 与 `visibilityScope()`（PM=all；MEMBER/VIEWER=subset） | `src/modules/authz/permissions.ts:123 / :182` |
| 查询层过滤范式（可见性与业务条件拼进同一 `where.AND`） | `src/modules/workbench/service.ts:109`、`task/routes.ts:248` |
| 交互式事务样例（含 CAS 条件更新），可复用，无需新基础设施 | `src/modules/acceptance/service.ts:250` |
| `AuditLog` 模型（`projectId/actorUserId/action/objectType/objectId/before/after/createdAt`） | `src/db/schema.prisma:191` |
| 事件仅类型占位、**未接线** | `src/modules/acceptance/types.ts:124-139` |
| **缺失**：`milestone/gantt/workload/predecessor/successor` 全量零命中 → 无 `Milestone` / `TaskDependency` 模型、表、端点 | 快照 `grep -rni`「零命中」事实 |

> ⚠️ 必须区分**「不可用」与「已知为空」**：依赖模型交付前，「取不到依赖」不得表达为 `dependencies: []`（会被误读为「确实没有前置」）。该包装**只有两态**（有值 / 不可用），字段名仅候选。

---

## 3. 模型设计候选：`Milestone` 与 `TaskDependency`（🟡 待核对）

> 以下字段 / 关系 / 约束 / 索引均为**候选提案**，不是已冻结 schema。迁移文件命名、`onDelete` 语义、是否改 `Task` 表待负责人与 C 核对。

### 3.1 `Milestone`（最小字段）

| 字段 | 候选类型 | 约束 / 说明 |
|---|---|---|
| `id` | `String @id @default(uuid())` | 主键 |
| `projectId` | `String` | FK `Project`，`onDelete: Restrict`；项目隔离边界 |
| `name` | `String` | 必填 |
| `dueDate` | `String` | `'YYYY-MM-DD'`，自然日，`Asia/Shanghai`；**候选**，待核对 |
| `ownerUserId` | `String?` | 可选负责人；通知决策提到「节点可无单独负责人」，故候选可空 |
| `createdAt` | `DateTime @default(now())` | 既有惯例 |

- **关系 / 索引候选**：`@@index([projectId])`；`ownerUserId` 若保留则 `@@index([ownerUserId])`。如保留负责人，需校验其为本项目有效成员，不新增角色；任务—里程碑关联必须读取两端实际 `projectId` 并核对同项目，不能仅靠客户端项目字段或单个外键证明项目隔离。
- **任务—里程碑关联**（AC4）：候选 A 为独立关联表 `TaskMilestone(taskId, milestoneId)`，`@@unique([taskId, milestoneId])`；候选 B 为 `Task.milestoneId String?` 单外键。A 不侵入 `Task` 表、天然支持多对多；B 更小。**二者待核对，本文不拍**。
- 无关联里程碑**不编造**、不自动改里程碑（`scheduling.advice-apply-scope-and-validation`）。

### 3.2 `TaskDependency`（最小字段，仅 FS）

| 字段 | 候选类型 | 约束 / 说明 |
|---|---|---|
| `id` | `String @id @default(uuid())` | 主键 |
| `projectId` | `String` | 冗余项目边界，便于同项目校验与过滤；`@@index([projectId])` |
| `predecessorTaskId` | `String` | FK `Task`，`onDelete: Restrict`（删除任务不静默丢边，端点 29 需另核） |
| `successorTaskId` | `String` | FK `Task`，`onDelete: Restrict` |
| `type` | `String @default("FS")` | **仅接受 `'FS'`**；写入层拒绝其他值 |
| `createdAt` | `DateTime @default(now())` | 既有惯例 |

- **约束候选**：
  1. `@@unique([predecessorTaskId, successorTaskId, type])` 去重；
  2. `predecessorTaskId !== successorTaskId`（拒自依赖）：**改为应用层写入校验**。SQLite 本身可用 `CHECK` 表达该字段比较，但 Prisma DSL 不直接表达；是否在迁移中补 `CHECK` 由迁移提案核对，**本文不擅定**。
  3. **拒环**：环检测必须与边写入落在**同一受控事务 / 一致视图**内，并具备并发保护；**不假定** SQLite 单写自动保证拒环——两个并发的互反建边请求（A→B 与 B→A）可各自通过检测后同时写入，须有「双请求互反建边」测试覆盖。具体锁 / CAS 机制待方案，**本文不擅定**。
  4. 两端任务的 `projectId` 必须相同且等于请求项目（**直接读库取真实 `Task.projectId`**，不信任请求体自报）；
  5. 索引：`@@index([successorTaskId])`、`@@index([predecessorTaskId])`、`@@index([projectId])`。
- **跨项目**：外键 / 成员校验（`src/db/schema.prisma:135`、`task/rules.ts:53`）只覆盖既有任务分配，**不能替代 FS 跨项目校验**。
- **删除任务口径（⛔ 需另核授权）**：`onDelete: Restrict` 会直接影响旧 `DELETE /tasks/:taskId`（`task/routes.ts:526`）——存在依赖边的任务删除将被拒。删除关联任务的具体语义（先删边 / 拒绝带边删除 / 级联）、旧端点 29 的错误映射，以及相应旧业务授权，**均须另确认**；不得藏在 schema 里静默改变旧业务，也不得借 C #32 的日期应用窗口取得。

---

## 4. FS 语义（✅ 已确认口径 + 🟡 落点候选）

### 4.1 已确认规则（`scheduling.fs-release-closed-natural-days`、C 确认稿 §6）
- 放行前置**必须 `CLOSED`**，`DONE` 不算验收通过；
- 计划按**自然日**（含周末），**起止日均计入**；
- FS 后继建议开始**不得早于前置计划结束日的次日**；
- 全项目日期口径 `Asia/Shanghai`、`YYYY-MM-DD`；wire 时间戳仍为既有 ISO 8601 UTC，**不改**。

### 4.2 模型层校验（写入时）
- 仅 `type = FS`；拒自依赖；拒环（**与边写入同一受控事务 / 一致视图 + 并发保护，见 §3.2**）；直接读库核对两端 `projectId`。

### 4.3 展示层校验（甘特读时）
- 计划日期倒置（`planStart > planEnd`）标记为异常，不静默修正；不落库。

### 4.4 真实开工守卫（⛔ 授权 / 落点待决）
- 现有「开始执行」由 `PATCH /tasks/:taskId`（`task/routes.ts:402`）及 `task/rules.ts` 承载，选择 `task.write` / `task.progress` 后执行形状与原分配规则校验（`task/routes.ts:402-525`），**未形成完整状态转换图或 FS 起步校验**。
- C2 守卫必须覆盖**实际写入口**，直接调用 HTTP 也拒绝未放行的后继开工，不能只禁用 UI 按钮。
- 需与当前任务流写者核对「哪些操作构成开始执行」、共同落点、改动函数 / 测试及排他窗口；**这不是 C #32 仅日期应用窗口的延伸**，不借该窗口擅改普通状态 / 验收规则（本文只登记范围问题，不写守卫代码）。

---

## 5. 故事日期 / 进度汇总（进度 ✅ 已按 C10 收口 · 日期 🟡 仍为候选）

- 故事**无独立计划日期字段**（基线 §2），汇总输入只能是其下 `Task.planStart/planEnd/status/progress`。
- **故事进度：已按 `analytics.story-progress-aggregation` 实现**（DECISIONS，项目负责人 2026-10-19 批准 B 在 #26 的建议，见评论 6262495800）：
  - **进度 = 已 `CLOSED` 任务数 ÷ 该故事任务总数**；`DONE` **不计入**分子（`DONE` 不冒充 `CLOSED`）；
  - 统计集合 = 该故事的**可见任务集合**，与故事 `min(planStart) ~ max(planEnd)` 用的是**同一个集合**（PM = 全项目，MEMBER / VIEWER = `visibilityScope` 可见范围，界面沿用既有 `basis.scopeLabel` 标注）；
  - **无任务 → `progress = null`**（不显示 0%，沿用「算不出来就不编数字」）；
  - **不做**加权 / 故事点 / 工时 / 自定义权重；**不得**由部分可见子集推全局；
  - 响应形状与取整**沿用仪表盘**：`progress = { closed, total, ratio }`，`ratio` 保留 4 位小数、`total = 0` 时 `null`；`progressState = 'computed'`。故**同一账号同一时刻、对同一任务集合**，本端点故事进度与 `GET /projects/:projectId/dashboard` 的 `progress` 必然一致（有用例钉住）。
  - 不使用 `Task.progress`（那是任务自身的执行百分比，与故事进度是两件事）。
- **故事日期：仍为候选口径（`aggregation = 'candidate-minmax'`）**，C10 只收口了进度，日期**未**随之改为已确认：
  - 故事日期：候选为 `min(planStart)` 至 `max(planEnd)`，但**仅在有效数据范围上成立**，不写成必然规则；
  - 已实现：日期汇总用 `groupBy` 在**全部可见任务**上取 min/max（不受明细 500 行截断影响），无可见任务 → `null`。
- **边界**：
  - **无任务**：故事日期 `null`、`progress` 为 `null`，不编造计划、不显示 0%；
  - **空值 / 异常历史数据**：正常模型中 `planStart/planEnd` 为**必填 `String`**（`src/db/schema.prisma:125-126`），`null` / 非法日期属异常历史数据；**不得静默剔除后把 min/max 说成全部任务的完整汇总**。界面对倒置区间标「日期倒置（异常）」、不静默修正；其余异常数据的展示规则仍待确认；
  - **部分可见**（MEMBER/VIEWER 仅见子集）：汇总只能是**可见范围**的汇总，须标「可见范围」，**不得**由部分任务推全局故事进度或泄漏隐藏任务存在性。
- 进度部分**不再是候选**；日期与异常数据部分仍标候选，不把候选当批准。

---

## 6. 可见性与计数（✅ 规则 + 🟡 落点候选）

- **查询层过滤**：既有 `visibilityScope` 的对象类型仅支持 `story` / `task`，不能假称已支持 `milestone` / `dependency`。先取得已有故事/任务授权范围，再在查询层组合依赖两端和里程碑关联条件；具体关联可见性派生规则待核对，不调用不存在的 scope、不私造敏感模型。列表与计数使用相同授权条件，**禁止**先查全量再内存剔除/计数。
- **可见任务与不可见所属故事并存**的边界需明确：不得显示隐藏故事标题或“隐藏故事”占位来泄漏存在性；也不能静默缩小任务集合后宣称与任务视图全量一致。独立任务条/分组关系的安全表示列为待核对，不单方拍板。
- **基数分层**（`scheduling.load-aggregation-baseline`）：
  - PM → `global` 全项目汇总（可含 `excludedSensitiveCount`，**仅 PM 内部 / 审计**）；
  - MEMBER / VIEWER → 仅**可见范围**汇总并标注「可见范围」，**不下发**全项目基数 / 排除敏感数；
  - AI 子集 → 排敏感后实际参与数，**不得**以子集冒充全局基数。
- **不得经依赖边 / 里程碑 / 聚合 / 计数**间接泄漏子集外对象存在。
- **跨可见范围约束**（依赖边 / 里程碑指向可见范围外的对象）：⛔ **不得默默当作「无约束」**，处理方案待核对；无法安全完整核验时不执行正式应用、不标验证成功（对齐 C 数据契约 §2.4、事务提案 fail-closed 候选）。

---

## 7. 接口候选（⛔ 未注册 · 未冻结 · 后端无 `/api` 前缀）

> 以下仅候选形状，字段名 / 路径 / 响应包装均待核对，**不代表已注册**。优先复用现有读端点。

| 用途 | 候选 | 说明 |
|---|---|---|
| 统一时间轴（AC1） | `GET /projects/:projectId/gantt` | 聚合故事 / 任务 / 里程碑；查询层过滤 |
| 故事展开（AC2） | 复用 `GET /stories/:storyId/tasks` | `task/routes.ts:204` |
| 里程碑写（AC4） | `POST /projects/:projectId/milestones`、`PATCH/DELETE /milestones/:milestoneId` | 候选 |
| 依赖写（AC5/6） | `POST /projects/:projectId/task-dependencies`、`DELETE /task-dependencies/:dependencyId` | 仅 FS，服务端校验 |
| 依赖 / 里程碑读取包装 | `Availability<T>`：`{ state:'ok'; data:T }` \| `{ state:'unavailable'; note; data:null }` | **两态**，不称三态；禁 `[]` 冒充无依赖 |

- 最小只读投影候选可直接复用既有 `Task` / `TaskView` 字段（`src/shared/types.ts:103 / :123`），不新造任务实体。
- 候选路由落公共层时先登记、小批次提交；本地桩 / 模块测试 / 真实 API / 真实生产方联调分栏留证。
- **写权限接入待核对**：PM 建改、MEMBER/VIEWER 只读的本票规则必须经统一 `can()` 落实。可提案复用适用的现有项目/任务写动作与项目引用，但不能仅用 `project.read` 充当写授权。若需新增 Action/ObjectRef 或改权限实现，须本票另获适用范围许可，不能借 B 仅针对 #32 的权限文件许可扩大到甘特。

---

## 7.1 实现状态（2026-10-19 更新，追加说明；上文候选形状保留为历史）

| 批次 | 状态 |
|---|---|
| P1 模型与迁移（`Milestone` / `TaskMilestone` / `TaskDependency`） | ✅ 已合入（PR #51） |
| P2/P3 只读聚合 `GET /projects/:projectId/gantt` | ✅ 已合入（PR #52，故事日期 `candidate-minmax`、进度待 C10） |
| P3 写路径（里程碑 / FS 依赖，5 端点） | ✅ 已合入（PR #68）：仅 FS、拒自依赖 / 跨项目 / 重复边 / FS 环（同事务迭代 BFS）、`gantt.write` **仅 PM**；错误码全部取自契约 I-4 冻结表 |
| P4 组装挂载 | ✅ 插件已注册于 `src/routes.ts`（无需改动） |
| P5 前端写侧 UI | ✅ 已合入（PR #69 → `e9055b2`）：仅 PM 渲染写控件、类型固定 FS、写后重拉；浏览器走查含「造环 409」与「MEMBER 403」实测 |
| 事件发布（§9.4） | ⛔ 未接线：`GanttEventPort` 占位 + 写点事件名注释，待 D 的 `#37` |
| §4.4 真实开工守卫（本地 #13） | ⛔ 顺延：`task/routes.ts`、`task/rules.ts` 当前属 C 的写窗口，B 在窗口期内不改 |

口径与决策：`DECISIONS.md` `permissions.gantt-write`（PM-only、409/422 语义、环判定同事务、code 不扩表、事件待 D）、`scheduling.fs-release-closed-natural-days`。

## 8. 公共层落地清单与短 PR 优先级（非硬依赖）

| 批次 | 文件 / 目录 | 内容 |
|---|---|---|
| P1 | `src/db/schema.prisma` + `src/db/migrations/<ts>_add_gantt_models/` | `Milestone` / `TaskDependency`（±任务关联）模型与迁移 |
| P2 | `src/shared/` | 甘特类型 / 端口候选（只读投影、`Availability`） |
| P3 | `src/modules/gantt/` | 聚合读 + 里程碑 / 依赖写 + 本域校验与测试 |
| P4 | `src/routes.ts`、`src/app.ts` | 集中注册 / 组装注入（公共单写） |
| P5 | `web/src/pages/gantt/`、`web/src/routes.tsx`、`layouts/ProjectLayout.tsx` | 页面 + 路由 + 导航挂载；`docs/frontend-routes.md` 更新 |

`#27`（负载）仅作**优先级参考**，不作硬前置；本文设计与独立目录工作不新增跨票硬依赖。

---

## 9. 待决项（⛔ 需授权 / 他人结论，不阻塞本文设计完成）

1. 真实开工入口的**具体文件授权 / 写窗口 / 现写者交接**（`task/routes.ts`、`rules.ts` 及必要测试）。
2. C10 **进度公式**与故事汇总边界的书面收口。
3. 里程碑**汇总归属 / 关联形态**（A 表 vs B 字段）与 `dueDate`、`ownerUserId` 是否保留。
4. **公共事件端口**签名 / 注入 / 失败语义（D 提案）；本文只做本域发布动作，⛔ 不承诺 outbox / exactly-once。
5. **跨可见范围约束**及关联对象可见性的安全方案：依赖边/里程碑指向子集外对象、可见任务所属故事不可见、milestone 如何由已有 task/story scope 派生；不得当成无约束或通过占位/计数泄漏。

> ★ **2026-10-24 已裁（口径变更；依据 PB-09，项目负责人 / DRI 裁定）**：里程碑可见性新口径 ——
>
> - **无关联任务**（`tasks` 为空）的里程碑 → 对项目内非 PM 成员**可见**；
> - 有关联任务、且其中**至少一个**任务在该成员可见范围内 → **可见**（与旧口径一致）；
> - 有关联任务、但**全部关联任务都在该成员可见范围之外**（敏感对象 / 超出授权范围）→
>   **仍然不返回**（不得泄漏存在性）。
>
> **「保留敏感保护」的边界**：本次改动**只**放开「无关联」这一类 —— 未关联的里程碑不携带
> 任何隐藏对象引用，返回它不会产生「某里程碑存在且与不可见任务相关」的信号；而「关联任务
> 全都不可见」的里程碑仍然 fail-closed，因为返回它本身就会暴露该关联关系的存在性。
> 因此 `taskIds` 也仍然只含可见任务，前端不需要改动。
>
> 实现（`src/modules/gantt/service.ts`，读端点里程碑 `where`）：
> `{ projectId, OR: [ { tasks: { none: {} } }, { tasks: { some: { taskId: { in: visibleTaskIds ?? [] } } } } ] }`。
> PM（`isGlobal === true`）仍为 `{ projectId }`，**行为完全不变**（项目内全部里程碑）。
> `visibleTaskIds ?? []` 的兜底分支在 `isGlobal` 为真时不可达（`visibleTaskIds` 只在非 PM
> 分支赋值），保留它只是让「关联任务全都不可见 ⇒ 不返回」的语义在类型上始终成立。
>
> 同步范围：模块测试 `src/modules/gantt/gantt.test.ts`（三种语义各 1 例 + PM 口径不变 1 例）、
> 设计文档本节；`docs/sprint-closure-dod-review-20261024.md`、`docs/tasks/role-b-development.md`
> 的旧口径描述按此加注（`docs/product-backlog.md` PB-09 由登记人维护，本批未改）。
>
> <details><summary>原登记（2026-10-24 B 实现口径，已被上条裁定取代；保留历史）</summary>
>
> **2026-10-24 已决（实现口径登记，B）**：里程碑的可见性**由可见关联任务派生** ——
> 非 PM 只返回「至少有一个**当前可见**关联任务」的里程碑（`where: { projectId, tasks: { some: { taskId: { in: visibleTaskIds } } } }`，
> `src/modules/gantt/service.ts:210-213`），`taskIds` 只含可见任务。
> 因此**无关联任务的里程碑对非 PM 不返回**（PM 全量可见）；这是刻意的 fail-closed：
> 若改为「无可见关联也返回」，会暴露「某里程碑存在且与不可见任务相关」的存在性信号。
> 代价是成员看不到尚未关联任务的里程碑——属**已知限制**，如需改变须先裁定
> 「无关联 / 仅关联隐藏任务的里程碑是否对成员可见」，并同步测试与前端文案；
> 本批不改行为，只登记事实。
>
> </details>
6. 六态**完整状态转换**及普通 PATCH 与验收入口差异——**未全批准不拍**；C #32 仅供日期应用。

---

## 10. GitHub #26 AC1–AC7 验收方案（**均未运行**，待实施后执行）

| AC | 设计响应 | 验证方法（测试 / 浏览器，未运行） |
|---|---|---|
| AC1 同视图展示需求 / 任务 / 里程碑 | `src/modules/gantt/` 聚合 + `web/src/pages/gantt/` | 真实响应与页面同时含三类对象；浏览器核对统一时间轴 |
| AC2 故事展开任务及计划时间 | 复用 `GET /stories/:storyId/tasks`（`task/routes.ts:204`） | 模块关联测试 + 浏览器展开 |
| AC3 故事计划 / 进度来自任务且一致 | §5 候选汇总；C10 未收口前只列候选 | 同账号同授权任务视图核对；未知公式先列待确认 |
| AC4 任务里程碑关联及汇总 | §3.1 模型 + 关联表候选 | 关联、汇总、边界测试；浏览器核对里程碑 |
| AC5 仅 FS、未放行不允许开工、拒绝环 | §4.2 校验 + §4.4 真实入口守卫 | `DONE` 不放行 / `CLOSED` 放行；自环 / 多节点环；**双请求互反建边（并发拒环）**；计划日期；直接入口绕过测试 |
| AC6 拒绝跨项目依赖，直接读库校验 | §3.2 约束 4，读真实 `Task.projectId` | 伪造项目 / 任务引用请求不得建立跨项目边 |
| AC7 敏感对象不出现在甘特和汇总 | §6 查询层过滤 | PM/member/viewer/outsider 敏感矩阵；边 / 里程碑 / 计数不泄漏 |

- 测试按 HTTP 接口层（唯一 seam）编写；越权用例必须打接口，不能用「前端不渲染按钮」代替。REST 候选见 §7，**未注册前不宣称通过**。

---

## 11. 最小开工契约（软门，按批次放行）

开工按批次独立放行，**不把全模块锁死在「全部结论齐备」之后**：

| 批次 | 最小前置 | 不受阻于 |
|---|---|---|
| P1 模型 / 基础日期展示（§3 模型 + 日期轴，不含故事进度） | §3 最小字段获批 + 用户批准 #26 单票方案 | C10、跨可见结论、旧入口守卫 |
| P2 故事进度相关实现 / AC3 | C10 书面收口 | — |
| P3 涉敏感读写 / 必要校验 / AC7 | 跨可见约束（§9.5）结论 | — |
| P4 真实旧开工入口守卫（§4.4） | §9.1 具体文件授权 / 写窗口 | 其余批次可先行，不互相阻塞 |

- C10 仅阻**故事进度相关**实现与最终 AC3，不阻塞模型 / 基础日期展示；跨可见约束仅阻**涉敏感读写 / 必要校验**，不阻塞其余；旧真实入口守卫**单独等授权**，不能全模块等全部题锁死。
- **可先做且不阻塞**：本设计文档、独立目录骨架设计、只读聚合口径与测试用例设计；**不等待** D 端口齐备即「设计完成」。
- 不增加复杂拖拽 / 调度 / 资源平衡；不建立对 C #32 / #27 的反向硬依赖。

---

## 12. 本文完成检查（Done when 覆盖）

- ✅ GitHub #26 模型 / 接口 / 验收设计，**无 code**：`Milestone` / `TaskDependency` 最小字段、关系、约束、索引候选（§3），候选路由（§7），逐 AC 测试（§10）。
- ✅ 需求 / 任务 / 里程碑 FS、故事日期 / 进度汇总与无任务 / 空值 / 部分可见边界（§4、§5）。
- ✅ 真实开工入口 / 事件 / 权限待决项，B 单写公共层不新增故事状态，C #32 只经 `Task` 日期应用刷新视图、不写派生结构（§1、§9）。
- ✅ 源路径行号（§2）、最小开工契约（§11）、估算归原 #26 8 人日（表头）。
- ✅ 依赖模型 / 运行时未实现**只影响真实联调，不阻塞本设计任务完成**；未决项不勾业务 AC。

**声明**：本文为 ROLE-B 单方 DRAFT，未与 C 书面核对、未冻结任何签名 / 路由 / 字段；不声称 GitHub #26 AC 已通过，不使用 `[]` 冒充无依赖，不新增故事状态或高级排期能力。

---

## 13. 2026-10-23 追加状态与开工范围裁定（历史正文保留）

- §7.1 的事件等待项已解除：甘特真实事件生产由 PR #90 合入；故事进度由 PR #73 落地 CLOSED/total 口径，不再等待 C10 或 D 的旧提案。
- 原 C 的 task 提炼基础子集已通过 PR #99 合入；C 明确无新增在途 task 改动，按既定条件交 B 的守卫窗口，不再等待审阅入口或让窗。
- 守卫候选 `5635b37` 已独立验证 task 391（含新增24）、排程142+12TODO、验收37及两端类型检查；未跑全量。**候选未合入**：语义评审识别验收返回 DOING 的另一写入口，不能拿绿测试宣称全覆盖。
- 负责人选择“所有进入 DOING 都校验”：凡原状态非 DOING 且结果为 DOING，含恢复/重开/验收 REJECT，统一校验前置 CLOSED 和次日计划边界；已经 DOING 的普通编辑、纯改期不属开工。本次不把 AI 的 TODO-only/快照/完整计划规则套入普通 PATCH。
- B 提供统一 shared 窄守卫与 app 注入；A 保有验收域，在原事务内调用。覆盖失败整事务回滚，不以 B 越界修改 A/C/D 模块补齐。真实 PATCH 与验收等入口覆盖并验证完成前，本地 #13/#15 与对应最终 AC 均不勾完成。
- 错误为冻结 `422 VALIDATION_FAILED` + `status`/`planStart: INVALID_VALUE` 的窄补充，见契约 I-2b/端点28追加说明。响应只给通用失败，不暴露隐藏前置字段/列表；不把此处字段不泄漏宣称成完全无动作侧信道。

权威决策：`scheduling.fs-enter-doing-all-paths`、`contract.fs-start-validation`。上述批准/排队状态不是新实现就绪 SHA，也不代表整票甘特验收完成。
