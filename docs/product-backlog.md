# 爱管理 —— Product Backlog（统一入口）

| 项目 | 内容 |
|---|---|
| 文档类型 | **Product Backlog 单一入口**：本阶段 Sprint 未完成项 + 已知限制 + 待口径确认项 |
| 建立 | 2026-10-24（本阶段 Sprint 结项时建立，判定见 `docs/sprint-closure-dod-review-20261024.md`） |
| 维护 | 项目负责人确认优先级与关闭；本文只登记，不替代证据或票内评论 |
| 状态 | `OPEN` 未开始 / `PARTIAL` 有实现缺验收门禁 / `BLOCKED` 等外部条件 |

---

## A. 本阶段 Sprint Backlog 回退项（4 项，按 DoD 未计入增量）

| ID | 原票 | 条目 | 已交付 | 剩余缺口 | 责任方 | 状态 |
|---|---|---|---|---|---|---|
| **PB-01** | #32 | AI 排期建议（PM-only 生成/查看/采纳/修改后采纳/拒绝/审计） | C 的实现已进 main（`455701e`）；D 的 SCHEDULING 模型端口已合入 main（`feat/D-scheduling-model-port`）；**B 的四项生产装配已合入 main（`8d88996`，PR #123）**：`src/routes.ts` 正式注册七路由；`src/scheduling.ts` 提供 caller-tx `authorization`/`readAuthorization`、`applyTaskPlanDates`（整批同事务、先全量校验后写、走 `writeAssignedTask` 统一写入口）、`appendAudit`/`readAudit`、事务外 `recordFailure`；前端 `/projects/:projectId/scheduling` 已正式挂载 | **无缺口**（装配层已全部交付） | — | CLOSED |
| PB-02 | #32 | 排程的 12 个验收门禁 | — | **12 条全部落成真实用例并通过**（`src/modules/ai-scheduling/integration.pending.test.ts` 已无 `it.todo`）：真实 HTTP + 真实临时 SQLite + **真实回环模型服务**（显式 `EXTERNAL_CHAT_COMPLETIONS` + `SYNTHETIC_DEMO`），含 **G6 真实浏览器走查**（本机 Chrome 155；证据 `docs/role-a/issue-32/evidence/g6-browser-results.json`：11 个检查点全通过、7 张截图、模型仅调用 1 次、库内终态可核）。**无缺口**：落地后经独立对抗性复核并据其补强（门禁 6/7 的原子性与真回滚哨兵、门禁 5 的动态反证、修掉 2 处恒真/过弱断言），见 `docs/ai-records/A/issue-32/A-I32-20261024-gates.md` | **A** | CLOSED |
| **PB-03** | #33 | AI 质量 / 进度 / 风险 / 效率分析（服务于仪表盘、人工确认、记录处置） | 四类指标纯函数（`src/modules/ai-insights/*`）+ 2 个测试文件（48 例）；口径与 #30/#27 同源（进度 = CLOSED ÷ 总数、未解决风险 = OPEN+IN_PROGRESS、负载 = 非 CLOSED 含 DONE） | 无端点/注册/页面/消费方；AC1/AC2/AC3/AC5 未实现，AC4/AC6 因无消费入口无法验收。**关闭依据已由 DRI 核对（2026-10-24）：原 `completed` 关闭不成立，处置为不重开、回退本 Backlog、保留纯函数与测试作为后续实施基础**（核对结论见 #33 票内说明） | A（+ 负责人裁定） | OPEN |
| **PB-04** | #34 | 站内通知的剩余生产方 | 运行时/存储/桥接/顶栏/定时全就绪；**六类中 5 类已真实端到端**（`task.assigned` 由 A 于 2026-10-24 补齐任务域事件通道，`acceptance.submitted` 同步接入；实测 1836ms / 1962ms，均达标） | **仅剩 `task.mentioned`（@提及）**：按 `DECISIONS.md` `notifications.us14-ac1-scope-downgrade`，负责人已裁定其为**明确后置缺口**、不计入本阶段 AC1（口径降级为「五类真实端到端 + @提及后置登记」）。**#34 已按新口径关闭**，本节仅保留 @提及的后续跟踪 | A（后续 @提及） | CLOSED（@提及后置） |
| **PB-05** | #36 | 任务附件的两处真实接线 | D 模块 + **B 公共层均已合入 main**（`6d4cfbc`）；**C 的两处消费点也已合入**（`dc9a9ba`，任务 DELETE 事务内生命周期 + TaskSection 挂载） | **无缺口**：#36 已按 DRI 复核关闭（删除生命周期 / 失败可重试 / 权限边界均有真实 DB + 真实磁盘用例） | — | CLOSED |

> 说明：上表 4 项对应 GitHub 的 #32 / #33 / #34 / #36，均**不关闭原票**；#34/#36 已有大量真实交付，回退的是**最后的验收门禁**而非全部工作。

---

## B. 已计入增量但需收口（低优先）

| ID | 条目 | 责任方 | 状态 | 说明 |
|---|---|---|---|---|
| PB-06 | UML 图→任务的 `#task-<id>` 锚点 | C（已完成，合入 main `dc9a9ba`） | CLOSED | **已实现**：`web/src/pages/task/TaskSection.tsx` 用 `useLocation` 监听 hash，仅在**已加载可见任务**中匹配 `#task-<id>` 后才 `scrollIntoView` + `focus`，行上加 `id={`task-${t.id}`}` 与 `tabIndex={-1}`；未知/非法/不可见 id 不额外请求、不推导权限。证据：`docs/role-c/issue-36/verify-browser.mjs` 正式路由 16 项浏览器检查（含锚点定位、深链刷新、同页换 hash、前进/后退、VIEWER 隐藏 hash 不请求），记录见 `docs/role-c/issue-36/delivery.md` |
| PB-07 | UML 的 5 项非阻断跟进 | C（4/5 已完成） | OPEN（仅剩第 ⑤ 项） | **已完成 4 项**（均合入 main `dc9a9ba`）：① 非边 `P2003` 退化为无 field 的通用 422，仅 `umlEdge.createMany` 上下文保留 `edges.sourceNodeId`（`src/modules/uml/service.ts:82,94`）；② 新增 `web/src/pages/uml/api.roundtrip.test.ts` 5 例纯映射往返（反向 association / null 标签 / 自消息 / 换序与服务端 seq 权威 / 非法投影拒绝）；③ 已知 `P2002` 返回 409 + `DUPLICATE` 字段码（`service.ts:93`）；④ `uml.http.test.ts` 过期注释已移除，`docs/role-c/issue-35/verification.md` 已加 2026-10-21 历史快照导航。**未做 ⑤**：详情端点计时型侧信道（缺失分支未走同一 `readWhere`）；响应体已与「不存在」逐字一致，仅延迟不同，保留为已知非阻断项 |
| PB-08 | 工作台「被提及」块文案过期 | A | CLOSED | **已修正**：`src/modules/workbench/service.ts` 的 `note` 由「通知模块（别人负责的票）尚未交付」改为「通知模块已交付（#34），但 @提及来源尚未接入」；`state='unavailable'` 与 `total=null` 的三态口径不变——数据源仍缺，不得用 0 冒充"没有" |
| PB-09 | 里程碑可见性口径 | A | CLOSED | 原口径：无关联任务的里程碑对非 PM 不返回（fail-closed，`src/modules/gantt/service.ts`）。**DRI 2026-10-24 裁定改为**：无关联任务的里程碑对项目内非 PM 成员**可见**；**保留敏感保护**——有关联任务、且全部关联任务都在可见范围之外的里程碑仍不可见；PM 行为完全不变。已落地并留痕：实现 `src/modules/gantt/service.ts`（`OR: [{ tasks: { none: {} } }, { tasks: { some: { taskId: { in: visibleTaskIds } } } }]`）、新增 4 条用例（gantt 61 例全通过）、`docs/role-b-gantt-design.md` §9.5 更新、决策记录 `DECISIONS.md` `gantt.milestone-visibility-unlinked`。注：`src/modules/ai-scheduling/source.ts` 的里程碑取数**已与 PB-09 对齐**（2026-10-24，决策 `DECISIONS.md` `ai.scheduling-source-milestone-alignment`）：无关联任务的里程碑纳入来源快照（影响 revision 与整份过期），但仍**不进模型输入**（无关联不编造）；验证见门禁 9 的「unlinked milestone」用例 |
| PB-10 | 上阶段 US-05 的权限 AC 文案与现行 `task.progress` 不一致 | A | CLOSED | `docs/sprint1-baseline.md` §2.4.2 的 AC-US-05-08「仅 PM 可创建 / 编辑任务，Member 只读」与附录 B 表 4 的 ⑤ 属 Sprint 1 历史口径。按该文档「历史基线、原文不改」的自身规则，**以文首 2026-10-24 追加修订说明为准**：创建 / 编辑（标题、描述、负责人、验收人、计划日期）/ 删除任务仍 **PM-only**；**任务负责人本人可更新本人任务的状态与进度**（非负责人 MEMBER `403`、本人负责 `200`）。无需改代码 |

---

## C. 运维 / 部署注意（非功能 Backlog）

| ID | 条目 | 说明 |
|---|---|---|
| PB-11 | 通知定时生产与 `NODE_ENV` | `NODE_ENV=test` 会关闭 10s 扫描（能力如实降级）；部署不得设 `NODE_ENV=test` |
| PB-12 | 附件上传目录 | `var/uploads/` 不得注册为公开静态目录；下载只走带鉴权的 `GET /attachments/:attachmentId/download` |
| PB-13 | 外部 AI 调用边界 | 只允许合成/演示数据；仍禁止外发真实凭据与个人信息；AC-13 不声称满足（`DECISIONS.md` `role-d.ai.demo-external-api-scope`）。**另：本阶段不配置真实供应商/模型/密钥**（负责人 2026-10-24 裁定，教学项目定位），排期模型保持显式不可用，真实供应商终验不在本期范围（`DECISIONS.md` `ai.no-real-provider-this-phase`） |

---

**变更记录**

| 日期 | 变更 |
|---|---|
| 2026-10-24 | 建立本文；从本阶段 Sprint 结项回退 PB-01~PB-05（#32/#33/#34/#36）；登记 PB-06~PB-13（收口项/已知限制/运维注意） |
| 2026-10-24 | DRI 分支合并后同步真实状态：PB-01 第 ⑤ 项（SCHEDULING 模型端口）已由 D 交付并合入 main，剩余缺口由 5 项降为 4 项；PB-05 的 B 公共层已从"分支候选"变为**已合入 main**（`6d4cfbc`）；PB-03 的关闭依据核对完成（不重开、回退 Backlog） |
| 2026-10-24 | 负责人裁定「直接接手」#32 门禁：核实 B 的四项生产装配确已合入 main（`8d88996`，PR #123），**PB-01 转 CLOSED**、**PB-02 解除 `BLOCKED` 并改由 A 执行**；**PB-08 文案已修正**为「通知模块已交付（#34），但 @提及来源尚未接入」，三态口径不变 |
| 2026-10-24 | 负责人裁定「PB-09 与 PB-10 都改」：**PB-10 转 CLOSED**（`docs/sprint1-baseline.md` 文首追加 2026-10-24 修订说明，历史原文不改；创建/编辑/删除任务仍 PM-only，负责人本人可改本人任务进度）；**PB-09 转 CLOSED**（里程碑可见性放宽并保留敏感保护，决策记录 `DECISIONS.md` `gantt.milestone-visibility-unlinked`）；**PB-02 已落地 11/12 条门禁并通过**，第 12 条（G6 浏览器走查）实施中 |
| 2026-10-24 | **PB-02 转 CLOSED**：#32 的 12 条验收门禁全部落成真实用例并通过（含 G6 真实浏览器走查，0 个 `it.todo`）；落地后经**独立对抗性复核**并据其补强三类哨兵（门禁 6/7 的「同一事务 / 整份回滚」真反证、门禁 5 的「模型已坏仍成功」动态反证、两处恒真/过弱断言），首轮浏览器失败为**测试侧选择器过宽**（已修）而非产品缺陷 |
| 2026-10-24 | 负责人追加裁定两条并已落地：① `src/modules/ai-scheduling/source.ts` 的里程碑取数与 PB-09 **对齐**（无关联里程碑进来源、不进模型输入；决策 `ai.scheduling-source-milestone-alignment`）；② **本阶段不配置真实 AI 供应商/密钥**（教学项目定位），排期模型保持显式不可用，真实供应商终验不在本期范围（决策 `ai.no-real-provider-this-phase`）；PB-13 与 PB-09 注记同步 |
| 2026-10-24 | C 收尾同步（依据 `origin/main` 代码逐项核对，非重述旧结论）：**PB-06 转 CLOSED** —— 任务锚点已在 `web/src/pages/task/TaskSection.tsx` 实现并随附件消费点合入 main（`dc9a9ba`），正式路由的 16 项浏览器检查覆盖锚点定位/深链刷新/同页换 hash/前进后退/隐藏 hash 不请求；**PB-07 更新为 4/5 已完成** —— P2003 收窄、wire 往返 vitest、P2002 `DUPLICATE`、过期注释与 `verification.md` 导航均已落地，仅剩第 ⑤ 项（详情端点计时型侧信道）未做，保留 OPEN 且明确为已知非阻断 |
