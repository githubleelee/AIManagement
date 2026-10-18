# US-10 进度 / 健康度 / 风险与关闭阻断 · 接口与口径说明（本票新增）

> 归属：**角色 A / 工单 #30**。实现位置：`src/modules/analytics/`、`src/modules/risk/`。
> **本文件不修改** `docs/sprint1-spec-interface-contract.md`（Sprint 1 冻结契约）；
> 新增端点按「提出 → 确认 → 单人修改 → 通知」流程并入，处理方式与 US-08 / US-09 一致。

---

## 1. 已确认口径（人工 2026-10-18 逐条拍板，原文见 #30 与 #24）

| # | 口径 |
|---|---|
| 1 | 计划时间进度 = **已过自然日数 ÷ 计划总自然日数（含首尾）**；计划区间取统计基数内任务的 `min(planStart)` ~ `max(planEnd)`；时区 **Asia/Shanghai**；无任务 → 「暂无计划数据」，**不做分级**。**不给 `Project` 加日期字段** |
| 2 | 偏差 = **计划时间进度 − 实际进度**，单位**百分点（pp）**；**比较用未舍入值**、展示保留 1 位小数；分级 **≤10pp 健康 / ≤25pp 预警 / >25pp 风险**（2026-10-18 批复冻结） |
| 3 | C6 = **PM 全局基数；其余角色可见基数，且分子与分母同源**；界面须标注「可见范围」 |
| 4 | 项目关闭入口放在**本票新模块**，不改 `src/modules/project/` |
| 5 | 风险写权限 = `risk.write`（**PM + MEMBER**，VIEWER 403）；四态流转细节由本票在业务层定义并写测试（公共层已落地） |
| 6 | 敏感风险**继承所关联任务的敏感可见性**，不扩展 `VisibilityObjectType` |

### 1.1 风险台账：创建即「未处理」（2026-10-19 起，**破坏性收窄**）

依据 DECISIONS `permissions.risk-ownership-change`：

> **创建风险时状态只能为 `OPEN`，其余三态必须经流转产生。**

- `POST /projects/:projectId/risks` 的请求体里若 `status` 给了且不是 `OPEN`
  → **422 `VALIDATION_FAILED`**，`details: [{ field: 'status', code: 'INVALID_VALUE' }]`；
  文案：「新建风险时状态只能是「未处理」；「处理中 / 已解决 / 已关闭」必须经状态流转产生」。
  （**2026-10-19 之前**该请求会得 201 并直接建出「已关闭」的风险 —— 照旧文档写的客户端需要改。）
- 「处理中 / 已解决 / 已关闭」只能先创建、再 `PATCH /risks/:riskId` 流转（走 `risk.flow` 归属判定）。
- 创建时给的 `resolution` **不生效**（状态恒为 `OPEN`，落库为 `null`，与 `PATCH` 对非解决态的
  清空口径一致）；创建路径上它仍参与形状校验，因此超长值会得到 422 `resolution: TOO_LONG`。
- 鉴权顺序不变：先 `can('risk.write')` 再校验 ⇒ VIEWER 403、非成员 404（与「项目不存在」逐字一致）。

外加（handoff §9 的必守口径）：**进度 = 已关闭任务数 ÷ 项目任务总数，`DONE` 不计入分子**；
**阻断条件 = 有未关闭任务，或有「未处理/处理中」的风险**。

---

## 2. 已实现的两个端点

### 2.1 `GET /projects/:projectId/dashboard` —— 进度与健康度

| 项 | 值 |
|---|---|
| 权限 | `can(actor, 'project.read', { kind: 'project' })`；非成员 / 不存在 → 404 |
| 响应 | `{ project, progress, health, byStatus, basis }` |

- `progress = { closed, total, ratio }`：`closed` 只计 `status === 'CLOSED'`；
  **`total === 0` 时 `ratio` 为 `null` 而不是 `0`**。
- `health = { state, deviationPp, note? }`，`state ∈ HEALTHY / WARNING / AT_RISK / UNAVAILABLE`；
  `deviationPp = 计划时间进度 − 实际进度`，单位**百分点（pp）**，展示保留 1 位小数（判定用未舍入值）。
- `byStatus`：六态计数，**之和恒等于 `progress.total`**。
- `basis`：`asOf / scope / planWindow / planTimeProgress / thresholds / 各口径文案 / timezone`。

### 2.2 `GET /projects/:projectId/closure-check` —— 关闭阻断校验预览（只读）

| 项 | 值 |
|---|---|
| 权限 | 同上 |
| 响应 | `{ project, verdict, blockingTasks, blockingRisks, basis }` |

- `verdict = { state, canClose, note }`，`state ∈ blocked / clear / unavailable`：
  - `blocked` → `canClose: false`：**已有未关闭任务**，风险侧未知也不影响这个结论（阻断条件是"或"）；
  - `unavailable` → `canClose: null`：任务侧没阻断，但风险侧还没接上 ⇒ **不敢说"能关"**；
  - `clear` → `canClose: true`：两侧都判过且都没阻断（`Risk` 表落地后才可能出现）。
- `blockingTasks = { state, total, rows }`：`status != 'CLOSED'` 的任务，计数与清单**同一个 where**，
  已按可见性作用域过滤；清单上限 50 条，`total` 始终精确。
- `blockingRisks = { state: 'ok', total, rows }`：`status ∈ OPEN / IN_PROGRESS` 的风险，
  按"继承关联任务可见性"过滤。

---

## 3. 为什么有 `UNAVAILABLE` / `unavailable` 这一态

沿用本仓库的「三态而不是两态」纪律（US-08 起）：

> **算不出来 ≠ 一切正常。** 返回 `0` 或 `HEALTHY` 会把"还没接上"说成"没有数据"或"状态良好"。

具体到本票（2026-10-18 独立审查 S4 后修订，此为**当前**口径）：
- 项目下没有任务时，健康度无从谈起 → `UNAVAILABLE`，并给 `note`；
- **只有 PM 能拿到 `clear` / `canClose: true`**：PM 拥有全项目基数。
- **非 PM（`basis.scope = 'visible'`）即使看到"两侧都干净"也只能得到
  `unavailable` / `canClose: null`** —— 他看到的只是可见范围，无法排除"存在自己看不见的
  未关闭任务/风险"。这条是本票中途一度写错（改成 `clear`）、由审查 S4 发现并纠正的行为：
  「我看不到阻断项」不等于「项目能关」。

> 一句话：**非 PM 永远拿不到 `canClose: true`**，因此不存在"可见子集冒充全项目"的放行。

---

## 4. `Risk` 表与迁移（**已落地**）

需 `schema.prisma` 授权（申请见 #24）。拟：

```prisma
model Risk {
  id          String   @id @default(uuid())
  projectId   String
  title       String
  description String?
  level       String   // RiskLevel: HIGH | MEDIUM | LOW
  status      String   @default("OPEN") // RiskStatus: OPEN | IN_PROGRESS | RESOLVED | CLOSED
  ownerUserId String
  taskId      String?  // 可选：关联任务，用于**继承该任务的敏感可见性**
  resolution  String?  // RESOLVED / CLOSED 时填写
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  task    Task?   @relation(fields: [taskId], references: [id], onDelete: SetNull)
  owner   User    @relation("RiskOwner", fields: [ownerUserId], references: [id], onDelete: Restrict)

  @@index([projectId, status])
}
```

并给 `Project` **加 1 列** `status String @default("ACTIVE")`（`ACTIVE` | `CLOSED`），
用于关闭动作。**不加** `planStart/planEnd`（口径 1）。

迁移只做 `CREATE TABLE` + `ADD COLUMN`，不改既有列、不动既有数据。

**设计上的一个规避**：`Project.status` **只加列、不进共享 `ProjectView`** ——
否则要改项目模块 `service.ts` 的序列化。本票端点自己读该列并只在自己的响应里返回，
因此 `src/modules/project/` **零改动**。

---

## 5. 与 AC 的对照（现状）

| AC | 现状 |
|---|---|
| AC1 进度口径 | ✅ 已实现（含"无任务返回 null"与"`DONE` 不计入"的用例） |
| AC2 健康度三态 | ✅ 已实现（按批复冻结口径：含首尾 / Asia/Shanghai / 计划−实际 / pp；含"正好等于阈值"的边界用例） |
| AC3 风险三级四态 | ✅ 已实现（CRUD + 四态流转 + 非法值 422 + 状态变化写审计；流转不强制单向，允许重开） |
| AC4 关闭阻断 | ✅ 已实现（任务侧 + 风险侧同时判定；`POST .../close` 被阻断 → **409**） |
| AC5 解除后可关闭 + 审计 | ✅ 已实现（`project.close` / `project.reopen` 各写一条 `AuditLog`；重开同样仅 PM） |
| AC6 汇总权限 | ✅ 已实现（PM=global / 其余=visible，分子分母同源） |
| AC7 敏感不计入 | ✅ 任务侧与**风险侧**均已实现（敏感风险继承关联任务可见性；清单、计数、阻断项都查询层过滤） |

---

## 6. 待确认 / 已落地

**已落地（项目负责人 2026-10-18 批复，公共层由 B 完成）**
- `Action`：`risk.write`（PM + MEMBER，VIEWER 403）、`project.close`（仅 PM）
- `Risk` 表 + `Project.status` 列 + 迁移；`test-support` 清理顺序
- 挂载：`src/routes.ts` 的注册行由本票在登记范围内自行添加（已向 B 登记）

**仍待确认（本票按拟案实现并留痕）**
1. **关闭被阻挡时的响应体形态**：本票用 `409 CONFLICT`，阻断**清单不在错误体里**
   （契约 I-3 的错误信封只承载 `{field, code}` 明细，塞不下任务/风险对象）；
   界面须先调 `GET .../closure-check` 取清单。若要"清单随 409 一起返回"，需要改错误信封（冻结区）。
2. **"解决说明"必填**：状态改为 `RESOLVED` / `CLOSED` 时要求 `resolution` 非空（422 `resolution: REQUIRED`）。
   契约未定义此规则，属本票按 schema 注释（"RESOLVED / CLOSED 时填写"）落地，**待确认是否保留**。
3. **四态是否允许回退**：批复把细节交给本票定义，当前**允许任意流转（含重开）**，
   理由是不在业务层私写角色判定。
4. **C10 销项建议**：进度口径已由 handoff §9 与批复第 3 节固定，建议正式销掉 C10。
5. **C3 已定案**：按批复第 3 节，时区为 **Asia/Shanghai 自然日、含首尾**（不再沿用 UTC）。

---

## 7. 已知限制（如实登记）

1. **界面已实现**（本票范围：仪表盘页 + 风险台账页 + 左导航 2 项 + `docs/frontend-routes.md` 2 行），
   浏览器走查 6 项已做、截图 6 张随 PR #55 一并提交。本文件只描述后端接口与口径。
2. **非 PM 看到的是自己可见范围内的阻断清单**（`basis.scope = 'visible'`）；
   关闭动作本身仅 PM 可执行，已在 `basis.closeActionNote` 写明，
   避免成员把"我看不到阻断项"误读成"项目能关"。
3. **#37 事件未接线**：风险状态变化与项目关闭事件只做类型设计，不写运行时发布。
4. **风险不提供删除**：四态里的 `CLOSED` 已能表达"不再跟进"；删除会让审计断链，故未做。
5. `Risk.updatedAt` 由 Prisma `@updatedAt` 维护，与 `AuditLog` 并存（前者看当前值，后者看历史）。
