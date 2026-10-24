# ROLE-B 夜间推进与状态报告（2026-10-24）

> 目的：一页看清**做了哪些工单、还差哪些、阻塞在谁**。所有结论以 main 提交、独立 tester 输出与真实浏览器/HTTP 证据为准；未做项与限制单列，不用"应该没问题"代替证据。

基线：`origin/main` = `982f8507f57f0ffe7130c9f30336b2de56ef725d`（含 2026-10-24 下午至傍晚的全部批次；文档批 #118/#119 在其上）。
本批合入：PR #101/#102（FS 范围与证据文档）、#103（UML 粘性置位）、#104（通知公共运行时）、#105（顶栏挂载）、#106（`risk.created` 改判）、#107（夜间记录）、**#108（事件目录登记）**、**#109（整合 A 的 PR #100：风险提级 + 验收结果事件）**、**#112（三个已接来源能力改判）**、**#114（FS 开工守卫双入口）**、**#116（D 附件模块修正）**、**#117（UML P2/P3 + P4/P5）**。

---

## 1. 本批已完成并合入 main

| 项 | 内容 | 合并 | 证据 |
|---|---|---|---|
| 看板最终验收（本地 #20 / GitHub #25） | 真实登录 PM 改状态 → 列计数变化；同事务 `AuditLog story.status` + `DomainEvent requirement.story.status-changed`；详情页同步；member1/viewer1 只读且直连 PATCH 403；outsider 404 / 自己项目 200；敏感故事对 member1 隐藏、白名单 member2 可见；`typecheck` 0、board+requirement **578 例** | 记录 PR | `docs/ai-records/B/issue-25/B-I25-20261024-board-acceptance-01.md` |
| UML 后置标敏粘性置位（#59） | `setSensitivity` 同事务把关联该 task/story 的图 `everRestricted=true`；只增不减、幂等、注入失败整事务回滚；独立复验 authz 16/16、敏感相关 96/96、自建探针 5/5 | **#103** `9160587` | `docs/ai-records/B/issue-35/B-I35-20261024-uml-sticky-*.md` |
| 通知公共运行时（#38/#39） | 三表 + 迁移（`sourceEventId → DomainEvent Restrict`、`dedupeKey` 唯一、消费账本 `(consumerId,eventId)`）；真实 DB 仓储（查询层可见性含**原事件 `payload.references`**）；权威接收者；#37 订阅适配；提交后消费桥接（仅 DELIVERED 落账本）；`task.overdue`/`milestone.due` 定时；app/routes 组装 | **#104** `ec4e638` | `docs/ai-records/B/issue-34/B-I34-20261024-notif-runtime-*.md`（tester：129 例 + 真实进程 12/12 + 可见性 10/10） |
| 顶栏通知入口（#40） | `AppLayout` 挂载 `NotificationBell`；面板未读 2 → 点开 2→1、DB `readAt` 落库；`typecheck`/`build:web` 0 | **#105** `cdb39d1` | `docs/ai-records/B/issue-34/B-I34-20261024-notif-bell-and-capability-01.md` |
| `risk.created` 能力改判（#41 的一部分） | 真实生产方已在（A 风险域）+ 本运行时端到端（事件→桥接→通知行，latency≈1.4s）→ 如实 AVAILABLE | **#106** `295e694` | 同上（含 9 项能力清单原始 JSON） |
| 事件目录登记（#100 前置 M1） | `src/shared/events.ts` 目录表补 `risk.created/updated/level-raised` 与 `acceptance.approved/rejected`（形状照实现），写明两段名例外与「`risk.updated` 不是通知触发事件」 | **#108** `568cc1b` | 注释表；`typecheck` 0 |
| 整合 A 的 PR #100（风险提级/验收事件） | B 解决 `app.ts`/`routes.ts` 冲突（同时保留 `acceptanceEvents` 与通知运行时）后合入；A 的 `01aecc6` 已把风险前值读取移入事务并加 `updatedAt` CAS | **#109** `aa62c0d` | 独立 tester：`typecheck` 0、全量 **84 文件 +1757 例 / 0 失败**、`build:web` 0 |
| D 附件模块修正（配合 #36） | 删除把框架 415/413 改写成 422 的局部 errorHandler、协议 §8 更正；B 验证后合入 | **#116** `30f77fa` | 3 文件/36 例通过；B 原 415 断言被确认正确 |
| UML P2/P3 合入 + P4/P5 挂载（#57/#58） | 合入 C 的 `feat/US15-uml@7b2f27e`；B 落注册行/路由行/导航行/文档行；修订设计稿 AC5/§5.4/§6.2/§8-10 口径 | **#117** `982f850` | 真实 HTTP：置敏前 member1 200/1-1 → 置敏后 404（与不存在 id 逐字一致）/0-0 → 解绑后**仍 404**（`everRestricted=1`）；浏览器 SVG 4 节点 3 边；typecheck/build:web 0 |
| FS 开工守卫双入口（#13/#15） | `TaskStartGuardPort` + task PATCH 同事务校验 + 验收 REJECT 在原事务内、CAS/记录/事件之前调用（缺端口 fail-fast）；B 解决装配归属后合入 A 的接线 | **#114** `cc67e33` | 真实 HTTP：前置仅 DONE → REJECT **422** 且任务仍 DONE/0 记录/0 事件；前置 CLOSED → 200 + DOING + 事件 |
| 三个已接来源能力改判（#41） | `risk.level-raised`、`acceptance.approved`、`acceptance.rejected` 经真实事件端到端（2 条 ≈1.5s / 1 条 ≈1.6s / 1 条 ≈0.28s，均达标）→ 如实 AVAILABLE；9 项中 6 项可用 | **#112** `9238330` | 真实 HTTP 能力清单 + DB 通知行；定向 61 例 |
| 附件公共层修正（候选，**未合**） | 上传 MIME 解析器收回附件插件封装子上下文（避免其它端点 415 变 422）；决策记录恢复追加式 + `supersedes` | 候选 `feat/attach-public-integration@902cfa1` | `docs/ai-records/B/issue-36/B-I36-20261024-*.md` |

**main 基线（独立 tester）**：合入前 `9160587` → 81 文件 / 1709 例全绿；**本批合入后 `295e694` → 83 文件通过 + 1 跳过 / 1732 通过 + 12 todo / 0 失败**，`typecheck` 与 `build:web` 均 0（`docs/ai-records/B/issue-22/B-I22-20261024-main-final-suite-01.md`）。

---

## 2. 进行中（B 侧已有真实候选，等条件）

| 项 | 现状 | 差什么 |
|---|---|---|
| **附件公共接入（#34/#35/#37）** | D 的模块修正已合入 main（#116）；B 候选已并入最新 main 并验证：`integrate/attach-candidate-on-main@f516b20`，migrate diff 无漂移、typecheck 0、**8 文件 / 100 例**；与 main 差异只剩 18 个 B 侧公共层文件 | **只差 C 两处**：任务 DELETE 事务内调 `markForTaskDeletion` + 提交后清理；`TaskSection.tsx` 挂 `TaskAttachmentPanel`。缺任一条不合 |
| **通知“六类”验收（#41）** | 基础链路 + **6/9 来源**已真实端到端：`task.overdue`、`milestone.due`、`risk.created`、`risk.level-raised`、`acceptance.approved`、`acceptance.rejected` | 仍缺 `task.assigned`、`acceptance.submitted`（C 域）与 `task.mentioned`（明确后置）；**最终 AC1/AC2 不勾** |

---

## 3. 阻塞项（按责任方）

| 阻塞 | 责任方 | 具体事实与解除条件 |
|---|---|---|
| 附件完成 | **C** | D 侧已修并合入（#116）；B 候选已集成验证（`f516b20`）。**仍缺** ① 任务 DELETE 事务内调 `TaskAttachmentLifecyclePort.markForTaskDeletion` 并在提交后清理；② `TaskSection.tsx` 挂 `TaskAttachmentPanel`。缺任一条不合（现状：删任务留 `ACTIVE/taskId:null` 孤儿） |
| 排程公共适配（#44/#47/#49/#50） | **C** | C 的 list/detail/disposition/plugin/UI 仍本地未推送；B 已在 #32 请求 6 项接口事实（路由表、DTO 字段、scenario/映射、模型端口要求、排序口径、事务/审计边界）。共享三表**已就绪**，不是阻塞 |
| UML 后续（非阻断） | **C** | P2/P3 已评审并合入、P4/P5 已挂载（#117）。留给 C 的非阻断项：任何 `P2003` 都映射成 `edges.sourceNodeId`；`fromWire`/`toWire` 缺 vitest 往返；P2002 兜底缺 `DUPLICATE` 字段码；测试注释与 C 的阶段文档过期；详情端点计时型侧信道 |
| 通知 @提及 | 明确后置 | `task.mentioned` 不阻塞其它类型；不擅自新增 Mention 模型 |

---

## 4. 可继续推进（无外部阻塞）

- #22 父汇总：等 #15 的合并后浏览器复核与 #41（通知仍缺 C 域两源）收口后合成。
- 附件：B 侧已无可做项（候选集成在 `f516b20`），等 C 两处接线即可合。
- 通知 #41：待 C 的 `task.assigned`/`acceptance.submitted`；B 的 `task.mentioned` 明确后置。
- 附件候选在 D #94 合入后即可做组合复验（含 415/413 断言对齐），C 的两处接线仍归 C。
- UML P4/P5（注册行/路由行/导航行/文档行）在 C 推送 P3 后可立即落笔。

---

## 5. 诚实限制与风险

- **最终全量（独立 tester，逐次递进）**：`aa62c0d` / `9238330` → 84 文件 / 1757 例；`cc67e33`（FS 双入口）→ 87 文件 / 1811 例；**`982f850`（UML P2/P3+P4/P5）→ 92 文件通过 + 1 跳过 / 1907 通过 + 12 todo / 0 失败**，`typecheck` 0、`build:web` 0（该次 tester 环境为 Node 22/npm 10，已如实标注）。
- **里程碑浏览器端到端受限**：上海 09:00 触发，深夜窗口只能靠注入时钟探针（08:59:59 不触发 / 09:00:00 触发）。
- **部署配置**：通知定时生产在 `NODE_ENV=test` 下不自动启动（默认启动；能力会如实降级而非伪造）。部署不得设 `NODE_ENV=test`。
- **未合入的候选**：附件公共层已集成到 `integrate/attach-candidate-on-main@f516b20`（未合 main，等 C）；FS `2e0d2f8` 已随 #114 合入。
- 合并过程中曾发生两次取用错误（基底取旧本地 `origin/main`、误删 main 侧 D 的 40+ 文档/证据），均已从 main 恢复并在记录中留痕。
- **A 的 PR #100** 内容已由 PR #109 合入 main（含冲突解决）；PR #100 本体作为历史保留并可关闭，不作为未完成项。
- **D 的 `plugin.test.ts` 测试装配修正**：B 在通知批次内最小改了该测试文件的装配部分（bare Fastify + 真实 session，断言与用例名未变）。这是 B 新增公共注册后必须做的测试装配修正，不是修改 D 的业务实现；已在记录中披露。

## 6. 证据索引

- 看板：#25 comment 6369853602；`docs/ai-records/B/issue-25/B-I25-20261024-board-acceptance-01.md`
- FS：#29 comment 6368427989 / 6368693875；`docs/ai-records/B/issue-26/B-I26-20261023-fs-*.md`、`B-I26-20261024-fs-verify-02.md`
- 通知：#34 comment 6368600269 与 PR #104/#105/#106/#112；`docs/ai-records/B/issue-34/B-I34-20261024-*.md`、`B-I34-20261024b-a100-and-live-capabilities-01.md`
- 事件目录/PR #100 整合：PR #108 `568cc1b`、PR #109 `aa62c0d`；#100 comment 6380170522
- UML：#35 comment（PR #103）与 `docs/ai-records/B/issue-35/B-I35-20261024-uml-sticky-*.md`
- 附件：#94 comment 6368193098；`docs/ai-records/B/issue-36/B-I36-20261024-*.md`
- main 基线：#22 comment 6369854392；`docs/ai-records/B/issue-22/B-I22-20261024-main-baseline-01.md`
