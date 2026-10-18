# US-10 进度 / 健康度 / 风险与关闭阻断 · 接口与口径说明（本票新增）

> 归属：**角色 A / 工单 #30**。实现位置：`src/modules/analytics/`、`src/modules/risk/`。
> **本文件不修改** `docs/sprint1-spec-interface-contract.md`（Sprint 1 冻结契约）；
> 新增端点按「提出 → 确认 → 单人修改 → 通知」流程并入，处理方式与 US-08 / US-09 一致。

---

## 1. 已确认口径（人工 2026-10-18 逐条拍板，原文见 #30 与 #24）

| # | 口径 |
|---|---|
| 1 | 健康度的「计划时间进度」基准 = **从任务推导** `min(planStart)` ~ `max(planEnd)`。**不给 `Project` 加日期字段** |
| 2 | C1 阈值 = 偏差 **≥ −10% 健康 / −10%~−25% 预警 / < −25% 风险**；阈值集中为常量并**随响应返回**，定案后只改一处 |
| 3 | C6 = **PM 全局基数；其余角色可见基数，且分子与分母同源** |
| 4 | 项目关闭入口放在**本票新模块**，不改 `src/modules/project/` |
| 5 | 风险四态：**PM 可任意流转（含重开），member 只读，每次变更写 `AuditLog`** |
| 6 | 敏感风险**继承所关联任务的敏感可见性**，不扩展 `VisibilityObjectType` |

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
- `health = { state, deviation, note? }`，`state ∈ HEALTHY / WARNING / AT_RISK / UNAVAILABLE`；
  `deviation = 实际进度 − 计划时间进度`（保留 4 位小数）。
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
- `blockingRisks = { state: 'unavailable', total: null, rows: [] }`：`Risk` 表未落地前的**如实占位**。

---

## 3. 为什么有 `UNAVAILABLE` / `unavailable` 这一态

沿用本仓库的「三态而不是两态」纪律（US-08 起）：

> **算不出来 ≠ 一切正常。** 返回 `0` 或 `HEALTHY` 会把"还没接上"说成"没有数据"或"状态良好"。

具体到本票：
- 项目下没有任务时，健康度无从谈起 → `UNAVAILABLE`，并给 `note`；
- 关闭校验收到的风险侧是空的（未接线）→ `blockingRisks.total = null`，且 `verdict` **最多只能到达
  「确定不能关」，不能到达「确定能关」**。

这条设计直接决定了一件事：**当前不可能出现"半数据放行"** —— 风险台账交付前，任何项目都拿不到
`canClose: true`。

---

## 4. `Risk` 表与迁移（**设计稿，未落地**）

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
| AC2 健康度三态 | ✅ 已实现（阈值按口径 2；含"正好等于阈值"的边界用例） |
| AC3 风险三级四态 | ⬜ **未实现**（需 `Risk` 表授权；枚举与流转口径已写入 `types.ts` 与本文） |
| AC4 关闭阻断 | ⚠️ **任务侧已实现**、风险侧未接线；关闭动作本身未开放 ⇒ **AC 未勾** |
| AC5 解除后可关闭 + 审计 | ⬜ 未实现（需关闭动作授权） |
| AC6 汇总权限 | ✅ 已实现（PM=global / 其余=visible，分子分母同源） |
| AC7 敏感不计入 | ✅ 任务侧已实现（分子、分母、状态分布、阻断清单均查询层过滤）；风险侧待 AC3 |

---

## 6. 待确认 / 申请中（不自行拍定）

1. **`Action` 新增**：`risk.write`、`project.close`（`src/shared/types.ts` + `src/modules/authz/permissions.ts`，
   两块冻结区，需技术负责人与权限模块负责人确认「谁能做」）。
   ★ 注意两处必须同改：`can()` 的第 5 条只拦 `WRITE_ACTIONS` 里的动作，
   只加类型不加集合的话，新动作会掉到第 6 条「其余允许」⇒ **成员也能写风险**。
2. **`Risk` 表 / `Project.status`**（`schema.prisma`）。
3. **挂载行**：`src/routes.ts`（2 处注册）、`web/src/routes.tsx`（2 处）、`ProjectLayout.tsx`（左导航 2 项）、
   `docs/frontend-routes.md`（2 行）。
4. **关闭的 HTTP 语义**：本票拟 `409 CONFLICT` + 阻断清单，且**不提供"强制关闭"**（待确认）。
5. **C10 销项建议**：进度口径已由 handoff §9 与人工拍板固定，建议正式销掉 C10。
6. **C3**：逾期/计划时间进度沿用 US-08 的 UTC 口径，`basis.timezone` 已如实声明。

---

## 7. 已知限制（如实登记）

1. **风险台账未交付** ⇒ 关闭校验只能到达"确定不能关"，达不到"确定能关"；AC3/AC5 不可勾。
2. **仪表盘与阻断预览的界面未做**：后端已就绪，但挂载行未授权，故本票暂不产出前端页面，
   避免先把东西做出来却接不上。
3. **非 PM 看到的是自己可见范围内的阻断清单**（`basis.scope = 'visible'`）；
   关闭动作本身仅 PM 可执行（待授权），已在 `basis.closeActionNote` 写明，
   避免成员把"我看不到阻断项"误读成"项目能关"。
4. **#37 事件未接线**：风险状态变化与项目关闭事件只做类型设计，不写运行时发布。
5. `Risk` 的 `updatedAt` 用 `@updatedAt` 由 Prisma 维护；若团队要求审计只落 `AuditLog`、表上不留 `updatedAt`，
   落地前可去掉。
