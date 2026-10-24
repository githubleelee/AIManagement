# 本阶段 Sprint 结项：DoD 判定与增量统计（2026-10-24）

| 项目 | 内容 |
|---|---|
| 本阶段 Sprint 范围 | 交接阶段 11 个故事 + 2 个公共能力 = **13 个 Sprint Backlog 项**：`#25` 故事看板、`#26` 甘特图、`#27` 成员负载、`#28` 个人工作台与任务状态/进度、`#29` 任务验收、`#30` 进度/健康度/风险（含关闭阻断）、`#31` AI 需求拆解 + AI 框架、`#32` AI 排期、`#33` AI 质量/进度/风险/效率分析、`#34` 站内通知、`#35` 在线 UML、`#36` 任务附件、`#37` 公共领域事件 |
| 不计入交付统计 | 角色汇总票 `#20–#23`（协调/父票）与 gate `#24`（开工契约确认）不是可交付功能项 |
| 判定依据 | DoD = `docs/sprint1-baseline.md` §1.3 的**四项**（团队通用 DoD）；逐票 AC = 各自 GitHub issue 正文的「验收标准」；跨票口径 = `docs/team-handoff.md` §9 |
| 判定提交 | `origin/main` = `90f0754`（本文件之前）；全量基线 = `982f850` 独立 tester（92 文件 / 1907 例通过 / 0 失败） |
| 判定日期 | 2026-10-24 |
| 结论摘要 | **13 项中 9 项通过 DoD 计入增量（69%）；4 项未通过（#32 / #33 / #34 / #36）回退 Product Backlog。** 另有 #35 的 2 项收口跟进、#28 的 1 处过期文案登记为低优先回退项。 |

---

## 1. DoD（四项，原文）

| 编号 | 标准 | 判定方式 |
|---|---|---|
| ① | 功能可运行 | 演示时能在浏览器中实际走通 |
| ② | 有基本测试 | 关键路径至少有接口测试，含正例与反例 |
| ③ | 有代码注释 | 关键函数与模块有清晰注释 |
| ④ | 代码已审查 | 人工审查 AI 生成的 diff 后合入，有分支与提交记录 |

> **判定规则**：**AC 通过 + DoD 四项全部满足**才计入增量；未达标项标记「未完成」并说明原因，**不降低 DoD**。
> 对 `#37`（后端基础能力）这类无 UI 项，DoD ① 以「真实 API 可运行 + 真实链路证据」代替浏览器演示，并在表中注明。

---

## 2. 逐项判定

| # | 项 | AC 判定 | ① 可运行 | ② 测试 | ③ 注释 | ④ 已审查 | 裁决 |
|---|---|---|---|---|---|---|---|
| #25 | 故事看板 | AC1–AC6 通过（含 PM 改状态唯一走端点 21、真实变化写审计、MEMBER/VIEWER 只读） | 浏览器：PM 改状态 → 列计数变化 + 详情同步（`B-I25-20261024-board-acceptance-01.md`，3 张截图） | board + requirement **578 例**（含状态审计/事件） | ✓ | PR #69 → 记录 #70；PM 状态控制 PR #75 | **计入增量** |
| #26 | 甘特图（含 FS、里程碑） | AC1–AC7 通过；FS 放行口径 C2 已并入真实写入口 | 浏览器：展开/里程碑/依赖编辑，PM 编辑器 + member1 只读（`B-I26-20261024c-gantt-*.md`，2 张截图） | gantt **57 例**（19+38）+ task 412 例（FS 双入口组合 522 例） | ✓ | PR #68 → #69；事件 #90；FS #114 | **计入增量** |
| #27 | 成员任务图与负载 | 通过（负载 = 非 CLOSED 含 DONE；PM 全项目 / 成员可见范围） | 浏览器：member1 可见范围 + outsider 拒绝（`docs/ai-records/B/issue-27/evidence/B-I27-20261018-member1-visible-range.png`、`...-outsider-denied.png`） | `workload.test.ts` **11 例** | ✓ | PR #50 | **计入增量** |
| #28 | 个人工作台 + 任务状态/进度 | 通过（固定 5 块：待办/逾期/待验收/被提及/近期计划；六状态 `TODO/DOING/BLOCKED/SUSPENDED/DONE/CLOSED` 已落地） | 浏览器：`/workbench` 五块正常渲染（截图 `docs/acceptance-screenshots/us08-01-workbench-five-blocks.png`） | `workbench.test.ts` **11 例** + `task-progress.test.ts` 13 例 + 六状态迁移用例 | ✓ | PR #42–#53 链 + `docs/us-08-workbench-api.md` | **计入增量**（附 1 处过期文案，见 §4） |
| #29 | 任务验收（通过/驳回/重验） | 通过：PASS→CLOSED、REJECT→DOING + 驳回原因必填、CAS 防重复、鉴权先于守卫 | 浏览器：`docs/acceptance-screenshots/us09-*.png`（6 张）；本轮真实 HTTP：前置未 CLOSED 时 REJECT `422` 且任务仍 DONE/0 记录/0 事件，前置 CLOSED 后 `200 + DOING` | acceptance **56 例**（37 + 事件 10 + FS 守卫 9） | ✓ | PR #67 → #91 → #95 → #109 → #114 | **计入增量** |
| #30 | 进度 / 健康度 / 风险（含关闭阻断） | 通过：进度 = CLOSED ÷ 总数（DONE 不计）、健康度四态（含"无法计算"）、风险三级四态、关闭阻断 409 + 汇总 | 浏览器：`docs/acceptance-screenshots/us10-*.png`（7 张） | risk **80 例**（42+25+13）+ analytics 21 例 | ✓ | PR #55（独立评审发现并修复越权与浮点阈值）→ #57/#58/#61 | **计入增量** |
| #31 | AI 需求拆解 + AI 框架 | 通过：生成/列表/处置、人工确认后才应用、审计留痕、真项目数据不出 EXTERNAL；**AC13 按负责人 2026-10-17 变更明确不声称满足** | 浏览器：需求页 AI 面板，PM 生成/处置、成员只读（`docs/ai-records/B/issue-31/evidence/*`） | AI 模块 **27 例** + 共享三表 95 例（PR #88 定向）+ 全量回归 | ✓ | PR #82 → #88（共享存储）→ #91 → #95 | **计入增量**（AC13 除外，已获批准） |
| **#32** | **AI 排期建议** | **未通过**：AC 要求 PM-only 的生成/查看/采纳/修改后采纳/拒绝/审计**正式入口**；当前无生产路由 | **无正式入口**（`src/routes.ts` 无 `scheduling` 注册；仅有组件验证页与合成 transport 证据） | C 侧 169 + 12 TODO；13 前端 DTO；387 回归 | ✓ | 核心 #99；实现 `455701e` 直接进 main | **不计入**（见 §3.1） |
| **#33** | **AI 质量 / 进度 / 风险 / 效率分析** | **未通过**：AC 要求分析结果**服务于仪表盘**、关键建议人工确认、记录采纳/修改/拒绝；代码只有纯函数 | **无端点、无注册、无页面**（`src/modules/ai-insights/{metrics,aggregate,types}.ts` + 2 测试文件；全仓除注释外无引用） | `metrics.test.ts` 18 + `aggregate.test.ts` 30 = **48 例**（纯函数） | ✓ | 无对应 PR 记录（GitHub #33 已被关闭，与实现不一致，需核对） | **不计入**（见 §3.2） |
| **#34** | **站内通知（6 类 / ≤60s）** | **未通过（4/6 类）**：逾期、验收、风险、关键节点真实端到端；**分配（`task.assigned`）与 @提及（`task.mentioned`）无真实生产方** | 浏览器：顶栏铃铛 + 面板 + 已读（`B-I34-20261024-notif-bell-*.md`，3 张截图）；真实 DB 通知行（latency 1.4s/1.6s/0.28s，均达标） | 运行时 129 例 + 通知模块 38 例 + 可见性/账本/投影探针 | ✓ | PR #93 → #104 → #105 → #106 | **不计入**（见 §3.3） |
| #35 | 在线 UML | AC1–AC5 通过；**AC6「上传仅作补充」**按"本期不提供任何上传路径"验证（无仅上传的创建路径） | 浏览器：PM 打开图、SVG 渲染 4 节点 3 边、选择器显示已选关联（`B-I35-20261024-uml-p45-*.md`，2 张截图） | UML **85 例**（schema 25 + http 54 + picker 6）+ 合并后 92 例（含 sticky 回归） | ✓ | PR #78/#79/#84/#103/#117 | **计入增量**（附 2 项收口，见 §4） |
| **#36** | **任务附件（≤10MB、受限类型）** | **未通过**：AC 要求"任务成功删除后清理元数据/实体、失败可追踪重试"与"在 `TaskSection.tsx` 最小挂载"；两处均未接真实入口 | D 组件独立页有截图；**生产任务页未挂载**，真实 DELETE 仍留 `ACTIVE/taskId:null` 孤儿 | D 模块 36 例 + B 公共层组合 **100 例** | ✓ | PR #94 → #116（D 修正）；B 候选 `f516b20` 未合 | **不计入**（见 §3.4） |
| #37 | 公共领域事件基础 | 通过：同事务追加、失败回滚、幂等键、敏感引用过滤、查询端口 | 无 UI 项：真实 HTTP/DB 证据（`B-I37-20261021-domain-event-production-http.md` 等） | events 模块 17 例 + `src/db/event-repository` 与 shared 契约测试；当前全量基线 1907 例 | ✓ | PR #86 → #87 → #90 → #100 → #109 | **计入增量** |

**统计**：计入增量 **9 项**（#25 / #26 / #27 / #28 / #29 / #30 / #31 / #35 / #37）；未计入 **4 项**（#32 / #33 / #34 / #36）→ 回退 Product Backlog。9/13 ≈ **69%**。

---

## 3. 未计入项的现状与缺口

### 3.1 #32 AI 排期建议（缺口：B 的 5 项公共装配）

- **已有**：C 的完整实现已进 main（`455701e`：`src/modules/ai-scheduling/{plugin,workflow,schemas,generation}.ts` + `web/src/pages/scheduling/**`），含列表/详情/统计/审计/评估/处置七条相对路径、保护编排、整份原子日期应用；共享三表、tx/幂等/审计基础在 main。
- **缺口**（B 按 `docs/role-c/issue-32-public-interface-handoff.md` 执行）：① tx-aware `authorization(tx)` + #32 专项 `readAuthorization(tx, actor, SCHEDULING)`（审计另能力）；② `writeDates(tx, projectId, changes)` 走**真实 FS 守卫**统一写入口；③ `appendAudit(tx, entry)` / `readAudit` / 事务外 `recordFailure`；④ 正式挂载（注册点 + 页面/导航 + 注入参数）；⑤ 真正支持 `SCHEDULING` 的模型端口（`LocalStubAiProvider` 只支持 REQUIREMENT_BREAKDOWN）。
- 另有 C 的 12 个验收门禁待 C 在装配完成后收口。

### 3.2 #33 AI 质量 / 进度 / 风险 / 效率分析（缺口：无对外能力）

- **已有**：`src/modules/ai-insights/{metrics,aggregate,types}.ts` 四类指标纯函数 + 2 个测试文件。
- **缺口**：无端点、无 `routes.ts` 注册、无页面、无消费方（`analytics` 仅在注释中提到）；AC 的"服务于仪表盘""人工确认/记录处置"未实现。
- **状态不一致**：GitHub #33 已被关闭，但按代码与 DoD ①② 不成立。**建议负责人核对关闭依据**（是并入 #30/#31 收口，还是误关）。

### 3.3 #34 站内通知（缺口：2 类真实生产方）

- **已有**：`Notification`/消费账本/激活三表、真实 DB 仓储（查询层可见性含原事件 `payload.references`）、权威接收者、#37 适配、提交后消费桥接（仅 DELIVERED 落账本）、B 自产 `task.overdue` / `milestone.due`、顶栏挂载；**6/9 事件名真实端到端**（逾期、节点、`risk.created`、`risk.level-raised`、`acceptance.approved`、`acceptance.rejected`），latency 全部 ≤60s。
- **缺口**：`task.assigned`（C 的任务域）与 `acceptance.submitted`（C）无真实生产方；`task.mentioned` 为明确后置项。**6 类要求 = 4/6 类**，故不勾最终 AC1/AC2、不关闭 #34。

### 3.4 #36 任务附件（缺口：C 的两处真实接线）

- **已有**：D 模块（扩展名+MIME 联合校验、10,000,000 B、框架 413/415 保持原状）+ B 公共层（`Attachment` 表/迁移、窄生命周期端口 `TaskAttachmentLifecyclePort`、清理状态机 `DELETING/CLEANUP_FAILED` + 30s 重试、查询层可见性、完整列表不截断、上传解析器封装）——组合验证 **100 例通过**、`prisma migrate diff` 无漂移。
- **缺口**（C）：① 任务 `DELETE` 事务内调 `markForTaskDeletion(tx, taskId)` 并在提交后清理；② `web/src/pages/task/TaskSection.tsx` 挂 `TaskAttachmentPanel`。
- 现状：删任务仍留 `ACTIVE/taskId:null` 孤儿；公共上传入口**不得**在这些接线完成前启用。

---

## 4. 已计入但需收口的项（低优先，进 Product Backlog）

| 项 | 内容 | 建议 |
|---|---|---|
| #35-UML | AC4 的任务锚点：图→`requirements/{storyId}#task-{taskId}`，但 `TaskSection` 未提供 `#task-<id>` 锚点，落页后不会定位/高亮该任务 | 由 C 按其 `task-anchor-proposal.md` 提交、B 挂载 |
| #35-UML | C 的 5 项非阻断跟进（任何 `P2003` 都映射成 `edges.sourceNodeId`、`fromWire`/`toWire` 缺 vitest 往返、P2002 兜底缺 `DUPLICATE` 字段码、测试注释与 `verification.md` 过期、详情端点计时型侧信道） | C 在自有窗口处理（已发 #35 评论 6381862601） |
| #28-工作台 | 「被提及」块文案仍写"通知模块（别人负责的票）尚未交付"——通知模块已于 #104 交付且已挂载，只有 @提及来源仍缺 | A 改文案为「@提及来源尚未接入」；不改变数据源缺失的事实 |
| 里程碑可见性 | ~~无关联任务的里程碑对非 PM 不返回（fail-closed）~~ | ✅ **已裁定改口径（2026-10-24，项目负责人 DRI；依据 PB-09）**：无关联任务的里程碑对非 PM **可见**；只有「关联任务全都在可见范围外」的里程碑仍不返回（**保留敏感保护**）。新实现 `where` 与边界见 `docs/role-b-gantt-design.md` §9.5 |
| 上一阶段口径 | 上阶段 US-05 的 AC「仅 PM 可创建/编辑任务，Member 只读」与现行 `task.progress`（负责人可编辑本人任务）不一致；当年 AC 未随后的扩展同步更新 | 负责人确认后更新 AC 文案即可，无需改代码 |

---

## 5. 证据索引

- **测试基线**：`982f850` 独立 tester → `npm run typecheck` 0、全量 **92 文件通过 + 1 跳过 / 1907 例通过 / 12 todo / 0 失败**、`build:web` 0（`docs/ai-records/B/issue-22/B-I22-20261024c-main-uml-suite-01.md`）。
- **浏览器/真实 HTTP 证据**：`docs/acceptance-screenshots/us08-01-workbench-five-blocks.png`（本批新增）；`docs/ai-records/B/issue-25|26|31|34|35/**`；本轮看板/甘特/UML/通知/验收矩阵记录见各 `B-I*` 文件。
- **逐票 AC**：各 GitHub issue 正文（#25–#37）。
- **跨票口径**：`docs/team-handoff.md` §9（敏感/用例四角色/附件/依赖/甘特/工作台/通知/风险/进度/AI 数据边界/六状态/多视图一致性/UML）。

**未做**：未对每一项重新跑全量（用统一基线 + 定向证据）；未替 C/A/D 关闭其票；未把"部分完成"当"完成"。
