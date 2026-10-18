# US-13 · AI 质量 / 进度 / 风险 / 效率分析 —— 设计（未实现）

> 归属：**角色 A / 工单 #33**。本文件是**设计文档**，不含实现。
> 正式接口契约仍以 `docs/sprint1-spec-interface-contract.md` 为准；本文件与
> `us-08-workbench-api.md`、`us-09-acceptance-api.md`、`us-10-progress-risk-api.md` 同级，
> 并入契约需走「提出 → 确认 → 单人修改 → 通知」流程。
>
> **为什么现在只出设计**（2026-10-18 实测）：
> - `#31`（AI 框架接口，本票的**接口先行依赖**）**未交付** ⇒ AC5「接入公共接口、不跨模块调 service」无处可接；
> - `#27`（成员负载）**未交付** ⇒ "效率 / 负载不均"这一类没有数据源；
> - `#30` 的风险台账未落地 ⇒ "风险"这一类缺一半。
>
> 按交接文档 §8：公共 AI 接口的放置方式未在 #24 第 3 点确认前，**只提供类型 / 接口设计，
> 不自行创造跨模块例外，不写运行时互调**。本文件即该产出。

---

## 1. 范围与不做

**范围**：面向仪表盘输出 **四类建议**（质量 / 进度 / 风险 / 效率），只给建议、不写成正式结论；
关键建议**人工确认**后才"采纳"；记录采纳 / 修改 / 拒绝及原因，并可统计采纳质量。

**不做**：自动决策、替代验收、调用外部公有云模型、独立的 AI 助手页面（本票只做仪表盘内嵌块）。

---

## 2. 四类建议：数据源与口径

**总原则：口径必须与 #30 一致，不得各自定义（AC6）。** 下表右列标出"现在能不能算"。

| 类别 | 输入（口径来源） | 现在能算吗 |
|---|---|---|
| **质量** | 验收数据（#29）：驳回次数、重验轮次、驳回原因分布、卡住（`BLOCKED`）任务数与滞留时长 | ✅ 有数据 |
| **进度** | #30 已落地的口径：`closed / total`、计划时间进度、偏差 | ✅ 有数据（只读部分已实现） |
| **风险** | 风险台账（#30）：未处理 / 处理中 的数量与级别分布、与关闭阻断的关系 | ⬜ 等 `Risk` 表 |
| **效率** | 成员负载（#27）+ 任务在 `DOING` / `DONE`（待验收）的滞留时长、验收平均等待时间 | ⬜ 等 #27 |

**每类建议必须附带"证据数字"**：建议里出现的每个判断，都要能追溯到一组可复核的聚合值
（例如"3 个任务在待验收状态停留超过 7 天"），而不是一句主观描述。

---

## 3. 建议对象的统一结构（设计）

```ts
type InsightKind = 'QUALITY' | 'PROGRESS' | 'RISK' | 'EFFICIENCY'

type InsightSeverity = 'INFO' | 'WARNING' | 'CRITICAL'   // 与 #30 的健康度三态口径区分开，不混用

type AiSuggestion = {
  id: string
  projectId: string
  kind: InsightKind
  severity: InsightSeverity
  /** 一句话现象（陈述事实，不是结论、不是命令） */
  title: string
  /** 2~4 句展开，必须引用 evidence 里的数字 */
  detail: string
  /** ★ 证据：可复核的聚合值，界面直接展示，供人工判断 */
  evidence: Array<{ label: string; value: number | string }>
  /** ★ 口径声明：与 #30 对齐；读取者能看到"这个数是怎么来的" */
  basis: Record<string, unknown>
  /** ★ 本次建议的统计基数（C6）：PM = global，其余 = visible。读取时按此过滤，防泄漏 */
  scope: 'global' | 'visible'
  /** ★ 生成方式：stub = 本地规则式（非真实模型）。界面必须显式标注 */
  model: { mode: 'stub' | 'external'; name: string }
  generatedAt: string
  /** 人工处置状态 */
  status: 'PROPOSED' | 'ACCEPTED' | 'MODIFIED' | 'REJECTED'
  decidedByUserId: string | null
  decidedAt: string | null
  /** `MODIFIED` / `REJECTED` 时必填 */
  decisionReason: string | null
}
```

### 三条措辞约束（写进实现纪律，也用测试钉住）

1. **不得写成正式结论**：不出现"项目一定会延期""该成员不合格"这类断言。
2. **不得写成命令**：不出现"必须关闭该任务"，只能是"建议关注"。
3. **不得省略证据**：`evidence` 为空即视为不合格输出（测试断言非空）。

---

## 4. 人工确认与审计（AC2 / AC3）

### 4.1 状态流转

```
PROPOSED ──采纳──→ ACCEPTED
         ──修改后采纳──→ MODIFIED（需 decisionReason）
         ──拒绝──→ REJECTED（需 decisionReason）
```

- 只有 `PROPOSED` 可被处置；已处置的不可再改（要改就产生新建议）。
- **"采纳"只是标记 + 写审计，不改任何业务表**。本票**不做**"AI 自动改数据"——
  这是 AC2「关键建议未经人工确认不进入正式数据」最直接的实现方式。

### 4.2 谁能处置

拟：**PM 可处置**；member / viewer 只读（范围待 C6）。
由于"处置"是一个写动作，需要一个 `Action`；现有 7 个动作都不合适
（与 #30 的 `risk.write` / `project.close` 完全同型）。**建议与 #30 那批一并申请**。

### 4.3 审计

每次处置写一条 `AuditLog`（表已存在）：`action = 'ai.suggestion.accept' | '.modify' | '.reject'`，
`before/after` 记录状态、处置人、原因。**不记录 AI 上下文原文**（见 §5）。

### 4.4 采纳质量统计（AC3 的后半句）

`采纳率 = ACCEPTED ÷ (ACCEPTED + MODIFIED + REJECTED)`，
另给 `修改率`、`拒绝率`；按类别（四类）与时间窗口分组。
这组数字本身就是"这个 AI 建议有没有用"的证据 —— **统计口径随响应返回**。

---

## 5. 数据边界（AC4）—— 本票最关键的设计

### 5.1 默认口径（C4 未批准前）

> **敏感对象默认不纳入；未批准不纳入。无论如何真实数据不外发公有云。**

实现上按下面的顺序逐层收窄，任何一层都可以独立成立：

1. **不出仓库**：AI 调用只发生在"本地桩"模式（`model.mode = 'stub'`），无任何网络外发。
2. **只传聚合数字，不传原文**：喂给分析层的**只有**计数 / 比率 / 时长这类数值，
   **不传**任务标题、描述、成员姓名、驳回原因原文。这一条同时满足"最小必要"与"天然脱敏"。
3. **按 C6 基数取数**：统计本身走 `visibilityScope()`，PM = 全局、其余 = 可见；
   因此生成出来的建议**不带全局数字**，读取时也不会通过建议泄漏敏感对象的存在性。
4. **敏感对象不进入任何一个聚合**：与 #30 的 AC7 同一做法（查询层过滤）。

### 5.2 若将来 C4 书面批准纳入敏感对象

需在此处补三样东西，**未补齐不实现**：
① 脱敏规则（保留哪些维度、去掉哪些）；② 隔离方式（是否单独通道 / 单独存储）；
③ 审计留痕（谁批准、纳入了哪些对象）。**当前一律按"不纳入"实现。**

---

## 6. 与 #31 的接口（AC5）—— 本票需要的**最小端口形状**

本票**不实现** AI 端口，只声明"我需要什么"，由 #31 提供后接入。放置位置按 #24 第 3 点结论
（建议放 `src/shared`，运行时在 app 组装根注入）。

```ts
// 本票期望的端口（形状提案，未落地、不写入 shared，等 #31 / #24 定）
type InsightInput = {
  projectId: string
  scope: 'global' | 'visible'
  /** 只含聚合数值，不含任何原文（见 §5.1 第 2 条） */
  metrics: {
    progress: { closed: number; total: number; planTimeProgress: number; deviation: number }
    quality: { rejections: number; reverifications: number; blockedTasks: number; avgAcceptanceDays: number | null }
    risk: { openRisks: number; inProgressRisks: number; byLevel: { high: number; medium: number; low: number } } | null
    efficiency: { byMember: Array<{ memberKey: string; openTasks: number }> } | null   // memberKey 为匿名键，不是姓名
  }
  locale: string
}

type InsightOutput = { suggestions: Array<Omit<AiSuggestion, 'id' | 'projectId' | 'status' | 'decidedByUserId' | 'decidedAt' | 'decisionReason'>> }
```

**桩实现的诚实要求**：本地桩用**规则式**（例如"待验收超过 7 天的任务 ≥ 3 个 → 进度类 WARNING"）产生建议，
响应的 `model.mode` 恒为 `'stub'`，界面**必须**显示"规则式演示建议，非真实 AI"。
**不得**把规则式输出冒充模型分析。

---

## 7. 需要一并申请的冻结区 / 新对象

| 对象 | 改动 | 说明 |
|---|---|---|
| `schema.prisma` | +1 model `AiSuggestion` | 建议与其处置状态、原因、生成方式（stub/external）落库 |
| `Action` | 新增 1 个动作（如 `ai.review`） | 处置建议是写动作；与 #30 的 `risk.write` / `project.close` 同型，**建议同一批申请** |
| `src/routes.ts` | +1 行注册 | 新端点 |
| `web/src/routes.tsx` + `ProjectLayout.tsx` + `docs/frontend-routes.md` | 挂载行 / 导航项 | 仪表盘内嵌块是否需要独立路由，待与 #30 页面一并定 |

> 也就是说：**#33 与 #30 卡在同一批授权上**。这也是本票先做设计、不先建分支的原因。

---

## 8. 拟定的端点（设计，未实现）

| 方法 / 路径 | 用途 | 权限 |
|---|---|---|
| `GET /projects/:projectId/insights` | 四类建议列表（按 C6 基数过滤） | `can(project.read)` |
| `POST /projects/:projectId/insights/generate` | 触发一次分析（桩） | 待定（PM？） |
| `POST /insights/:suggestionId/decision` | 处置：采纳 / 修改后采纳 / 拒绝（后者需原因） | 待定（PM）+ 新动作 |
| `GET /projects/:projectId/insights/stats` | 采纳质量统计（采纳率 / 修改率 / 拒绝率） | 同读取 |

---

## 9. AC 对照（现状：**全部未实现**，设计已定）

| AC | 设计是否覆盖 |
|---|---|
| AC1 四类建议、不写成正式结论 | ✅ §2 / §3（含三条措辞约束） |
| AC2 未经人工确认不进入正式数据 | ✅ §4.1（"采纳"只改建议状态 + 写审计，不碰业务表） |
| AC3 记录采纳/修改/拒绝及原因，可统计质量 | ✅ §4.3 / §4.4 |
| AC4 数据来源限于有权可见；敏感默认不纳入 | ✅ §5（四层收窄；未批准不纳入） |
| AC5 接入 #31 公共接口，无跨模块 service 调用 | ✅ §6 只出端口形状，**不实现** |
| AC6 与 #30 口径一致 | ✅ §2 明确以 #30 为准，不各自定义 |

---

## 10. 待确认（不自行拍定）

1. **C4**：AI 服务与资源（本地化 / 私有化方案、是否可离线）—— 未定前**只有桩**。
2. **C4 数据边界**：是否允许"已授权且最小必要"地纳入敏感对象 → 未批准按**不纳入**实现。
3. **C6**：建议的可见范围（PM / member / viewer 各看到什么）—— 本文件按 #30 已拍板的口径
   （PM 全局、其余可见且同源）暂定，需在 #33 上再确认一次。
4. **处置权限**：谁能采纳/拒绝（拟 PM），以及是否需要新的 `Action`。
5. **建议是否落库**：本设计假定落库（便于统计采纳质量）；若团队倾向"只留审计日志不建表"，
   则 §7 的 `AiSuggestion` 表可去掉，改成全部走 `AuditLog`。

---

## 11. 已知风险（提前登记）

1. **把桩当 AI**：规则式输出容易被误认为是模型分析 → 用 `model.mode` + 界面标注双重约束。
2. **聚合数字的间接泄漏**：若基于全局基数生成、却给非 PM 看，会泄漏敏感对象的存在性
   → 用 `scope` 字段 + 查询层基数解决（§5.1 第 3 条）。
3. **建议变成结论**：措辞约束必须由测试钉住，不能只靠自觉。
4. **效率类的成员维度**：需要匿名键（`memberKey` 而非姓名），否则分析结果本身成为人事数据。
