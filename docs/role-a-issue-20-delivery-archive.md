# ROLE-A · 工单 #20 交付说明（完整可读归档）

> **为什么有这个文件**
>
> 本票下由 ROLE-A 发出的两条交付回帖在 GitHub 上**被截断**，均断在第一个代码块处，
> 后半部分（口径表、"三处差异"、操作流程、验证数据）未能送达：
>
> | 位置 | 实际留在 GitHub 上的长度 | 缺失内容 |
> |---|---|---|
> | #20 comment `6330555879` | 335 字（断在 §一.1 代码块内） | §一.2 之后全部 |
> | #20 comment `6330566865` | 1082 字（断在 §一.3 之前） | §二 ~ §六 全部 |
> | PR #100 正文 | 578 字（断在代码块内） | §一.2 之后全部 |
>
> 故按项目负责人要求（#20 comment `6365254755`：**"请补可读归档"**）将全文落到本文件。
> 后续回帖只需指向本文件，不再正文粘贴长文。
>
> **口径声明**：本文件是对已交付内容的重述，**不主张任何额外授权**，
> 也不扩大既有批复范围。已合入部分以 main 的实际代码与 PR 评审记录为准。

---

## 第一部分 · PR #95 交付（风险域事件生产 + AI 面板挂载）

**状态：已合入 main**（PR #95，合并提交 `cef7ac6`；main 可见 `riskEvents` 装配与
`AiBreakdownPanel` 挂载）。本节仅补齐当时未送达的文字。

### 1. 接口签名

端口（`src/modules/risk/types.ts`）：

```ts
export type RiskEventPort = {
  publish(event: RiskEventDraft, transaction: Prisma.TransactionClient): Promise<void>
}
```

`RiskEventDraft` 与甘特域同构：`{ eventName, projectId, object, actor, occurredAt }` 判别联合；
敏感分支的 `payload` 只能是 `{ references: EventObjectRef[] }`。

适配器（`src/modules/risk/event-port.ts`）：

```ts
export function createRiskEventPort(options: RiskEventPortOptions): RiskEventPort

export type RiskEventPortOptions = {
  repository: RiskTransactionalEventRepository
  newId?: () => string   // 缺省 randomUUID
  now?: () => Date       // 缺省 () => new Date()
}

export type RiskTransactionalEventRepository = {
  appendIfAbsent(
    event: DomainEventEnvelope,
    transaction: Prisma.TransactionClient,
  ): Promise<AppendEventResult>
}
```

`RouteContext` 字段名：**`riskEvents`**。

### 2. 口径落地

| 技术负责人口径 | 落地 |
|---|---|
| 同事务追加、不自行提交、失败即业务回滚 | 写路径在既有 `$transaction` 内 `await events.publish(draft, tx)`；专测「发布失败 → 风险行 / 审计行 / 事件行三者皆无」 |
| 端口与适配器放模块内，不反向 import | `src/modules/risk/event-port.ts`，只依赖 `src/shared/events.ts` 与 `@prisma/client` |
| 用 `buildDomainEventEnvelope` 不自拼信封 | 适配器只注入 `id` / `storedAt`，`schemaVersion` 由公共纯函数补齐 |
| 事件名 / object | `risk.created`、`risk.updated`；`object = {objectType:'risk', objectId}` |
| 非敏感载荷只放结构与标识 | `{status, level, ownerUserId, taskId}`（更新时另加 `changedFields`）；**不含标题 / 描述正文 / 解决说明**，有专测断言载荷里连 `title` 字段名都不出现 |
| 确定性幂等键 | 创建 `risk.created:<riskId>`；更新 `risk.updated:<riskId>:<occurredAt ISO>` |
| 敏感规则（I-6） | 事务内查关联任务 `isSensitive`，任一为真 → 整条以敏感事件发布，载荷只有 `{references}`（含 risk 自身 + 关联任务）；改绑场景同时查**改绑前后**两个任务 |
| 不新增端点 / 不碰 `shared/events.ts` 与 `src/db/**` | 遵守（`shared/events.ts` 至今未由 A 修改，见 §3 第 ③ 条） |

### 3. 三处差异（原回帖缺失章节，此处补全）

#### ① 没有 `risk.deleted`

请求原文写的是「`createRisk` / `patchRisk` / 删除」，但风险的写路径**只有创建与修改**：
`src/modules/risk/plugin.ts` 共 7 个端点，**无 DELETE**。而「已解决 / 已关闭」是
`RiskStatus` 的两个取值、经 `PATCH` 流转，落在 `risk.updated` 的载荷里
（带 `status` 与 `changedFields`），**不是删除**。

按"不新增 HTTP 端点"的约束，本批不接 `risk.deleted`。若将来确有删除入口，再单独开事件。

#### ② 动了技术负责人预留的两行（已合入，请复核）

`RouteContext.riskEvents` 的字段声明（`src/routes.ts`）与注入行（`src/app.ts`）原属技术负责人
单写范围。缺这两行时 `registerRiskRoutes` 会按其 fail-fast 规矩直接抛错、风险模块全部测试起不来。
经项目负责人同意，按与 `ganttEvents` / `requirementEvents` **逐字同构**的写法补上：

```ts
// src/routes.ts
riskEvents?: RiskEventPort

// src/app.ts
context.riskEvents = createRiskEventPort({ repository: eventRepository })
```

**状态：已随 PR #95 合入 main，以该 PR 的评审记录为准**；若需改命名或位置，A 按技术负责人的要求改。

#### ③ 事件目录表未登记，需技术负责人补

`src/shared/events.ts` 的事件目录表由技术负责人单写，A **未修改**。
需要登记的名字现已增至五个（三个风险 + 两个验收）：

```
| `risk.created`       | `risk` | `{status, level, ownerUserId, taskId}`                                  | `risk.created:<riskId>`                      | 关联任务 `isSensitive`（风险继承任务可见性） |
| `risk.updated`       | `risk` | `{status, level, ownerUserId, taskId, changedFields}`                    | `risk.updated:<riskId>:<occurredAt>`         | 改绑前后任一关联任务 `isSensitive`           |
| `risk.level-raised`  | `risk` | `{fromLevel, toLevel, status, ownerUserId}`                              | `risk.level-raised:<riskId>:<occurredAt>`    | 改绑前后任一关联任务 `isSensitive`           |
| `acceptance.approved`| `task` | `{conclusion, statusBefore, statusAfter, recordId}`                      | `acceptance.approved:<taskId>:<occurredAt>`  | 任务 `isSensitive`                           |
| `acceptance.rejected`| `task` | `{conclusion, statusBefore, statusAfter, recordId}`                      | `acceptance.rejected:<taskId>:<occurredAt>`  | 任务 `isSensitive`                           |
```

### 4. AI 面板最小挂载

- 文件：`web/src/pages/RequirementDetailPage.tsx`（仅此一个，未新增文件）
- 实际行数：**21 行**（登记时预估 20 行、上限 30 行，未超）
- 能力位：`canRead`（项目成员语义）/ `canGenerate` / `canReview` = 仅 PM
- 未新增 URL、未加依赖、未改骨架、未碰其他页面；样式随 `AiBreakdownPanel` 自带的
  `ai-breakdown.css` 生效
- 挂载位置：故事详情区、任务区块之后（与 `TaskSection` 同级），不新增页签

---

## 第二部分 · PR #100 交付（风险提级事件 + 验收结果事件）

**状态：PR #100 待复核**（分支 `feat/risk-level-raised-and-acceptance-events`，commit `cc7c887`）。
技术负责人已明确：**事件生产子集独立评审，不因 FS 候选未合入而改变范围或宣称通知送达**
（#29 comment `6367883854`）。

### 1. 接口签名

#### 1.1 风险域 —— 只扩事件名，端口本身不变

`RiskEventPort` 与 `createRiskEventPort` 签名一字未改，`RouteContext.riskEvents` 也不变。
本次只把事件名枚举扩为三个：

```ts
export type RiskEventName = 'risk.created' | 'risk.updated' | 'risk.level-raised'
```

#### 1.2 验收域 —— 此前无任何事件通道，本次从零建

```ts
// src/modules/acceptance/types.ts
export type AcceptanceEventName = 'acceptance.approved' | 'acceptance.rejected'

export type AcceptanceEventPort = {
  publish(event: AcceptanceEventDraft, transaction: Prisma.TransactionClient): Promise<void>
}

// src/modules/acceptance/event-port.ts
export function createAcceptanceEventPort(options: AcceptanceEventPortOptions): AcceptanceEventPort

export type AcceptanceEventPortOptions = {
  repository: AcceptanceTransactionalEventRepository
  newId?: () => string   // 缺省 randomUUID
  now?: () => Date       // 缺省 () => new Date()
}

export type AcceptanceTransactionalEventRepository = {
  appendIfAbsent(
    event: DomainEventEnvelope,
    transaction: Prisma.TransactionClient,
  ): Promise<AppendEventResult>
}
```

`RouteContext` 字段名：**`acceptanceEvents`**。

### 2. 事件口径

| 事件名 | object | 非敏感载荷 | 幂等键 | 敏感判定来源 |
|---|---|---|---|---|
| `risk.level-raised` | `{objectType:'risk', objectId}` | `{fromLevel, toLevel, status, ownerUserId}` | `risk.level-raised:<riskId>:<occurredAt ISO>` | 关联任务 `isSensitive`（改绑前后两个任务） |
| `acceptance.approved` | `{objectType:'task', objectId}` | `{conclusion, statusBefore, statusAfter, recordId}` | `acceptance.approved:<taskId>:<occurredAt ISO>` | `Task.isSensitive`（事务内读） |
| `acceptance.rejected` | `{objectType:'task', objectId}` | 同上（`conclusion: 'REJECT'`） | `acceptance.rejected:<taskId>:<occurredAt ISO>` | 同上 |

#### 幂等键为何必须是更新类

技术负责人 #20 comment `6358121473` 第 1 条指出 `risk.level-raised` 的坑，A 按该口径实现，
并将**同一个坑在验收域一并堵住**：

- `risk.level-raised` 归入**更新类**（键带 `occurredAt`）。同一风险 `LOW → MEDIUM → HIGH`
  得到**两条**事件、两条不同的键；若按创建类算，第二次真实提级会被永久去重。
- `acceptance.*` 同样是更新类。理由同源：同一任务可以被「驳回 → 重新提交 → 再驳回」，
  按 `<eventName>:<taskId>` 会让**第二次同结论验收**永久消失。已写专测钉住。

同一毫秒内的重复仍会被合法去重（`src/shared/events.ts` 明示的可接受行为）。

#### 敏感与载荷边界

- 只要涉及敏感关联任务，整条事件以敏感事件发布，载荷**只能是** `{references}`；
  `risk.level-raised` 的敏感判定覆盖**改绑前后**两个任务。
- 载荷不放风险标题 / 描述正文 / 解决说明。
- 载荷不放验收 `reason`（自由文本属受保护内容；需要时消费方按 `recordId` 回查）。
- 载荷**不放任何收件人字段**（按技术负责人裁定，收件人由权威适配器解析）。

#### 同事务语义

三类事件都在**既有业务事务内**追加（`appendIfAbsent(event, tx)`），适配器不自行提交；
发布失败 = 业务写入整笔回滚。有专测覆盖「发布失败 → 状态 / 审计 / 记录 / 事件四者皆无」。

#### 关于 `risk.updated`

`risk.updated` 仍然存在（上一批已合入 main），但**它不是通知触发事件** ——
`DECISIONS.md` 的九名名单里没有它。消费桥接只应认那九个名字，不得把 `risk.updated`
当作提级或任何通知的触发源。

### 3. 技术负责人侧的操作流程

#### 第 1 步 · 复核 A 占的两行（B 单写文件）

缺这两行时验收路由会按 fail-fast 规矩直接抛错、整个验收模块起不来，故经项目负责人同意，
按与 `ganttEvents` / `requirementEvents` / `riskEvents` **逐字同构**的写法补上：

```ts
// src/routes.ts —— RouteContext 内新增（含 import）
acceptanceEvents?: AcceptanceEventPort

// src/app.ts —— 与既有三行并列
context.acceptanceEvents = createAcceptanceEventPort({ repository: eventRepository })
```

复用的是**同一个** `eventRepository` 实例，**不需要新增任何仓储或注入点**。

#### 第 2 步 · 在 `src/shared/events.ts` 事件目录登记五个新名字

见第一部分 §3 第 ③ 条的表格。

#### 第 3 步 · 接消费桥接（收件人解析）

按技术负责人裁定，收件人**不由事件载荷给出**，由权威适配器现查：

- `risk.level-raised`：项目 PM + `Risk.ownerUserId`；本域只发事件，不判读收件人。
- `acceptance.approved` / `acceptance.rejected`：`Task.ownerUserId` / `Task.acceptorUserId`
  （按 `DECISIONS.md` `notifications.event-catalog-exact-names` 的口径），并做当前成员与对象权限筛选。

事件里 `object.objectId` 即回查主键：风险事件回查 `Risk.id`，验收事件回查 `Task.id`
（载荷里的 `recordId` 可再定位到具体 `AcceptanceRecord`，其中含 `reason`）。

#### 第 4 步 · 联调验证顺序（便于一次定位问题出在哪一层）

1. **只验生产**：不做消费桥接，先起服务发一次「中→高」提级与一次验收，直接查 `DomainEvent` 表，
   确认键、载荷、`sensitive` 三项符合 §2。此步绿 = 本域生产无问题。
2. **再验敏感过滤**：把任务标敏感且白名单清空，用非 PM 账号走查询层应查不到该事件；PM 查得到。
3. **最后接消费**：接上桥接后验通知收件人是否等于「PM + owner」的并集去重，以及 60 秒窗口。

**A 只保证到第 2 步**；第 3、4 步属通知链路，归技术负责人。

### 4. 两处需确认

#### ① 改正了一个与决策冲突的占位类型（产生一处文档引用失效）

`src/modules/acceptance/types.ts` 原有标注"未接线"的占位类型 `AcceptanceEventPayload`，
其事件名写作 `task.accepted` / `task.rejected`，与 `DECISIONS.md`
`notifications.event-catalog-exact-names` 冻结的精确名单（`acceptance.approved` /
`acceptance.rejected`）不一致。A 按决策文件改正，并替换成正式的
`AcceptanceEventName` / `AcceptanceEventDraft` / `AcceptanceEventPort`。
该占位从未有运行时依赖，替换无破坏。

**副作用**：`docs/role-b-scheduling-transaction-proposal.md:119` 点名引用过这个旧类型名。
那是技术负责人的文档，A **未修改**，请其自行更新或书面授权 A 改。

#### ② 验收域此前完全没有事件通道，由 A 从零建

若原计划由 B 侧统一提供验收事件端口，请明确叫停，A 按 B 的接口重写；
否则按 `createAcceptanceEventPort` 接入。

### 5. 验证

- 根类型检查 / Web 类型检查：**双绿**
- 全量测试：**76 文件 / 1659 例全绿**（基线 `5ef3b4a` 为 1639 例，本批净增 20 例；
  另有 1 文件跳过、12 例 todo，均为既有状态）
- 新增测试：
  - `src/modules/risk/risk-events.test.ts` 新增 10 例：跨级提级 / 降级不发 / 同级不发 /
    只改其他字段不发 / 两次提级键不同 / 两条事件共用 `occurredAt` / 敏感提级只有 references /
    载荷无正文
  - `src/modules/acceptance/acceptance-events.test.ts` 新增 10 例：通过 / 驳回 /
    载荷无 reason 与收件人 / **第二次同结论验收仍发得出去** / 409 与 422 零事件 /
    CAS 落空零事件 / 发布失败回滚 / 敏感只有 references + MEMBER 查不到 PM 查得到 /
    非敏感不误伤
- 未新增 HTTP 端点、未新增依赖、未碰 `src/db/**`、
  未碰 `task.assigned` 与 `acceptance.submitted`（该两条划归 C，A 未越窗）

---

## 第三部分 · 待接事项（未开工，仅登记）

### FS 守卫（任务进入 DOING 的前置校验）

依据：#29 comment `6367883854`（技术负责人转述项目负责人裁定）+ #20 comment `6367885526`。

裁定要点：**所有从非 DOING 进入 DOING 均校验 FS**，包括首次、恢复、重开及**验收 REJECT**；
重复写已是 DOING 的任务不属于新进入；PASS 目标 CLOSED 不属本规则。

A 的窄修改范围（已登记，**尚未实现**）：

- 位置：验收域 REJECT 分支、既有 caller-tx 内
- 时机：在任务状态 CAS / 验收记录 / 审计 / 事件写入成功**之前**调用 B 的统一共享守卫
- 失败语义：整次验收回滚，不落 `AcceptanceRecord`、不写成功审计、不发 `DomainEvent`
- 不改动：现有 `task.accept` 判权
- 预期接口（B 单写，**尚无就绪 SHA**）：

```ts
// src/shared/task-execution.ts，B 单写
interface TaskStartGuardPort<TTransaction> {
  assertCanEnterDoing(transaction: TTransaction, input: {
    projectId: string
    taskId: string
    nextPlanStart?: string
  }): Promise<void>
}
// src/app.ts 组装；RouteContext.taskStartGuard 注入
```

A 只消费注入端口，不 import `task/rules` 或 DB 实现、不复制前置判定。
**当前阻塞**：B 端口未就绪，A 等真实 commit 后基于候选分支接入。

### 其他

- 工单 #33 共享建议存储前提已具备（#20 comment `6365254755`），A 可按正式契约推进。
- 工单 #28 真提及按后置单向取证。
- 局部已合入不等于四子票 AC 全通过，父票不自动关闭。
