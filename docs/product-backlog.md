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
| **PB-01** | #32 | AI 排期建议（PM-only 生成/查看/采纳/修改后采纳/拒绝/审计） | C 的实现已进 main（`455701e`），共享三表/幂等/审计基础就绪；**✅ 第 ⑤ 项已解除**：D 的 SCHEDULING 模型端口已合入 main（`feat/D-scheduling-model-port`，`scheduling-provider.ts` + 兼容性/单测） | **B 的 4 项装配**（原 5 项，模型端口已交付）：tx-aware `authorization(tx)` + #32 专项 `readAuthorization`（审计另能力）；`writeDates(tx, …)` 走真实 FS 守卫；`appendAudit/readAudit/recordFailure` adapter；正式挂载（注册点 + 页面/导航 + 注入参数） | **B** | OPEN |
| PB-02 | #32 | 排程的 12 个验收门禁 | — | 依赖 PB-01 完成后由 C 做真实生产装配的 API/浏览器闭环，逐项收掉 12 TODO | C | BLOCKED |
| **PB-03** | #33 | AI 质量 / 进度 / 风险 / 效率分析（服务于仪表盘、人工确认、记录处置） | 四类指标纯函数（`src/modules/ai-insights/*`）+ 2 个测试文件（48 例）；口径与 #30/#27 同源（进度 = CLOSED ÷ 总数、未解决风险 = OPEN+IN_PROGRESS、负载 = 非 CLOSED 含 DONE） | 无端点/注册/页面/消费方；AC1/AC2/AC3/AC5 未实现，AC4/AC6 因无消费入口无法验收。**关闭依据已由 DRI 核对（2026-10-24）：原 `completed` 关闭不成立，处置为不重开、回退本 Backlog、保留纯函数与测试作为后续实施基础**（核对结论见 #33 票内说明） | A（+ 负责人裁定） | OPEN |
| **PB-04** | #34 | 站内通知的剩余 2 类真实生产方 | 运行时/存储/桥接/顶栏/定时全就绪；9 个事件名中 6 个真实端到端（latency ≤60s 达标） | `task.assigned`、`acceptance.submitted` 的真实生产方（C 的任务域），以及 `task.mentioned` 的明确后置联调；补齐后 #34 才可勾 AC1/AC2 并关闭 | C（+ @提及后续） | BLOCKED |
| **PB-05** | #36 | 任务附件的两处真实接线 | D 模块 + **B 公共层均已合入 main**（`6d4cfbc`，原候选 `integrate/attach-candidate-on-main`；含 `Attachment` 表/迁移、DB 仓储、清理状态机、窄生命周期端口、上传解析器封装、`routes.ts` 注册；100 例通过、migrate diff 无漂移） | **仅剩 C 的两处**：① 任务 `DELETE` 事务内调 `TaskAttachmentLifecyclePort.markForTaskDeletion(tx, taskId)` + 提交后清理；② `web/src/pages/task/TaskSection.tsx` 挂 `TaskAttachmentPanel`。缺任一条，删任务留 `ACTIVE/taskId:null` 孤儿 | C | BLOCKED |

> 说明：上表 4 项对应 GitHub 的 #32 / #33 / #34 / #36，均**不关闭原票**；#34/#36 已有大量真实交付，回退的是**最后的验收门禁**而非全部工作。

---

## B. 已计入增量但需收口（低优先）

| ID | 条目 | 责任方 | 状态 | 说明 |
|---|---|---|---|---|
| PB-06 | UML 图→任务的 `#task-<id>` 锚点 | C 提交 / B 挂载 | OPEN | 现链接跳到需求页但不高亮任务（AC4 已满足"可跳转"，此为提高定位体验） |
| PB-07 | UML 的 5 项非阻断跟进 | C | OPEN | `P2003` 一律映射成 `edges.sourceNodeId`（建图/关联行失败时字段不存在）；`fromWire`/`toWire` 缺 vitest 往返；P2002 兜底缺 `DUPLICATE` 字段码；`uml.http.test.ts` 注释与 `docs/role-c/issue-35/verification.md` 过期；详情端点计时型侧信道 |
| PB-08 | 工作台「被提及」块文案过期 | A | OPEN | 仍写"通知模块尚未交付"；已交付，仅 @提及来源缺。应改为"@提及来源尚未接入" |
| PB-09 | 里程碑可见性口径 | 负责人 | OPEN（已知限制） | 无关联任务的里程碑对非 PM 不返回（fail-closed，`src/modules/gantt/service.ts:210-213`；登记于 `docs/role-b-gantt-design.md` §9.5）；若改需先裁定并同步测试/文案 |
| PB-10 | 上阶段 US-05 的 AC 文案与现行 `task.progress` 不一致 | 负责人（仅改文案） | OPEN | 原 AC「仅 PM 可创建/编辑任务，Member 只读」；现行允许任务负责人更新本人任务进度/状态。2026-10-24 复核在 `90f0754` 上实测：非负责人 MEMBER `403`、本人负责 `200`。建议按 US-08 新口径更新 AC，无需改代码 |

---

## C. 运维 / 部署注意（非功能 Backlog）

| ID | 条目 | 说明 |
|---|---|---|
| PB-11 | 通知定时生产与 `NODE_ENV` | `NODE_ENV=test` 会关闭 10s 扫描（能力如实降级）；部署不得设 `NODE_ENV=test` |
| PB-12 | 附件上传目录 | `var/uploads/` 不得注册为公开静态目录；下载只走带鉴权的 `GET /attachments/:attachmentId/download` |
| PB-13 | 外部 AI 调用边界 | 只允许合成/演示数据；仍禁止外发真实凭据与个人信息；AC-13 不声称满足（`DECISIONS.md` `role-d.ai.demo-external-api-scope`） |

---

**变更记录**

| 日期 | 变更 |
|---|---|
| 2026-10-24 | 建立本文；从本阶段 Sprint 结项回退 PB-01~PB-05（#32/#33/#34/#36）；登记 PB-06~PB-13（收口项/已知限制/运维注意） |
| 2026-10-24 | DRI 分支合并后同步真实状态：PB-01 第 ⑤ 项（SCHEDULING 模型端口）已由 D 交付并合入 main，剩余缺口由 5 项降为 4 项；PB-05 的 B 公共层已从"分支候选"变为**已合入 main**（`6d4cfbc`）；PB-03 的关闭依据核对完成（不重开、回退 Backlog） |
