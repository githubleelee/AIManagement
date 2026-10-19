# ROLE-B → ROLE-C：#32 AI 排期所需最小只读数据契约（FROZEN v1.0）

> **状态：FROZEN v1.0（2026-10-19）· 已按 ROLE-C 的书面核对冻结，取代下方 DRAFT 状态行。**
> - C 的逐项核对：https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6247293014
> - B 的逐项答复（接受 / 调整）与 `task/` 写窗口：https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6260611783
> - 冻结范围、接受项与调整项：见文末 **§Z v1.0 冻结变更记录**。
> - 基线更新：核对基线 `398aa76` → 冻结基线 **`9c380ca`**（含甘特 / 负载读路径、`risk.flow`、`AuthzDb` 窄签名）。
> - 下方原始 DRAFT 状态段按「保留历史」处理，**不再生效**；正文事实基线与行号仍按 `398aa76` 快照标注，冻结后如有偏差以最新 main 复核。


> **状态：DRAFT · 待 C 书面核对 · 未冻结。**
> 本文是 ROLE-B 为 C `#32`（US-12 AI 排期建议）拟定的 `#26` / `#27` **最小只读数据契约候选**，
> 供 C 在实现生成阶段读取项目 / 任务 / 依赖 / 里程碑 / 成员负载时对齐字段与口径。
> **本文不声称已与 C 核对、未冻结任何签名，也不代表 `#26` / `#27` 的接口已实现或已注册。**

> **口径同步状态**：已确认业务口径来自最新本地项目负责人确认稿及 `DECISIONS.md`。`docs/team-handoff.md`、索引及 #24 中旧的 C2/C3/C6 待确认文字尚待本地 #42 另行同步，本文不声称远端已经对齐；也不因旧文案再次阻塞已获明确确认的基础口径。

| 项目 | 内容 |
|---|---|
| 发起人 | ROLE-B / `githubleelee`（公共文件单写、契约统筹） |
| 接收人 | ROLE-C / `xichoutrees`（`#32` `ai-scheduling` 唯一业务写者） |
| 本地工单 | `docs/tasks/role-b-development.md` `#43`（本契约）；`#46` 事务协议（主代理另写）与本稿**并行对齐**：`#43` **不等** `#46` 整体完成，`#46` 收尾受 **FF #43** 约束 |
| 关联上游 | GitHub `#26` 甘特图 / 里程碑 / FS 依赖、`#27` 成员任务图与负载、`#32` AI 排期建议 |
| 基线 main | `398aa76d02f66ce9d62e4e1c340de408f15a1f0f` |
| 只读快照 | `/tmp/role-b-main-398aa76.GvfwFS`（当前工作区 HEAD `fb5cee2` 较老，**本文所有行号以快照为准**） |
| 业务依据 | `docs/role-c-issue-32-confirmation.md`、`DECISIONS.md`（最新 `supersedes` 条目）、`docs/plans/role-b-development.md`、`docs/tasks/role-b-development.md` `#43` |
| 事务 / 幂等 / 审计字段 | **不在本文**，见 `docs/role-b-scheduling-transaction-proposal.md`（主代理并行起草，本文不抢写） |
| 日期 | 2026-10-18 |

---

## 0. 阅读须知（必须先读）

1. **源字段已存在 ≠ 接口已实现。** 本文大量引用 `Task` 模型与既有端点的**现有字段**作为事实基线；
   但 `#26` / `#27` 的甘特、里程碑、FS 依赖、成员负载**均无任何实现**（见 §1.4），
   因此这些部分只给**候选形状**，且明确标注「待交付」，不得当成已可用接口。
2. **旧「三态、无 `CLOSED`」口径已过时。** 最新 main 已合入 US-08 / US-09：任务六状态
   `TODO / DOING / BLOCKED / SUSPENDED / DONE / CLOSED` 已落地（`src/shared/types.ts:38`、
   `src/shared/validation.ts:20`）。本文一律按六状态、且 **`DONE ≠ CLOSED`** 表述。
3. **本文不拟定、也不批准**下列内容：新的 REST 路径、供应商 / 模型 SDK、全局 `hash` 字段、
   契约「版本」字段、过载阈值（「超过 N 即过载」）。凡出现相关字样，均为**候选 / 待确认**。
4. **C2 / C3 / C6 已由项目负责人确认**，不能再列为「待拍」；本文直接采用其口径（见 §2.4、§2.6）。
   C11 / C12 等**未全确认**，不得据本文推定完成。
5. **已确认：仅对 `TODO` 任务的 `planStart` / `planEnd` 应用**（非「建议」）；应用后 B 的甘特 /
   负载视图**从同一任务数据自然更新**，不由 `#32` 写派生结构（见 §2.6）。
6. 本文只讨论**只读消费**与**最小字段**；`#32` 的具体字段与 C 核对后才能勾 `#43` done，
   本轮可交付的是**可审阅提案**，不是已冻结契约。
7. **D 侧端口提案：本轮尚未取得可引用 / 可确认的 D 提案。** 只读远端证据：`#31` / `#37`
   均无评论，当前公开 open PR 仅 `#39`；**未见可引用的 D 最小端口提案**。
   这**不代表 D 私下没有实现**，也不据此标注 D 已交付或接口已冻结。
   本契约的自身设计部分可继续，**不等 D 两类端口齐备**（main 仍以固定 `398aa76` 快照为源）。

---

## 1. 事实基线（快照 `398aa76`，逐条可核对）

### 1.1 任务模型与状态（已存在）

| 事实 | 来源（相对路径:行） |
|---|---|
| `Task` 字段：`id / projectId / storyId / title / description / ownerUserId / acceptorUserId / planStart / planEnd / status / progress / blockedReason / isSensitive / createdAt` | `src/db/schema.prisma:117`（字段 `:119-131`） |
| `planStart` / `planEnd` 为 `String`，语义 `'YYYY-MM-DD'` | `src/db/schema.prisma:125-126` |
| `status` 为 `String`，默认 `TODO`；数据库不约束枚举 | `src/db/schema.prisma:127` |
| 六状态枚举定义 | `src/shared/types.ts:38`；Zod 枚举 `src/shared/validation.ts:20` |
| 任务响应类型 `Task` / `TaskView`（内嵌 `owner` / `acceptor` 的 `UserBrief`） | `src/shared/types.ts:103`、`:123` |
| 计划日期格式校验 `^\d{4}-\d{2}-\d{2}$` | `src/shared/validation.ts`（`dateSchema`） |

### 1.2 任务读取 / 写端点（已实现，**只读消费只取读端点**）

| 端点 | 语义 | 来源 |
|---|---|---|
| `GET /stories/:storyId/tasks`（端点 24） | 按故事列任务；`project.read`；查询层可见性过滤 | `src/modules/task/routes.ts:204` |
| `GET /projects/:projectId/tasks?ownerUserId=`（端点 26） | **按项目列任务**，可按负责人过滤；`project.read`；可见性与负责人条件都拼进同一 `where` | `src/modules/task/routes.ts:248` |
| `GET /tasks/:taskId`（端点 27） | 任务详情；`project.read`；唯一鉴权入口 | `src/modules/task/routes.ts:373` |
| `PATCH /tasks/:taskId`（端点 28） | 部分更新（含计划 / 状态）；**`#32` 应用受控路径不复用为逐条 PATCH** | `src/modules/task/routes.ts:402` |
| `GET /projects/:projectId/members`（端点 7） | 项目成员列表 `ProjectMemberView[]`（`userId / role / joinedAt / user`） | `src/modules/project/plugin.ts:182`；类型 `src/shared/types.ts:61` |

> 端点 26 是 `#32` 读取「某负责人名下任务」的**唯一现成查询路径**；
> 但它**不返回**依赖 / 里程碑 / 负载聚合，这些在 §1.4 标注为待交付。

### 1.3 鉴权、可见性与项目隔离（已实现，冻结入口）

| 事实 | 来源 |
|---|---|
| 唯一鉴权入口 `can(actorUserId, action, ref)`，判定顺序：对象不存在 404 → 非成员 404 → PM 全允许（含敏感）→ 敏感未授权 404 → 两个**成员关联动作**例外分支：`task.progress`（负责人可推进自己的任务）/ `task.accept`（验收人可验收）按对象关系放行，且 **VIEWER 一律 403 不放权** → 其余写类动作（含 `task.write`）对 MEMBER/VIEWER 403（**普通任务编辑仍是 PM-only**） | `src/modules/authz/permissions.ts:123`；`task.progress` / `task.accept` 分支 `:146-163` |
| 列表可见性 `visibilityScope(actor, projectId, objectType)`：PM → `{mode:'all'}`；其余 → `{mode:'subset', ids}`（非敏感 + 自己被指名的敏感对象） | `src/modules/authz/permissions.ts:182` |
| **查询层过滤**范式（禁止「先查全量再内存 filter」，否则计数泄漏敏感存在性）：可见性与业务条件拼进同一 `where.AND` | `src/modules/workbench/service.ts:109`、`:119`；`src/modules/task/routes.ts:248`（端点 26） |
| 敏感为对象级整体可见 / 不可见（无字段级脱敏）；载体 `ObjectVisibility(objectType, objectId, userId)` | `src/db/schema.prisma:177`；写端点 `PUT /stories/:storyId/sensitivity`、`PUT /tasks/:taskId/sensitivity`，`src/modules/authz/plugin.ts:18-38` |
| 项目隔离：`Task.projectId` 外键 `Restrict`；任务分配时跨项目引用由成员校验拦下（`NOT_PROJECT_MEMBER`） | `src/db/schema.prisma:135`；`src/modules/task/rules.ts:53` |
| **注意**：上述外键 / 成员校验只覆盖既有任务分配，**不代表 FS 跨项目依赖已校验**——FS 依赖模型尚未存在（§1.4），其跨项目约束属待交付，不得据此推定 | §1.4 |
| 组装 / 依赖方向：公共类型端口放 `src/shared/`，由 `src/app.ts` 组装注入；**禁止业务模块互调 service** | `DECISIONS.md` `arch.shared-ports-and-assembly`；`src/routes.ts`（集中注册） |

### 1.4 明确**缺失**（事实待交付，不得捏造）

在快照 `src/` 与 `web/src/` 全量检索 `milestone` / `gantt` / `workload` / `predecessor` /
`successor`（忽略大小写）**零命中**。因此：

- **无 `Milestone` 模型 / 表 / 端点**。
- **无 FS 依赖（`Dependency`）模型 / 表 / 端点**；Sprint 1 契约 `Out of Scope` 明列
  「任务 FS 前置依赖」（`docs/sprint1-spec-interface-contract.md`，Out of Scope 段）。
- **无成员负载 / 甘特聚合服务或端点**。

> 结论：`#26` / `#27` 的依赖与里程碑只能给**候选形状**（§3），其读取接口**待 B 交付**。
> **必须区分「不可用」与「已知为空」**（这是必要语义）：在依赖模型交付前，
> 「取不到依赖」不得表达为 `dependencies: []`——后者会被误读为「确实没有前置依赖」。
> 具体字段名 / 包装（如 `state:'unavailable'`）**仅为候选**，不是已批准的强制协议；
> 该包装**只有两态**（有值 / 不可用），**不要称三态**。
> **运行时未实现只影响真实联调，不构成 `#43` 设计冻结的硬阻塞**（见 §6）。

---

## 2. 候选契约（DRAFT，待 C 书面核对）

### 2.1 项目隔离与对象可见性（有效权限语义候选）

- **一切读取以 `projectId` 为边界**：`#32` 只处理调用者当前项目的数据；对象 `projectId`
  与请求项目不一致视为不可见。
- **有效可见性** = `visibilityScope(actor, projectId, 'task')` 的结果：
  - PM → `all`；
  - MEMBER / VIEWER → `subset`（非敏感任务 + 被 `ObjectVisibility` 指名的敏感任务）。
- **`#32` 生成 / 查看 / 确认 / 审计入口本身是 PM-only**（`DECISIONS.md`
  `scheduling.permission-pm-only`），但**AI 参与的数据子集仍须单独按敏感过滤**（§2.4），
  不得因 PM 可见敏感就默认把敏感对象送入 AI 上下文。
- **每次请求、每次确认 / 重试都重新鉴权**（撤权即时收敛），不缓存越权结果。

### 2.2 合法读取方式（候选）

允许且仅允许以下两种，均**只读**：

1. **直接读库**：`#32` 在其独立目录内用注入的 `PrismaClient` 查询，自行组装最小只读视图。
   参照 `src/modules/workbench/service.ts`：可见性条件与业务条件**拼进同一 `where.AND`**，
   在查询层过滤，不内存过滤、不内存计数。
2. **经 `src/shared/` 公共端口注入**：由 B 在 `src/app.ts` 组装注入的只读端口；
   `#32` 只依赖端口类型，不依赖实现。

**禁止**：`#32` 调用 `src/modules/task/`（或任何其他业务模块）的 service；
禁止跨模块调 service 做数据聚合（`arch.shared-ports-and-assembly`、
`arch.legacy-task-controlled-extension`）。跨模块只允许经 HTTP 或经公共端口。

- **直接读库是合法选项**，本文不把它降为次选；是否额外提供 `src/shared/` 只读端口由 C / B 核对。
- **不要把「禁止跨业务 service」扩大为「禁止一切 helper」**：本域内部的读取 / 组装 helper 不受限；
  仅**纯规则复用**（如复用任务分配校验）的边界以 **`#46` 方案为准**，本文不擅定。

### 2.3 最小只读字段（已明确、可先收口）

以下字段来自现有 `Task` 模型，属「已存在、可核对」，但**是否作为 `#32` 最终输入仍待 C 核对**：

| 用途 | 最小字段 | 说明 |
|---|---|---|
| 任务计划 | `id, projectId, storyId, ownerUserId, planStart, planEnd, status` | 计划 / 状态 / 负责人；`storyId` 供定位故事 |
| 敏感判定 | `isSensitive` | **仅用于过滤，不得进入 AI 上下文** |
| 负载基数 | `ownerUserId, status` | 负载计数口径见 §2.4 |
| 版本 / 过期基线 | `createdAt`（现有）；**无 `updatedAt`** | 快照指纹候选见 §2.5；**不新造版本字段** |

- 展示用 `title` 等可由读取方按需取，但 **AI 上下文只应含非敏感最小集**。
- **不要求**把整行 `Task` 序列化进快照（§2.5）。
- **缺失字段**：`Milestone`、`Dependency` 无模型，属**待交付**，见 §3 候选形状。

### 2.4 计数基数必须按**受众**分开，防止泄漏隐藏对象基数（负载口径 C6 已确认；受众分离机制为本文候选，待 C 核对）

**#32 的建议/审计入口始终 PM-only。** 下方 MEMBER/VIEWER 的 visible-range 形状仅供 #27 等通用负载视图跨域复用，不代表这些角色获得 #32 入口、响应或审计权限。

| 基数 / 受众 | 定义 | 下发边界 |
|---|---|---|
| `visiblePopulation`（普通可见范围） | `visibilityScope` 作用域内的任务数 | 可下发 MEMBER / VIEWER；**须标注「可见范围」** |
| `globalPopulation`（PM 受保护展示基数） | 该项目**全部**任务数 | **仅 PM 内部展示 / 审计**；**不下发** MEMBER / VIEWER，**不进入**外部模型 |
| `excludedSensitiveCount`（排除敏感数） | 从可见 / 参与范围中排除掉的敏感对象数 | **仅 PM 内部展示 / 审计**；**不下发** MEMBER / VIEWER，**不进入**外部模型 |
| `aiPopulation`（实际 AI 输入） | 排敏感子集后**实际进入 AI** 的任务数 | 可随建议记录给 PM 审计；对外只体现排敏感子集 |

- **禁止把 `globalPopulation` / `excludedSensitiveCount` 无条件下发给** MEMBER / VIEWER
  或外部模型——那会通过计数泄漏隐藏（不可见 / 敏感）对象的存在性。
- **AI 的任务 / 依赖 / 里程碑 / 负载均基于排敏感子集**；**禁止经由依赖边、聚合或计数间接泄漏**
  子集外对象的存在。
- **跨子集约束**（如依赖边 / 里程碑引用到排敏感子集之外的隐藏对象）如何安全处理
  **列为 C 待核对**（§5）；**不得默默当成「无依赖」**。任何会透露隐藏对象存在的排除数量/占位提示，只能在 PM 受保护的内部视图处理，不能发往外部模型。相关约束未能安全、完整核验时，不得把正式应用校验标为成功，见 #46 的候选 fail-closed 守卫；具体数据表示与处理方式仍待核对。
- **负载定义（C6，已确认）**：负载 = 负责人名下**所有非 `CLOSED` 任务数（含 `DONE`）**；
  不做工时 / 技能 / 产能评分。
- **不设过载阈值**：负载只展示分布，**不得**写死「超过 N 即过载」。

### 2.5 输入范围 / snapshot / fingerprint 候选协议（非全库实体 JSON）

`#32` 生成建议时需记录输入范围与可追溯快照。候选最小形状（**字段名待 C 核对，非冻结**）：

- `InputScope`（输入范围）：`projectId`、`asOf`（**既有 ISO 8601 UTC 时刻**，沿用现有 wire 格式，
  **不擅改时间戳格式**）、实际参与的任务 id 列表或负责人过滤条件、`aiPopulation` 等计数
  （PM 审计另含 `excludedSensitiveCount`，见 §2.4）。
- `SnapshotFingerprint`（候选）：对**参与任务的最小字段集合**做稳定摘要，用于
  「相关数据变化则整份过期」判定。**这只是候选分量**：仅哈希任务的
  `id + planStart + planEnd + status + ownerUserId` **不足以**覆盖 C 已确认的过期基线要求
  （成员变动、FS 依赖、里程碑、参与负载范围、权限变动）。**完整快照范围待 `#46` 对齐**，
  本文**不宣称已足够**。
- **业务日期语义**：`planStart` / `planEnd` 等业务日期为 `YYYY-MM-DD`，时区语义
  `Asia/Shanghai`（C3 已确认）；**与 `asOf` 的 ISO 8601 UTC 时间戳是两回事**，不得混用。

**边界（重要）**：

- **不得**存整库 / 全量实体 JSON，**不得**把真实敏感 `data` 写入快照。
- **不新增全局 `hash` 字段作为已批准契约**；摘要算法与幂等键 / 冲突语义属
  **`docs/role-b-scheduling-transaction-proposal.md`（`#46`）**，本文只声明「需要可复算的输入范围」。
- 过期判定所需字段与 `#46` 的快照 / 幂等字段以 `#46` 提案为准，本文不抢先冻结。

### 2.6 应用后更新语义（C2 / C3 / C6 已确认口径，非候选；应用细节归 `#46`）

- **已确认：仅 `TODO` 任务可写 `planStart` / `planEnd`**；不改负责人 / 验收人 / 状态 / 依赖 / 里程碑。
- FS 放行前置必须为 **`CLOSED`**（`DONE` 不算通过）；计划按**自然日**（含周末，起止日均计入）；
  FS 后继建议开始不早于前置计划结束日的**次日**。
- 时区统一 **`Asia/Shanghai`**，日期语义 `YYYY-MM-DD`。
- **应用后 B 视图从同一任务数据自然更新**：甘特 / 负载由 `Task.planStart/planEnd/status` 派生，
  `#32` **不写任何派生聚合 / 依赖 / 里程碑结构**。
- 事务边界、整份原子、幂等重放、并发冲突、审计落库**全部归 `#46` 事务协议文件**，本文不复述。

---

## 3. 最小 TypeScript 候选形状（**未实现 · 待 C 核对**）

> 以下为**候选**，不是已冻结签名，也不表示对应端口 / 表已存在。
> `Milestone` / `Dependency` 无任何实现（§1.4），其形状为**待交付提议**。

```ts
// —— 已存在字段的只读投影（候选；字段来自 src/db/schema.prisma:117） ——
// 注意：这是 #32 侧的最小读模型候选，不代表新增公共类型。
type SchedulingTaskRead = {
  id: string
  projectId: string
  storyId: string
  ownerUserId: string
  planStart: string // 'YYYY-MM-DD'
  planEnd: string   // 'YYYY-MM-DD'
  status: 'TODO' | 'DOING' | 'BLOCKED' | 'SUSPENDED' | 'DONE' | 'CLOSED'
  isSensitive: boolean // 仅用于过滤；不得进入 AI 上下文
  createdAt: string
}

// —— 计数基数按“受众”分开，防止把隐藏对象基数下发给 member/viewer 或外部模型（§2.4） ——
// 普通可见范围：MEMBER / VIEWER 可读
type VisibleRangeBasis = {
  audience: 'visible-range'
  visiblePopulation: number
  scopeLabel: '可见范围'
}
// PM 受保护展示 / 审计基数：不下发 member/viewer，不进入外部模型
type PmProtectedBasis = {
  audience: 'pm-protected'
  globalPopulation: number
  visiblePopulation: number
  excludedSensitiveCount: number
  scopeLabel: '全项目'
}
// 实际 AI 输入：只描述排敏感子集
type AiInputBasis = {
  audience: 'ai-input'
  aiPopulation: number
  scopeLabel: '排敏感子集'
}
type PopulationBasis = VisibleRangeBasis | PmProtectedBasis | AiInputBasis

// —— 成员负载（候选；聚合口径 C6 已确认，接口待交付） ——
type MemberWorkload = {
  userId: string
  openTaskCount: number // 负责人名下 status !== 'CLOSED'（含 DONE）
  taskIds: string[]
}

// —— FS 依赖（候选形状；模型 / 端点均不存在，待 B 交付） ——
// 交付前读取方必须区分「不可用 / 已知为空」（字段名候选，如 state:'unavailable'），禁止用 [] 冒充「无依赖」。
type FsDependency = {
  predecessorTaskId: string
  successorTaskId: string
  type: 'FS'
  // 放行前置：predecessor.status === 'CLOSED'；后继计划开始 >= predecessor.planEnd 次日
}

// —— 里程碑（候选形状；模型 / 端点均不存在，待 B 交付） ——
type Milestone = {
  id: string
  projectId: string
  name: string
  dueDate: string // 'YYYY-MM-DD'，候选；字段待 C 与 B 核对
  // 无关联里程碑时不编造、不自动改里程碑
}

// —— 两态读取包装（候选，非已批准强制协议）：区分“有值”与“不可用” ——
// 只有两态，不要称三态；字段名 state/note 仅候选。
type Availability<T> =
  | { state: 'ok'; data: T }
  | { state: 'unavailable'; note: string; data: null }
```

---

## 4. 虚构样例（**全部虚构 · 未运行 · 待运行**）

> 以下数据为演示形状用，**不含任何真实敏感资料**；样例均**未运行**，不得当成测试证据。

### 4.1 正常（PM，虚构）

```jsonc
{
  "basis": { "audience": "pm-protected", "globalPopulation": 12, "visiblePopulation": 12,
             "excludedSensitiveCount": 0, "scopeLabel": "全项目" },
  "workload": [
    { "userId": "u-alice", "openTaskCount": 3, "taskIds": ["t1", "t2", "t5"] }
  ],
  // 字段名 state/note 仅候选；区分“不可用”与“已知为空”。
  "dependencies": { "state": "unavailable", "note": "FS 依赖模型尚未交付（#26）", "data": null },
  "milestones":   { "state": "unavailable", "note": "里程碑模型尚未交付（#26）", "data": null }
}
```

### 4.2 敏感子集（PM 可见全项目，但 AI 排除敏感）

```jsonc
{
  "basis": { "audience": "pm-protected", "globalPopulation": 12, "visiblePopulation": 12,
             "excludedSensitiveCount": 2, "scopeLabel": "全项目" },
  "aiInput": { "audience": "ai-input", "aiPopulation": 10, "scopeLabel": "排敏感子集" },
  "note": "AI 实际参与 10 条；2 条敏感对象未进入上下文（该计数仅 PM 审计，不入外部模型）。"
}
```

### 4.3 非成员（调用者不属于该项目）

```jsonc
// 读取入口应返回 404 NOT_FOUND（与「对象不存在」逐字一致，不泄漏存在性）。
{ "error": { "code": "NOT_FOUND", "message": "资源不存在" } }
```

### 4.4 空数据（项目存在、任务为空）

```jsonc
{
  "basis": { "audience": "pm-protected", "globalPopulation": 0, "visiblePopulation": 0,
             "excludedSensitiveCount": 0, "scopeLabel": "全项目" },
  "workload": [],
  "dependencies": { "state": "unavailable", "note": "FS 依赖模型尚未交付（#26）", "data": null }
}
```

### 4.5 普通可见范围（MEMBER / VIEWER，虚构）

```jsonc
{
  "basis": { "audience": "visible-range", "visiblePopulation": 4, "scopeLabel": "可见范围" },
  "note": "不含全项目基数、不含排除敏感数——避免通过计数泄漏隐藏对象存在性。"
}
```

> 注意 4.4：**负载为空数组是合法的「确实没有任务」**；而 `dependencies` 为
> `unavailable` 是**数据源未交付**，两者语义不同，不可互换（§1.4）。

---

## 5. C 需书面核对的最小问题（逐条回答后本文才可能冻结）

1. §2.3 的最小字段集合是否足够？是否还需要 `progress` / `blockedReason` 之外的字段？
   （补充：项目负责人 2026-10-18 已定 AI 建议采用**共享的「建议 + 处置」存储**，#32 与 #33 复用同一套，字段以 D 的 #31 提案为源并与本契约合并成一份（`DECISIONS.md` `ai.suggestion-store-shared`）；请 C 核对最小字段与共享字段的合并方式。）
2. §2.4 按受众分开的计数基数（`visible-range` / `pm-protected` / `ai-input`）命名与返回位置是否接受？
   `aiPopulation` 是否还含其他经确认的排除条件？请核对字段放置能保证全局/排敏感数量仅在 PM 内部展示与审计，不向无权角色或外部模型泄漏；不将已有不泄漏要求重新开放为可选项。
3. §2.4 **跨子集约束**如何在服务器内安全核验（依赖边/里程碑指向 AI 子集外对象），且外发不暴露隐藏对象存在？字段/处理方案需 C 核对；不得默默当无依赖，无法完成必要约束核验时不执行正式计划应用。
4. §2.5 快照指纹**仅是候选分量**，仅任务 5 字段不足；完整快照范围是否同意**待 `#46` 对齐**？
   `asOf` 用既有 ISO 8601 UTC、业务日期用 `Asia/Shanghai` + `YYYY-MM-DD` 是否接受？
5. §3 的 `Milestone` / `Dependency` 候选形状是否与 `#26` 预期一致？
   交付前区分「不可用 / 已知为空」（字段名仅候选，不用 `[]` 冒充）是否接受？
6. §2.2 合法读取方式是否以「直接读库」为准，还是需要 B 另立 `src/shared/` 只读端口？
   若需端口，请给出 C 侧期望的最小方法签名；**纯规则复用边界以 `#46` 为准**是否接受？
7. §2.6「应用后不写派生结构、由原任务数据自然更新」是否与 C 的实现计划一致？

---

## 6. 明确**未完成**的 Done when 项与建议 Blocker（`#43`）

`#43` Done when 要求「契约文本与 C 核对后冻结」。本轮**只能交付可审阅提案**，以下**仍未完成**：

| 未完成项 | 说明 |
|---|---|
| **未与 C 核对** | 本文为单方 DRAFT；§5 七问均无 C 书面答复。 |
| **未冻结** | §3 全部形状为候选；无任何签名冻结。 |
| **依赖 / 里程碑运行时未实现** | `#26` 的 `Dependency` / `Milestone` 模型、端点、聚合**均不存在**（§1.4）；只影响**真实联调**，不阻塞设计冻结。 |
| **快照 / 幂等字段待对齐** | 摘要、幂等键、冲突语义归 `#46`，两文件字段尚未由主代理对齐。 |
| **AI 端口字段未冻结** | 公共 AI 端口字段 / 版本仍待 B+D 书面冻结（C 确认稿第 2、4 项）；本轮尚未取得可引用 / 确认的 D 提案（`#31` / `#37` 无评论，open PR 仅 `#39`），不代表 D 未私下实现。 |
| **无代码测试证据** | 本文为文档；样例全部**未运行**（§4）。 |

**建议 Blocker（`#43`）**：
> `#43` 设计冻结**只依赖 C 对 §5 的书面核对与相应字段约定**，**不依赖 `#26` / `#27` 模型 / 端点真正交付**
> （运行时未实现只影响真实联调，不作为设计冻结硬阻塞）。在此之前 `#43` 不应标记 done，
> 只能保留为「提案已交付、待 C 核对」。

**本轮可先收口**（不阻塞）：§2.1–§2.4 已明确的最小字段与 C2 / C3 / C6 口径，
以及按受众分离、防止泄漏的计数基数——这些不等 `#04` / `#09` 完整设计、不等 B 两票整体 AC，
也**不等 `#46` 整体完成**。

---

## 7. 与事务协议文件（`#46`）的边界

- **本文负责**：只读字段、可见性 / 隔离语义、按受众分开的计数基数、输入范围与 snapshot 的**只读候选**。
- **`docs/role-b-scheduling-transaction-proposal.md`（主代理另写）负责**：
  读 / 写端口、事务边界、事务内鉴权与规则复用、整份原子、幂等 / 冲突、
  **snapshot 的持久化 / hash / 幂等键**、事件提交与失败留痕、审计记录字段。
- 两文件的字段可后续由主代理对齐；**本文不复述、不抢先冻结事务细节**。
- `#43` 与 `#46` **并行对齐**，`#43` 不等 `#46` 整体完成；`#46` 收尾受 **FF #43** 约束。

---

## 8. 验证方案（仅文档一致性，无代码测试）

本文为提案文档，**不运行任何代码测试**。核对方式：

1. **事实核对**：§1 每条引用的 `相对路径:行` 均在快照 `398aa76` 上可复现；
   §1.4 的「零命中」可用 `grep -rni "milestone\|gantt\|workload\|predecessor\|successor" src web/src` 复核。
2. **口径核对**：§2.4 / §2.6 与 `DECISIONS.md` 的 `scheduling.load-aggregation-baseline`、
   `scheduling.fs-release-closed-natural-days`、`timezone.project-wide-asia-shanghai` 一致。
3. **冻结核对**：全文须始终带 DRAFT / 待 C 核对 / 未冻结标记；不得出现「已与 C 核对」「已冻结」表述。
4. **样例核对**：§4 样例均为虚构且标注未运行；不得当成通过证据。

---

## 声明

- 本文为 **ROLE-B 单方 DRAFT**，**未与 ROLE-C 书面核对、未冻结**，不代表 `#26` / `#27` 接口已实现或已注册。
- 源字段已存在**不等于**接口已实现；缺失的 `Milestone` / `Dependency` 按事实标注**待交付**，未捏造端点或用空数组冒充无依赖。
- 本文不新增 REST 路径、供应商 SDK、全局 `hash`、契约版本或过载阈值；事务 / 幂等 / 审计字段见 `docs/role-b-scheduling-transaction-proposal.md`。

---

## Z. v1.0 冻结变更记录（C 核对结论 → 本文落点）

| C 的答复（§5 七问） | 处置 | 本文落点 |
|---|---|---|
| 1 最小字段与共享字段合并 | **接受**：补 `acceptorUserId`、成员读取含 `userId/role`、补任务—里程碑关联；`title` 仅按展示需要；`description/progress/blockedReason` 不作首批必需；`createdAt` 不充当版本；排敏同时覆盖任务与**关联故事**且在**查询层**完成；建议/处置字段并入共享契约、**不建 C 专属表** | §2.3 字段集合、§2.4 计数基数、§7 与 #46 边界；「建议/处置字段」改指 `DECISIONS.md` `ai.suggestion-store-shared` |
| 2 受众基数与返回位置 | **接受**：拆独立 DTO / 序列化出口（`visible-range` / `pm-protected` / `ai-input`）；PM 内部基数与排除敏感数**不进模型**；AI 负载按实际非敏感参与任务重算（非 CLOSED 含 DONE）；不得静默丢记录；不新增过载阈值 | §2.4（受众分离升级为**独立出口**）、§3 候选形状按出口拆分 |
| 3 跨子集约束 | **接受**：模型不接收隐藏端点/边/计数/占位；服务端在统一鉴权后核验**与候选变更有关的全部真实 FS 约束（含未改期相邻任务）**；不得删边冒充无依赖；不足则**不允许正式应用**；私有敏感约束仅受保护服务端验证、不写快照正文 | §2.1、§2.5、§6 Blocker 项；私有摘要与读取边界见 #46 §10 |
| 4 快照 / asOf | **接受**：快照范围按 C 所列字段；`asOf` 保持 **ISO UTC**、业务日期 **YYYY-MM-DD / Asia/Shanghai**；`asOf` 是**一致读取标记**，非锁或版本；另记生成时间 | §2.5（快照协议） |
| 5 FS / 里程碑形状与可用性 | **接受**：对齐 `#26` 现有字段（不另造平行模型）；保留**有值 / 不可用两态**，已知空 = 可用且空；截断 / 完整性**另列元数据**；正式应用所需集合不可用 / 截断 / 完整性未知时 **fail-closed**；不虚构里程碑 | §1.4 缺失项、§2.3、§2.5 |
| 6 读取方式 | **接受**：`ai-scheduling` 目录内经**注入 DB 的只读投影**，B **不另建聚合服务**；须支持**同一事务内复读**；先统一 `can()` / `visibilityScope()`；私有约束读取与外发 DTO 严格分离；不调其他域 service；如需 shared 只读端口，B 按同等语义提供且**不先冻结方法名** | §2.2 合法读取方式 |
| 7 应用后派生更新 | **接受**：仅改 TODO 的 `planStart/planEnd`；不写甘特 / 负载派生结构；不改依赖与里程碑；成功后刷新真实读取视图；**「负载数必须变化」不作为验收条件** | §2.6 |

**未接受 / 有保留的项**：无。**仍待外部输入**：D 的 `#31` 共享建议存储字段提案（`ai.suggestion-store-shared`）——B 已按本评论接受的最小字段集先行冻结，D 若其后提交补充字段按**追加迁移**处理。
