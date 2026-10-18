# ROLE-B → GitHub #27：成员任务图与负载 · 单票设计（DRAFT）

> **状态：DRAFT · 可交用户审阅 · 未冻结。** 本文只写 `#27` 的字段、端点候选、权限边界、页面方案与文件清单；
> **不代表接口已注册、代码已实施、AC 已运行通过**。编码、公共挂载与外部发布均需另行授权。
> 依据：`docs/role-b-baseline-review.md`（#01）、`docs/role-b-contract-register.md`（#02）、
> `docs/role-c-issue-32-confirmation.md`（C 确认稿）、`DECISIONS.md` 最新条目；
> `docs/role-b-scheduling-data-contract.md`（#43）与 `docs/role-b-scheduling-transaction-proposal.md`（#46）均 **DRAFT**，
> 本文仅引用其**字段思想**（按受众分离的计数基数），不视为已冻契约。
> 代码基线：只读快照 `/tmp/role-b-main-398aa76.GvfwFS`（commit `398aa76`）；工作区 HEAD `fb5cee2` 较老，**不采用其状态/权限结论**。

## 1. 范围与已确认前提

- 范围：`src/modules/workload/`（后端只读查询）+ `web/src/pages/workload/`（页面）+ 本域测试；公共挂载由 B 单写、**另批**。
- 不做：技能匹配、请假/工时、并行度、过载阈值、新角色、协作人模型、跨项目/跨 task/workbench service 调用（`arch.shared-ports-and-assembly`、`arch.legacy-task-controlled-extension`）。
- 已确认（最新 main + C 确认稿 + `DECISIONS.md`）：
  - 六状态 `TODO/DOING/BLOCKED/SUSPENDED/DONE/CLOSED` 已落地（`src/shared/types.ts:38`、`src/shared/validation.ts:20`）；**`DONE ≠ CLOSED`**。
  - **C6 基础负载**：负载 = 负责人名下**所有非 `CLOSED` 任务数（含 `DONE`）**，不做评分；PM 看全项目，MEMBER/VIEWER 只看授权可见任务并标「可见范围」；不设「超过 N 即过载」阈值（`DECISIONS.md` `scheduling.load-aggregation-baseline`）。
  - **C3** 全项目 `Asia/Shanghai`；**C2** FS 前置须 `CLOSED`——本轮负载只做**基础非 CLOSED 计数**，不因日期口径阻塞（见 §6）。
  - `CLOSED` 已在最新 main 存在，**不再以「无 CLOSED/六态不存在」作为 Blocker**（#01 结论）。

## 2. #27 AC 与本设计的对应（AC 均未运行）

| AC（GitHub #27 原义） | 设计落点 | 状态 |
|---|---|---|
| AC1 按成员列未关闭数量与清单 | `WorkloadView.members[]`，`openTaskCount` = 同 where 的 `status != 'CLOSED'` | 设计 |
| AC2 点击成员看状态/计划时间 | 成员详情复用端点 26/27（HTTP），或候选 `workload/:userId`；展示 `status/planStart/planEnd` | 设计 |
| AC3 与任务列表/工作台同口径 | 与端点 26、工作台 todo 用相同非 CLOSED 条件；比较须同项目/负责人/actor/授权（§6） | 设计 |
| AC4 仅本项目成员，outsider 404 | 成员来自 `GET /projects/:id/members` 同源 `ProjectMember`；`can('project.read')` 不通过即 404 | 设计 |
| AC5 敏感不计入无权负载/计数 | `visibilityScope()` 进查询层，列表与 count 同 `where`（§4） | 设计 |
| AC6 viewer 范围按 C6 | 响应按受众分基数：MEMBER/VIEWER 仅 `visiblePopulation` + 「可见范围」标签 | 设计 |

## 3. 端点候选（**均未注册 · 待批准 · 未冻结**）

后端既有契约**无 `/api` 前缀**；前端 `apiFetch` 统一代理 `/api`（`web/src/api.ts:54-64`）。

| 候选 | 语义 | 复用/新增 | 备注 |
|---|---|---|---|
| `GET /projects/:projectId/workload` | 聚合：项目成员 + 各成员非 CLOSED 负载计数 + 可见范围标签（+ 候选 population，可选） | **新增**，由 B 在 `src/routes.ts` 注册 | URL 待用户/公共骨架确认，**不称已注册** |
| `GET /projects/:projectId/workload/:userId`（备选） | 单成员**未关闭**任务清单（状态/计划） | **新增候选**，DB 同 `where`：`projectId + ownerUserId + visibilityScope + status != 'CLOSED'` | 端点 26 **无 status 过滤**，不能拿它冒充现成未关闭清单 |
| `GET /projects/:projectId/tasks?ownerUserId=` | 按负责人列任务（已实现，**仅 ownerUserId 可筛**） | 端点 26 | 复用则返回**全量状态**，须在调用/展示侧正确排除 `CLOSED`；若分页截断，**不得从 rows 推 total** |
| `GET /tasks/:taskId` | 任务详情（已实现） | 端点 27 | 详情跳转 |

- **不发明强制既有端点**；端点 26 现只有 `ownerUserId` 查询参数（`src/modules/task/routes.ts:262`），**不新增 `status` 查询参数**，也不假称已支持按状态过滤。
- 若走端点 26：可见性 + 负责人过滤虽在查询层（`:286`、`:290-296`），但 `CLOSED` 排除不在该端点职责内，须由消费方补过滤；聚合端点若自行实现，则 DB 内用同一 `where` 完成非 CLOSED，`total` 由 `count` 精确得出。
- 后端 workload **直接读库**，不 import `task`/`project`/`workbench` 的 service（`src/modules/workbench/service.ts:9-15` 同范式）。

## 4. 字段契约候选（命名待 C/用户核对，非冻结）

```ts
// 最小 UI 口径：AC1 真正需要的只是“可见范围标签 + 非 CLOSED 负载计数”。
type WorkloadBasis = {
  scopeLabel: '全项目' | '可见范围'
}

type MemberWorkloadRow = {
  userId: string
  role: 'PM' | 'MEMBER' | 'VIEWER'      // 来自 ProjectMember，不自造角色
  account: string; displayName: string  // 真实个人信息，仅在本 UI 内展示；不得整包外发模型
  joinedAt: string
  openTaskCount: number                  // 该 where 内该负责人 status !== 'CLOSED'（含 DONE）
}

// —— 候选（非最小、非必需，待用户/C 核对）：全项目/可见“全部任务人口”基数 ——
// 与 openTaskCount 是两种口径：population 数“全部任务”，openTaskCount 数“非 CLOSED”。
type TaskPopulationBasis =
  | { audience: 'pm-protected'; scopeLabel: '全项目';
      predicate: '该项目全部任务（含 CLOSED，含离组负责人任务）'; taskPopulation: number;
      visiblePopulation: number; excludedSensitiveCount: number }  // 仅 PM 内部展示/审计
  | { audience: 'visible-range'; scopeLabel: '可见范围';
      predicate: 'actor 可见任务（含 CLOSED）'; visiblePopulation: number }

type WorkloadView = {
  projectId: string
  basis: WorkloadBasis                       // 最小：scopeLabel（PM/其余同一结构，值不同）
  population?: TaskPopulationBasis           // 候选；若提供则明确为不同口径，不下发 member/viewer/AI
  members: MemberWorkloadRow[]                // 本项目当前成员；零任务成员 openTaskCount=0
}
```

- **两种口径不得混同**：`openTaskCount` 是**非 CLOSED 负载**（C6），`taskPopulation`/`visiblePopulation` 是**全任务人口**（含 CLOSED，候选）。每个计数字段都须自带状态谓词与范围（如上），**不得用人口数冒充负载**。
- **不得默默等值**：`Σ members[].openTaskCount` 与 `taskPopulation` **不能视为相等**——`removeMember` 不校验名下任务（`src/modules/project/service.ts:230-250`），存在负责人已离组的任务；该目录不含离组行，故两者口径不同，待确认（§11.1）。
- **AI 不入本 UI 响应**：`WorkloadView` 不含 `ai-input` 联合成员；AI 内部消费由 C 侧另行排敏感 + 最小字段投影（不含 `account`/`displayName` 等真实个人信息外发），本设计**不新增 AI 对外 endpoint**，#27 仍只读。
- **成员—任务关联**：以 `Task.ownerUserId` 定义；`Task` 无协作人字段（`src/db/schema.prisma:117-131`），本设计**不引入**协作人（C12 未确认）。
- **列表与计数同口径**：`members` 的计数与该成员可见任务清单使用**同一 `where`**；计数由 `count` 精确得出，明细行若限流不得反推总数（对齐工作台 `ROWS_PER_BLOCK` 纪律，`src/modules/workbench/service.ts:34-38`）。
- **空态**：项目无任务 → `members` 仍返回全部成员且 `openTaskCount=0`（与「数据源未交付」区分，后者在 #27 不存在数据源缺失问题）。

## 5. 权限边界

- 入口：`can(actorUserId, 'project.read', { kind: 'project', projectId })`（`src/modules/authz/permissions.ts:123`）。非成员/项目不存在 → 404（不泄漏存在性）。
- 查询层：`visibilityScope(actorUserId, projectId, 'task')`（`:182`）结果并入同一 `where`（`all` → 不加条件；`subset` → `id IN (...)`）；列表与 count 共用该 `where`（范式见 `src/modules/workbench/service.ts:109-131`）。
- 角色：
  - **PM**：全项目成员与负载；若提供候选 `population`，含 `taskPopulation`、`excludedSensitiveCount`（仅 PM 内部展示/审计）。
  - **MEMBER / VIEWER**：只读；`scopeLabel='可见范围'`；**不下发** `taskPopulation` / `excludedSensitiveCount`，仅可给候选 `visiblePopulation`。
  - **outsider**：404。
- **敏感**：无权敏感任务既不返回也不加计数（`visibilityScope` 在查询层过滤，禁止内存剔除）。
- **AI**：本视图外层不下发 `taskPopulation` / `excludedSensitiveCount`；也**不把 `members` 整包（含 `account`/`displayName`）送模型**。#32 若消费须由 C 侧另行排敏感 + 最小字段投影，不得以 AI 子集冒充 PM 全项目基数。
- 不改 `permissions.ts` 签名/`Action`（不在本票授权内）；只读聚合复用既有 `project.read`，不新增权限动作。

## 6. 与个人工作台的一致性

- 工作台 `todo.total` = **actor 本人**负责且 `status != 'CLOSED'`（`src/modules/workbench/service.ts:153/188`），覆盖该 actor **参与的所有项目**，`total` 精确、`rows` 最多 50（`:38/129`）；本设计**未给工作台新增项目过滤参数**。
- 比较负载与工作台 **必须同项目/同负责人/同 actor/同授权视角，且能证其数据为该范围全量**；**不得把工作台五块计数相加**（块间有重叠），**不得从 ≤50 条截断明细推计数**。
- **不可跨账号直接比**：PM 在项目负载里看到的是**他人成员行**，不能与该成员**自己**的工作台（其 actor 视角、跨其全部参与项目）直接对照；也不可用 `rows` 过滤后反推项目总数。
- 工作台 `isoToday()` 用 UTC（`:41`），与全项目 `Asia/Shanghai`（C3）存在实现差异：该差异只影响**日期子块**（逾期/近期），**不给基础非 CLOSED count 新增日期阻塞**；日期相关跨视图最终一致性待 A 收敛后实测。B 不越权改 A 业务。

## 7. 页面方案（`web/src/pages/workload/`，公共挂载另一批）

| 文件（候选） | 职责 |
|---|---|
| `WorkloadPage.tsx` | 项目内成员负载总览：成员行 + `openTaskCount` + 可见范围标签；加载/空态/错误/无权限反馈 |
| `MemberWorkloadDetail.tsx` | 点成员 → 任务清单（状态标签、`planStart/planEnd`）；空态「该成员暂无未关闭任务」 |
| `api.ts` | `getWorkload(projectId)` 等，经 `apiFetch` 走 `/api` 前缀 |
| `types.ts` | 前端视图类型（枚举转界面标签，复用 `labels.ts`） |
| `workload.css` | 本页样式 |

- **挂载**：`web/src/routes.tsx` 增 `/projects/:projectId/workload`（项目空间内）与导航入口，并更新 `docs/frontend-routes.md` —— 均由**公共骨架单写（B）另批**完成，本设计不主张已注册。
- 状态映射：`CLOSED` 与其余状态分开显示；`DONE` 标注「已提交待验收」，不得显示为「已完成/关闭」。

## 8. 文件清单（计划，未实施）

- 后端：`src/modules/workload/plugin.ts`、`service.ts`、`types.ts`；公共注册 `src/routes.ts`（B 单写）。
- 前端：`web/src/pages/workload/{WorkloadPage,MemberWorkloadDetail,api,types}.tsx|ts`、`workload.css`；公共挂载 `web/src/routes.tsx`、`docs/frontend-routes.md`（B 单写）。
- 测试：`src/modules/workload/*.test.ts`。
- 运行命令（编码获批后）：`npm run typecheck`、本模块测试；**本轮不装依赖、不跑 app**。

## 9. AC1–6 验证矩阵（**均未运行**）

| 场景 | 期望 | AC |
|---|---|---|
| PM | 全项目成员 + 负载；候选 `taskPopulation`（仅 PM）与负载**口径分开**；敏感任务在其可见基数内 | AC1/AC3/AC6 |
| MEMBER | 仅可见范围 + 负载；无 `taskPopulation`/`excludedSensitiveCount`/`global` | AC1/AC5 |
| VIEWER | 同 MEMBER，只读且标「可见范围」 | AC5/AC6 |
| outsider / 外项目 | 404（与项目不存在逐字一致） | AC4 |
| 敏感被指名人 | 仅其被指名的敏感任务计入并出现 | AC5 |
| 敏感未授权 | 不出现、不加计数（列表与 count 同 where） | AC5 |
| 跨项目 | 不混入他项目成员/任务 | AC4 |
| 零任务成员 | 出现在成员列表且 `openTaskCount=0` | AC1 |
| 多项目成员 | 只统计当前 `projectId` | AC4 |
| 分页/截断 | `total` 精确；不从明细行推计数 | AC3 |

以上为**测试设计**，不是本轮执行；代码落地与运行由后续编码授权完成。

## 10. 估算与授权

- 计划估算**只归原 #27 的 4 人日**（`docs/plans/role-b-development.md:29`），**不再向 C/D 重复收费**；本设计文档不新增估算。
- 编码、公共挂载、运行验证**另行授权**（本地 #05/#06/#07/#08），本设计不自动解锁。

## 11. 仍需确认但不阻塞设计交付

1. **退组负责人任务 / 全项目基数 vs 成员行合计**：`removeMember` 不校验名下任务（`src/modules/project/service.ts:230-250`），故可能存在 `ownerUserId` 已非本项目成员的任务。**「全项目基数」与「成员行合计」不能默默等同**；数据边界（是否单列「已离组」、基数是否含离组任务）**列待确认**，编码前须定。
2. **响应字段名/受众形状**需 C/用户书面核对（引用 #43 §2.4 只是思想，非冻结）；`ai-input` 已从本 UI 联合移出，AI 侧另做排敏感 + 最小字段投影。
3. **详情端点选择**：新增 `workload/:userId` 还是复用端点 26。
4. **candidate URL 与页面归属**（项目空间内 vs 顶层）由公共骨架确认；**未注册前不称可用**。
5. **分页/明细上限**：成员数与单成员明细是否限流、如何标精确 `total`。
6. C11（成员操作授权）、C12（协作人）**仍未确认**，本文不拍板；负载以负责人定义，不新增协作人。

## 12. 来源行号（快照 `398aa76`）

- `src/shared/types.ts:32`（故事三态）/`:38`（任务六态）/`:61`（`ProjectMemberView`）/`:103`（`Task`）/`:123`（`TaskView`）
- `src/db/schema.prisma:117`（`Task` 模型，字段 `:119-131`，`status :127`）
- `src/modules/task/routes.ts:204`（故事任务）/`:248`（端点 26 按项目+owner 过滤；`ownerUserId` 参数 `:262`，可见性 `:286`，where `:290-296`）/`:373`（任务详情）/`:402`（PATCH）
- `src/modules/authz/permissions.ts:123`（`can`）/`:149-163`（条件动作）/`:182`（`visibilityScope`）
- `src/modules/workbench/service.ts:38/129`（`ROWS_PER_BLOCK`）/`:41`（UTC `isoToday`）/`:109-131`（查询层 where + count）/`:153/188`（非 CLOSED 口径）/`:151`（`today`）
- `src/modules/project/plugin.ts:182`（端点 7 成员列表）；`src/modules/project/service.ts:230`（`removeMember`）
- `src/routes.ts:44`（工作台注册示例，新模块注册落点）；`web/src/api.ts:54-64`（`/api` 前缀）；`web/src/routes.tsx:40`（requirements 项目空间挂载示例）

## 声明

- 本文为 **ROLE-B 单方 DRAFT**，未与 C/用户冻结，**不代表 #27 接口已注册、代码已实施或 AC 已通过**。
- 未改其他文件/代码/任务清单/公开契约/`DECISIONS.md`，未 git 或远端写。
- 编码、公共挂载、外部发布与 AC 验收均需另行授权；本文可交用户审阅。
