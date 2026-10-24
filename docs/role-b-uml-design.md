# ROLE-B → GitHub #35：在线 UML（用例图 / 时序图）最小模型与接口设计

> **状态：FROZEN v1.0（2026-10-19）· 已按项目负责人批准口径冻结 · 取代下方 DRAFT 状态行。**
> - 依据：`DECISIONS.md` `uml.minimal-model-and-visibility`、`permissions.uml-write`（PR #72 → main `aa69288`）；C 的 #35 申请（#24 评论 6249728765）、B 的逐项答复（#24 评论 6261802627）、B 的设计交付与裁定（#24 评论 6263362484）。
> - **项目负责人 2026-10-19 裁定**：关联对象纳入 **4 类**（业务目标 / 用户活动 / 用户故事 / 任务）——完整满足 `#35` AC2；目标 / 活动**无敏感维度**，对全体项目成员可见，不引入新的可见性复杂度。
> - **B 的裁定**：图负责人非空（创建默认当前 PM，PM 可转移给任意项目成员）；UML 事件本期**不接线**（D 的 `#37` 未交付）；**不做**乐观锁（最后写入者全胜，登记为已知限制）；列表返回 `total`（同 `where` 计数）；时序图**允许自消息**；客户端显式传 `seq` **被忽略**（服务端分配）；上限 nodes 200 / edges 500 / 关联各 50。
> - **C 决定**：前端渲染与 `orderIndex` 换序交互细节（后端 `PUT content` 已支持重排）。
> - 冻结范围与变更：见文末 **§Z v1.0 冻结变更记录**。


> **（历史）状态：DRAFT · 设计提案 · 未冻结模型 / 路由 / 字段 · 不含实现代码。**
> 本文只交付 #35 在**已批准最小口径**下的模型与接口设计、公共层批次划分、逐 AC 验证方案，供 P1（模型 + 迁移）开工前核对。
> 本文**不改**任何 `src/**`、`web/**`、测试、迁移，不改 `DECISIONS.md`，不新增路由，不声明任何 AC 已通过。

| 项目 | 内容 |
|---|---|
| 对应工单 | GitHub #35 / US-15 在线用例图 / 时序图并关联项目数据（执行方 ROLE-C；公共层由 ROLE-B 单写） |
| 源码基线 | `origin/main` = **`aa69288`**（`Merge pull request #72: UML 口径与 uml.write 批准入库`）；worktree `/home/lee/aim-wt/b-uml-design`，`npm ci` 已真装（`@prisma/client` 6.19.3） |
| 依据 | `DECISIONS.md` 的 `uml.minimal-model-and-visibility`（2026-10-19T16:20:00+08:00）、`permissions.uml-write`（同时间戳）；C 的 #35 最小契约申请（#24 评论 6249728765）；B 的逐项技术答复（#24 评论 6261802627）；`docs/role-b-gantt-design.md`（结构参照）；`docs/role-b-contract-register.md` |
| 估算 | 归原 #35 的 9 人日；B 只承担公共层（P1 / P4 / P5 挂载与文档），不重复计算 C 的实现工时 |

**标记约定**：✅ 已由项目负责人 / 权限负责人批准（**不得改写，只能细化**）；🟡 本文候选（待 C 或负责人核对）；⛔ 待决（依赖他人交付或授权）。已批准口径 ≠ 已实现；下表所有模型 / 字段 / 路由均**未冻结**。

---

## 1. 范围与边界

### 1.1 已批准口径（✅ 逐条摘自 `DECISIONS.md`，本文只做细化）

| # | 口径 | 本文落点 |
|---|---|---|
| 1 | **仅两类图**：用例图、时序图 | §3.1 单表 + `kind` 判别列 |
| 2 | 用例图关系**仅** `ASSOCIATION`（参与者—用例）、`INCLUDE`、`EXTEND`（用例—用例） | §3.3 / §4.2 写入层白名单 |
| 3 | 时序图消息 `sync` / `async` / `return`，`seq` **严格递增** | §3.3 / §4.4 |
| 4 | **本地结构化编辑 + SVG 即时预览**，不引外部建模服务 | §6（无外部依赖）、§8 待决 7 |
| 5 | **不做**泛化 / 组合 / 泳道 / 片段 / 自动布局 / 自由画布语义校验 | §3.4（不落坐标）、§4.2（枚举封闭） |
| 6 | PM 可 CRUD 与管理关联；**MEMBER / VIEWER 本期只读** | §4.1 / §6.4 |
| 7 | **不给图加独立敏感标记**；可见性 = 关联对象（任务 / 故事）可见性的**交集**；任一关联不可见 → 整图 **404**，与「不存在」逐字一致；**不遮链接式降级**、不返回标题占位 | §5 |
| 8 | 解除关联或目标被删**不自动降密**（不改变既有可见性判定） | §5.5 |
| 9 | 删除：图 → 项目 / 负责人 **Restrict**；图 ↔ 任务 / 故事关联行 **Cascade** | §3.5 / §3.6 |
| 10 | 列表与计数**同源**，可见性在**本模块查询层**过滤，**不新增 `visibilityScope` 对象类型** | §5.2 / §5.4 |
| 11 | 新增 `uml.write`，**仅 PM**（入 `WRITE_ACTIONS`）；**不新增 `ObjectRef`**；读侧**不新增 scope**；显式拒绝非 PM；业务层不得私写角色判断 | §4.1 / §7 P1 |
| 12 | 事件走 D 的 `#37`，**本批不接线** | §7 / §8 待决 6 |

### 1.2 分工（与已发给 C 的口径一致）

- **B（公共层单写）**：`src/db/schema.prisma` + 迁移（P1）、`src/db/test-support.ts`（P1）、`test/db-schema*.test.ts` 表集合快照（P1）、`src/shared/types.ts` 的 `Action` 扩项与 `src/modules/authz/permissions.ts` 的 `WRITE_ACTIONS` 扩项（P1，公共层同批）、`src/routes.ts` 注册行（P4）、`web/src/routes.tsx` / `layouts/ProjectLayout.tsx` 挂载行与 `docs/frontend-routes.md`（P5）。
- **C（本域实现）**：`src/modules/uml/`（类型 / 校验 / 服务 / 端点 / 测试）、`web/src/pages/uml/`（P2 / P3 / P5 页面）。
- **D**：事件传输（`#37`），本批不接线。

### 1.3 明确不做

- 不做泛化 / 组合 / 聚合 / 实现 / 依赖（用例图）、不做泳道 / 片段 / 门 / 时间约束（时序图）、不做自动布局、不做自由画布坐标与几何语义校验。
- 不做外部建模服务、不做导入 / 导出 XMI、不做图片上传替代在线绘图（见 §9 AC6 说明与 §8 待决 9）。
- 不新建第二套敏感模型、不给图加 `isSensitive`、不扩 `VisibilityObjectType`、不新增 `visibilityScope` 对象类型、不新增 `ObjectRef`。
- 不改 `src/modules/task/`、`requirement/`、`project/` 任何文件；不跨模块调 service（契约 I-9），本域需要的数据自己查 Prisma。

---

## 2. 事实基线（`aa69288`，逐条可核对）

| 事实 | 来源 |
|---|---|
| 三条 SQLite 硬约束：枚举列一律 `String`（Prisma 在 SQLite 不支持原生 enum）；日期为 `String 'YYYY-MM-DD'`；删除保护默认 `Restrict` | `src/db/schema.prisma` 文件头注释（第 1–11 行） |
| `ObjectVisibility` 是**多态列**：`objectType String` + `objectId String`（**无外键**），主键 `@@id([objectType, objectId, userId])` | `src/db/schema.prisma` 的 `model ObjectVisibility`（第 197 行起） |
| 多态列无法依赖数据库级联，只能按表整体清空 | `src/db/test-support.ts` 第 30 行注释 |
| `TaskMilestone`（关联表）两端均 `Cascade`，`@@id([taskId, milestoneId])` | `src/db/schema.prisma` 的 `model TaskMilestone`（第 296 行起） |
| `TaskDependency` 两端 `Restrict`，`@@unique([predecessorTaskId, successorTaskId, type])` | `src/db/schema.prisma` 的 `model TaskDependency`（第 307 行起） |
| 甘特写路径的 404 / 403 文案与错误构造函数（`validationError` / `conflictError` / `prismaErrorCode`）可直接照抄范式 | `src/modules/gantt/write.ts`（`NOT_FOUND_MESSAGE` 第 62 行、`FORBIDDEN_MESSAGE` 第 65 行、`denied` 第 79 行、`validationError` 第 96 行、`conflictError` 第 106 行、`prismaErrorCode` 第 119 行） |
| `AppError` **仅** `403 / 404 / 409 / 422` 四档，无 400 / 405 | `src/shared/errors.ts` |
| `FieldErrorCode` 为冻结穷举表；前端 `FIELD_ERROR_HINT` 是 `Record<FieldErrorCode, string>` 穷举，**自造 code 会让前端无法翻译** | `src/shared/types.ts`（`FieldErrorCode` 第 184 行）、`web/src/pages/requirement/terms.ts:86` |
| `Action` 已有 `gantt.write`（PM-only 同型先例），`ObjectRef` 已有 6 个分支 | `src/shared/types.ts`（`Action` 第 217 行、`ObjectRef` 第 235 行） |
| `WRITE_ACTIONS` 决定「MEMBER / VIEWER → 403」；`can()` 第 3 条放行 PM、第 5 条拦写类动作 | `src/modules/authz/permissions.ts`（`WRITE_ACTIONS` 第 33 行、`gantt.write` 第 40 行、`can()` 第 167 行、PM 放行第 177 行、写类 403 第 223 行） |
| `visibilityScope` 只支持 `story` / `task`，PM 返回 `{mode:'all'}`，其余返回 `subset` | `src/modules/authz/permissions.ts`（第 247 行起）、`src/shared/types.ts:261` |
| 截断上限先例：甘特任务 500 / 里程碑 200 / 依赖 500；看板单列 200 | `src/modules/gantt/service.ts`（第 56/58/60 行）、`src/modules/board/types.ts:36` |
| 两态 `Availability<T>` 仅用于「数据源可能缺席」；数据源恒可用时**一律返回实际集合**（不造假 `unavailable`） | `src/modules/gantt/types.ts`（`GanttDependencies`）、`src/modules/gantt/service.ts` 依赖区注释 |
| 表集合快照（当前 13 张）+ 列序陷阱（`ALTER TABLE ADD COLUMN` 的物理列序） | `test/db-schema.test.ts`（第 89 行起）、`test/db-schema-contract.test.ts`（第 278 行起、第 63–66 行的列序告警、第 315 行的 FK 计数断言） |
| 本域**零命中**：`grep -rni uml src/ web/ test/` 无任何结果 | 基线事实（无 `src/modules/uml/`、无 UML 表） |
| 前端骨架挂载点已存在（`gantt` / `board` 行） | `web/src/routes.tsx:61/63`、`web/src/layouts/ProjectLayout.tsx:136/141` |

> ⚠️ 必须区分「不可用」与「已知为空」：本域数据源是**自有表**，不存在跨域缺席问题，故读侧**不引入两态包装**（§6.5）。

---

## 3. 模型设计（🟡 候选，未冻结）

### 3.1 三处关键取舍（先给结论，再给理由）

| 取舍 | 结论 | 理由 |
|---|---|---|
| **① 是否落坐标** | **不落任何几何坐标**（`x` / `y` / `width` / `height` 一律不进库） | 已批准口径明确「不做自动布局、不做自由画布语义校验」。落坐标会把「画布语义」悄悄带回来：一旦有坐标，就必须回答坐标系原点、缩放、越界、重叠、迁移时的重排、以及「两个客户端各自布局」的冲突，这些都超出本期范围且无人批准。改为**只落结构 + 序**：前端由结构确定性渲染（用例图按 `nodeType` 分组 + 边表；时序图生命线按 `orderIndex`、消息按 `seq`），同一份数据在任何客户端得到同一张图。 |
| **② 任务 / 故事关联行如何 DB 级 Cascade** | **四张真实关联表**：`UmlDiagramGoal` / `UmlDiagramActivity` / `UmlDiagramStory` / `UmlDiagramTask`，各两个**真实外键**，两端均 `onDelete: Cascade`（项目负责人 2026-10-19 裁定纳入 4 类关联以完整满足 AC2；目标 / 活动无敏感维度，恒对项目成员可见） | 已批准口径要求「关联行 Cascade，否则既有 `DELETE /tasks/:taskId` 会开始失败」。`ObjectVisibility` 的多态做法（`objectType` + `objectId` 无外键）**恰恰无法级联**——这正是本处不能照抄它的原因（`src/db/test-support.ts:30` 已记录该限制）。另外**实测**（见 §3.7）：Prisma 拒绝 `@@id` 引用可空列（`P1012`），所以「单表 + `taskId?` / `storyId?` 两个可空列」连复合主键都建不出来，只能退化为主键 `id` + 两个无法用 SQLite/Prisma 表达的部分唯一索引 ⇒ 两张表是拿到「真实 FK + 复合主键 + Cascade」的最小形态。 |
| **③ 用例图与时序图共用还是分表** | **共用一套 3 张表**（`UmlDiagram` / `UmlNode` / `UmlEdge`），用 `kind` + `nodeType` / `edgeType` 判别 | 两类图在本期共享**全部**生命周期与横切逻辑：同一份可见性交集口径、同一套关联行、同一套 CRUD、同一份列表。分表（2×3=6 张）会把可见性 `where`、关联替换、404 文案、测试矩阵全部复制两份，且列表接口要么 UNION 要么拆成两个端点。**代价**：DB 无法约束「用例图只能有 ASSOCIATION/INCLUDE/EXTEND」——但这与本仓库既有惯例一致（枚举合法性一律由 Zod / 写入层保证，`schema.prisma` 文件头第 1 条），不构成新的技术债。**若后续要加第三类图（如活动图）**，共用结构只需扩 `kind` 与 `edgeType` 白名单，分表则要再建 3 张表。 |

### 3.2 `UmlDiagram`（图的元数据）

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| `id` | `String @id @default(uuid())` | 主键 |
| `projectId` | `String` | FK `Project`，**`onDelete: Restrict`**（✅ 口径：项目不应被删掉而留下孤儿图） |
| `kind` | `String` | `'USECASE' \| 'SEQUENCE'`；DB 不约束枚举，写入层拒绝其他值（§4.2）。**创建后不可变**（改 `kind` 等于换一张图，本期不提供） |
| `title` | `String` | 必填；长度上限见 §4.6 |
| `description` | `String?` | 可选说明；上限同 `title` |
| `ownerUserId` | `String` | FK `User`，**`onDelete: Restrict`**（✅ 口径：人不该被删掉而留下无主图）。创建时取当前 PM；PM 可转移（§Z 已裁定） |
| `everRestricted` | `Boolean @default(false)` | **持久「曾经受限」guard**（`DECISIONS.md` `uml.no-auto-declassification-guard`，2026-10-21 项目负责人裁定 A）：曾关联敏感对象即置 `true` 且**永不自动清除**；非 PM 读一律 404。迁移对已存在图按当前关联回填 |
| `createdAt` | `DateTime @default(now())` | 既有惯例 |
| `updatedAt` | `DateTime @updatedAt` | 既有惯例（`Risk` 同款），供列表排序与将来乐观锁用 |

- 索引：`@@index([projectId, kind])`（列表主查询）、`@@index([ownerUserId])`。
- 反向关系：`Project.umlDiagrams UmlDiagram[]`、`User.ownedUmlDiagrams UmlDiagram[] @relation("UmlDiagramOwner")`。

### 3.3 `UmlNode` 与 `UmlEdge`（图内容）

**`UmlNode`**

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| `id` | `String @id @default(uuid())` | 主键（由服务端生成，客户端不自造 id） |
| `diagramId` | `String` | FK `UmlDiagram`，**`onDelete: Cascade`**（图没了，节点没有意义） |
| `nodeType` | `String` | 用例图：`'ACTOR' \| 'USECASE'`；时序图：`'LIFELINE'`。与 `kind` 的匹配由写入层校验（§4.2） |
| `name` | `String` | 必填，上限 §4.6 |
| `orderIndex` | `Int @default(0)` | **序，不是坐标**：时序图生命线的横向排列序（0,1,2…）；用例图恒 `0`（不用）。只用于确定性渲染，不承载任何几何含义 |
| `createdAt` | `DateTime @default(now())` | 既有惯例 |

- 约束：`@@unique([diagramId, id])`（**必须**：作为 `UmlEdge` 复合外键的目标）、`@@index([diagramId])`。
- 不加 `@@unique([diagramId, orderIndex])`：用例图所有节点 `orderIndex = 0` 会直接撞唯一约束；时序图排序用 `orderIndex asc, id asc` 破平局即可。

**`UmlEdge`**

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| `id` | `String @id @default(uuid())` | 主键 |
| `diagramId` | `String` | FK `UmlDiagram`，**`onDelete: Cascade`** |
| `edgeType` | `String` | 用例图：`'ASSOCIATION' \| 'INCLUDE' \| 'EXTEND'`；时序图：`'SYNC' \| 'ASYNC' \| 'RETURN'`。与 `kind` 匹配由写入层校验 |
| `sourceNodeId` | `String` | 起点节点 |
| `targetNodeId` | `String` | 终点节点 |
| `label` | `String?` | 边上的文字（`INCLUDE` / `EXTEND` 的说明、消息名）；上限 §4.6 |
| `seq` | `Int?` | **仅时序图**使用（消息序号）；用例图恒 `null` |
| `createdAt` | `DateTime @default(now())` | 既有惯例 |

- **边两端必须属于同一张图——由数据库兜底**：用**复合外键**把 `diagramId` 一起带进引用目标：
  ```prisma
  source UmlNode @relation("UmlEdgeSource", fields: [diagramId, sourceNodeId], references: [diagramId, id], onDelete: Cascade)
  target UmlNode @relation("UmlEdgeTarget", fields: [diagramId, targetNodeId], references: [diagramId, id], onDelete: Cascade)
  ```
  **已实测**（`prisma@6.19.3` + SQLite，见 §3.7）：跨图建边被数据库直接拒绝（`P2003`），删除节点时其边被级联清理。这样即使写入层漏检，「A 图的边指向 B 图的节点」在物理上不可能落库。
- 索引：`@@index([diagramId])`、`@@index([sourceNodeId])`、`@@index([targetNodeId])`（后两者服务节点删除的级联查找）。
- `@@unique([diagramId, seq])`：时序图内 `seq` 唯一。**注意这是「唯一」不是「严格递增」**——递增语义只能由写入层保证（§4.4）。用例图 `seq` 全为 `null`，SQLite 唯一索引允许多个 `NULL`，**已实测**多条 `seq = null` 的边可共存（这是刻意的：否则一张用例图只能有一条边）。
- **重复边不建 DB 唯一约束**：时序图里「同一对生命线之间的同型消息」是合法的（第 2 次调用），只靠 `seq` 区分；因此 `@@unique([diagramId, edgeType, sourceNodeId, targetNodeId])` 会误杀正常时序图。重复边改由**写入层**在事务内判定（§4.3），与甘特 FS 环检测同范式。

### 3.4 为什么完全不落坐标（细化）

- 已批准口径把「自动布局」和「自由画布语义校验」同时排除；落坐标等于二者都要做（有了坐标就必须校验重叠 / 越界 / 缩放，否则坐标没有意义）。
- 落坐标会引入**第二个写者冲突面**：前端改布局 = 改数据 = 需要写权限与并发控制，而本期只有 PM 可写。
- 前端确定性渲染所需的全部信息在本文模型里已具备：节点类型 + 生命线序（`orderIndex`）+ 消息序（`seq`）+ 边类型。用例图用「参与者列 / 用例列」两列固定布局即可，无需存储。
- 若将来要支持手工摆放，只需给 `UmlNode` 追加**可空** `posX` / `posY` 两列（`ALTER TABLE ADD COLUMN`，见 §7.3 列序陷阱），本期模型不预埋、不预留。

### 3.5 `UmlDiagramTask` / `UmlDiagramStory`（关联行，✅ Cascade）

```prisma
model UmlDiagramTask {
  diagramId String
  taskId    String
  diagram   UmlDiagram @relation(fields: [diagramId], references: [id], onDelete: Cascade)
  task      Task       @relation(fields: [taskId],    references: [id], onDelete: Cascade)
  @@id([diagramId, taskId])
  @@index([taskId])
}

model UmlDiagramStory {   // 结构同上，story ↔ UserStory
  diagramId String
  storyId   String
  ...
  @@id([diagramId, storyId])
  @@index([storyId])
}
```

- **为什么两端都 Cascade**：图被删 → 关联行无意义（Cascade）；**任务 / 故事被删 → 关联行必须自动消失**，否则既有 `DELETE /tasks/:taskId`（`src/modules/task/routes.ts` 的端点 29）会因外键 `Restrict` 开始返回 409 —— 这正是已批准口径点名的关键理由。用 Cascade 后**旧任务删除端点零改动**，也不需要手写清理代码，也不需要改 `resetDatabase` 的语义。
- **为什么不用 `ObjectVisibility` 那种多态单列**：多态列无外键 ⇒ 无 DB 级联 ⇒ 删任务后留下孤儿关联行 ⇒ 可见性交集会把「指向已不存在对象的关联」当成一条真实关联（要么永久 404 一张本来可见的图，要么必须写清理代码并保证每个删除路径都调用），与已批准口径的「DB 级 Cascade」直接冲突。
- **为什么不用「单表 + 两个可空 FK」**：**已实测** Prisma 报 `P1012`（`@@id` 不得引用可空字段），无法建复合主键；且「同一张图对同一任务只能关联一次」需要部分唯一索引（`WHERE taskId IS NOT NULL`），SQLite/Prisma 都表达不了。两张表各 3 列，代价更小、约束更强。
- 反向关系：`Task.umlDiagramLinks UmlDiagramTask[]`、`UserStory.umlDiagramLinks UmlDiagramStory[]`。

### 3.6 删除语义汇总（✅ 与已批准口径逐条对齐）

| 关系 | `onDelete` | 依据 |
|---|---|---|
| `UmlDiagram.projectId → Project` | **Restrict** | ✅ 口径原文 |
| `UmlDiagram.ownerUserId → User` | **Restrict** | ✅ 口径原文 |
| `UmlNode.diagramId → UmlDiagram` | Cascade | 图内容的从属物 |
| `UmlEdge.diagramId → UmlDiagram` | Cascade | 同上 |
| `UmlEdge.(diagramId, sourceNodeId) → UmlNode` | Cascade | 节点删除后残留边即脏数据 |
| `UmlEdge.(diagramId, targetNodeId) → UmlNode` | Cascade | 同上 |
| `UmlDiagramTask.diagramId → UmlDiagram` | **Cascade** | ✅ 口径原文 |
| `UmlDiagramTask.taskId → Task` | **Cascade** | ✅ 口径原文（关键：不破坏端点 29） |
| `UmlDiagramStory.diagramId → UmlDiagram` | **Cascade** | ✅ 口径原文 |
| `UmlDiagramStory.storyId → UserStory` | **Cascade** | ✅ 口径原文 |

- 由此**不需要** `HAS_CHILDREN` 语义：删除图会连带清掉节点 / 边 / 关联行，不存在「图下仍有子对象所以拒绝删除」的分支。这与「关联行 Cascade」是同一决定的两面。
- 本设计**不触碰** `TaskDependency` 的既有 `Restrict` 与端点 29 的 `P2003 → 409` 映射——已批准口径明确那是**独立待办**，不在本条目范围。

### 3.7 已实测的 schema 事实（`prisma@6.19.3` + SQLite，临时库，非本仓库）

| 待验证问题 | 实测结果 |
|---|---|
| 复合外键 `(diagramId, sourceNodeId) → UmlNode(diagramId, id)` 是否可用 | ✅ 可用；跨图建边被拒（`P2003`） |
| 删除节点是否级联删除其边 | ✅ 是（2 条 → 0 条） |
| 删除图是否级联删除节点 | ✅ 是 |
| `@@unique([diagramId, seq])` 且 `seq` 可空 | ✅ 多个 `NULL` 可共存（用例图多边可行）；非空 `seq` 重复被拒（`P2002`） |
| 单表 `@@id([diagramId, taskId, storyId])` 且两个可空 | ❌ Prisma 报 `P1012`：ID 定义不得引用可空字段 |
| 自环边（`source = target`） | ⚠️ 数据库**接受**，必须由写入层拒绝（§4.3） |

> 上述为**独立探针**结论（`/tmp` 临时 schema，未进仓库），用于确认模型可行性；不代表本仓库已建表，也不代替 P1 的迁移测试。

---

## 4. 写入校验规则（写入层，`src/modules/uml/`）

### 4.1 判权（✅ `uml.write` 仅 PM）

- 所有写端点（新建 / 改元数据 / 整图替换 / 删图）在**服务层**调用唯一入口：
  ```ts
  const decision = await can(actorUserId, 'uml.write', { kind: 'project', projectId })
  if (!decision.allow) throw denied(decision)   // 直接用 decision.status / decision.code
  ```
  `{ kind: 'project', projectId }` 是**已批准**的写侧引用（不新增 `ObjectRef`）。
- 按 id 操作（`PATCH` / `PUT content` / `DELETE`）**先按 id 最小解析真实 `projectId`**（只取一列），再问 `can()`——与 `src/modules/gantt/write.ts` 的 `updateMilestone` / `deleteMilestone` 同范式。
- `uml.write` 列入 `WRITE_ACTIONS` ⇒ PM 由第 3 条放行、MEMBER / VIEWER 由第 5 条得 **403**、非成员得 **404**。**不新增第 5.7 分支**（与 `gantt.write` 同型，避免第二套判定）；业务层**零角色名字面判断**。
- 读侧仍用既有 `project.read`，**不新增 scope、不新增 Action**。

### 4.2 `kind` / `nodeType` / `edgeType` 白名单（封闭枚举）

| 校验 | 非法时 | 字段码 |
|---|---|---|
| `kind ∈ {'USECASE','SEQUENCE'}` | 422 | `INVALID_VALUE`（field `kind`） |
| 用例图 `nodeType ∈ {'ACTOR','USECASE'}`；时序图 `nodeType = 'LIFELINE'` | 422 | `INVALID_VALUE`（field `nodes[i].nodeType`） |
| 用例图 `edgeType ∈ {'ASSOCIATION','INCLUDE','EXTEND'}`；时序图 `edgeType ∈ {'SYNC','ASYNC','RETURN'}` | 422 | `INVALID_VALUE`（field `edges[i].edgeType`） |
| 用例图 `ASSOCIATION` 必须 **ACTOR ↔ USECASE**（不许 ACTOR—ACTOR、USECASE—USECASE） | 422 | `INVALID_VALUE`（field `edges[i].edgeType`，原因写进 message） |
| 用例图 `INCLUDE` / `EXTEND` 必须 **USECASE → USECASE** | 422 | 同上 |
| 时序图 `seq` 只允许出现在时序图边（用例图必须为 `null`/缺省） | 422 | `INVALID_VALUE`（field `edges[i].seq`） |
| 泛化 / 组合 / 聚合 / 实现 / 依赖 / 泳道 / 片段等任何其他取值 | 422 | `INVALID_VALUE`（白名单外一律拒绝，不做映射、不做降级） |

- 枚举**不做**「未知值当默认值」的兼容分支（与 `gantt` 的 `type !== 'FS'` 拒绝同款）。

### 4.3 边结构校验

| 规则 | 违反时 | 说明 |
|---|---|---|
| 两端节点必须**属于同一张图** | 422 `INVALID_VALUE`（field `edges[i].sourceNodeId`） | 写入层先查；**DB 复合外键是兜底**（§3.3），漏检也会被 `P2003` 拒绝 |
| 边引用的 `nodeId` 必须在本请求的节点集内（不存在 = 非法，不区分「不存在」与「别图」） | 422 `INVALID_VALUE` | 不造存在性预言机 |
| **用例图拒自环**（`source === target`） | 422 `INVALID_VALUE`（field `edges[i].targetNodeId`） | DB 接受自环（§3.7 实测），必须写入层拒 |
| **用例图拒重复边**（同 `edgeType` + 同 `(source,target)`） | **409 `CONFLICT`** + `DUPLICATE` | 唯一性靠写入层在**同一事务**内判定（§3.3 说明为何不建 DB 唯一约束） |
| 时序图**允许** `source === target`（自消息） | 🟡 建议允许 | 自消息是合法 UML；**待 C 确认**（§8 待决 2） |
| 时序图**允许**同 `(source,target,edgeType)` 重复（不同 `seq`） | — | 第 2 次调用是正常建模 |

### 4.4 `seq` 严格递增语义（🟡 候选，含一处口径选择）

- **`seq` 由服务端分配，不接受客户端指定**（客户端传了也忽略，或按 §8 待决 5 决定是否 422）。
- **分配规则（推荐）**：`seq = 该消息在请求数组中的下标 + 1`（`1, 2, 3, …`），由「整图替换」语义天然给出（§6.3）。
  - 「严格递增」由此**构造性成立**：不需要额外排序、不需要和库内已有值比较、不会产生空洞以外的冲突。
  - 删除消息后重新提交整图 ⇒ 自动重排为连续 `1..n`，**不保留空洞**（空洞只在「不重新提交整图」的路径下才可能出现，而本期没有该路径）。
  - 因此**「是否允许重排」= 允许**：调整数组顺序即重排，不需要单独的重排端点、不需要 `seq` 交换逻辑。
- **兜底**：`@@unique([diagramId, seq])` 把并发写造成的重复 `seq` 映射为 **409 `CONFLICT`** + `DUPLICATE`（`P2002`），不落 500。
- 用例图：`seq` 恒为 `null`，不参与任何排序（边按 `createdAt asc, id asc` 返回）。

### 4.5 关联对象必须属于该图的 `projectId`

| 规则 | 违反时 | 说明 |
|---|---|---|
| `taskIds[]` 中每个任务必须**真实属于** `diagram.projectId`（**直接读库取 `Task.projectId`**，不信请求体） | 422 `VALIDATION_FAILED` + `CROSS_PROJECT_REF`（field `taskIds`） | 「不存在 / 跨项目 / 不可见」**返回同一条**，不造存在性预言机（与 `gantt/write.ts` 的 `resolveTaskIdsInProject` 同款） |
| `storyIds[]` 同上（读 `UserStory.projectId`） | 422 + `CROSS_PROJECT_REF`（field `storyIds`） | 同上 |
| 重复 id | 去重（保留首次出现顺序），**不报错** | 与 `gantt` 的 `[...new Set(...)]` 同款 |
| 关联数量上限 | 🟡 建议单图 ≤ 50 个任务 + 50 个故事 | 超限 422 `TOO_LONG`（field `taskIds`）；上限值 → §8 待决 3 |

> ⚠️ 外键只能证明「任务存在」，**不能证明项目隔离**——跨项目必须靠这条写入层校验（与甘特 §3.2 约束 4 同理）。

### 4.6 名称与文本上限

| 字段 | 上限 | 超限 | 参照 |
|---|---|---|---|
| `UmlDiagram.title` | 100 | 422 `TOO_LONG` | `MILESTONE_NAME_MAX_LENGTH = 100`（`src/modules/gantt/types.ts:54`） |
| `UmlDiagram.description` | 200 | 422 `TOO_LONG` | `RISK_TITLE_MAX_LENGTH = 200` |
| `UmlNode.name` | 100 | 422 `TOO_LONG`（field `nodes[i].name`） | 同上 |
| `UmlEdge.label` | 100 | 422 `TOO_LONG`（field `edges[i].label`） | 同上 |
| 空 / 纯空白 | 必填 | 422 `REQUIRED` | Zod `.trim().min(1)` |
| 单图节点数 | 200 | 422 `TOO_LONG`（field `nodes`） | 与甘特里程碑上限同量级 |
| 单图边数 | 500 | 422 `TOO_LONG`（field `edges`） | 与甘特任务 / 依赖上限同量级 |

- **写侧上限 = 读侧不截断的前提**：图内容（nodes / edges）必须完整返回才能渲染，所以读侧对单图内容**不设截断**，改由写入上限保证体积可控（§5.6）。

---

## 5. 可见性（★ 2026-10-21 追加 guard）

> **非 PM 可见 = 当前关联交集可见 **且** `everRestricted = false`**；`everRestricted = true` 的图对非 PM 一律 404（与「不存在」逐字一致），**解除关联或目标被删都不恢复**。列表 / `total` / 详情共用同一条件。显式降密属另案（PM 动作 + 审计），本期不做。详见 `DECISIONS.md` `uml.no-auto-declassification-guard`。（✅ 交集口径，本文给出精确查询形状）

### 5.1 原则

- 图**没有**独立敏感标记（✅）。可见性完全由「关联对象（任务 / 故事）的可见性」派生。
- 口径：**交集**——`图的所有关联任务都可见` **且** `图的所有关联故事都可见`，才返回；**任一关联不可见 ⇒ 整图不返回**（404，与「不存在」逐字一致），**不遮链接式降级、不返回标题占位**。
- 过滤在**本模块查询层**（✅），不新增 `visibilityScope` 对象类型、不改 `authz` 签名。

### 5.2 精确 Prisma `where` 形状（已实测）

```ts
// 1) 取作用域（既有入口，不新增对象类型）
const taskScope  = await visibilityScope(actorUserId, projectId, 'task')
const storyScope = await visibilityScope(actorUserId, projectId, 'story')
const isGlobal = taskScope.mode === 'all' && storyScope.mode === 'all'   // 只可能是 PM

// 2) 交集条件（非 PM 才拼）
const visibilityWhere: Prisma.UmlDiagramWhereInput = isGlobal
  ? {}
  : {
      tasks:   { every: { task:   { id: { in: taskScope.ids  } } } },
      stories: { every: { story:  { id: { in: storyScope.ids } } } },
    }

// 3) 列表 / 详情 / 计数共用同一个 where（同源）
const where: Prisma.UmlDiagramWhereInput = { projectId, ...visibilityWhere }
```

- **为什么用 `every` 而不是 `some` + 取反**：`every` 直接表达「所有关联都可见」，语义即交集；`NOT { some: { 不可见 } }` 等价但可读性差且容易在 `AND` 组合中写错。
- **`every` 对空关系的语义是 `true`**（已实测）⇒ **无任何关联的图对所有项目成员可见**（见 §5.3）。
- **实测结果**（4 张图：无关联 / 全可见关联 / 含 1 个隐藏任务关联 / 含 1 个隐藏故事关联）：`findMany` 只返回「无关联」与「全可见」两张；同一 `where` 的 `count()` 得 2，与 `findMany` 长度一致。

### 5.3 无关联的图是否对项目成员可见（🟡 建议：可见）

**建议：对项目成员可见。** 理由：

1. 已批准口径的敏感模型是「可见性 = 关联对象可见性的**交集**」。空集的交集在逻辑上就是全集——若强行规定「无关联 ⇒ 不可见」，等于凭空新增一条「图必须挂到某个敏感对象上」的规则，而这**没有被批准**。
2. 图本身**没有独立敏感标记**（✅），所以「标题 / 描述」不是敏感内容；无关联图的标题不泄漏任何任务 / 故事的存在性。
3. 反过来做会带来一个明显的坏体验与坏语义：PM 刚建好、尚未关联的空图会对所有成员「凭空消失」（且是 404，无法区分「不存在」与「未关联」），而 PM 无法从界面得知原因——这等于让「未完成关联」变成一种隐式隐藏状态。
4. 与「不自动降密」口径一致：**关联被解除**后图重新变成无关联 ⇒ 仍然可见，不构成降密（因为它的可见性从未依赖敏感对象）。反之若规定「无关联不可见」，解除关联会**突然把图变成不可见**，那才是真正的可见性跳变。

> 若项目负责人选择「无关联对非 PM 不可见」，只需把 `visibilityWhere` 改成 `{ AND: [ {...}, { OR: [{ tasks: { some: {} } }, { stories: { some: {} } }] } ] }`——但这属于**新增规则**，须单独批准，本文不默认采用。

### 5.4 列表与计数同源（✅）

- 列表与（将来任何）计数**必须使用完全相同的 `where` 对象**（同一个变量，不重写一遍）。
- **禁止**：先 `findMany` 取全量再内存过滤；用 `items.length` 冒充 `total`；先算全项目总数再减可见数。
- 本期**返回** `total`（与 `items` 用**同一个** `where` 的 `count()` 计算；截断时仍报精确值，禁止用 `items.length` 反推——看板 `BOARD_COLUMN_ROW_LIMIT` 的先例）。
  > ⚠ **2026-10-24 修订**：原文写「本期不返回 `total`」，与 §6.2 的响应类型、§8 第 10 项及 C 的实现不一致；按后三者统一为**返回**，并保留此修订说明（不改历史结论的其他部分）。

### 5.5 关联目标被删 / 关联被解除（✅ 不自动降密）

- 任务被删 → `UmlDiagramTask` 行由 DB **Cascade** 消失 ⇒ 该关联不再参与交集判定。若这是最后一个关联，图变成「无关联」⇒ 按 §5.3 仍对成员可见。**这不是降密**：可见性判定规则没变，只是输入变了。
- 解除关联（`PATCH` 传新的 `taskIds`）同理。
- 反向的「加密」也不做：把一张图关联到敏感任务，**不会**让原本可见的图对成员变成 404 之外的行为——它会正常变成「对无权者 404」，这正是交集口径的直接结果。

### 5.6 截断上限（🟡 建议值）

| 集合 | 上限 | 超出行为 | 参照 |
|---|---|---|---|
| 图列表 `items` | **200** | `truncated: true`，`items` 截到 200 | 甘特里程碑 200 / 看板单列 200 |
| 单图 `nodes` | **不截断**（写侧上限 200） | 不可能超出 | §4.6 |
| 单图 `edges` | **不截断**（写侧上限 500） | 不可能超出 | §4.6 |
| 单图 `taskRefs` / `storyRefs` | **不截断**（写侧上限各 50） | 不可能超出 | §4.5 |

- 取数用 `take: LIMIT + 1` 判定截断（不多取就无法区分「刚好 200」与「超过 200」），**不用行数反推总数**——与 `gantt/service.ts` / `board/service.ts` 同款。

---

## 6. 接口候选（⛔ 未注册 · 未冻结 · 无 `/api` 前缀）

> 路径与字段名均为候选；响应形状对齐既有惯例（单资源不套壳、列表 `{ items }`、错误信封 `AppError`）。**不代表任何路由已注册。**

### 6.1 最小端点集（6 个）

| # | 方法与路径 | 权限 | 成功 | 说明 |
|---|---|---|---|---|
| 1 | `GET /projects/:projectId/uml-diagrams` | `project.read` | 200 `{ items: UmlDiagramSummary[], truncated }` | 列表；交集可见性进查询层；截断 200 |
| 2 | `GET /uml-diagrams/:diagramId` | `project.read` | 200 `UmlDiagramView` | 详情：元数据 + `nodes[]` + `edges[]` + `taskRefs[]` + `storyRefs[]` |
| 3 | `POST /projects/:projectId/uml-diagrams` | `uml.write` | 201 `UmlDiagramView` | 新建（元数据 + 可选 `nodes`/`edges`/`taskIds`/`storyIds`），一个事务落地 |
| 4 | `PATCH /uml-diagrams/:diagramId` | `uml.write` | 200 `UmlDiagramView` | 改元数据（`title` / `description` / `ownerUserId?`）+ **关联集整体替换**（`taskIds` / `storyIds` 出现即整体替换，含 `[]` = 清空） |
| 5 | `PUT /uml-diagrams/:diagramId/content` | `uml.write` | 200 `UmlDiagramView` | **整图替换** `nodes` + `edges`（见 §6.3） |
| 6 | `DELETE /uml-diagrams/:diagramId` | `uml.write` | 204 | 删除；节点 / 边 / 关联行由 DB 级联清理 |

- **为什么没有 `POST /uml-diagrams/:id/nodes`、`PATCH /uml-edges/:edgeId` 这类细粒度端点**：见 §6.3。
- 无「恢复 / 复制 / 版本」端点；无导出端点。

### 6.2 响应形状（候选）

```ts
// 列表项：不含 nodes/edges（列表不渲染图）
type UmlDiagramSummary = {
  id: string
  projectId: string
  kind: 'USECASE' | 'SEQUENCE'
  title: string
  description: string | null
  ownerUserId: string
  ownerDisplayName: string
  /** 关联对象数量（只计数，不含标题，避免列表页泄漏未授权标题） */
  taskCount: number
  storyCount: number
  createdAt: string   // ISO 8601 UTC
  updatedAt: string
}

type UmlNodeView = {
  id: string
  nodeType: 'ACTOR' | 'USECASE' | 'LIFELINE'
  name: string
  orderIndex: number
}

type UmlEdgeView = {
  id: string
  edgeType: 'ASSOCIATION' | 'INCLUDE' | 'EXTEND' | 'SYNC' | 'ASYNC' | 'RETURN'
  sourceNodeId: string
  targetNodeId: string
  label: string | null
  /** 仅时序图非空；服务端分配，1..n 严格递增 */
  seq: number | null
}

// 关联对象简讯：只回 id + 展示名 + 跳转所需的父级 id（供 AC4 跳转）
type UmlTaskRef  = { id: string; title: string; storyId: string }
type UmlStoryRef = { id: string; title: string; activityId: string }

type UmlDiagramView = UmlDiagramSummary & {
  nodes: UmlNodeView[]
  edges: UmlEdgeView[]
  taskRefs: UmlTaskRef[]
  storyRefs: UmlStoryRef[]
}

// 列表信封（契约 I-2 的 ListResponse 惯例）
type UmlDiagramListResponse = { items: UmlDiagramSummary[]; total: number; truncated: boolean }
```

- **不含 `isSensitive`**：过滤已在查询层完成（与甘特 / 看板同款），列表不回传敏感标记。
- `taskRefs` / `storyRefs` 只含**调用者可见**的对象——因为整图只在「全部关联可见」时才返回，能走到这一步的对象集必然全部可见，无需二次过滤。
- `orderIndex` / `seq` 是**序**不是坐标；前端按此确定性渲染。

### 6.3 「整图替换」而非细粒度端点（🟡 建议）

**结论：图内容用 `PUT /uml-diagrams/:diagramId/content` 整图替换；节点与边不提供独立端点。**

理由：

1. **边依赖节点**：细粒度端点必须规定「先建节点、再建边、失败时客户端回滚」的顺序契约，任何一步失败都会留下半张图；整图替换是**一个事务、一次校验、零中间态**。
2. **交互形态本就如此**：已批准口径是「本地结构化编辑 + SVG 即时预览」——客户端内存里本来就持有整张图，「保存」天然是整图提交。为细粒度端点额外设计增量协议，等于给一个不存在的交互做适配。
3. **`seq` 严格递增变简单**：整图替换下 `seq = 数组下标 + 1`，构造性满足「严格递增」，且**天然支持重排**（改数组顺序即可），不需要 `seq` 交换端点、不需要与库内已有值比较（§4.4）。
4. **校验可一次性完成**：节点类型 / 边类型 / 同图 / 自环 / 重复边 / 数量上限都在同一批数据上一次判完，错误一次性返回（`details[]` 可多条）。
5. **与既有先例一致**：里程碑的 `taskIds` 已是「出现即整体替换关联集」（`src/modules/gantt/write.ts` 的 `updateMilestone`）。

**代价（须承认）**：整图替换是「最后写入者全胜」，并发编辑会互相覆盖。是否加乐观锁 → §8 待决 3。本期 PM-only 写、单项目单 PM 的常见场景下可接受。

- `PUT content` 语义细节：请求体 `{ nodes: [...], edges: [...] }`（节点可带客户端临时 id 用于边引用；服务端**重新生成**真实 id 并在响应里返回映射后的结果）。事务内顺序：校验 → 删旧 `UmlEdge` → 删旧 `UmlNode` → 建新 `UmlNode` → 建新 `UmlEdge`。
- `PATCH` 与 `PUT content` **分开**：改标题不该触发整图重写（否则每次改名都要重传全部节点）。

### 6.4 错误映射表（**只用契约 I-4 冻结表内 code**）

| 场景 | status | `error.code` | `details[]`（`field` / `code`） | message |
|---|---|---|---|---|
| 未登录 / 凭证失效 | 401 | `UNAUTHENTICATED` | — | 由 M1 统一 |
| 项目不存在 / 非成员（所有端点入口） | 404 | `NOT_FOUND` | — | **`项目不存在`**（与 `project` / `gantt` / `workload` / `board` 逐字一致） |
| 图不存在 / 对调用者不可见 / 属他项目 | 404 | `NOT_FOUND` | — | **`图不存在`**（三者**同一条**，不造存在性预言机） |
| 写端点非 PM（MEMBER / VIEWER） | 403 | `FORBIDDEN` | — | **`该操作需要项目经理权限`**（与 `gantt/write.ts:65` 同款） |
| `kind` 非法 | 422 | `VALIDATION_FAILED` | `kind` / `INVALID_VALUE` | 仅支持用例图与时序图 |
| `nodeType` / `edgeType` 与图种不匹配、或白名单外 | 422 | `VALIDATION_FAILED` | `nodes[i].nodeType` / `edges[i].edgeType` / `INVALID_VALUE` | 具体原因写 message |
| 边端点不属于本图 / 引用不存在的节点 | 422 | `VALIDATION_FAILED` | `edges[i].sourceNodeId` / `INVALID_VALUE` | 同上 |
| 用例图自环 | 422 | `VALIDATION_FAILED` | `edges[i].targetNodeId` / `INVALID_VALUE` | 同上 |
| 用例图重复边 | **409** | `CONFLICT` | `edges[i].edgeType` / `DUPLICATE` | 该关系已存在 |
| `seq` 冲突（并发写兜底 `P2002`） | **409** | `CONFLICT` | `edges[i].seq` / `DUPLICATE` | 并发冲突，请重试 |
| 事务写冲突（`P2034`） | **409** | `CONFLICT` | —（不带 details） | 并发冲突，请重试 |
| 关联任务 / 故事跨项目或不存在 | 422 | `VALIDATION_FAILED` | `taskIds` / `storyIds` / `CROSS_PROJECT_REF` | 关联对象不属于本项目（**不区分不存在与跨项目**） |
| 名称 / 文本超长、节点 / 边 / 关联数量超上限 | 422 | `VALIDATION_FAILED` | 对应字段 / `TOO_LONG` | 由 Zod 映射 |
| 必填缺失 / 纯空白 | 422 | `VALIDATION_FAILED` | 对应字段 / `REQUIRED` | 由 Zod 映射 |
| 并发删除竞态（`P2025`） | 404 | `NOT_FOUND` | — | **`图不存在`**（与「不存在」同一条） |
| 外键兜底失败（`P2003`，复合外键拦下跨图边） | 422 | `VALIDATION_FAILED` | `edges[i].sourceNodeId` / `INVALID_VALUE` | 边端点不属于本图 |

- **不新增任何 `ErrorCode` / `FieldErrorCode`**（✅ 与 `permissions.gantt-write` 同口径）：前端 `FIELD_ERROR_HINT` 是 `Record<FieldErrorCode, string>` 穷举表，扩表会连带改前端公共文件。上表全部取值都在 `src/shared/types.ts` 的冻结表内。
- **环 / 冲突类用 409，字段 / 结构校验类用 422**——本域没有真正的「环」概念（不建跨图依赖），故 409 只覆盖「重复边 / `seq` 冲突 / 写冲突」。
- `AppError` 只有 403/404/409/422 四档（`src/shared/errors.ts`），上表不引入其他状态码。

### 6.5 是否需要两态 `Availability<T>`：**不需要**

- 甘特引入 `Availability<T>` 是因为「依赖模型 / 运行时未接线时，`[]` 会被误读为『确实没有』」（`docs/role-b-gantt-design.md` §2）。
- 本域的数据源是**自有表**（`UmlDiagram` / `UmlNode` / `UmlEdge` + 两张关联表），P1 落地后**恒可用**；可见性派生依赖的 `ObjectVisibility` / `Task` / `UserStory` 也恒可用。没有任何跨域缺席分支。
- 因此**一律返回实际集合**（`nodes: []` 就真的表示「这张图没有节点」），不造假 `unavailable`。这与甘特读侧最终做法一致（`src/modules/gantt/service.ts` 依赖区「数据源本批始终可用 → 一律 `ok`」）。
- 若将来引入「UML 图导出服务」等外部能力，再单独为该能力加两态，不预先套在核心读路径上。

---

## 7. 公共层批次 P1–P5

| 批次 | 归属 | 文件 / 目录 | 内容 |
|---|---|---|---|
| **P1** | **B** | `src/db/schema.prisma`、`src/db/migrations/<ts>_add_uml_models/`、`src/db/test-support.ts`、`test/db-schema.test.ts`、`test/db-schema-contract.test.ts`、`src/shared/types.ts`、`src/modules/authz/permissions.ts` | **7 张模型** + 迁移 + 重置顺序 + 表集合快照 + `uml.write` 入 `Action` / `WRITE_ACTIONS` |
| **P2** | C | `src/modules/uml/types.ts`、`validation.ts`（或 `schemas.ts`） | 本域类型、Zod schema、枚举白名单、上限常量 |
| **P3** | C | `src/modules/uml/service.ts`、`plugin.ts`、`*.test.ts` | 可见性交集查询、整图替换事务、6 端点、HTTP 层测试 |
| **P4** | **B** | `src/routes.ts` | `import { registerUmlRoutes }` + `registerUmlRoutes(app, context)` |
| **P5** | C 页面 / **B** 挂载与文档 | `web/src/pages/uml/`（C）、`web/src/routes.tsx`、`web/src/layouts/ProjectLayout.tsx`、`docs/frontend-routes.md`（B） | 页面 + 路由行 + 左导航行 + 路由文档表行 |

> P2 / P3 依赖 P1 的类型与表；P4 依赖 P3 的插件导出（也可先注册再实现，但**同一时刻一个文件一个写者**）。

### 7.1 P1 在 `src/db/schema.prisma` 的具体改动点

1. **追加 7 个 model**（放在文件末尾，紧随 `TaskDependency`，并加一段与甘特同款的注释块说明「为什么需要 / 枚举列为何是 String / 删除语义理由」）：`UmlDiagram`、`UmlNode`、`UmlEdge`、`UmlDiagramGoal`、`UmlDiagramActivity`、`UmlDiagramStory`、`UmlDiagramTask`。
2. **追加 6 处反向关系**（既有 model 内各加一行，不改既有字段；Prisma 要求关系双向声明，故 4 张关联表对应 4 处，加 `Project` / `User` 两处）：
   - `model Project`：`umlDiagrams UmlDiagram[]`
   - `model User`：`ownedUmlDiagrams UmlDiagram[] @relation("UmlDiagramOwner")`
   - `model BusinessGoal`：`umlDiagramLinks UmlDiagramGoal[]`
   - `model UserActivity`：`umlDiagramLinks UmlDiagramActivity[]`
   - `model UserStory`：`umlDiagramLinks UmlDiagramStory[]`
   - `model Task`：`umlDiagramLinks UmlDiagramTask[]`
3. **不改任何既有字段 / 默认值 / 索引**——本次是**纯新增**，不对既有表做 `ALTER TABLE`。

### 7.2 P1 在 `src/db/test-support.ts` 的具体改动点

1. `resetDatabase()` 内新增 **7 行** `deleteMany()`，位置放在**甘特块之后、`task.deleteMany()` 之前**（即当前第 48–50 行的 `taskMilestone` / `taskDependency` / `milestone` 之后）：
   ```ts
   await prisma.umlDiagramTask.deleteMany()
   await prisma.umlDiagramStory.deleteMany()
   await prisma.umlDiagramActivity.deleteMany()
   await prisma.umlDiagramGoal.deleteMany()
   await prisma.umlEdge.deleteMany()
   await prisma.umlNode.deleteMany()
   await prisma.umlDiagram.deleteMany()   // projectId 是 Restrict，必须早于 project.deleteMany()
   ```
   - 顺序理由：关联行 → 边 → 节点 → 图（子表在前）；`UmlDiagram.projectId` 为 `Restrict`，若留到 `project.deleteMany()` 之后会失败。
   - 虽然关联行 / 边 / 节点都有 `Cascade`，显式删除仍保留——与 `taskMilestone` 的既有做法一致（不依赖隐式级联，避免将来改 `onDelete` 时静默失效）。
2. 更新文件头**删除顺序注释**（当前第 26–38 行那段列表），把 `UmlDiagramTask / UmlDiagramStory / UmlEdge / UmlNode / UmlDiagram` 加进去，并加一句 `US-15（工单 #35）` 说明。

### 7.3 P1 在 `test/db-schema.test.ts` 与 `test/db-schema-contract.test.ts` 的具体改动点

两文件各有一处**表集合等值快照**（`db-schema.test.ts` 第 89 行起、`db-schema-contract.test.ts` 第 278 行起），基线实测 **14 张表**，本批后 **21 张表**（`Uml*` 按 ASCII 序落在 `TaskMilestone` 与 `User*` 之间，**不是末尾**）：

```
AcceptanceRecord, AuditLog, BusinessGoal, Milestone, ObjectVisibility, Project,
ProjectMember, Risk, Task, TaskDependency, TaskMilestone, User, UserActivity, UserStory
```

改动：

1. 两处快照数组**插入 5 项**。快照来自 `SELECT name ... ORDER BY name`，SQLite 按 **ASCII 字节序**排序，而 `'m'`（0x6D）< `'s'`（0x73）⇒ **`Uml*` 全部排在 `User*` 之前、`TaskMilestone` 之后**（**不是**文件末尾）。改后的完整顺序：
   ```
   AcceptanceRecord, AuditLog, BusinessGoal, Milestone, ObjectVisibility, Project,
   ProjectMember, Risk, Task, TaskDependency, TaskMilestone,
   UmlDiagram, UmlDiagramStory, UmlDiagramTask, UmlEdge, UmlNode,   // ← 本批新增 5 张
   User, UserActivity, UserStory
   ```
   （五者内部字典序：`UmlDiagram` < `UmlDiagramStory`（`S` < `T`）< `UmlDiagramTask`；`UmlD` < `UmlE` < `UmlN`。已用排序实测核对。）
2. 两处用例**标题**从「9 张 + 经授权新增的 5 张」改为「9 张 + 经授权新增的 10 张」，并在上方注释块追加一段 `US-15（工单 #35）经项目负责人 2026-10-19 授权新增 5 张表…`（照抄 `Milestone` 那条注释的写法）。**断言形式不变**（仍是「不多不少」的等值比较，保护意图完整保留）。
3. `db-schema-contract.test.ts` 的 **FK 合计断言（第 315 行）不改**：它只统计 `EXPECTED_FKS` 覆盖的契约 I-7 九张表（14 处 = 9 RESTRICT + 5 CASCADE）。新表的列与 FK **不进** `EXPECTED_COLUMNS` / `EXPECTED_FKS`——该文件的既定职责是「断言直接对齐契约 I-7 原文」，新表由本域自己的 PRAGMA 测试覆盖（US-09 先例：新表列集合由该票自己的迁移核对脚本覆盖，未混进契约清单）。
4. **新增** `src/modules/uml/uml-schema.test.ts`（P1 交付，属于新表的自检，避免把快照职责扩散到契约文件；C 在 P3 也可把它并入本域测试）：
   - 5 张新表的 `PRAGMA table_info` 逐列断言（名 / 类型 / 可空性 / 默认值 / 主键序号）；
   - 5 张新表的 `PRAGMA foreign_key_list` 逐条断言 `onDelete`（**10 处**：`UmlDiagram` 2 处 Restrict、`UmlNode` 1 处 Cascade、`UmlEdge` 3 处 Cascade、`UmlDiagramTask` 2 处 Cascade、`UmlDiagramStory` 2 处 Cascade）；
   - 行为级断言：删任务 → 关联行消失（证明 Cascade 真的生效，`PRAGMA foreign_keys = 1` 前提下）；删节点 → 其边消失；跨图建边被拒（`P2003`）。

### 7.4 ⚠️ 列序陷阱（必须写进 P1 检查清单）

- `test/db-schema-contract.test.ts` 的 `EXPECTED_COLUMNS` **按物理列序**比对，而物理列序由**迁移 SQL** 决定，不由 `schema.prisma` 的字段书写顺序决定。
- 已有两处踩过的坑（文件内已留注释）：`Project.status` 由 `ALTER TABLE "Project" ADD COLUMN` 追加，物理上位于 `createdAt` **之后**；`Task.progress` / `Task.blockedReason` 同理排在 `Task.createdAt` 之后。
- **本批（P1）是纯 `CREATE TABLE`，不对既有表做 `ALTER TABLE`**，所以 `Project` / `Task` / `User` / `UserStory` 的既有列序**不会变**，`EXPECTED_COLUMNS` 无需改动。
- **但**：新表的列序以**迁移 SQL 的 `CREATE TABLE` 语句顺序**为准（Prisma 生成的顺序即 `schema.prisma` 字段顺序，两者一致）。若 P1 之后有人为了「加坐标」而 `ALTER TABLE "UmlNode" ADD COLUMN`，该列会物理落在末尾，届时必须同步改 §7.3 第 4 项的新表列断言。
- 落地后**必须**跑 `npx prisma migrate dev --name add_uml_models`（或手写迁移 + `prisma migrate deploy`）+ `npm run db:generate`（`postinstall` 已自动跑，但改 schema 后要手动重跑）。

### 7.5 P1 在 `src/shared/types.ts` 与 `permissions.ts` 的具体改动点（公共层同批）

1. `src/shared/types.ts` 的 `Action` 联合**追加一项**：
   ```ts
   | 'uml.write' // 用例图 / 时序图及其类型化关联的增删改（仅 PM；MEMBER / VIEWER 只读）
   ```
   **不动** `ObjectRef`（✅ 不新增）、**不动** `VisibilityObjectType`（✅ 不新增 scope）、**不动** `ErrorCode` / `FieldErrorCode`（✅ 不扩表）。
2. `src/modules/authz/permissions.ts` 的 `WRITE_ACTIONS` **追加 `'uml.write'`**（紧跟 `'gantt.write'`，加一行注释说明与 `gantt.write` 同型）。
3. `can()` 的判定顺序注释里**追加一行 5.7 说明**（纯注释，无新分支）：
   `5.7 uml.write（UML 图及其关联的增删改）与其它写类动作同规则：仅 PM（第 3 条放行）；MEMBER / VIEWER 一律 403，本入口不为 UML 单开角色分支`
   —— 这样「显式拒绝非 PM、不得落默认允许」在**代码位置与文档位置**都可核对，且不产生第二套判定逻辑。
4. **已知不受影响**：仓库内**没有** `Record<Action, …>` 穷举表（`grep` 确认只有 `Action[]` 字面量数组，见 `src/modules/authz/sensitivity.http.test.ts:172`、`test/t0-gap-fix.test.ts:178/189`），所以新增 `Action` 不会造成类型破裂。新增 `Action` 后应确认这两处数组仍通过（它们是子集，不受影响）。

---

## 8. 待决项（只列真实未决；已批准口径不再列）

| # | 待决问题 | 需谁裁定 | 本文默认建议 | 不裁定时的后果 |
|---|---|---|---|---|
| 1 | **AC2 原文含「关联项目 / 业务目标 / 用户活动 / 用户故事 / 任务」五类，但已批准口径只覆盖「任务 / 故事」**——业务目标、用户活动是否本期不做？ | **项目负责人 + C** | 本期**只做任务 / 故事**关联；目标 / 活动关联不做 | 若必须做，需先定义「目标 / 活动」的可见性派生规则（它们没有 `ObjectVisibility` 白名单，敏感只有 story / task），否则交集口径无法落地 |
| 2 | 时序图**自消息**（`source === target`）是否允许 | C | **允许**（合法 UML，且不影响任何可见性 / 校验规则） | 若禁止，需在 §4.3 加一条 422 规则；若允许，前端需能画自消息 |
| 3 | 整图替换是否需要**乐观锁**（`If-Match` / `version` / `updatedAt` 前置条件） | C + 项目负责人 | 本期**不做**（PM-only 单写者场景可接受「最后写入者全胜」） | 两个 PM 并发编辑同一张图会静默覆盖，无 409 提示 |
| 4 | `ownerUserId`（图负责人）是否可**转移**、是否必须为 PM | 项目负责人 | 创建时取当前 PM；`PATCH` 允许改，且新负责人必须是**本项目成员**（422 `NOT_PROJECT_MEMBER`） | 若不允转移，`PATCH` 去掉该字段；若必须是 PM，校验改为「本项目 PM」 |
| 5 | 客户端**显式传 `seq`** 时如何处理：忽略 / 422 | C | **忽略**（服务端按数组下标分配），不报错 | 若改为 422，需在 §4.4 / §6.4 增一条 `INVALID_VALUE` |
| 6 | 是否需要 UML 业务事件（如 `uml.diagram.updated`） | **D（#37 端口）+ 项目负责人** | 本批**不接线**，仅在写成功点留 `【事件占位】` 注释（与甘特同款） | 无事件则通知 / 审计联动不可用；但不阻塞 #35 AC |
| 7 | C 的**前端渲染方案细节**：用例图两列布局的具体算法、生命线间距、自消息绘制、`orderIndex` 变更的交互（拖拽换序？） | C | 前端按 `nodeType` + `orderIndex` + `seq` 确定性渲染；换序 = 改 `orderIndex` 后整图提交 | 若需要拖拽换序，`PUT content` 语义已支持（重排数组），无需后端改动 |
| 8 | 图内容**写入上限**（nodes 200 / edges 500 / 关联各 50）是否够用 | C | 采用本文数值 | 上限过低会挡住真实大图（422 无绕过路径）；过高会让单响应过大 |
| 9 | **AC6「上传图片仅作补充」** 本期如何满足 | 项目负责人 | 本期**不提供任何上传路径** ⇒ 不存在「只能上传、不能在线编辑」的退化；若需补充图片，走 D 的附件能力（`#34` / `#35`，另票） | 若要求本期就能上传补充图，需接 D 的附件运行时，属跨票依赖 |
| 10 | 列表是否需要 `total` | C | 本期**返回**（必须与 `items` 同源 `count()`，截断时仍报精确值） | 2026-10-24 已按实现统一；若前端做分页，直接用该值 |

> 已批准口径**不再列**：两类图、三种关系 / 三种消息、`seq` 严格递增、不落外部服务、不做自动布局 / 自由画布校验、PM 写 / MEMBER·VIEWER 只读、无独立敏感标记、交集可见性 + 404 逐字一致、不自动降密、不遮链接降级、图→项目 / 负责人 Restrict、关联行 Cascade、列表与计数同源、不新增 scope / ObjectRef。

---

## 9. GitHub #35 AC 与验证方案（**均未运行**，待实施后执行）

唯一 seam 是 **HTTP 接口层**（契约 Testing Decisions）：造数用 `test/factories.ts` 直接写库，**断言一律打接口**。越权用例**必须打接口**，不能用「前端不渲染按钮」代替。

| AC（#35 原文） | 设计响应 | 可执行验证 |
|---|---|---|
| **AC1** 可在线创建并编辑用例图与时序图（非仅上传） | §3 模型 + §6 端点 3/4/5 + `web/src/pages/uml/` | 接口层：`POST` 建两类图各 1 张 → `PUT content` 写用例图（2 ACTOR + 3 USECASE + 5 边）与时序图（3 LIFELINE + 4 消息）→ `GET` 详情逐字段比对；**浏览器走查**：新建 → 编辑 → 保存 → 刷新后 SVG 与结构一致（截图留证） |
| **AC2** 图可关联项目 / 目标 / 活动 / 故事 / 任务中的目标对象 | §3.5 两张关联表 + `PATCH` 的 `taskIds` / `storyIds` 整体替换 | 接口层：`PATCH` 传 `taskIds` / `storyIds` → `GET` 详情 `taskRefs` / `storyRefs` 正确；传 `[]` → 清空；重复 id → 去重。**目标 / 活动是否纳入见 §8 待决 1**（未裁定前不勾该子项） |
| **AC3** 关联对象跨项目时拒绝 | §4.5 写入层读真实 `projectId` | 接口层：用**他项目**的任务 id / 故事 id 提交 → **422 `VALIDATION_FAILED` + `CROSS_PROJECT_REF`**；同一用例再传**不存在**的 id → **同一条**错误（逐字比对 message 与 code，证明不造存在性预言机） |
| **AC4** 至少一条核心时序图可从图跳转到关联需求 / 任务 | §6.2 的 `taskRefs` / `storyRefs` 带 `id` + `storyId` / `activityId` | 接口层：详情响应含可跳转 id；**浏览器走查**：在时序图页面点关联任务 → 落到任务详情 / 需求详情（截图留证） |
| **AC5** 无权者看不到不可见图及其关联；越权 404 | §5 交集 `where` + §6.4 统一 404 文案 | 接口层矩阵（**每格都打接口**）：<br>• PM：全部图可见（含关联敏感任务的图）<br>• MEMBER（非白名单）：关联敏感任务的图 → **404**，且 message 与「图不存在」**逐字一致**<br>• MEMBER（敏感白名单）：**仅当该图从未关联过敏感对象（`everRestricted = false`）** 才 200；若曾关联过敏感对象（含已解绑 / 目标已删），`everRestricted` 恒为 `true` ⇒ 仍 **404**（sticky，`DECISIONS.md` `uml.no-auto-declassification-guard`，不自动降密）<br>• VIEWER：只读 → `GET` 200/404 按交集，`POST`/`PATCH`/`PUT`/`DELETE` → **403 `FORBIDDEN`**<br>• outsider（非项目成员）：**列表 404 / 详情 404**，`message` = `项目不存在`（与甘特 / 看板 / 负载同款，不返回空集合）<br>• 未登录：401<br>• **列表与 count 同源**：同一账号的 `items.length` 与同 `where` 的 `count()` 一致（截断时用 `truncated` 标记，不用长度反推）<br>• **不泄漏存在性**：对比「不存在的 diagramId」与「存在但不可见的 diagramId」→ 两者 status / code / message 完全一致 |
| **AC6** 上传图片仅作补充，不替代在线编辑能力 | §1.3 本期不提供上传路径 | 验证方式：确认接口集内**不存在**任何「仅上传图片」的创建路径（端点清单核对），且 AC1 的在线编辑路径已通过。**若负责人要求本期支持上传补充图，见 §8 待决 9（跨票依赖 D）** |

### 9.1 补充必测项（超出 AC 原文但属本设计的正确性下限）

| 用例 | 期望 |
|---|---|
| 用例图关系白名单外的取值（如 `GENERALIZATION`） | 422 `INVALID_VALUE` |
| 用例图 `ASSOCIATION` 用在 USECASE—USECASE | 422 `INVALID_VALUE` |
| 用例图 `INCLUDE` 用在 ACTOR—USECASE | 422 `INVALID_VALUE` |
| 时序图消息类型 `sync`/`async`/`return` 全部接受 | 201 / 200 |
| 用例图自环 | 422 `INVALID_VALUE` |
| 用例图重复边 | **409 `CONFLICT` + `DUPLICATE`** |
| 跨图边（A 图边指向 B 图节点） | 422（写入层）；若绕过写入层，DB `P2003` 兜底（**schema 测试**验证） |
| `seq` 严格递增 | `PUT content` 传 4 条消息 → 响应 `seq` 恰为 `1,2,3,4`；删中间一条重传 → `1,2,3`（**无空洞**） |
| 删任务后关联行消失 | 建图关联任务 → `DELETE /tasks/:taskId`（既有端点 29）**仍成功**（不因 UML 关联变 409）→ 图详情不再含该 `taskRef` |
| 删故事后关联行消失 | 同上（走既有故事删除端点） |
| 删图 | 204；节点 / 边 / 关联行全部消失（DB 级联），`GET` 详情 → 404 |
| 并发整图替换（两请求同时提交不同内容） | 一个成功、另一个成功或 409，**不出现**半张图（事务性）；若加乐观锁（§8 待决 3）则另一个必须 409 |
| 超上限 | nodes > 200 / edges > 500 / title > 100 → 422 `TOO_LONG` |
| 类型检查 | `npm run typecheck` exit 0 |

### 9.2 证据分栏（不混用）

| 证据类型 | 内容 |
|---|---|
| 模块 / HTTP 测试 | `src/modules/uml/*.test.ts`（CRUD / 关联 / 跨项目 / 越权矩阵 / 可见性交集 / `seq` 递增 / 409 与 422 分流） |
| schema 自检 | `src/modules/uml/uml-schema.test.ts`（§7.3 第 4 项） |
| 迁移 | `npm test` 中 `test/db-schema.test.ts` / `test/db-schema-contract.test.ts` 表集合快照通过 |
| 浏览器走查 | 新建用例图 → 新建时序图 → 关联任务 → 跳转需求 / 任务；PM / MEMBER / VIEWER 三角色截图（含 MEMBER 看不到敏感关联图的 404 页） |
| 不宣称 | 未跑通的用例不勾 AC；「前端隐藏按钮」不作为越权证据 |

---

## 10. 本文完成检查

- ✅ 三处关键取舍给出结论与理由：**不落坐标**（§3.1①/§3.4）、**两张关联表拿 DB 级 Cascade**（§3.1②/§3.5）、**两类图共用 3 张表**（§3.1③）。
- ✅ 模型字段 / 类型 / 默认值 / 唯一约束 / 索引 / `onDelete` 逐项给出，并用**独立 Prisma 探针**验证了复合外键、级联、可空 `seq` 唯一性、`@@id` 不能引用可空列（§3.7）。
- ✅ 写入校验：`kind` / `nodeType` / `edgeType` 白名单、同图校验（应用层 + DB 兜底）、自环、重复边、`seq` 严格递增与重排语义、跨项目关联、长度与数量上限（§4）。
- ✅ 可见性：交集口径的**精确 Prisma `where`**、无关联图可见性建议及理由、列表与计数同源、截断上限（§5）。
- ✅ 接口候选：6 个端点、响应形状、整图替换的取舍、错误映射表（**全部取契约 I-4 冻结表内 code**）、不做两态 `Availability` 的理由（§6）。
- ✅ P1–P5 分工与 P1 的**具体改动点**（含表集合快照的 5 项追加、字典序校验、`test-support` 删除顺序、列序陷阱）（§7）。
- ✅ 待决项只列真实未决（10 条，含 AC2 范围缺口与 AC6 口径缺口），标注需谁裁定（§8）。
- ✅ 逐 AC 验证方案（接口层 + 浏览器），越权用例必须打接口（§9）。

**声明**：本文为 ROLE-B 单方 DRAFT，**未冻结任何模型 / 字段 / 路由**，不代表 #35 任何 AC 已通过；不声称已建表、已注册端点或已实现页面。已批准口径（`uml.minimal-model-and-visibility`、`permissions.uml-write`）在本文中只被**细化**，未被改写。

---

## Z. v1.0 冻结变更记录

| 项 | 冻结结论 |
|---|---|
| 关联对象范围 | **4 类**：`UmlDiagramGoal` / `UmlDiagramActivity` / `UmlDiagramStory` / `UmlDiagramTask`（各两个真 FK、两端 Cascade）；目标 / 活动**无敏感维度** → 恒对项目成员可见，可见性交集只对故事 / 任务生效 |
| 模型数量（P1） | **7 个 model**：`UmlDiagram` / `UmlNode` / `UmlEdge` / 上述 4 张关联表；**纯新增**，不对既有表 `ALTER TABLE` |
| 表集合快照插入点 | 7 张表名按 ASCII 序：`UmlDiagram` < `UmlDiagramActivity` < `UmlDiagramGoal` < `UmlDiagramStory` < `UmlDiagramTask` < `UmlEdge` < `UmlNode`，整体落在 `TaskMilestone` 之后、`User*` 之前（**不是末尾**） |
| 坐标 | 不落任何几何坐标（只落结构 + 序） |
| 边同图约束 | 复合外键 `(diagramId, sourceNodeId) → UmlNode(diagramId, id)` → 跨图建边物理不可能（实测 `P2003`） |
| 事件 | **不接线**（D 的 `#37`）；仅类型占位 + 写点事件名注释 |
| 乐观锁 | **不做**（PM-only 写、最后写入者全胜），登记为已知限制 |
| 列表 `total` | 返回（与清单同一 `where`） |
| 时序图自消息 | 允许 |
| 客户端传 `seq` | 忽略（服务端分配，严格递增由服务端保证） |
| 上限 | nodes 200 / edges 500 / 关联各 50 |
| 上传补充图 | 本期不做（无 D 的附件运行时）；`#35` AC6 记为不勾 |
| 前端渲染 / 换序交互 | C 决定（后端 `PUT content` 已支持重排） |

---

## Z2. P1 实现状态（2026-10-19，PR 合入后追加）

| 项 | 实测结果 |
|---|---|
| 模型数量 | **7 个**（含 4 张关联表），**纯新增**；反向关系 **6 处**（`Project` / `User` / `BusinessGoal` / `UserActivity` / `UserStory` / `Task`） |
| 迁移 | `20261019090000_add_uml_models`：7 `CREATE TABLE` + 13 `CREATE INDEX`；**14 处外键 = 2 RESTRICT（图→项目 / 负责人）+ 12 CASCADE**；**无 `ALTER TABLE`**（既有表物理列序不变） |
| 复合外键 | `UmlEdge` 的 `(diagramId, sourceNodeId)` / `(diagramId, targetNodeId)` → `UmlNode(diagramId, id)` 均 CASCADE（跨图建边物理不可能） |
| 空库验证 | `DATABASE_URL=file:/tmp/uml-p1-fresh.db npx prisma migrate deploy` 成功；21 张表按 ASCII 序实测落在 `TaskMilestone` 与 `User*` 之间 |
| 重置顺序 | `resetDatabase()` 新增 **7 行**（关联行 → 边 → 节点 → 图；图早于 `project`） |
| 行为验证 | 新增 `src/modules/uml/uml-schema.test.ts` **25 例**：PRAGMA 逐列 / `onDelete` 语义 / 删任务→关联行消失 / 删节点→边消失 / **跨图边 `P2003`** / `seq=null` 共存与 `(diagramId, seq)` 唯一 / 关联表复合主键去重（`P2002`）/ 自环边 DB 接受（证明拒绝责任在写入层） |
| 权限 | `Action 'uml.write'` + `WRITE_ACTIONS`（紧跟 `gantt.write`），判定顺序注释补 5.7，**无新分支** |
| 测试 | `typecheck` exit 0；`uml` + `db-schema*` 3 文件 / 62 例；**全量 61 文件 / 1420 例全绿** |
| 已知抖动 | `test/db-schema-contract.test.ts` 的「`User.account` 有唯一约束」在满载并行下偶发 5s 超时（单独跑 1.09s、复跑全绿）——既有用例的时限抖动，未改断言 / 超时，另行登记 |

### Z3. 2026-10-21 追加：持久 guard（裁定 A）

| 项 | 内容 |
|---|---|
| 触发 | ROLE-C 在 #24 给出真实反例：解除最后一个受限关联 / 删目标（关联行 Cascade）后 `every(empty)=true` → 图正文对成员自动公开，**实际降密** |
| 裁定 | 项目负责人 **A**：持久「曾经受限」标记，一旦受限非 PM **永久 404** |
| 落地 | `UmlDiagram.everRestricted Boolean @default(false)` + 迁移 `20261021120000_add_uml_ever_restricted`（含**回填**：仍关联敏感任务 / 故事的图置 `true`）+ 索引 `(projectId, kind, everRestricted)`；非 PM 读条件并入 `everRestricted = false` |
| 置位责任 | `uml` 服务在**建立关联的同一事务**内：目标 `isSensitive = true` → 置位（B 提供字段与约束，C 实现写入与查询） |
| 不做 | 显式降密动作（另案）；用 `AuditLog` / 内存状态冒充主权限存储 |
