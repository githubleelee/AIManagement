# ROLE-B：首批对外同步与授权申请文本包（本地待审 · 未发布）

> 对应本地任务 `#03`（对外发布与申请）与 `#42`（C #32 新确认同步）。
> **本文只是待核准的文本与补丁计划：未在 GitHub 发布任何评论，未改标签 / PR / Issue 状态，未提交或推送任何文件，也未替 C / A / D 确认其规则。**
> 发布动作、本地文档补丁的落地，均需用户逐条核准；本地已确认口径不以对外发布为生效前提。

## 1. 依据

- 代码基线：main `398aa76d02f66ce9d62e4e1c340de408f15a1f0f`（本地最新 origin/main）。
- 本地权威来源：`docs/role-c-issue-32-confirmation.md`（C 12 项确认原文）、`DECISIONS.md` 最新适用条目（含 `supersedes` 链）、`docs/role-d-start-confirmation.md`。
- 台账与设计：`docs/role-b-contract-register.md`（#02）、`docs/role-b-baseline-review.md`（#01）、三票设计（#04/#09/#16）、`#43/#46` 两份 DRAFT。
- 只读远端核对（`2026-10-18T02:59Z` 与 `03:0x`，只发 GET，无任何写入）：
  - #24 `open`，6 条评论，`updated_at 2026-10-18T02:31:18Z`，正文 sha256 `7423ed9f…`;
  - #25 / #26 / #27 / #32 评论数 `0`；#31 / #37 评论数 `0`；
  - PR #39 `open`、未合并，正文 sha256 `94ffce92…`；
  - #30 有 1 条新评论（ROLE-A 的 US-10 开工确认，`2026-10-18T02:31:39Z`）。
  - “没有公开评论”只说明本轮无可引用的书面提案，**不等于对应角色没有私下实现**。
- **文档树与可发布性**：只读核对以 `origin/main 398aa76` 为准；但 §5 补丁所在工作树是分支 `docs/role-b-public-integration`（PR #39 head `fb5cee2`，merge-base `658ee87`，**落后 main 36 个提交**，含 PR #40/#41 两次合并）。`DECISIONS.md` **只存在于该分支**（main 无此文件），且本地新增条目尚未提交。因此评论中引用的 `DECISIONS.md` key 与 `#43/#46` 两份 DRAFT 在远端**当前都打不开**，交付方式需先定（§7）。

## 2. 新收到的外部输入（登记，不等于批准）

| 来源 | 内容 | B 的处置 |
|---|---|---|
| #30 评论（ROLE-A） | #30 开工确认：C1 阈值 -10%/-25%、C10 进度=已关闭÷总数、C6“PM 全局基数 + 其余可见基数且分子分母同源”、关闭入口放本票新模块、风险四态、敏感风险继承任务可见性；并称“C3 沿用 US-08 的 UTC 口径”待澄清 | 只登记，不代项目负责人确认；不据此改动 B 域规则 |
| #24 评论（ROLE-A） | 冻结区申请：`src/db/schema.prisma` 加 `Risk` 与 `Project.status`；`src/shared/types.ts` 新增 `Action` `risk.write` / `project.close` 及 `permissions.ts` 判定；`src/routes.ts`、`web/src/routes.tsx`、`ProjectLayout.tsx`、`docs/frontend-routes.md` 各加挂载行 | 见 §4 T7：这些多为 **B 单写范围或权限模块**，需项目负责人 / 权限负责人裁决；B 不擅自新增 Action 或替 A 放行业务规则 |
| #24 评论（ROLE-A，US-09 时） | 报告两条既有缺陷：端点 28 允许 PM 跳过验收直接 `CLOSED`；`rules.ts` 不限制验收人角色，VIEWER 可被指定为验收人却无法自行验收 | 属 A 域状态与授权口径，登记为跨域未决项，不在 B 域自行修 |
| PR #39 / #24 正文 | 仍保留旧口径：C3 “A 域待统一”、`permissions.ts` 明确排除、C2/C6 待确认 | 按 §5 原则以“保留原文 + 追加变更说明”方式更新，不追溯改写历史 |
| #31 / #32 / #33 远端正文 | 第 0 步是**追加**式同步，旧 C4 句仍在线：#31 保留“真实数据不得外发公有云”与“真实项目数据不出私有环境”，#32 保留旧 C4 句与“待确认：AI 服务与资源”；#33 根本未在本次同步列表内 | 登记为待处理冲突（票面 ≠ 最新口径），不默认票面已同步；是否修票面正文单列裁决（§7），不在正文以外的地方冒充已更新 |
| A 在 #24 末条评论中需 B 回答的项 | `/projects/:projectId/close` 的**路径命名空间归属**（`src/routes.ts` 属 B 单写，A 明确请 B 指定）；`Project.status` 是否**不进**共享 `ProjectView`（涉及 `src/shared/types.ts`）；`schema.prisma` +1 迁移；健康度基准“任务 min(planStart)~max(planEnd)、不给 Project 加日期字段”；C9/C13 的 409 与“不允许强制关闭”待定口径 | 补入登记并列入 §7；B 只回答属于单写范围的问题，不代批 A 的业务与阈值口径 |

**冲突提示**：A 方案称 C3 沿用 UTC，与本轮已确认的全项目 `Asia/Shanghai` 不一致；B 不修改 A 的代码，也不接受“两套最终口径”并存，需在 T7 中提出协调。

## 3. 发布目标与去重策略

| 目标 | 用途 | 不做什么 |
|---|---|---|
| **#24（CONTRACT）** | 唯一集中同步点：C2/C3/C6 已确认、`permissions.ts` #32 限范围例外与 `supersedes`、`task/` 写窗口、以及 §2 新收到申请的登记 | 不重贴 C1–C13 全文，不动标签 |
| #32（US-12） | C 侧规则确认与 `#43/#46` 书面核对请求（字段/受众/跨子集；事务/签名/幂等） | 不复制 #24 全文，不声称接口已冻结 |
| #26（US-06） | 仅 C2（AC5）已确认 + 真实开工入口授权/写窗口申请 | 不改 AC 勾选状态 |
| #27（US-07） | 仅 C6 基础口径（AC6）+ 计数/受众边界说明 | 不新增阈值类规则 |
| #25（US-04） | 澄清 #32 的 `task/` 窗口**不覆盖** requirement 写路径；附具体文件授权申请 | 不关闭 C11，不宣布已获授权 |
| #21（ROLE-B） | 指向本地草稿、状态与未决项短链 | 不重述正文 |
| #31/#34/#36/#37 | **本轮不重复编辑**：第 0 步已追加同步（`updated_at 2026-10-17T10:34–10:35Z`），C4/C7/C8 口径未变，避免制造微差异 | 不把追加式同步当作票面已无旧句（见 §2） |
| #33（US-13） | **未在第 0 步同步**：远端正文仍是旧口径（含“待确认 C4”），而本地索引已更新 | 需单独授权后再更新，不得沿用“已同步、不必改”的假设 |

## 4. 发布记录与待发布文本

### 4.0 已发布（2026-10-18，用户授权范围内）

| 目标 | 形式 | 链接 | 备注 |
|---|---|---|---|
| 文档入库 | PR #42（仅文档，未合并） | https://github.com/githubleelee/AIManagement/pull/42 | 分支 `docs/role-b-c32-contract-drafts`（基于 main `398aa76`）；含 `DECISIONS.md`、C 确认稿、#01/#02/#04/#09/#16 文档、#43/#46 DRAFT、本文与计划/任务；**不含代码** |
| #26（T3） | 评论（已发） | https://github.com/githubleelee/AIManagement/issues/26#issuecomment-6245104366 | 发送时附了 PR #42 与设计文档 / `DECISIONS.md` 直链；未改标签，AC 未勾 |
| #27（T4） | 评论（已发） | https://github.com/githubleelee/AIManagement/issues/27#issuecomment-6245104653 | 同上 |
| #25（T5） | 评论（已发） | https://github.com/githubleelee/AIManagement/issues/25#issuecomment-6245104919 | 同上；三票仍 `open` + `needs-confirmation`，未改标签 |
| #24（T1） | 评论（已发，第二批） | https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6245135447 | 集中同步 C2/C3/C6、#32 权限例外与 `supersedes`、`task/` 窗口、A 申请登记；附 PR #42 直链 |
| #32（T2） | 评论（已发，第二批） | https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6245135807 | 向 C 请求字段/受众/跨子集与事务/签名/幂等的书面核对；附 #43/#46 与 `DECISIONS.md` 直链（交付条款已按文件可达改写） |
| #21（T6） | 评论（已发，第二批） | https://github.com/githubleelee/AIManagement/issues/21#issuecomment-6245136058 | 本地草稿与状态短指针 + PR #42 链接 |
| #30（T7） | 评论（已发，第二批） | https://github.com/githubleelee/AIManagement/issues/30#issuecomment-6245136311 | **落点选 #30**（A 在此提出开工确认与 UTC 待澄清，通知更直接）；内容与 T7 一致 |

评论区均注明首批三票“本轮只发本票等三条自包含同步”；第二批已全部发出。**实际发出文本以评论链接为准**（相对下方草稿增补了 PR #42 直链，T2 第 5 条改写为“文件已可达”，T6 补上了评论链接与 PR）。发布后核对：相关票仍 `open`、标签与 PR 状态均未变。

### 发布后状态

- 对外文本 T1–T7 已全部发出（2026-10-18），无遗留待发评论；`T8` 仍默认不发。
- 收到回复前，待回复项：#25 requirement 具体文件/范围授权与写窗口；#26 真实开工入口守卫授权/写窗口；#32 C 对 #43/#46 的书面核对；#24 A 对其申请范围的进一步确认。
- **本地文档补丁已落地**（2026-10-18，用户授权“在分支中落地”）：`docs/team-handoff.md`、`docs/handoff-issues.json`、`docs/sprint1-spec-interface-contract.md`、`docs/frontend-routes.md` 已按 §5 追加变更说明；#39 的既有文档更新一并纳入 PR #42 分支（#39 可后续弃用，未关闭）。提交 `ea81b3e`。
- **票面 C4 句已更正**（2026-10-18）：#31 / #32 / #33 正文顶部追加「口径更正 / 口径同步」块（保留原文），链接 `DECISIONS.md` 与 PR #42；#32 另注明供应商仍待定并指向本票核对评论。三票仍 open、标签未变。

### 4.1 待发布文本（可直接粘贴；仍待核准）

### T1 → #24（集中同步 + 新增申请登记）—— ✅ 已发布（2026-10-18，见 §4.0）

```text
<!-- role-b-c32-confirmation-sync -->
ROLE-B / 项目负责人 githubleelee 口径同步（**本地已确认，尚未发布到其他文档**）：

1. 全项目口径（不只 #32）：C2 FS 放行前置必须 CLOSED、DONE 不放行、自然日含起止、后继不早于前置计划结束次日；C3 全项目 Asia/Shanghai、planEnd 次日 00:00 仍未 CLOSED 即逾期；C6 基础负载=负责人名下非 CLOSED 任务数（含 DONE），PM 全项目、MEMBER/VIEWER 可见范围、AI 排敏后重算且不得冒充全局基数。
2. #32 限定口径：生成/查看/采纳/修改后采纳/拒绝/审计全部 PM-only；仅可应用 TODO 任务 planStart/planEnd；整份原子应用、唯一处置、先鉴权后重放；生成阶段只读消费 #26/#27，不直接写派生聚合/依赖/里程碑。
3. 权限文件：`src/modules/authz/permissions.ts` 原“明确排除”仍有效，**仅就 #32 PM-only 追加最小改动授权**（含必要共享 Action / 对象 scope），不代表 C11/C12 或其他票权限；以 `DECISIONS.md` 同 key `supersedes` 条目为准，旧条目保留。
4. `task/` 限范围授权：C 在 B 登记具体文件/范围并完成现写者交接后的独占窗口内，最小改 `task/routes.ts`、`rules.ts` 及本域测试；不另建旁路、不调 task service；该例外**不覆盖** B 甘特旧入口、也不覆盖 requirement 等其他旧模块；不假定写锁空闲。
5. 上述确认对应本地 `docs/role-c-issue-32-confirmation.md` 与 `DECISIONS.md` 2026-10-17T18:41 / 18:51 条目；`docs/team-handoff.md`、工单索引及本票正文的同步文本仍在本地待发布，故本票上文旧表述暂以本条为准，不表示线上已对齐。
6. 收到并登记（**未批准**）：ROLE-A 在 #30 / 本票提出的 `Risk` 模型、`Project.status`、新增 `Action`（`risk.write` / `project.close`）与若干公共文件挂载行申请；涉及 `src/shared/*`、`schema.prisma`、`routes.ts`、前端骨架及权限模块，需项目负责人 / 权限负责人裁决后再落；B 不擅自新增 Action、不替 A 确认阈值与关闭口径。
7. 未一并确认：C1 健康度阈值、C5、C9、C10 故事级汇总、C11 其他 Action、C12 协作人、六状态完整转换细节；仍按“只登记、不实现”处理。
8. 本条为口径同步，不合并 PR、不关闭 Issue、不批量移除 `needs-confirmation`；四类证据（桩 / 模块测试 / 真实 API / 真实生产方联调）继续分别留证。
```

### T2 → #32（C 书面核对请求）—— ✅ 已发布（2026-10-18，第 5 条已改写为文件可达）

```text
ROLE-B → ROLE-C / xichoutrees：请对两份 DRAFT 做书面核对，不要求先有运行时实现：

1. `docs/role-b-scheduling-data-contract.md` §5 七个问题：最小字段、受众基数（visible-range / pm-protected / ai-input）与返回位置、跨 AI 子集约束的安全处理、快照指纹分量与 asOf 语义、Milestone/Dependency 候选形状与“不可用 ≠ 已知为空”、合法读取方式（直接读库或另立 shared 只读端口）、应用后不写派生结构。
   注意：负载口径已确认，但“全项目基数 / 排除敏感数”只在 PM 内部展示/审计，不下发 MEMBER/VIEWER 或外部模型。
2. `docs/role-b-scheduling-transaction-proposal.md` §12 的 C 最小确认点：新增 Action 与对象 scope（读/审计是否与写/处置分离）、`createAuthorization` / `assertTaskAssignment` 的签名放宽方案、受控应用端点与统一计划写能力落点、唯一处置保护、错误映射、幂等键机制、fingerprint 范围、“有效权限”语义、失败证据落点、事务内参与范围复核与「最小归属解析」步骤边界、同一请求身份口径、生成期间撤权。
   其中：新增生成/读/审计/处置 Action **必须命中显式拒绝非 PM 的分支或集合，不得落入 `can()` 末尾默认允许**；依赖数据不可用或完整性未知时 fail-closed，不得当作“无依赖”通过。
3. 请给出 `task/routes.ts`、`rules.ts` 及必要测试的具体改动清单与期望交接基线，B 据此登记写窗口（不重复索要已确认的 #32 限范围许可，但仍需核对当前写者与实际窗口，不假定空闲）。
4. 上述两份文件均为 DRAFT、未冻结；#26/#27 的运行时实现与 D 两类端口**不构成设计冻结前置**。最终 AC 依赖真实数据链路，不以 fixture 代替。
5. 文件交付：两份 DRAFT 目前只在本地（未提交、未推送），本条评论发出时你**可能无法打开**。请与 B 约定交付方式——B 先推送文档分支 / PR（需另行授权）或把关键问题直接内联在本条评论下；未定之前以上第 1–3 条不能视为已送达。
```

### T3 → #26（C2 已确认 + 真实开工入口申请）—— ✅ 已发布（2026-10-18，见 §4.0）

```text
ROLE-B 同步（GitHub #26）：

- C2 已确认，不再二选一：放行前置必须 `CLOSED`，`DONE` 不放行；自然日含起止；后继建议开始不早于前置计划结束次日。AC5 将按此验证，但仍未运行。
- 模型设计不含实现：`Milestone` / `TaskDependency` 最小字段、约束、索引为候选；环检测要求与边写入同一受控事务 + 并发保护，并覆盖“双向同时建边”用例；`onDelete: Restrict` 对既有 `DELETE /tasks/:taskId` 的影响需单独定口径。
- 申请（未获授权前不改）：真实“开始执行”入口的守卫落点现集中在 `PATCH /tasks/:taskId`（`src/modules/task/routes.ts:402-525`）与 `rules.ts`，目前无 FS 起步校验。请与当前任务流写者核对：哪些操作构成开始执行、共同落点、需改的函数/测试与排他窗口。
- 边界：这不是 C #32 仅日期应用窗口的延伸，不借该窗口擅改普通状态/验收规则；任何超出登记文件的抽取或新文件另提范围。
```

### T4 → #27（C6 基础口径同步）—— ✅ 已发布（2026-10-18，见 §4.0）

```text
ROLE-B 同步（GitHub #27）：C6 基础口径已确认——负载 = 负责人名下所有非 `CLOSED` 任务数（含 `DONE`），不做工时/技能/产能评分；PM 看全项目汇总，MEMBER/VIEWER 只看各自授权可见任务汇总并标注「可见范围」；AI 排敏感后以子集重算，不得以子集冒充 PM 全项目基数，含敏感的全局负载不得外送。

补充边界（设计结论，仍待接口核对）：基数是「非 CLOSED 负载数」，与「全项目任务人口数」是不同口径，不能默默等同；退组负责人（`removeMember` 不校验名下任务）会造成「成员行合计 ≠ 全项目基数」，需单独定语义；成员姓名/账号等个人信息不得整包送入模型；与个人工作台比较必须同项目、同负责人、同账号、同授权视角，不得把五块相加或从 ≤50 条截断明细推计数。健康度阈值等其他规则仍未确认。
```

### T5 → #25（requirement 授权申请 + 窗口边界）—— ✅ 已发布（2026-10-18，见 §4.0）

```text
ROLE-B 申请（GitHub #25，仅本票范围，未获授权前不改）：

- `src/modules/requirement/service.ts`：仅 `updateUserStory`（`860-884`）及其同函数内新增的 before/after 与审计写入。
- `src/modules/requirement/plugin.ts`：仅端点 21 `PATCH /stories/:storyId` handler（`854-917`，含 `873` 既有鉴权）传参调整；不新增路由、不建镜像写入口。
- `src/modules/requirement/requirement.story-read-update.test.ts`：仅该端点的审计、越权与状态变更回归；本票新测试放 `src/modules/board/`。

保留 `requirement.write` / `can` / `visibilityScope` 与原字段校验，不借看板扩成员写权限；审计最小范围为真实 `status` 变化 + who/when/before/after，全字段审计与 `action` 命名另议；事件提交与失败语义待公共事件端口就绪后按已确认策略处理（不默认 outbox，也不静默失败）。

说明：项目负责人对 #32 的 `task/` 限范围授权**不覆盖** requirement，仍需原 owner 对上述具体文件/范围授权及实际写窗口确认；C11（MEMBER 能否改故事状态）仍未确认，VIEWER 维持只读。
```

### T6 → #21（短指针）—— ✅ 已发布（2026-10-18）

```text
ROLE-B 状态：基线复核（#01）、最小契约台账（#02）与三票设计（#04/#09/#16）已完成并各自通过独立复核；#43 数据契约、#46 事务/鉴权协议为 DRAFT，待 C 书面核对，未冻结。本地文件：`docs/role-b-baseline-review.md`、`docs/role-b-contract-register.md`、`docs/role-b-{workload,gantt,board}-design.md`、`docs/role-b-scheduling-{data-contract,transaction-proposal}.md`。未编码、未跑应用测试、未发布远端；C #32 新确认的对外同步由本地 #42 承担，尚未发布。
```

### T7 → 面向 ROLE-A 的协调 —— ✅ 已发布在 #30（2026-10-18）

```text
ROLE-B → ROLE-A / lyh：收到你 #30 的开工确认与 #24 的冻结区申请，先登记四点，均待项目负责人 / 权限负责人裁决，B 不代批：

1. C3 冲突：本轮已确认全项目统一 `Asia/Shanghai`（`DECISIONS.md` `timezone.project-wide-asia-shanghai`，覆盖 A/B/C/D），而你的待澄清项写“沿用 US-08 的 UTC 口径”。现有 `workbench/service.ts:41 @398aa76` 的 `isoToday()` 用 UTC，属**实现差异**，不是口径待定。请把 A 域日期计算收敛到上海日期语义；B 不代改 A 业务，也不接受两套口径并存作为最终一致。
2. 你的 `Action` / schema 申请：`src/shared/types.ts` 的 `Action` 联合、`schema.prisma`、`routes.ts`、前端骨架属 B 单写范围，但**新增 `risk.write` / `project.close` 的业务语义属权限与 A 域业务规则**；`permissions.ts` 目前只有 #32 PM-only 的最小例外，尚无其他 Action 改动授权。请在 #24 明确请求范围与语义后由项目负责人 / 权限负责人裁决，B 只在获批范围内落公共文件。
3. C1 / C10：你在 #30 的阈值与进度口径属人工拍板，B 只登记、不否认也不外推；注意 #30 的项目进度（已关闭÷总数）与 #26 的故事级进度汇总是两个口径，故事级公式仍待收口，勿互相替代。
4. 需 B 在单写范围内回答的项（登记后单独走授权，不在本条代批）：`/projects/:projectId/close` 路径命名空间是否可落（`src/routes.ts`）、`Project.status` 不进共享 `ProjectView` 的规避是否接受、`Risk` 迁移批次与 `min(planStart)~max(planEnd)` 基准是否影响 B 后续 schema 批次；这些由项目负责人确认后，B 再按批次落公共文件。
```

### T8 → 面向 ROLE-D（可选，默认不发）

D 的 `#31/#37` 第 0 步说明已同步，C4/C7/C8 口径未变，本轮**不重复编辑**以避微差异；仅在用户希望催办最小 AI / 事件提案时，才单独补一条指向 `docs/role-d-minimal-interface-request.md` 的短评。

## 5. 本地文档补丁计划（**未应用**）

> 行号按当前工作树（分支 `docs/role-b-public-integration`）文本，落地前需重新核对；原则是**保留原文 + 追加带日期的变更说明 / `supersedes` 指针**，不追溯改写历史。
>
> **目标树与承载方式待裁决**：该分支落后 main 36 个提交（merge-base `658ee87`，含 #40/#41 两次合并），且 `DECISIONS.md` 只存在于该分支。补丁是 rebase 后并入 PR #39、另开文档 PR，还是先在 main 上重建，需先定；否则行号漂移与内容重叠不可控。`docs/handoff-issues.json` 是**本地索引**，改写它不等于线上票面已更新（索引 ≠ 线上 body）。

| 文件 | 锚点 | 拟追加内容 |
|---|---|---|
| `docs/team-handoff.md:8` | 第 0 步同步块 | 追加“本地已确认、远端未发布；#42 待授权同步”，不写成已同步 |
| `docs/team-handoff.md:135`、`:139` | `permissions.ts` 明确排除 | 追加 #32 PM-only 最小例外 + `supersedes` 指向，原排除保留 |
| `docs/team-handoff.md:244` | 依赖行“放行条件待 #24 C2” | 更新为已确认（CLOSED / 自然日 / 次日），旧句留痕 |
| `docs/team-handoff.md:253` | 多视图一致性 | 追加 C6 已确认基础口径（含 DONE、PM 全局 / 可见范围、AI 子集） |
| `docs/team-handoff.md:275`–`:279` | C2 / C3 / C6 行 | C2、C3、C6 状态更新为已确认，C3 注明工作台 UTC 为实现差异；C1/C10 等仍待 |
| `docs/team-handoff.md:230-231` | A/C 复用端口说明 | 追加“C 只读消费 #26/#27、不写派生聚合；B 视图随 Task 更新” |
| `docs/team-handoff.md:286` | C13 行 | 追加 #32 `task/` 限范围窗口与“不覆盖 #25/#26” |
| `docs/handoff-issues.json`（#21 / #24 / #25 / #26 / #27 / #32 条目） | 对应 body | 与 T1–T5 同文同步；权限例外 + `supersedes`；#25 仅澄清窗口不覆盖，不关闭 C11 |
| `docs/sprint1-spec-interface-contract.md:13-19`（变更说明）、`1025`/`1034`（冻结清单与归属更新行） | 基线归属说明 / 冻结清单 | 仅加注“#32 PM-only 最小例外及其来源”，不改基线正文与表格 |
| `DECISIONS.md`（本分支已跟踪，本地 +63 行未提交） | 5 条旧条目 + 本地新增确认条目 | **需先决定是否随文档 PR 入库**，否则 T1/T7 引用的 key 在远端不可验证、`supersedes` 链无从追溯 |
| `docs/frontend-routes.md:9-12`、路由表 | 骨架归属 | 追加“#32 `/scheduling` 由 B 挂载、URL 未定、不称已注册”，不新增已实现路由行 |

**落地状态（2026-10-18）**：上表除 `DECISIONS.md` 行（已随 PR #42 入库）外均已按“保留原文 + 追加变更说明”应用到分支 `docs/role-b-c32-contract-drafts` 并推送到 PR #42；同时把 PR #39 的既有文档更新并入同一分支（#39 保持 open，未关闭、未合并）。`handoff-issues.json` 的追加覆盖 #21/#24/#25/#26/#27（口径更新）与 #31/#32/#33（C4 更正）。索引 ≠ 线上 body 的提醒依然成立，但本次两者已同步。

## 6. 发布前检查清单

- 不改标签、不合并 PR、不关闭 Issue、不批量移除 `needs-confirmation`。
- 保留原文；新增内容带日期与依据（`DECISIONS.md` key 或确认稿章节）。
- 不声称 C / A / D 已确认其未确认内容；不把“无公开评论”当作“无实现”。
- 接口、字段、路由均标候选 / 未冻结；AC 一律未运行。
- 本地文档补丁与线上评论分开授权、分开留证；发布后回填链接与回复方。
- 评论中引用的文件（`DECISIONS.md`、`#43/#46` 草稿）在发布时必须**已可访问**，否则先在评论内联关键问题或标注“暂不可达”。
- 明确 `docs/handoff-issues.json` 是本地索引：改索引不等于改线上票面，二者需分别留证。

## 7. 待用户裁决

已完成（2026-10-18，无需再裁决）：T1–T7 全部发布；`DECISIONS.md` 与 `#43/#46` 草稿经 PR #42 可访问。

仍待裁决：

1. ROLE-A 的申请：是否升级给权限负责人或项目负责人裁决，或先由 B 只回“登记待裁”。需逐项处理的是——(a) 新增 `Action` `risk.write` / `project.close` 与对应 `permissions.ts` 判定；(b) `Risk` 模型、`Project.status`、迁移批次与 `min(planStart)~max(planEnd)` 基准（影响 `schema.prisma`）；(c) `Project.status` 不进共享 `ProjectView` 的规避是否接受（`src/shared/types.ts`）；(d) `/projects/:projectId/close` 路径命名空间与挂载行（`src/routes.ts`、前端骨架）；(e) C9/C13 关闭语义：阻断用 `409 CONFLICT`、是否允许强制关闭——原文属“待定”，B 不代批。
2. C3 冲突（已在 #30 T7 提出，等待 A 回复）；如需用户直接指示 A，另行告知。
3. §5 本地文档补丁是否现在落地（仍不提交、不推送），或等发布授权一并执行；以及 §5 的目标树选择（rebase 进 PR #39 / 沿用新 PR #42 分支 / 在 main 重建）。注意 PR #39 已落后 main，与 PR #42 重叠，建议后续只保留其一。
4. #33（以及 #31/#32）票面旧 C4 句是否本轮一并更正，还是仅发评论并在后续单票处理。
5. #32 的 `needs-confirmation` 在 C 书面核对后由 C 自摘，还是由 B 按 C 的核对申请代操作。
6. C 的 `/scheduling` 路由与导航挂载（确认稿 §11）是否补发一条独立说明（本轮 T2/T6 未展开该点）。
7. 是否拒绝 T8（默认不催办 D）。
