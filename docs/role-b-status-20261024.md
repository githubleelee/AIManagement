# ROLE-B 夜间推进与状态报告（2026-10-24）

> 目的：一页看清**做了哪些工单、还差哪些、阻塞在谁**。所有结论以 main 提交、独立 tester 输出与真实浏览器/HTTP 证据为准；未做项与限制单列，不用"应该没问题"代替证据。

基线：`origin/main` = `295e6949c4f21a1020ac9c35b958da7991cef8a8`（本批合入完成后）。
本批合入：PR #103（UML 粘性置位）、#104（通知公共运行时）、#105（顶栏通知挂载）、#106（`risk.created` 能力改判）、#101/#102（FS 范围与证据文档）。

---

## 1. 本批已完成并合入 main

| 项 | 内容 | 合并 | 证据 |
|---|---|---|---|
| 看板最终验收（本地 #20 / GitHub #25） | 真实登录 PM 改状态 → 列计数变化；同事务 `AuditLog story.status` + `DomainEvent requirement.story.status-changed`；详情页同步；member1/viewer1 只读且直连 PATCH 403；outsider 404 / 自己项目 200；敏感故事对 member1 隐藏、白名单 member2 可见；`typecheck` 0、board+requirement **578 例** | 记录 PR | `docs/ai-records/B/issue-25/B-I25-20261024-board-acceptance-01.md` |
| UML 后置标敏粘性置位（#59） | `setSensitivity` 同事务把关联该 task/story 的图 `everRestricted=true`；只增不减、幂等、注入失败整事务回滚；独立复验 authz 16/16、敏感相关 96/96、自建探针 5/5 | **#103** `9160587` | `docs/ai-records/B/issue-35/B-I35-20261024-uml-sticky-*.md` |
| 通知公共运行时（#38/#39） | 三表 + 迁移（`sourceEventId → DomainEvent Restrict`、`dedupeKey` 唯一、消费账本 `(consumerId,eventId)`）；真实 DB 仓储（查询层可见性含**原事件 `payload.references`**）；权威接收者；#37 订阅适配；提交后消费桥接（仅 DELIVERED 落账本）；`task.overdue`/`milestone.due` 定时；app/routes 组装 | **#104** `ec4e638` | `docs/ai-records/B/issue-34/B-I34-20261024-notif-runtime-*.md`（tester：129 例 + 真实进程 12/12 + 可见性 10/10） |
| 顶栏通知入口（#40） | `AppLayout` 挂载 `NotificationBell`；面板未读 2 → 点开 2→1、DB `readAt` 落库；`typecheck`/`build:web` 0 | **#105** `cdb39d1` | `docs/ai-records/B/issue-34/B-I34-20261024-notif-bell-and-capability-01.md` |
| `risk.created` 能力改判（#41 的一部分） | 真实生产方已在（A 风险域）+ 本运行时端到端（事件→桥接→通知行，latency≈1.4s）→ 如实 AVAILABLE；其余六项保持 UNAVAILABLE | **#106** `295e694` | 同上（含 9 项能力清单原始 JSON） |
| 附件公共层修正（候选，**未合**） | 上传 MIME 解析器收回附件插件封装子上下文（避免其它端点 415 变 422）；决策记录恢复追加式 + `supersedes` | 候选 `feat/attach-public-integration@902cfa1` | `docs/ai-records/B/issue-36/B-I36-20261024-*.md` |

**main 基线（独立 tester，合入前）**：`9160587` → `typecheck` 0、**81 文件通过 + 1 跳过 / 1709 通过 + 12 todo / 0 失败**。

---

## 2. 进行中（B 侧已有真实候选，等条件）

| 项 | 现状 | 差什么 |
|---|---|---|
| **FS 开工守卫（#13/#15）** | 共享 `TaskStartGuardPort` + task 侧同事务校验已交付（`feat/fs-start-guard@2e0d2f8`），独立复验 45 例 + task 412 例；裁定与字段码已进 main（`scheduling.fs-enter-doing-all-paths`、`contract.fs-start-validation`） | **A 在验收 REJECT 的原事务内接入**（真实 HTTP 探针实测：前置仅 DONE 时仍 200 进 DOING）。两端覆盖前 B 不合并 FS |
| **附件公共接入（#34/#35/#37）** | 候选 `902cfa1`（schema/迁移、窄生命周期端口、真实删除联动接口、250 行完整列表、mkdtemp 隔离、解析器封装修正）；独立验证 50 例 + 迁移/FK 探针 | **D #94 先合**（其 `plugin.test.ts` 已改 bare Fastify），**C 接真实任务 DELETE + `TaskSection` 挂载**；B 不接管 |
| **通知“六类”验收（#41）** | 基础链路 + 三个真实来源（`task.overdue`、`milestone.due`、`risk.created`）已端到端 | `task.assigned`、`task.mentioned`、`acceptance.submitted/approved/rejected`、`risk.level-raised` 真实生产方未接（A/C）；**最终 AC1/AC2 不勾** |

---

## 3. 阻塞项（按责任方）

| 阻塞 | 责任方 | 具体事实与解除条件 |
|---|---|---|
| FS 整体合入 | **A** | 验收 `REJECT`（DONE→DOING）走独立写入口，未接 `context.taskStartGuard`；真实探针 200 + DOING。A 需在 `submitAcceptance` 的原 `$transaction` 内、CAS/记录/审计/事件写之前调用，缺端口 fail-fast，并补 HTTP 回归。B 提供共享端口与装配，**已通知**（#29 comment 6368427989 / 6368693875） |
| 附件完成 | **C**（+D） | ① C 在任务 DELETE 事务内调注入的 `TaskAttachmentLifecyclePort.markForTaskDeletion` 并在提交后清理；② C 在 `TaskSection.tsx` 挂 `TaskAttachmentPanel`；③ D 先合 #94（413/415 不再被改写、测试改 bare）。缺任一，公共候选不合（现状：删任务留 `ACTIVE/taskId:null` 孤儿） |
| 风险/验收事件生产 | **A** | PR #100 事件子集方向正确，但 `risk.service` 的 `existing` 在**事务外**读取，并发/交错下可能发出与实际最终态不一致的 `risk.level-raised`；已请求 A 把读取移入 caller-tx（#100 comment 6368086701） |
| 排程公共适配（#44/#47/#49/#50） | **C** | C 的 list/detail/disposition/plugin/UI 仍本地未推送；B 已在 #32 请求 6 项接口事实（路由表、DTO 字段、scenario/映射、模型端口要求、排序口径、事务/审计边界）。共享三表**已就绪**，不是阻塞 |
| UML P2/P3/P4/P5（#57/#58） | **C** | 远端 `feat/US15-uml` 只到 P1 守卫；选择器 `86b3b02` 本地未推送；读侧 `everRestricted=false` guard 未落地（B 的写侧粘性已合 main，当前无权限消费方） |
| 通知 @提及 | 明确后置 | `task.mentioned` 不阻塞其它类型；不擅自新增 Mention 模型 |

---

## 4. 可继续推进（无外部阻塞）

- #22 父汇总：等 #15（FS）与 #41（通知六类）收口后合成；负载/工作台/看板部分的证据已独立。
- 附件候选在 D #94 合入后即可做组合复验（含 415/413 断言对齐），C 的两处接线仍归 C。
- UML P4/P5（注册行/路由行/导航行/文档行）在 C 推送 P3 后可立即落笔。

---

## 5. 诚实限制与风险

- **未跑最终全量**：本报告基线为 `9160587` 的全量（0 失败）；`295e694` 的最终全量由独立 tester 另跑并单独记录。
- **里程碑浏览器端到端受限**：上海 09:00 触发，深夜窗口只能靠注入时钟探针（08:59:59 不触发 / 09:00:00 触发）。
- **部署配置**：通知定时生产在 `NODE_ENV=test` 下不自动启动（默认启动；能力会如实降级而非伪造）。部署不得设 `NODE_ENV=test`。
- **未合入的候选**：FS `2e0d2f8`、附件 `902cfa1` 只是分支，不代表 main 已具备对应能力。
- **D 的 `plugin.test.ts` 测试装配修正**：B 在通知批次内最小改了该测试文件的装配部分（bare Fastify + 真实 session，断言与用例名未变）。这是 B 新增公共注册后必须做的测试装配修正，不是修改 D 的业务实现；已在记录中披露。

## 6. 证据索引

- 看板：#25 comment 6369853602；`docs/ai-records/B/issue-25/B-I25-20261024-board-acceptance-01.md`
- FS：#29 comment 6368427989 / 6368693875；`docs/ai-records/B/issue-26/B-I26-20261023-fs-*.md`、`B-I26-20261024-fs-verify-02.md`
- 通知：#34 comment 6368600269 与本批 PR；`docs/ai-records/B/issue-34/B-I34-20261024-*.md`
- UML：#35 comment（PR #103）与 `docs/ai-records/B/issue-35/B-I35-20261024-uml-sticky-*.md`
- 附件：#94 comment 6368193098；`docs/ai-records/B/issue-36/B-I36-20261024-*.md`
- main 基线：#22 comment 6369854392；`docs/ai-records/B/issue-22/B-I22-20261024-main-baseline-01.md`
