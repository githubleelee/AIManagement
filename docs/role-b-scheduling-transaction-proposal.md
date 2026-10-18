# ROLE-B → ROLE-C：#32 AI 排期「公共读 / 写端口 + 事务 / 鉴权协议」提案（DRAFT）

> **状态：DRAFT / 待 C 书面核对，未冻结。** 本文只提出候选协议与待核对点，
> **不构成已确认接口**，不声称任何签名、命名、幂等键、hash、`outbox`、URL 已批准。
> 涉及 AI / 事件签名的部分**需 D 的对应提案**；**本轮尚未取得可引用 / 确认的 D 提案**
> （远端核实：#31 / #37 均无评论，公开 open PR 仅 #39），因此相关小节只标「待 D 提案」，不假装已交付或已冻结。

> **口径同步状态**：C2/C3/基础 C6 的“已确认”指最新本地项目负责人确认稿及 `DECISIONS.md`；`docs/team-handoff.md`、工单索引和 #24 的旧待确认文案尚待本地任务 #42 另行同步，本文不声称线上已对齐，也不以旧文案撤销新授权。

| 项目 | 内容 |
|---|---|
| 发起人 | ROLE-B / 项目负责人：`githubleelee` |
| 接收人 / 主要核对人 | ROLE-C：`xichoutrees`（#32 唯一业务写者、协议主使用方） |
| 涉及本地任务 | [#46](tasks/role-b-development.md)（本提案）；上游 `docs/role-b-scheduling-data-contract.md`（#43，另一文件，本提案只引用不改）；下游 #45 / #47 / #48 / #50 |
| 对应 GitHub 工单 | [#32 AI 排期建议](https://github.com/githubleelee/AIManagement/issues/32)；接口面 [#31](https://github.com/githubleelee/AIManagement/issues/31)、事件面 [#37](https://github.com/githubleelee/AIManagement/issues/37)（均需 D 提案） |
| 代码基线（**只读快照**） | `398aa76d02f66ce9d62e4e1c340de408f15a1f0f`（`/tmp/role-b-main-398aa76.GvfwFS`）。工作区 HEAD `fb5cee2` 较老，**本文所有代码引用均以新快照为准**；已合 US-08（工作台）/ US-09（验收） |
| 本文件职责 | 只写**公共读 / 写端口、事务边界、事务内鉴权与规则复用、snapshot / 幂等 / 冲突 / 事件提交语义**的书面提案 |

**两类 DRAFT 文件的关系（不互相覆盖字段）**：`docs/role-b-scheduling-data-contract.md`（#43，另一代理撰写）
负责 **最小只读字段契约**；本文负责 **写路径与事务 / 幂等 / 事件协议**。
两文件的字段 / 签名最终由主代理与 C 对齐，**本文不抢写 #43，也不默认其字段已定**。

---

## 0. 阅读说明：已确认 / 候选 / 待核对 三分

本文严格区分三种状态，**不得互相升格**：

| 标记 | 含义 | 来源 |
|---|---|---|
| ✅ **已确认** | **项目负责人本地确认稿**已书面确认的业务口径，不得被接口设计擅自改变 | `docs/role-c-issue-32-confirmation.md`、`DECISIONS.md` 最新 `supersedes` 条目 |
| 🟡 **候选** | 实现方案，B 提议、**待 C 核对**；命名 / 签名及尚未约定的错误映射可讨论；已确认的 401/403/404 权限语义不改 | 本文 |
| ⛔ **待核对 / 未取得** | 依赖他人交付或结论，**当前没有可引用证据** | D 提案、#43、#26、#48 |

> 已确认业务口径**不等于**代码已实现，也不等于接口已注册。源字段已存在（如 `Task.planStart`）**不代表**该读 / 写路径已按 #32 语义实现。

---

## 1. 范围与边界（本节为职责事实，非业务新规则）

- **C 负责**：#32 业务、整份原子写、snapshot、幂等、建议 / 处置 / 审计的本域实现。
- **B 负责**：公共 `Action` / 对象 scope 声明（仅 #32 PM-only 窄授权）、差异模型 / 迁移单写、`src/app.ts` 组装注入、`src/routes.ts` 集中注册、前端路由挂载。
  依据：`docs/tasks/role-b-development.md` #44 / #45 / #47 / #49；`DECISIONS.md` `arch.legacy-task-controlled-extension`。
- **旧 `task` 模块受控窗口**：C 经 B 登记具体文件 / 范围并完成实际写者交接后，可在独占窗口内最小改 `src/modules/task/routes.ts`、`rules.ts` 及必要本域测试，用于「统一计划写路径 / 原约束复用 / 整份事务应用」；
  **不另建绕过旧规则的镜像写路径，不调用 task service，不把 #32 独有 TODO-only 规则强加给所有旧手工 PATCH。**
  依据：`DECISIONS.md` `arch.legacy-task-controlled-extension`、`docs/role-c-issue-32-confirmation.md` 第 10 项。
- **不做**（本文明确排除）：
  - 不新增消息队列 / 外部中间件 / 分布式投递；不擅加 `outbox`。
  - 不引入「为所有旧接口加全局乐观锁」；不为 #32 造第二套全局版本号基础设施。
  - 不擅自决定幂等键字段、hash 算法、AI 供应商 SDK、前端 URL、`apiAction` 命名。
  - 不修改旧其他 `Action` 的既有权利；不把 #32 PM-only 例外扩到其他票。

---

## 2. 已确认业务规则（直接引用，不在本文改变）

以下均引自工作区 `docs/role-c-issue-32-confirmation.md` 与 `DECISIONS.md` 最新生效条目，仅作协议设计的输入。

| # | 已确认口径 | 来源 |
|---|---|---|
| R1 | 仅 PM 可**生成 / 查看 / 采纳 / 修改后采纳 / 拒绝 / 查看审计**；MEMBER / VIEWER 不开放；未登录 401、对象不可见 / 外项目 404、可见无操作权 403 | `DECISIONS.md` `scheduling.permission-pm-only` |
| R2 | 统一走 `can()` / `visibilityScope()`，**业务不私写角色判定**；须覆盖**读取 / 审计**操作，而非只把 write 加入动作集合 | 同上；`docs/tasks/role-b-development.md`「本轮口径同步 → 限定口径（#32）」 |
| R3 | 每次请求、以及每次确认 / 重试都**重新鉴权**；**撤权即时收敛，撤权重试不得返回历史结果**；仍有权限的相同请求可按幂等规则返回已有结果 | `scheduling.permission-pm-only` |
| R4 | 只允许对 **`TODO` 任务**写 `planStart` / `planEnd`；不改负责人 / 验收人 / 状态 / 依赖 / 里程碑；非 `TODO` 只提示 | `scheduling.advice-apply-scope-and-validation` |
| R5 | 硬阻断：日期倒置、`TODO` 新开始早于北京时间今天、违反 FS 计划约束、非 `TODO` 或越字段写；仅提示：同人重叠、新结束晚于原计划、超里程碑日期；无关联不编造、不自动改里程碑；不设过载阈值 | 同上 |
| R6 | snapshot 记录输入范围 / 关键数据 / fingerprint / 生成时间；应用前核对任务日期 / 状态 / 负责人、成员、FS、milestone、参与负载范围与权限，**相关数据变化则整份过期、拒绝写入并要求重新生成** | `scheduling.advice-snapshot-transaction-idempotency` |
| R7 | **同一 DB 事务**复核 snapshot / 权限 / 业务约束，批量计划写、处置、成功审计一次完成；任一失败全部不改、不部分成功 | 同上 |
| R8 | **模型调用在事务外**；不得用逐条 HTTP PATCH 伪装原子 | 同上 |
| R9 | 相同请求重复提交返回已有结果，不重复写、不重复发事件 | 同上 |
| R10 | 一份建议只允许一个最终处置；并发 / 不同内容再次处置返回冲突 | 同上 |
| R11 | 每次重试**先鉴权**，不得借幂等越权 | 同上 |
| R12 | 失败 / timeout / 权限拒绝另记必要失败或安全日志，不当采纳成功、不泄漏 payload / 密钥、**不与已回滚的成功事务混淆** | 同上 |
| R13 | 生成阶段在写事务外调用模型并保存建议 / 输入快照 / 生成记录；确认阶段应用**已保存建议或 PM 允许的日期修改**，**不重新调用模型生成另一份建议** | `audit.scheduling-decision-traceability` |
| R14 | 事件域 D 只做传输 / 存储 / 订阅 / 幂等，**领域生产者仍是原业务域**；不跨业务模块调 service | `arch.shared-ports-and-assembly` |
| R15 | C2（FS 前置须 `CLOSED`、自然日含起止、后继不早于前置结束次日）、C3（`Asia/Shanghai`，`planEnd` 次日 00:00 未 `CLOSED` 即逾期）、C6（负载含 `DONE` 非 `CLOSED`）为**全项目**口径 | `scheduling.fs-release-closed-natural-days`、`timezone.project-wide-asia-shanghai`、`scheduling.load-aggregation-baseline` |
| R16 | C6 敏感隔离：PM 内部 `global` / `excludedSensitiveCount` 等**不进入 AI，也不进入 member / viewer 响应**；AI 只消费查询层过滤后的子集 | `scheduling.load-aggregation-baseline`；`docs/tasks/role-b-development.md`「本轮口径同步 → C6」 |

**仍未确认**（不得在本文写死）：其他六状态转换细节、C11 操作授权、C12 协作人模型、健康度阈值等；FS 硬阻断所需 `Milestone` / `TaskDependency` 字段仍未交付（见 §3.6）。

---

## 3. 代码事实基线（源 commit `398aa76…`，相对路径 + 行号）

以下为**只读事实**，用于界定协议改动面；不含任何业务新规则。

### 3.1 鉴权入口 `can()` 硬编码 `PrismaClient`

- `src/modules/authz/permissions.ts:122`：`export function createAuthorization(prisma: PrismaClient)`。
- 内部 helper 同样硬编码：`loadTarget(prisma: PrismaClient, …)` `permissions.ts:50`；`roleIn(prisma: PrismaClient, …)` `permissions.ts:97`。
- `can()` 判定顺序：PM 允许一切 `permissions.ts:132-133`；条件动作（`task.progress` / `task.accept`）按对象关系判定 `permissions.ts:146-160`；写类动作对 MEMBER / VIEWER → 403 `permissions.ts:162-163`；其余 → 允许 `permissions.ts:165-166`。
- `WRITE_ACTIONS` 集合 `permissions.ts:33-38` 仅含 4 个写动作。
- `visibilityScope(actorUserId, projectId, objectType)` `permissions.ts:182`。
- **结论（事实）**：当前 `Action` / `ObjectRef` 集合**没有排期动作，也没有排期对象种类**（`src/shared/types.ts:217-224`、`231-238`）。真正的缺口是**生成 / 读 / 审计动作本身不存在**；只要所有 PM-only 动作（含读 / 审计 / 生成）都被实现为可拒绝非 PM，判权即可满足 R1/R2。**本文不擅自选择「必须新增某种分类 / 集合」的实现方式**——具体由 C 核对。

### 3.2 任务规则入口 `assertTaskAssignment` 同样硬编码 `PrismaClient`

- `src/modules/task/rules.ts:53`：`export async function assertTaskAssignment(prisma: PrismaClient, projectId, input)`；入参类型 `TaskAssignmentInput` `rules.ts:27`。
- 覆盖规则：负责人 / 验收人是本项目成员、成员数 ≥ 2、验收人 ≠ 负责人、`planEnd ≥ planStart`（`rules.ts` 第 1–5 步注释）。
- **结论（事实）**：该函数只用到 `projectMember` 等模型委托，**运行时**可在事务客户端上工作，但**类型上**无法直接接收 `Prisma.TransactionClient`。

### 3.3 交互式事务写法已在仓库落地（可直接复用，无需新基础设施）

- 交互式 `$transaction(async (tx) => …)`：`src/modules/acceptance/service.ts:250`、`src/modules/project/service.ts:77/204/236`、`src/modules/requirement/service.ts:176/263/523/592/715`、`src/modules/authz/sensitivity.ts:36`。
- 数组式 `$transaction([...])`：`src/modules/task/routes.ts:561`。
- **结论（事实）**：既有代码已用同一交互式事务保护读-改-写（见 `requirement/service.ts:150-171` 并发修复注释），C 的整份原子应用**可复用同款写法**，无需引入新框架。
  ⚠️ **不得把 SQLite 单写者模型当成全流程自动正确性证明**：事务只是**基础**；并发下的唯一处置仍需 **CAS / 唯一约束**（§7.1）与**并发测试**共同保证，且这些测试**本轮未运行**。
- **事实缺口**：全仓 **没有任何** `Prisma.TransactionClient` 显式引用（grep 为空）。因此「事务内鉴权 / 规则复用」目前**在类型层不可直接落地**，需要一次受控的签名放宽（§5.3）。

### 3.4 「事件」当前只有未接线的类型占位

- `src/modules/acceptance/types.ts:139` `AcceptanceEventPayload`，其上下文注释 `types.ts:124-131` 明确写着「**未接线**……当前不发布任何事件……等 #37 交付后再接线」。
- 全仓无事件发布器 / 订阅器 / 事件表 / `outbox`（`grep event|outbox|publish|subscribe` 无运行时实现）。
- **结论（事实）**：提交后事件派发的**承载方尚未存在**；本文只能定义**语义边界**，签名待 D 提案（§8、§12）。

### 3.5 Schema 与模型事实

- `Task`：`planStart` / `planEnd` 为 `String 'YYYY-MM-DD'`，`status` 默认 `TODO`，**无 `updatedAt` / 无 `version` 列**（`src/db/schema.prisma:117` 起，字段 `117-155` 区间）。⇒ 无现成乐观锁载体，snapshot 比对只能**读-比**。
- 六状态含 `CLOSED`：`src/shared/types.ts:38`、`src/shared/validation.ts:20`（旧「三态无 CLOSED」描述已过时）。
- 无 `Milestone` / `TaskDependency` 模型：`src/db/schema.prisma` 的 model 列表仅 `User / Project / ProjectMember / BusinessGoal / UserActivity / UserStory / Task / AcceptanceRecord / ObjectVisibility / AuditLog`。
  ⇒ **R15 的 FS 硬阻断当前没有落点**，需 #26 交付依赖数据。
- 可复用审计载体：`AuditLog`（`schema.prisma:191`，字段 `projectId/actorUserId/action/objectType/objectId/before/after/createdAt`）；`AcceptanceRecord`（`schema.prisma:157`）是「结论 / 状态前后 / 时间线」的现成范式。

### 3.6 组装与注入事实

- `src/app.ts:47` 可选 `prisma?: PrismaClient` 注入；`src/app.ts:56` 组装 `RouteContext`。
- `src/routes.ts:16-17` `RouteContext = { prisma: PrismaClient }`，集中注册各模块插件。
- `src/modules/task/routes.ts` **无 service.ts**，规则集中在 `rules.ts`；路由内 `createAuthorization(prisma)` 于 `routes.ts:199` 创建一次。

---

## 4. 两阶段总览（生成 / 确认）与提交点

```
Stage A 生成（DB 写事务之外）
  [鉴权入口检查] → 事务外调用 AI 端口(D) → 保存 建议 + 输入快照/fingerprint + 生成记录
  模型调用不在事务内；失败按 R12 另记，不冒充已生成

Stage B 确认（单个 DB 交互式事务）
  入口鉴权(事务前，可做快速拒绝) ── 事务开始
                                    0) 仅解析建议 id/projectId 归属元数据，不读取历史结果
                                    1) 对存储归属项目重跑 can()（权威，撤权即时收敛）
                                    2) 读建议记录（含 disposition / snapshot）
                                    3) 重放判定（先于 snapshot 复核）→ 相同请求返回既有结果
                                    4) snapshot 复核（有效权限 + 来源数据）
                                    5) 复用 assertTaskAssignment + #32 硬阻断
                                    6) 批量写 TODO dates + 唯一处置 + 成功审计
                                  ── COMMIT（提交点）
  提交后（事务外）：派发领域事件(C 生产)。事件失败只重试事件，不回滚 / 不重复改计划
```

- **提交点 = Stage B 事务 `COMMIT`**：提交成功即「计划已应用」的唯一权威信号。
- **模型生成与确认严格分离**（R8 / R13）：确认阶段**不重新调用模型**。
- Stage A 的鉴权只是**入口防护**；**最终鉴权与约束复核必须在 Stage B 事务内**（§5.4）。

---

## 5. 公共读 / 写端口提案（🟡 候选，待 C 核对）

> 端口指「C 域向公共层暴露、经 `app.ts` 注入 / `routes.ts` 注册的接口」。
> **本文不指定端点 URL、不指定 `apiAction` 名、不指定 `Pick` / `union` 最终形态。**

### 5.1 读端口（查看建议 / 审计）

- 🟡 **候选**：建议与审计属 #32 本域数据，**由 C 域自己读库组装**，不跨模块调 service（R14 / I-9）。
  对 #26 / #27 的**只读消费**按 `docs/role-b-scheduling-data-contract.md`（#43）的合法读取方式取得。
- 🟡 **候选**：读端口权限 = 新增的 **PM-only 排期读 / 审计 Action**（命名待定，见 §5.5）。
  不得复用 `project.read`——后者对 MEMBER / VIEWER 放行，违反 R1。
- ⛔ **待核对**：AI 侧输入（场景 / 输入范围 / snapshot / model 版本 / mode / error）的**读取载体字段**需 D 的 AI 端口提案；本轮无可引用提案。

### 5.2 写端口（确认应用）

- 🟡 **候选**：**唯一受控写端口**承担「采纳 / 修改后采纳 / 拒绝」三种处置，内部为单个交互式事务。
- 🟡 **候选输入语义**：`建议标识 + 处置类型 + （可选的）PM 修改后的日期集合 + 理由`。
  日期只允许落在建议范围内的 `TODO` 任务，字段仅 `planStart` / `planEnd`（R4）。
- ✅ **边界（职责事实）**：**无论路由落在 C 域还是 `task` 模块，都必须走统一计划写能力、不得新建绕过 `task` 受控 core 的镜像写路径。**
  C 须在**已授权并登记的 `src/modules/task/routes.ts` / `rules.ts` 及必要本域测试范围**内提炼 / 复用「统一计划写能力」；原手工 PATCH 的基础规则**不被 AI-only 规则强改**。如确需新增 `task/service.ts` 等其他文件，必须先获明确范围扩展许可，再由 #48 登记，不能把登记本身当作扩权。若跨模块运行时经 shared 端口 / `app.ts` 注入，则 **B 只声明与装配、C 实现业务**。
- 🟡 **候选统一写能力（位置 / 签名示意，非冻结，B 不擅定）**：在 `task` 模块内提炼单一入口（如 `applyPlanDates(db, projectId, changes: { taskId; planStart; planEnd }[])`，内部复用 `assertTaskAssignment` 与基础校验）；AI-only 硬阻断（R5）由调用方在事务内叠加。命名 / 参数 / 落点由 C 定。
- 🟡 **候选落点（待 C 核对）**：
  - **候选 A（C 域受控应用端口）**：在 `src/modules/ai-scheduling/` 新增受控应用路由，**调用上述统一计划写能力**（而非自行拼 `tx.task.update`），在其外层包事务、完成处置与审计。
  - **候选 B（task 模块内受控路由）**：在 `src/modules/task/routes.ts` 内新增受控应用路由，复用同模块的统一计划写能力（使用 #48 登记的写窗口）。
  - 两种候选都要求 `rules.ts` 的签名放宽（§5.3）；`task/routes.ts` 的改动（若有）须在 #48 登记范围内。B 不替 C 选。
- 🟡 **候选装配**：C 导出路由插件 → `src/routes.ts` 集中注册 → `src/app.ts` 注入 `prisma`（符合 `arch.shared-ports-and-assembly`）。路由命名 / URL 待 C 与前端路由清单确认。

### 5.3 事务内鉴权与规则复用的签名放宽（🟡 候选，**B 不擅定**）

**问题事实**：`createAuthorization(prisma: PrismaClient)` 与 `assertTaskAssignment(prisma: PrismaClient, …)` 的类型把 `Prisma.TransactionClient` 挡在外面（§3.1 / §3.2），无法在事务内传 `tx`。

**候选（供 C 核对，非冻结）**：

```ts
// 候选 A：结构化窄接口（只暴露实际用到的模型委托）
//  - createAuthorization 用到的委托：project / businessGoal / userActivity / userStory / task / projectMember / objectVisibility
//  - assertTaskAssignment 只用到：projectMember
type AuthzDb = Pick<PrismaClient,
  'project' | 'businessGoal' | 'userActivity' | 'userStory' | 'task' | 'projectMember' | 'objectVisibility'>

// 候选 B：联合类型
type Db = PrismaClient | Prisma.TransactionClient
```

- 两种候选都能让 `PrismaClient` 与 `Prisma.TransactionClient` 同时满足；**运行时** `can()` / `assertTaskAssignment` 只读模型委托，故无需改内部实现。
- ⛔ **待 C / B 核对**：选 A 还是 B；是否允许对**冻结的 `permissions.ts`**（契约 I-5 / I-6 签名）做此项最小放宽；`Authorization` 类型（`permissions.ts:215`）是否随之调整。
- **B 立场**：`can()` / `visibilityScope()` 的**公开调用契约**（参数语义、Decision / Scope）不变；这里只是让工厂参数接受事务客户端。是否算「签名改动」由 C 与契约负责人确认。

### 5.4 Stage B 事务内统一鉴权与约束复核顺序（🟡 候选）

事务内的**候选顺序**如下（顺序须与 C 核对后才冻结）：

0. **最小归属解析**：只查询/解析建议的 `id` 与存储 `projectId`，不读 disposition、历史结果、snapshot 或建议正文。内部解析不对调用者暴露存在性信息；不存在统一 404。这与现有 `can()` 先加载目标归属再判权的模式一致；若请求另带项目上下文，必须核对与存储归属相符，不能直接信任客户端 projectId。此步骤不要求先确定 URL，也不授权读取历史内容。
1. **重跑 `can()`（用 `tx`）**：以步骤 0 的存储项目归属调用已确认语义的 PM-only 排期动作。此步必须先于读取任何既有处置/历史结果；撤权即拒绝，不返回历史内容。
2. 鉴权通过后读取该项目下的完整建议、disposition / snapshot，并再次保持其项目归属与已授权上下文一致。
3. **重放判定**（先于 snapshot 复核，§7.2）。
4. **snapshot 复核**（§6）——仅当无既有处置时执行。
5. **规则复用**：核对每个任务的存储 projectId/建议参与范围，再调用事务内 `assertTaskAssignment` 复用成员归属/数量/验收互斥/日期顺序；叠加 #32 硬阻断。**需要 FS 校验而依赖源不可用或完整性未知时，本提案按 fail-closed 拒绝正式日期应用，事务不写计划/成功处置/成功审计**，可以保留草稿并提示未验证；不得将 unavailable 当作空依赖通过。具体错误映射仍使用既有契约并待 C 核对。已证实可用且为空与数据源缺失是不同情形。
6. 校验通过后**批量写** `TODO` dates + 唯一处置 + 成功审计，全部同一 `tx`。

> 事实提示：事务内 `can()` 会按 id 现查目标对象（`permissions.ts:50` `loadTarget`），鉴权读取与写在同一隔离视图内。
> ⚠️ 事务只是并发正确性的**基础**：唯一处置仍须 CAS / 唯一约束（§7.1）与并发测试共同保证（**未运行**）；**不得据「SQLite 单写者」推断全流程自动串行正确**。
> ⛔ **待 C 核对**：「撤权即时收敛」在并发撤权与本次事务重叠时的精确定义（事务边界内 vs 下一个请求）；以及**生成耗时期间撤权**（§11 P9）的期望行为。

### 5.5 新增 `Action` / 对象 scope（🟡 候选，命名待定）

- **事实缺口**：`src/shared/types.ts:217-224` 无排期动作；`ObjectRef`（`types.ts:231-238`）无排期对象种类。
- 🟡 **候选最小动作集**（命名仅为示意，**B 不擅定**）：
  - 需要覆盖 **生成 / 查看 / 审计读取 / 确认处置** 的动作（读 / 审计与写 / 处置是否分离待 C 定）。
  - **真正的缺口是这些动作当前不存在**（`shared/types.ts:217-224`）。新增生成/读/审计/处置 Action **必须在统一权限入口命中显式拒绝非 PM 的分支或集合**（可扩展 `WRITE_ACTIONS` 或采用等价 PM-only 策略），**不得落入 `can()` 末尾默认允许分支**；不能只增加类型就认为权限已实现，也不在业务里复制角色判定。具体集合名称/动作划分仍由 B/C 核对，不改其他现有 Action 的语义。
- 🟡 **候选 scope（以真实 `shared/types.ts` 为准）**：
  - 现有 `ObjectRef`（`shared/types.ts:231-238`）为 `{ kind: 'project'; projectId }` 与 `{ kind: 'goal' | 'activity' | 'story' | 'task'; projectId; objectId }`。
  - 🟡 候选：优先复用**已存在的** `{ kind: 'project', projectId }`（真实形状；`can()` 第 1/2 条按 projectId 现查，`permissions.ts:56-66`、`130-131`）。
  - 🟡 候选：若需按建议对象判权，可**新增排期 `kind`**（如 `{ kind: 'schedulingAdvice', projectId, objectId }`）——这是**候选新 kind**，需同步扩展 `loadTarget` 的 `switch`（`permissions.ts:56-92`）与 `Action`，**待 C / B 核对**。
- ⛔ **待核对**：具体动作名、是否读写分离、对象种类、以及 B 在 `permissions.ts` 的最小改动清单（#44）。

---

## 6. Snapshot / fingerprint 与过期判定（🟡 候选，🟢 数据字段见 #43）

### 6.1 数据定义（🟡 候选）

- 生成阶段记录：**输入范围**（参与任务 id 集合 / 项目 id / 成员集合）+ **关键数据快照** + **fingerprint** + 生成时间（R6）。
- 🟡 候选快照字段（最终字段以 #43 与 C 对齐）：
  - 每个参与任务：`id / projectId / status / planStart / planEnd / ownerUserId / acceptorUserId`；
  - 项目成员集合与角色；参与范围内的敏感可见性；
  - FS 依赖边（**待 #26 交付**）、里程碑日期（**待 #26 交付**）；参与负载范围（C6 口径）。
- 🟡 候选 fingerprint：对上述字段做**稳定序列化后再摘要**；**算法与是否入库由 C 拍板**（B 不擅定 hash 字段）。
- ⛔ **与 #43 敏感计数隔离对齐（R16）**：PM 内部 `global` / `excludedSensitiveCount` 等**不得进入 AI 输入，也不得进入 member / viewer 响应**；snapshot 可含**必要的 server-private** 数据，但**不得全量发 AI**——发给 AI 的仅是查询层过滤后的子集。具体字段以 #43 对齐。

### 6.2 「有效权限」语义（🟡 候选）

- 生成时的**参与范围**基于当时 `visibilityScope()` / 敏感过滤后的子集；确认时**重新计算**同一子集。
- 🟡 候选：若**权限 / 可见范围变化**导致参与子集变化 → 视为来源变化 → 整份过期（R6）。
- ⛔ **待 C 核对**：权限变化是否一律过期，还是仅当影响参与任务集合时过期；以及「有效权限」是快照时的集合，还是确认时的实时集合。

### 6.3 过期判定与 HTTP 语义（🟡 候选）

- 确认时重算 fingerprint，与生成时不一致 → **整份过期**，拒绝写入并要求重新生成（R6）。
- 🟡 候选状态码：`409 CONFLICT`（现有 `AppError` 支持 `409`，`src/shared/errors.ts:22`）。**具体状态码由 C 拍板**。

---

## 7. 幂等 / 唯一处置 / 冲突（🟡 候选）

### 7.1 唯一处置（R10）

- 🟡 候选：建议记录上 `disposition` 一旦落定即**不可再改**；由**唯一约束或 CAS**（`updateMany({ where: { id, disposition: null } })` 影响 0 行即冲突）保护。二者取一，待 C 核对（§12-C4）。
- 并发两次不同处置：先提交者胜；后到者读到既有处置 → **冲突**。

### 7.2 重放判定必须先于 snapshot 复核（R9 与「成功重放不误判自身日期更新」）

这是 #46 的核心边界，**顺序不可交换**：

1. 事务内按 §5.4 先解析仅 id/projectId 的最小归属元数据，再执行 `can()`；历史处置/结果只在权威鉴权通过后读取（R3 / R11）。
2. 若建议**已有最终处置**，按「同一请求」判定决定返回既有结果还是冲突。
   - 若判定为同一请求 → **返回既有结果，不写、不派发事件**；此时**不得**再做 snapshot 复核：首次成功已改 `Task.planStart/planEnd`，重算必然与生成时不同，否则会把**自身写入**误判成过期。
3. 若已有处置但判定为**不同请求** → **冲突**（R10）。
4. 若**无**处置 → 才进入 snapshot 复核与规则校验。

- ⛔ **「同一请求」的身份口径待 C 核对**（**不能仅以 payload 相同替代**）：
  - 至少需明确 **actor（谁）/ 建议标识 / 请求标识** 的**作用范围**；不同 actor（不同 PM）**相同 payload** 的重放应判「既有结果」还是「冲突」，**本文列为待核对，不预判**。
  - 需**保留首次审核人**（首次成功处置的 actor）；后续请求不得因 payload 相同被自动当成同一请求 / 覆盖首次审核人。
- 🟡 候选判定键（示意，非冻结）：建议 id + 处置类型 + 目标日期集合的稳定摘要（+ actor 范围待定）。**是否引入独立请求幂等键 / 如何 hash 由 C 拍板**（B 不擅定）。
- 🟡 候选：也可**不引入独立幂等键字段**，直接以「建议唯一处置 + 处置 payload 摘要（+ actor 口径）」判定重放，符合「避免新基础设施」。

### 7.3 撤权与重放（R3 / R11）

- 重放**先鉴权**：actor 已撤权 → 步骤 1 即 404 / 403，**不读取、不返回**历史成功结果。
- 「仍有权限的相同请求」才允许返回既有结果。

---

## 8. 事件提交语义（🟡 候选；⛔ 签名待 D 提案）

**事实前提**：事件承载方尚不存在（§3.4）；D 只做传输 / 存储 / 订阅 / 幂等，**领域事件由原业务域（此处即 C 域）发出**（R14）。**本轮尚未取得可引用 / 确认的 D 提案**（远端 #37 无评论）。

- 🟡 **候选提交点**：Stage B 事务 `COMMIT` 成功即「**计划已应用**」。
- 🟡 **候选派发时机**：**提交后**（事务外）派发领域事件，携带处置记录 id / 建议 id / 项目 id / 处置类型 / 提交时间等（字段形状**待 D 的信封提案**）。
- 🟡 **候选失败语义（关键边界）**：**「计划已应用」与「事件未送达」是两个独立事实**——提交成功即已应用；事件失败 / 重试**不得重复改计划**（计划在提交点已定），只重试事件本身，不再进入写事务。
  - ⛔ **不得把「事件未送达」说成「未应用」**，也不得反向把「已应用」当成「事件必达」。
- ⛔ **提交后进程退出 / 派发丢失 / 恢复方式（C / D 需确认）**：提交后进程崩溃、事件在内存中丢失、或重试前重启，当前**没有持久化待发机制**。恢复语义（是否补发、如何发现漏发、漏发是否可接受）**必须由 C 与 D 共同确认**。
- 🟡 **候选去重**：consumer 侧按「处置记录 id / 建议 id + 处置」幂等；**D 不承诺 exactly-once**，本协议**也不承诺可靠送达 / exactly-once**；具体幂等键作用范围**待 D 提案**（见 `docs/role-d-minimal-interface-request.md` A2）。
- 🟡 **候选失败证据**：事件发布失败的证据由谁记录、记在哪（C 的失败留痕 vs D 的传输失败）**须 C / D 划分**；不得把事件失败冒充成功处置。
- ⛔ **明确不做**：不擅自引入 `outbox` / 持久化待发事件表 / 定时重投等新基础设施——若要，需 C 与 D 共同确认。

---

## 9. 失败留痕与审计一致性（🟡 候选）

- **成功审计**：与批量计划写、唯一处置**同一事务**写入（R7）；写入 `AuditLog`（`schema.prisma:191`）或 #45 定义的建议 / 确认 / 审计记录表（**表结构属 #45**，本文不定义字段）。
- **失败留痕**：失败 / timeout / 权限拒绝**另记**，不当采纳成功、不泄漏 payload / 密钥（R12）。
  - 🟡 **候选关键点**：失败证据**不能与被回滚的事务写在同一个事务里**（否则证据随回滚消失）。候选：事务抛出 / 回滚**之后**，以独立写记录失败 / 安全日志。落点（复用 `AuditLog` 还是安全日志）**待 C 确认**。
- 成功与失败**不得混淆**：成功事务已回滚则不得显示部分成功；失败不得写成成功处置。

---

## 10. 跨项目与对象可见性（✅ 规则已确认，🟡 落点候选）

- ✅ 建议归属单一项目；对象对调用者不可见 / 外项目 → 404（R1）。
- 🟡 候选：按 §5.4 的最小元数据解析取得存储归属，用真实已有 `ObjectRef`（`{ kind:'project', projectId: 存储归属 }`）鉴权，再读取受保护建议。每个待写任务必须属于相同项目及建议参与范围；项目上下文不匹配按 R1 拒绝为 404，不读/返回外项目正文；同项目越建议范围的校验错误映射待 C 核对。
- 在别的项目是 PM，不代表在建议所属项目也是 PM：**不是该项目成员 → 404**；在该项目为 MEMBER/VIEWER、对象可见但无排期操作权 → 403；在该项目为 PM 再按本域约束处理。不得因调用者在其他项目的角色绕过当前项目判权。

---

## 11. 验收测试矩阵（**均未执行**；本轮只写文档，不跑应用测试）

> 说明：以下为**待实现的验收场景**，本文件不作任何「已通过」声明。
> 「依据」列引用已确认规则 ID；「候选落点」引用本文小节与代码相对路径 / 行号（基线 `398aa76…`）。全部标记 **未运行**。

| ID | 类别 | 场景 | 预期结果 | 依据 | 候选落点 | 状态 |
|---|---|---|---|---|---|---|
| P1 | 权限 | PM 生成 / 查看 / 采纳 / 修改后采纳 / 拒绝 / 看审计 | 全部允许 | R1 | §5.1/5.2/5.5 | 未运行 |
| P2 | 权限 | MEMBER 调用生成 / 查看 / 采纳 / 拒绝 / 审计 | 403（对象可见无操作权） | R1/§5.5 | `permissions.ts:162-166` | 未运行 |
| P3 | 权限 | VIEWER 同上 | 403 | R1 | 同上 | 未运行 |
| P4 | 权限 | 未登录 | 401 | R1 | `src/auth/actor.ts` requireAuth | 未运行 |
| P5 | 权限 | outsider / 非项目成员 | 404（与对象不存在一致） | R1 | `permissions.ts:130-131` | 未运行 |
| P6 | 权限 | 底层敏感任务对非白名单调用者 | 不可见任务 404；建议入口另外遵守 PM-only，不据此擅造建议敏感模型 | R1 | `permissions.ts:136-144`、§5.5 | 未运行 |
| P7 | 权限 | **撤权后重试**（曾成功过） | 403/404，**不返回历史结果** | R3/R11 | §7.3 | 未运行 |
| P8 | 权限 | 仍有权限的相同请求重试 | 返回既有结果，不重复写 / 不重复发事件 | R9 | §7.2 | 未运行 |
| T1 | 事务 | 多任务批量日期写入 | 全成功或全不改（无部分成功） | R7 | §5.4 步 6 | 未运行 |
| T2 | 事务 | 批量中某任务写失败 | 整体回滚；计划不变；无成功审计 | R7 | §5.4 | 未运行 |
| T3 | 事务 | 非 `TODO` 任务 | 硬阻断，不写 | R4/R5 | `rules.ts` + §5.4 步 5 | 未运行 |
| T4 | 事务 | 越字段（负责人 / 状态 / 依赖 / 里程碑） | 硬阻断不写 | R4/R5 | §5.4 步 5 | 未运行 |
| T5 | 事务 | 日期倒置 / `TODO` 新开始早于今天 | 硬阻断 | R5 | §5.4 步 5 | 未运行 |
| T6 | 事务 | 违反 FS 计划约束 | 硬阻断（**依赖 #26 数据，当前无落点**） | R5/R15 | ⛔ 无 `TaskDependency` | 未运行 / 阻塞 |
| T8 | 事务 | 本次需校验 FS，但依赖源 unavailable/完整性未知 | 候选安全守卫：拒绝正式应用且全不写，不把缺失当空依赖；错误映射待核对 | R5/R15、§5.4 | 依赖可用性协议 | 未运行 |
| T7 | 事务 | 复用原规则：非本项目成员 / 成员<2 / 验收人=负责人 / 结束<开始 | 复用 `assertTaskAssignment` 报错 | R4 | `rules.ts:53` | 未运行 |
| C1 | 并发 | 两个并发不同处置 | 先提交者成功；后到者冲突 | R10 | §7.1 | 未运行 |
| C2 | 并发 | 同一已识别请求的并发重试（身份及 payload 一致） | 仅一次生效，另一次按确认的幂等协议返回既有结果；不同独立请求不因 body 相同自动视作重放 | R9/R10 | §7.1/7.2 | 未运行 |
| R1 | 回放 | 相同请求重复提交 | 返回既有结果；不重复写 / 不发事件 | R9 | §7.2 | 未运行 |
| R2 | 回放 | **成功重放**（日期已被自身改过） | **不误判过期**，返回既有结果 | R9/§7.2 | §7.2 步 2 | 未运行 |
| R3 | 回放 | 同建议**异内容**重试 | 冲突 | R10 | §7.2 步 3 | 未运行 |
| F1 | 失败 | 模型调用超时 / 失败（生成阶段） | 不冒充已生成；另记失败；计划不变 | R12/R13 | §4 Stage A | 未运行 |
| F2 | 失败 | 确认阶段校验失败 | 整体回滚；失败另记；不冒充成功 | R12 | §9 | 未运行 |
| F3 | 失败 | 权限拒绝 | 404/403；另记安全日志；不读历史 | R3/R12 | §7.3/§9 | 未运行 |
| F4 | 失败 | 提交成功但事件派发失败 | 计划不再改；仅重试事件；失败证据另记 | R9/§8 | §8 | 未运行 |
| F5 | 失败 | 事件重试 | 不重复改计划；consumer 幂等去重 | §8 | §8 | 未运行 |
| S1 | 来源变更 | 生成后参与任务日期 / 状态 / 负责人变化 | 整份过期，拒绝写入并要求重新生成 | R6 | §6.3 | 未运行 |
| S2 | 来源变更 | 成员 / 权限 / 可见范围变化 | 按 C 确认的「有效权限」语义判定 | R6/§6.2 | §6.2 | 未运行 |
| S3 | 来源变更 | FS / 里程碑变化（**依赖 #26**） | 参与过期判定 | R6 | ⛔ 无字段 | 未运行 / 阻塞 |
| X1 | 跨项目 | 建议/任务与已授权项目上下文不匹配 | 404、不读外项目正文且不写；同项目但越建议参与范围的错误映射另按契约核对 | R1/§10 | §10 | 未运行 |
| X2 | 跨项目 | 外项目 PM | 404（非本项目成员） | R1 | `permissions.ts:130-131` | 未运行 |
| X3 | 跨项目 | 敏感任务不在参与范围 | 不计入基数 / 不写 / 不泄漏 | R6/R15 | §6.2 | 未运行 |
| P9 | 权限 | **生成耗时期间撤权**（生成进行中 PM 被撤权） | 生成落库 / 确认须按撤权后重新鉴权；期望行为**待 C 确认** | R3 | §5.4/§7.3 | 未运行 |
| R4 | 回放 | **同一 payload 由不同 PM（跨 actor）重放** | 既有结果 vs 冲突**待 C 核对**；保留首次审核人 | R10/§7.2 | §7.2 | 未运行 |
| F6 | 失败 | **提交成功后进程退出 / 派发丢失 / 重启** | 「计划已应用 / 事件未送达」分开；恢复方式待 C/D | §8 | §8 | 未运行 |
| X4 | 跨项目 | **外项目 PM（非该项目成员）** | 404（用「非该项目成员」条件，**非 403**） | R1/§10 | `permissions.ts:130-131` | 未运行 |
| N1 | 敏感隔离 | PM 内部 `global`/`excludedSensitiveCount` 进入 AI 或 member/viewer 响应 | 禁止；AI 仅收查询层过滤子集；snapshot 非全量发 AI | R16/§6.1 | §6.1 | 未运行 |

> 具体断言、fixture 与证据形式由 #50 的定向集成验证任务定义；本文件只给场景矩阵。**全部场景均未运行。**

---

## 12. 待核对点清单

### 12.1 C 最小确认点（🟡，逐项需 C 书面回复）

- **C1 动作 / 对象 scope**：处置动作**已定**（2026-10-18）：#32 与 #33 共用同一个处置动作、仅 PM，由 B 在共享建议存储落地时一并加入 `can()`（`DECISIONS.md` `permissions.ai-suggestion-disposal`）。仍需 C 核对：**生成 / 读取 / 审计动作是否与处置动作分离**；`ObjectRef` 复用 `{ kind:'project' }` 还是新增排期 `kind`；B 在 `permissions.ts` 的最小改动清单（#44）。
- **C2 签名放宽方案**：选结构化 `Pick` 还是 `union`；是否允许对冻结的 `permissions.ts` / `rules.ts` 做此项最小放宽；`Authorization` 类型是否调整（§5.3）。
- **C3 写端口落点与统一写能力**：受控应用端点置于 C 域 `ai-scheduling` 还是 `task/routes.ts`；**统一计划写能力的提炼 / 复用方式与签名**；`rules.ts` 复用方式（§5.2/§5.3）。
- **C4 唯一处置保护**：DB 唯一约束 vs CAS `updateMany`；由哪一层保证（§7.1）。
- **C5 错误映射**：snapshot 过期、异 payload、并发处置及同项目越建议范围如何映射既有错误码（过期/冲突候选 `409`）；已确认的未登录 401、不可见/外项目 404、可见无操作权 403 不重新开放二选一（§6.3/§7/§10）。
- **C6 幂等键机制**：是否引入独立请求幂等键字段，还是以「建议唯一处置 + 处置 payload 摘要」天然幂等（推荐后者，避免新基础设施）（§7.2）。
- **C7 fingerprint 字段范围**：入库字段、摘要算法（是否 hash、hash 字段名）——**B 不擅定**（§6.1）。
- **C8 「有效权限」语义**：权限变化是否一律过期；快照集合 vs 实时集合（§6.2）。
- **C9 失败证据落点**：回滚后另写的位置；复用 `AuditLog` 还是安全日志（§9）。
- **C10 事务内参与范围复核**：如何在同一事务读取并核对相关数据与有效权限（已确认的同事务复核不重新讨论是否执行），以及最小归属解析与受保护正文读取的步骤边界；FS 数据不可用时不得将其视为空依赖通过（§5.4）。
- **C11 「同一请求」身份口径**：actor / 建议 / 请求标识的作用范围；不同 PM 同 payload 是既有结果还是冲突；首次审核人保留（§7.2）。
- **C12 生成耗时期间撤权**：生成阶段进行中 actor 被撤权时的落库 / 确认期望（§5.4、§11 P9）。

### 12.2 D 最小确认点（⛔ 需 D 对应提案；**本轮尚未取得可引用 / 确认的 D 提案**）

> 远端核实：#31 / #37 无评论，公开 open PR 仅 #39；**不代表 D 私下没有实现**，但本轮无书面可引用材料。

- **D1 AI 生成端口签名**：生成阶段（事务外）调用签名、输入范围 / snapshot 记录、model 及版本（未提供记「未提供」）、mode（`stub`/`api`）、错误表示（对应 `docs/role-d-minimal-interface-request.md` B1–B4）。
- **D2 事件信封与发布签名**：字段形状、幂等键作用范围、发布 / 存储失败如何暴露、未注册订阅者行为（对应同文 A1–A4）。
- **D3 提交后派发、去重与恢复**：事件如何与处置记录关联；consumer 幂等键；**提交后进程退出 / 派发丢失 / 恢复方式**；D **不承诺 exactly-once**（§8）。
- **D4 失败证据边界**：事件发布失败由 C 还是 D 记录、如何划分（§8/§9）。

### 12.3 其他依赖（仅影响实现 / 验收，不阻塞本文设计）

- **#43**：最小只读字段契约（FF 关系，**约束 #46 finish**）。
- **#26**：`Milestone` / `TaskDependency` 交付（R15 的 FS 硬阻断落点，当前不存在；**仅影响实现验收**）。
- **#48**：`task/` 写窗口登记与实际写者交接（**仅影响写路径落地 / 验收**）。
- **#45**：建议 / 确认 / 审计记录 schema 与迁移（本文不定义其字段）。

---

## 13. Done when 未完成项与建议 Blocker（#46）

`docs/tasks/role-b-development.md` #46 的 Done when 要求「书面提案与确认结论」。**本轮仅完成可审阅提案，未完成项如下**：

| 未完成项 | 说明 |
|---|---|
| C 书面核对未完成 | 本文为 DRAFT；§12.1 各项待 C 逐项回复 |
| D 签名未取得 | AI / 事件签名无可引用提案（§12.2）；对应小节待 D 提案再对齐 |
| 具体签名 / 命名未冻结 | `Action`、对象 scope、端点、统一写能力、幂等键、hash 均未定（B 不擅定） |
| 与 #43 字段未最终对齐 | FF 关系；待两文件字段收口 |

> **说明**：未运行应用测试、未发布远端**不是**本协议不能冻结的阻塞——它们属「实现 / 验收 / 发布」阶段的状态；本文档仅给协议，测试矩阵（§11）与发布留证另行推进。

**建议 Blocker（#46 设计确认层面，仅以下三项）**：

1. 待 **C 书面核对** §12.1（端口 / 统一写能力 / 签名 / 事务 / 幂等 / 冲突 / 状态码 / 同一请求身份）。
2. 待 **#43 数据契约**最小字段与 C 对齐（FF 约束 finish）。
3. 涉及 **D 签名**的部分（AI 生成端口、事件信封 / 提交 / 去重 / 恢复）待 **D 对应提案**对齐；**不要求 D 两类提案全齐**，可先完成自身设计部分。

> **以下仅影响「实现 / 验收」，不作为 #46 设计确认的 Blocker**：**#26** 交付 `Milestone` / `TaskDependency`（R15 的 FS 硬阻断落点）、**#48** `task/` 写窗口登记与现写者交接、应用测试运行、远端发布。它们不阻塞协议设计本身。
> 说明：#46 可与 #43 **并行设计**，最终 finish 受 FF43 约束。

---

## 14. 来源与不声明

**来源（工作区本地，未发布到远端）**：

- `docs/role-c-issue-32-confirmation.md`（C #32 确认稿）
- `DECISIONS.md` 最新生效条目（含 2026-10-17 `supersedes`）：
  `scheduling.permission-pm-only`、`scheduling.advice-apply-scope-and-validation`、
  `scheduling.advice-snapshot-transaction-idempotency`、`audit.scheduling-decision-traceability`、
  `arch.legacy-task-controlled-extension`、`arch.shared-ports-and-assembly`、
  `scheduling.fs-release-closed-natural-days`、`timezone.project-wide-asia-shanghai`、`scheduling.load-aggregation-baseline`
- `docs/plans/role-b-development.md`、`docs/tasks/role-b-development.md`（#43 / #44 / #45 / #46 / #47 / #48 / #50）
- `docs/role-d-minimal-interface-request.md`（D 端口请求，本文只引用其待办项）
- 代码基线 **`398aa76d02f66ce9d62e4e1c340de408f15a1f0f`**（只读快照 `/tmp/role-b-main-398aa76.GvfwFS`）

**声明**：

- 本文为 **DRAFT 提案**，**不声称 C 已确认本协议**，**不声称与 C 已核对冻结**，**不声称 D 接口已交付或已冻结**，
  不声称任何实现已落地、任何测试已通过、任何远端已发布。
- 「已确认业务规则」（§2）的来源**仅为项目负责人本地确认稿 `docs/role-c-issue-32-confirmation.md` 与 `DECISIONS.md`**，**不代表 C 已确认本协议本身**。
- 本文不修改任何代码、任务清单、`DECISIONS.md`、`docs/role-c-issue-32-confirmation.md` 或 #43 文件；
  本轮未执行 git / 远端写操作。
- 涉及 `docs/role-b-scheduling-data-contract.md`（#43）的字段，本文只引用路径、**不抢写、不改其内容**；
  两文件字段最终由主代理与 C 对齐。
