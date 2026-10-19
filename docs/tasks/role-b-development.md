# 角色 B 开发工单清单

> 历史：用户已批准 C 确认修订及本地 #01/#02/#04/#09/#16/#43/#46 的复核/设计提案。本次追加授权：准备 #03/#42 的首批对外同步与授权申请文本包，仅本地待审，不发布、不编码；允许维护相应状态、证据与 Blocker。可只读读取 GitHub 并刷新 origin/main，不覆盖既有未提交材料；不提交、不推送、不改标签/合并/关闭工单。主代理独占维护本清单。
> 保留本地任务编号和既有完成证据；当前执行状态以每项 Status / Evidence / Blocker 为准，#23 的完成记录仍仅指历史第 0 步。规则确认、实现落地与对外发布分别留证，不互相替代。

依据：`docs/plans/role-b-development.md`、`docs/role-c-issue-32-confirmation.md`、`DECISIONS.md` 最新适用条目。

## 执行规则

- 本文 `#01–#50` 是本地任务编号，不是 GitHub Issue 编号；GitHub 工单在正文明确标注。`#01–#41` 保留原编号与执行状态，后续新增任务继续递增。
- 主线 `#27 → #26 → #25`（GitHub #27/#26/#25）是**优先级顺序，不是硬依赖**：三票在各自独立目录（`workload/`、`gantt/`、`board/`）可并行推进设计与实现；公共文件由 B 单写、组件按就绪挂载，**不整模块等待**；不得据此新增跨票硬边。
- 优先接收 **D 最小公共 AI / 事件端口**，同时并行 C `#26 / #27` 最小读契约、#32 权限 / 模型提案与 `task` 写窗口登记；**不让 C 等 B 两票整体验收才设计**。
- Dependencies 使用前置任务编号及类型：FS 为前置完成后才能开始，SS 为前置开始后才能开始，FF 为前置完成后才能完成。本地排期边不回写为 GitHub 的整体验收依赖，不把角色父票或契约票变成硬依赖。**仅保留真实接口 / 验收依赖**，删除只由排序产生的硬边；不用优先级造边。
- 独立文件、目录可在各自范围获批后并行；先划清写入边界，同文件不并发修改，公共文件仍由 B 单写。校验器就绪不等于编码已获授权。
- 状态以**证据**为准：每波按已授权范围更新并校验；历史 #23 的完成不等于其他任务完成。每票开工重新核对最新 main；旧基线描述与当前事实分开记录。
- Blocker 表示需解除的外部条件，不是新增业务规则；基于已批准计划登记，实际执行前复核并补证据。解除阻塞不自动代表任务完成。
- 仅由对应负责人确认业务规则、授权旧业务文件扩展。B 不代其他角色确认，不新建旁路写入口。

## 本轮口径同步（依据 2026-10-17 项目负责人确认）

> 本节记录项目负责人本轮明确的口径更新。旧历史以「适用范围 + 变更说明」保留在各自文档中，不全局替换；来源见 `docs/role-c-issue-32-confirmation.md`、`docs/role-d-start-confirmation.md` 与 `DECISIONS.md`。**注意区分全项目口径与 #32 限定口径**，不把全项目规则误标为仅 #32。

### 公共文件与授权

- **公共文件归属**：项目负责人已授权 ROLE-B = `githubleelee` 统一修改 / 合入 `src/shared/*`、`src/db/schema.prisma` 及迁移、`src/routes.ts`、`src/app.ts`、前端公共骨架（`web/src/App.tsx`、`web/src/routes.tsx`、`web/src/layouts/`、`web/src/components/`）、`docs/frontend-routes.md` 及 `var/uploads` 的 `.gitignore`。
- **权限文件**：`src/modules/authz/permissions.ts` 的权限 / 签名原**排除**在公共单写外；本轮**仅就 #32** 额外授权 B 最小修改（及必要共享 `Action` / 对象 scope），**不是把整个 authz 模块或其他票权限转给 B**；如该文件存在其他写者，先登记排他窗口。不代表 C11 / C12 完成。
- **旧业务文件**（`requirement/`、`task/`、`project/`、`authz/` 等）一般仍须原 owner 对**具体文件 / 范围**书面授权；**#32 例外**：C 在 B 登记具体文件 / 范围并完成现写者交接后的独占窗口内，最小改 `task/routes.ts`、`rules.ts` 及本域测试，不必再等原 owner 重复同意。该例外**不覆盖** B 甘特旧模块写入口或其他票。
- **4 类证据分开**：桩（本地 mock / 可替换接口）、模块测试、真实 API、真实生产方联调分别留证，任一不得冒充另一类。

### 全项目口径（C2 / C3 / C6）

- **C2 FS 放行（全项目，含 A/B/C）**：实际放行前置必须为 `CLOSED`，`DONE` 不算验收通过；计划按自然日（含周末）计，**起止日均计入**；FS 后继建议开始**不得早于前置计划结束日的次日**；实际开工另检查前置 `CLOSED`。
- **C3 时区与逾期（全项目，含 D）**：统一 `Asia/Shanghai`，日期语义 `YYYY-MM-DD`；`planEnd` 当日结束后、**次日 00:00 仍未 `CLOSED` 即视为逾期**；不再仅列「A 域 C3 待确认」。**其他六状态转换细节未一并批准。**
- **C6 基础负载与汇总（本期统一基础口径）**：负载 = 负责人名下**所有非 `CLOSED` 任务数（含 `DONE`）**，不做评分；PM 看**全项目汇总**，MEMBER / VIEWER 只看到各自**授权可见任务**的汇总并标注「可见范围」；AI 排敏感对象应在**查询层过滤**并以该子集重算负载 / 计数，**不得把含敏感的全局负载送 AI**，也不得以 AI 子集冒充 PM 全项目基数。**健康度阈值等其他业务规则未确认。**

### 限定口径（#32）

- **PM-only**：仅 PM 可生成 / 查看 / 采纳 / 修改后采纳 / 拒绝 / 查看审计；MEMBER / VIEWER 不开放。未登录 401、对象不可见或外项目 404、可见无操作权 403。统一走 `can()` / `visibilityScope()`，业务不私写角色判定；每次请求与确认 / 重试都重新鉴权，撤权即时收敛，**撤权后的重试不得返回历史结果**；仍有权限的相同请求可按幂等规则返回已有结果。**须覆盖读取 / 审计操作，而非只把 write 加入动作集合。**
- **可应用字段**：仅 `TODO` 任务的 `planStart` / `planEnd`；不改负责人 / 验收人 / 状态 / 依赖 / 里程碑，非 `TODO` 只提示。
- **只读消费 + 受控应用**：#32 生成只读消费 `#26 / #27`；人工确认可经**统一受控路径**改 `TODO` 任务 dates，B 甘特 / 负载随原任务数据更新。「不改 #26 / #27」应理解为**不直接改派生聚合 / 依赖 / 里程碑**，**不是禁止已授权日期应用**。
- **硬阻断 vs 仅提示**：硬阻断 = 日期倒置、`TODO` 新开始早于北京时间今天、违反 FS 计划约束、非 `TODO` 或越字段写；仅提示 = 同一人日期重叠、新结束晚于原计划、超过已有关联里程碑日期；无关联里程碑不编造、不自动改里程碑；负载只展示分布，不设「超过 N 即过载」阈值。
- **C 实现业务，B 只落公共层**：C 负责业务 / 整份原子写 / 快照 / 幂等；B 只落公共声明 / 模型 / 权限 / 组装 / 挂载。公共读 / 写端口与事务 / 鉴权协议**先提案确认**，防止跨模块 service 调用或事务外检查；**不自行选择 tx 架构 / 幂等键 / hash 字段 / URL 等细节**。
- **写路径回归边界**：C 的统一计划写路径**复用原项目 / 分配 / 日期等基础校验**；**不把 #32 独有的 TODO-only / 应用规则强加给所有旧手工 PATCH 或其他业务**。

### 其他

- **AI 外部演示范围**与 **AC13 冲突**：按 `DECISIONS.md` `role-d.ai.demo-external-api-scope` 执行，不声称满足原 AC13。
- **净新增估算单列**：见文末「估算拆分」。原 2 人日契约统筹只覆盖原 B 票已含工作，不重复计算，也不暗示已批准延期或无条件吸收 18 人日。
- **本地 / 远端区分**：本轮已存在的 C 确认稿与 `DECISIONS.md` 追加条目尚未发布到远端；#23 的 `done` 仅指历史第 0 步。后续每次状态或阻塞更新均运行任务校验器；保留编号，新增任务另分配编号。mock 可支持设计与模块验证，不充当最终验收证据。

## #01 复核基线并建立验收对应表
Status: done
Outcome: 最新 main、适用契约和 B 域三票实际实现的证据清单，以及逐条 AC 对应表。
Evidence: docs/role-b-baseline-review.md：固定最新 main 398aa76，实时 #25/#26/#27 共 19 条 AC 与索引一致，逐项列出现状/交付/验证方式；独立 tester 核对通过，三处引用行号已修正。仅静态复核，未跑应用测试。
Done when: 记录复核提交号；核对六状态、故事 PATCH 审计事件、现有权限、里程碑与依赖模型；为 GitHub #25/#26/#27 每条 AC 标明现状、交付物和验证方式，不重复建设。
Dependencies: none

## #02 编制 B 域最小契约与申请草稿
Status: done
Outcome: B 域确认草稿、GitHub #27 开工边界、GitHub #26 提前申请、GitHub #25 旧模块申请、#32 公共读写 / 事务鉴权协议待办，以及未决事项台账。
Evidence: docs/role-b-contract-register.md 已完成 C1–C13/六态/公共归属/#32 协议台账，区分结论、实现差异和待确认，含 #25/#26 具体旧文件申请草稿及跨域协调草稿；独立 tester 复核通过。未发布或代确认。
Done when: 每项写明问题、确认人、确认/待确认状态、所影响的开发与验收部分、证据位置；覆盖六状态、C2/C3/C6、C11/C12/C13、甘特汇总、FS 执行落点、事件接口、公共文件归属及 #32 协议；明确标注**全项目口径（C2/C3/C6）与 #32 限定口径（权限例外 / task 写窗口）**，不把全项目规则误标为仅 #32；C5 仅登记协调，不承诺替 C 实现；草稿未擅自发布或代确认。
Dependencies: #01 [FS]

## #03 获批并发出首批契约与旧业务文件授权申请
Status: done
Outcome: 经用户认可的 B 域最小确认及申请记录；提前登记甘特字段、类型、事件与挂载需求（公共层由 B 单写），并提交负载挂载与看板旧业务模块的**具体文件 / 范围**授权需求。
Evidence: docs/role-b-publication-package.md 已产出并经两轮独立复核。2026-10-18 获用户授权后全部发出：① 文档 PR #42（仅文档，未合并）https://github.com/githubleelee/AIManagement/pull/42，使 DECISIONS.md 与 #43/#46 草稿可引用；② 评论 T1 #24 https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6245135447、T2 #32 https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6245135807、T3 #26 #issuecomment-6245104366、T4 #27 #issuecomment-6245104653、T5 #25 #issuecomment-6245104919、T6 #21 #issuecomment-6245136058、T7 #30 #issuecomment-6245136311。发布后核验：相关票仍 open、标签 handoff/needs-confirmation/role:* 未变、PR 未合并。待回复项：#25/#26 具体旧文件授权与写窗口、C 对 #43/#46 的书面核对、A 对范围与 C3 的回复。
Done when: 用户批准具体对外文本与操作；发布后记录链接、接收负责人和待回复项；未获决定的问题保持待确认，不要求所有议题定稿，不代删执行票标签。
Dependencies: #02 [FS]
已解除：T1–T7 已于 2026-10-18 全部发布；本地文档补丁归 #42，不在本任务范围。
## #04 完成成员负载单票方案与接口设计
Status: done
Outcome: GitHub #27 的字段、端点设计、成员与任务关联、权限边界、页面方案及文件清单。
Evidence: docs/role-b-workload-design.md 已交付单票 DRAFT，覆盖当前成员、非 CLOSED 含 DONE 计数、受众/AI隔离、详情及与工作台同源比较，列明退组负责人等待确认边界；独立 tester 复核通过，引用已修正。仅设计交审，未编码/冻结接口/运行 AC。
Done when: 覆盖成员列表、负载摘要、任务详情、空态和工作台一致性；明确六状态落地状态与 C6 已确认基础口径（含 `DONE` 的非 `CLOSED` 计入、PM 全项目 / MEMBER / VIEWER 可见范围），阈值类规则未确认部分保留；不把 DONE 当 CLOSED，不擅自扩展协作人模型；可实施部分与待确认部分分开，提交用户审阅。
Dependencies: #02 [FS]

## #05 实现成员负载后端只读查询
Status: done
Evidence: src/modules/workload/{types,service,plugin}.ts + workload.test.ts（11 用例）已合入 main（PR #50）。可见性经 visibilityScope() 进查询层、列表与 count 共用同一 where；非 CLOSED 含 DONE；未新增 Action/未跨模块 service；明细不返回 isSensitive。npm run typecheck exit 0；npx vitest run src/modules/workload 11/11；全量 npm test 50 文件 1193 用例通过。
Outcome: `src/modules/workload/` 中的授权查询与负载数据接口。
Done when: 直接读库且不跨业务 service；只查本项目成员；复用 `can()`/`visibilityScope()`；敏感过滤进入数据库查询；任务列表与计数同口径，按 C6 基础口径计算未关闭任务（含 `DONE`）；区分 PM 全局与可见范围基数，AI 消费须基于过滤后子集重算，不把含敏感全局负载送出；不改公共文件（由 B 单写）。
Dependencies: #03 [FS], #04 [FS]
已解除：用户 2026-10-18 批准 #27 编码范围。本轮按设计 §4 最小口径实施（basis.scopeLabel + members[].openTaskCount）；候选 population 字段（含退组负责人歧义）本轮不实现。

## #06 实现成员负载页面与成员详情
Status: done
Evidence: web/src/pages/workload/{WorkloadPage,MemberWorkloadDetail,api,types}.tsx|ts + workload.css 已合入 main（PR #50）。范围标签、计数、状态/计划、加载/空/错误/无权限态；DONE 标「已提交待验收」；复用既有状态与角色标签；typecheck exit 0。浏览器走查（PM/MEMBER/outsider）见 docs/ai-records/B/issue-27/evidence/B-I27-20261018-bmaster-08-acceptance.md。
Outcome: `web/src/pages/workload/` 的成员负载、成员—任务关联与详情页面。
Done when: 能展示状态和计划时间；具备加载、空态、错误与无权限反馈；按确认的接口开发；后端未接入时仅标为开发态，不能宣称真实计数已验收；不改前端骨架。
Dependencies: #03 [FS], #04 [FS]
已解除：用户 2026-10-18 批准 #27 前端编码范围。只读展示；C11/C12 未确认部分不写死（不引入协作人、不新增权限动作）。

## #07 完成成员负载真实接口与挂载联调
Status: done
Evidence: 公共挂载已合入 main（PR #50）：src/routes.ts 注册 registerWorkloadRoutes、web/src/routes.tsx 增 /projects/:projectId/workload、ProjectLayout.tsx 左导航「成员负载」、docs/frontend-routes.md 路由行。真实链路：本地 migrate+seed 后 dev server + 浏览器实测数据来自真实后端（非 mock）。
Outcome: 可在应用中访问、使用真实后端的成员负载与详情链路。
Done when: 公共层（B 单写授权）完成必要后端路由、前端页面挂载及按需类型修改；前后端真实数据一致；记录修改与授权证据，无 mock 冒充正式接口。
Dependencies: #05 [FS], #06 [FS]
已解除：公共挂载已合入 main（PR #50）。

## #08 验收并交付成员负载
Status: done
Evidence: docs/ai-records/B/issue-27/evidence/B-I27-20261018-bmaster-08-acceptance.md（含 3 张截图）。AC1 成员计数与清单、AC2 详情状态/计划、AC3 与工作台 todo.total 同账号同授权对照一致、AC4 outsider 404 与「项目不存在」逐字一致、AC5 敏感排除（MEMBER 视角 member2 计数 2→1）、AC6 可见范围标签；DONE 计入且显示「已提交待验收」。未验证项：VIEWER 浏览器走查、>200 行截断浏览器验证、移动端、AI 子集（本票无 AI 端点，N/A）——均已登记，未冒充通过。
Outcome: GitHub #27 AC1–AC6 的证据包及供 GitHub #32/#33 消费的数据契约。
Done when: 本模块测试与 `npm run typecheck` 通过；浏览器验证负载图到成员详情；覆盖 PM/member/viewer/outsider、敏感计数、跨项目、列表计数一致、PM 全项目基数与可见范围基数区分、AI 子集不冒充全局，以及 `DONE` 不等于 `CLOSED` 且计入非 `CLOSED` 负载；与工作台按同账号同授权视角核对，外部未就绪项不得假称通过；记录全部 AC 结论及 PR 草稿/链接，不自动合并或关闭工单。
Dependencies: #07 [FS]

## #09 提前完成甘特模型、接口与验收设计
Status: done
Outcome: GitHub #26 的模型与接口设计、公共文件细化申请及测试场景，不含实现代码。
Evidence: docs/role-b-gantt-design.md 已交付模型/接口/逐 AC 设计，含 FS 原子并发拒环、真实开工与删除授权范围、日期异常及部分可见边界；独立 tester 复核通过。C10/关联模型等候选待确认，按批次软门；未实施迁移/代码或运行 AC。
Done when: 覆盖需求/任务/里程碑/FS 数据、Milestone 与 TaskDependency 字段约束索引、故事日期进度聚合、无任务/空值/部分可见边界；明确 C2 已确认口径（前置 `CLOSED`、自然日含起止、后继不早于前置结束次日）、真实开工路径、事件接口和权限待决项；设计供公共层（B 单写授权）小批次顺序合入，不擅自新增故事排期状态；B 本票仍负责甘特依赖与里程碑。C #32 不直接写 B 的派生结构，其已授权日期应用后，视图随原任务数据更新。
Dependencies: #02 [FS]

## #10 落实甘特开工授权与最小模型条件
Status: done
Evidence: 三模型（Milestone/TaskMilestone/TaskDependency）+ 迁移 20261018050000_add_gantt_models + test-support 清理顺序 + 快照测试表集合 11→14 + src/modules/gantt/types.ts 已合入 main（PR #51）。主控独立复核：typecheck exit 0、快照 37/37、全量 50 文件 1193 用例通过、/tmp 新鲜库 migrate deploy 成功（14 表）、node:sqlite 实测外键 ON DELETE 与索引名符合设计。
Outcome: GitHub #26 独立分支/worktree、用户认可的实施范围，以及首批模型/迁移/类型的公共层交付证据（B 单写授权）。
Done when: 复核最新 main；用户批准甘特单票方案；公共层按 B 单写授权提供首批读接口所需模型与迁移；只确认本阶段最小契约，C2 已确认结论可用于展示工作。`#27` 仅作优先级参考，**不作硬前置**。
Dependencies: #09 [FS]
已解除：用户 2026-10-18 授权「开启下一步开发任务」（#27 之后按优先级推进 #26）。本轮交付最小模型 + 迁移 + 类型；#12 写入/事件仍待 D 的公共事件端口，#13 真实开工守卫仍待旧入口写窗口。

## #11 实现甘特聚合读接口
Status: done
Evidence: src/modules/gantt/{service,plugin}.ts + gantt.test.ts（13 用例）已合入 main（PR #52）。GET /projects/:projectId/gantt；可见性全进查询层（隐藏任务不出现、仅关联隐藏任务的里程碑与含隐藏端点的依赖边不返回）；故事日期标 candidate-minmax、progress=null+unconfirmed（C10 未确认不编造）；截断用 LIMIT+1 判定。typecheck exit 0；模块 13/13；全量 51 文件 1206 用例通过。
Outcome: `src/modules/gantt/` 中需求、任务、里程碑和依赖的聚合数据接口。
Done when: 支持故事展开任务、任务计划时间、确认后的故事进度日期及里程碑汇总；查询层敏感过滤，依赖与汇总不泄漏无权对象；不跨业务 service；与任务视图按同授权视角一致；区分 PM 全项目汇总与 MEMBER / VIEWER 可见范围汇总。
Dependencies: #10 [FS]
已解除：读路径按已确认口径实现（C6 基础汇总 + 可见范围）；故事进度按 C10 未确认处理为 null+unconfirmed，不冒充已批准公式。

## #12 实现里程碑与 FS 依赖写操作及事件
Status: done
Note: **事件发布未接线**（D 的 #37 未交付，项目负责人 2026-10-19 授权「事件后接」）：仅在 `src/modules/gantt/types.ts` 留 `GanttEventPort` 占位与 5 处写点事件名注释，无 no-op 实现、无可选死参。
Outcome: 里程碑与 FS 依赖写接口（5 个端点）、业务校验（仅 FS / 拒自依赖 / 拒跨项目 / 拒重复边 / 拒 FS 环）与新增 `gantt.write`（PM-only）权限；事件端口留占位待 D。
Outcome: 已授权的里程碑/依赖写接口、业务校验与本域事件发布。
Done when: 仅接受 FS；拒绝自依赖、环与跨项目依赖；完成任务里程碑及汇总；按确认的权限判定与公共事件接口处理写入及事件，不直接调用 D 域业务 service，不在敏感载荷中带未授权标题内容。
Evidence: PR #68 → main（`feat/gantt-write-path`：`c8e1366` 实现 + `80d9daf` 错误码改契约表内 + `2acb726` 按独立评审修 M1/L1/L2/L4/L7）。改动 6 文件（`shared/types.ts` +1 Action、`authz/permissions.ts` +`WRITE_ACTIONS` 一项、`gantt/{types,write,plugin}.ts`、新建 `gantt-write.test.ts`）。验证：`npm run typecheck` exit 0；`npx vitest run src/modules/gantt/` 2 文件 / 45 用例；全量 `npm test` 59 文件 / 1378 用例全绿（子 agent `b-gantt-verify` 独立复跑确认）；并发互反建边 10/10 稳定 `201+409`、库中恒 1 条边；自环/2/3/4 节点长链环均 409；跨项目与不存在响应逐字相等。独立评审 `b-gantt-review`：可合入（无代码级阻断），M1 已修。决策：`DECISIONS.md` `permissions.gantt-write`。
Dependencies: #11 [FS]
Note: **事件接入待 D 的 #37**（本批只留 `GanttEventPort` 占位、未接线）；写操作授权（`gantt.write`）与模型 / 迁移已交付。

## #13 落实真实任务入口的 FS 放行校验
Status: not started
Outcome: 按 C2 批准规则执行、不能绕过的任务开工约束。
Done when: 按已确认 C2 实施：前置必须 `CLOSED`、`DONE` 不算，后继建议开始不早于前置计划结束次日，自然日含起止；明确真实任务开工路径的 owner 与实施范围；必要旧模块授权留痕；验证直接调用真实入口也拒绝未放行的后置开工，不仅依赖甘特按钮禁用，不新增镜像任务写路径；该甘特旧模块写入口仍按 B 既有授权 / 既定流程，不由 C 的 #32 写窗口例外覆盖。
Dependencies: #12 [FS]
Blocker: main 398aa76 已有六态/CLOSED；仍缺 TaskDependency 与真实开工入口的 FS 守卫，且需该旧入口具体授权/写窗口。C2 结论已确认，C #32 日期应用许可不覆盖此状态守卫。

## #14 实现甘特时间轴页面
Status: done
Evidence: web/src/pages/gantt/*（7 文件）已合入 main（PR #52）：纯 CSS 统一时间轴、故事展开、里程碑、依赖区（unavailable 显式提示）、候选口径与未确认进度标注、加载/空/错误/无权限态。挂载 src/routes.ts + web/src/routes.tsx + 左导航「甘特图」+ docs/frontend-routes.md。浏览器走查：PM 2/5/3/3 + 故事展开 + 3 条 FS 边；MEMBER 4 任务/2 里程碑/2 边（隐藏对象不出现）。证据 docs/ai-records/B/issue-26/evidence/B-I26-20261018-bmaster-04-read-acceptance.md。
Outcome: `web/src/pages/gantt/` 中需求/任务/里程碑统一视图。
Done when: 支持故事展开、计划时间、汇总进度、里程碑和 FS 关系展示，具备空态与错误反馈；不做复杂拖拽、自动调度或其他依赖类型；按已确认 C2 展示，未落地的状态与执行入口不冒充完成。
Dependencies: #11 [FS]

## #15 验收并交付甘特图
Status: not started
Outcome: GitHub #26 AC1–AC7 证据包及交付 C 域 GitHub #32 的数据契约。
Done when: 公共层（B 单写授权）完成必要路由与页面挂载；本模块测试与 `npm run typecheck` 通过；浏览器验证展开、汇总、里程碑；覆盖 FS、环、跨项目、敏感过滤及真实任务开工路径；C2 已确认口径留证；事件联调保留真实证据，不能只用模拟替代；未决或外部不可验证项不勾完成，不建立对 GitHub #32 的反向依赖。
Dependencies: #12 [FS], #13 [FS], #14 [FS]
Blocker: 部分解除：路由与页面挂载已完成（PR #52）。**仍缺**：#12 写路径（里程碑/依赖写入、FS 环/自依赖/跨项目校验、事件）待 D 的 #37 公共事件端口；#13 真实开工守卫待旧入口写窗口。故本任务不勾 AC、不标完成。

## #16 提前完成故事看板方案与授权细化
Status: done
Outcome: GitHub #25 只读看板、状态写路径、审计及事件的单票设计和具体文件授权申请。
Evidence: docs/role-b-board-design.md 已交付正式三列、原 PATCH 唯一路径、具体 requirement 授权草稿、最小状态审计/事件及跨视图方案；独立 tester 复核通过，引用已修正，补明 C12 不扩项。仅设计交审，未获旧文件许可/冻结接口/运行 AC。
Done when: 固定 DRAFT/PLANNING/DONE 三列；明确复用现有故事 PATCH，不新建镜像写路径；列出 requirement 具体修改文件/范围、C11/C12/C13、写入审计事件一致性待决项，以及地图/详情同步方案，不含编码。
Dependencies: #02 [FS]

## #17 实现故事只读看板
Status: done
Evidence: src/modules/board/{types,service,plugin}.ts + board.test.ts（10 用例）与 web/src/pages/board/*（5 文件）已合入 main（PR #53）。GET /projects/:projectId/board 三列固定顺序；count 与 findMany 共用同一 where（visibilityScope 进查询层）；排序 createdAt asc, id asc；每列 ≤200 行 + truncated；卡片 6 字段不含 isSensitive；空列不合并。挂载 src/routes.ts + web/src/routes.tsx + 左导航「故事看板」+ docs/frontend-routes.md。typecheck exit 0；模块 10/10；全量 52 文件 1216 用例通过。浏览器走查：PM 2/2/1；MEMBER 敏感隐藏 1/2/0 且空列显示空态；被指名成员 2/2/0；outsider 404 与「项目不存在」逐字一致。证据 docs/ai-records/B/issue-25/evidence/B-I25-20261018-bmaster-05-read-acceptance.md。
Outcome: `src/modules/board/` 按需聚合读与 `web/src/pages/board/` 的状态列、卡片及计数。
Done when: 用户批准 GitHub #25 方案及只读编码范围；从最新 main 建独立分支；正式故事三状态展示正确；查询层敏感过滤，计数与列表一致；不复制 requirement service，不改骨架。`#26` 仅作优先级参考，**不作硬前置**。
Dependencies: #16 [FS]
已解除：用户 2026-10-18 批准 #25 只读看板（#17）编码范围。本轮只做只读三列（不含状态写入/审计，写路径属 #18，待 C11/C13）。

## #18 扩展获授权的故事状态写路径
Status: done
Note: C11 裁定**不扩权**（故事状态写入仅 PM，`permissions.story-status-write`）；C13 授权最小改动（`legacy.requirement-status-audit-authorization`）；**事件未接线**（D 的 `#37` 未交付，仅 `RequirementEventPort` 类型占位 + 写点注释，无 no-op 实现）。
Outcome: 既有故事 PATCH 的状态操作授权、who/when/before/after 审计与状态变更事件。
Evidence: PR #75 → main `6638004`（`feat/story-status-audit`，8 文件 / +606−28）：`updateUserStory` 增 `actorUserId`、**仅状态真实变化**时同事务写 `AuditLog`（`action=story.status`，before/after JSON）、空补丁仍只读、非状态补丁仍单语句；`plugin.ts` **恰好 1 行**；新增 11 例审计/权限测试；窗口登记 #24 评论 6263265008 + 6263277635，通知模块原负责人 #20 评论 6263266208。验证：`npm run typecheck` exit 0；`src/modules/requirement/` 14 文件 / 559 例；全量 **60 文件 / 1395 例** 全绿；`build:web` exit 0；**浏览器走查**（PM 改状态 → 抓包 body 仅 `{"status":"PLANNING"}` → 重拉 → 移列；**DB 审计行核验** before/after/actor/projectId 正确且仅 1 条；MEMBER 0 个写控件 + 直连 403）。
Done when: C11 成员操作及 Action 规则已书面确认；C13 对具体文件范围已授权；复用 `can()`；按确认的一致性策略完成真实写入、审计、事件处理；公共文件由 B 单写、旧业务文件须原 owner 具体授权后改，不绕过 `requirement.write`，不创建替代写入口。
Dependencies: #17 [FS]
## #19 接入看板状态操作与跨视图同步
Status: done
Note: 看板写入口已实现（PM-only 三态下拉，写后重拉 board 作唯一真相）；**跨视图一致**已验证（故事地图 / 详情 / 看板三处读数一致）；**事件驱动的实时同步未接线**（待 D 的 `#37`），当前依赖各视图自然刷新。
Outcome: 看板调用既有 PATCH 调整状态，并在重新拉取后与故事地图、详情及统计一致。
Evidence: PR #75 → main `6638004`：`web/src/pages/board/**`（卡片三态选择、非 PM 只读 + 页顶提示、错误就近、失败不改本地态）。验证：PM 改状态后 **故事地图（`GET /projects/:projectId/goals`）两故事均 PLANNING**、**故事详情（端点 20）PLANNING**、**看板 PLANNING 列 2 张** —— 同账号同授权下三视图一致；MEMBER 直连 `PATCH /stories/:storyId` → 403（服务端权威）。
Done when: 公共层（B 单写授权）完成必要挂载；交互按已确认角色授权展示，服务端仍判权；成功与失败反馈正确；同账号同授权视角下多视图一致；涉及他人业务页面文件须先获具体授权，不擅自修改。
Dependencies: #18 [FS]
## #20 验收并交付故事看板
Status: not started
Outcome: GitHub #25 AC1–AC6 的模块、浏览器与审计事件证据包。
Done when: 本模块测试与 `npm run typecheck` 通过；浏览器验证看板改状态后地图/详情同步；覆盖 PM/member/viewer/outsider、跨项目、越权和敏感计数；审计及事件来自真实状态写路径；逐条 AC 留证，不自动合并或关闭工单。
Dependencies: #19 [FS]

## #21 持续跟踪 B 域契约、授权与跨域交接
Status: done
Evidence: docs/role-b-contract-register.md §7 已追加 2026-10-18 登记：A #30/#33 批复与落地、验证证据（typecheck exit 0 / vitest 49 文件 1182 测试全绿）、发布与文档状态（PR #42–#47、#39 已关闭）、未决项确认人/影响/移交（C 对 #43/#46 的核对、D 的 #31/#37 提案、A 的 US-10 分支与挂载登记、#25/#26 授权、C11/C12、C10/C5）。前文历史保留不改写。
Outcome: 持续更新的 B 域契约 / 公共文件授权台账，以及最终的已确认、待确认、后续处理清单。
Done when: B 域所用规则与授权均可追溯（已交付部分逐项登记，未交付部分明确标待后续）；未决项明确确认人、影响和移交对象；C2/C3/C6 全项目口径与 #32 限定口径分别登记；C5 等跨域事项有状态但不代确认；其他角色未完成确认时不宣称 GitHub #24 整票完成。
Dependencies: #03 [SS]

## #22 汇总 B 域最终交付与一致性证据
Status: not started
Outcome: 三票 AC 总表、同账号同授权视角的一致性证据、契约授权索引及未决交接清单。
Done when: 负载/工作台、甘特/任务、看板/地图/详情按已具备的真实链路核对；外部未就绪链路明确列为未完成，不冒充全局回归通过；记录每票分支、PR 草稿/链接、测试和浏览器证据；不扩大到全仓测试，不自动关闭旧工单、合并 PR 或替他域签字。
Dependencies: #08 [FS], #15 [FS], #20 [FS], #21 [FS]

---

## 公共集成任务（新增，2026-10-17）

本地 `#23–#41` 不是 GitHub 工单编号。`#23` 文档同步、`#24` 提案接收在原 2 人日统筹项内核算；仅后续 D 能力公共实现单列净新增估算。各能力独立，下面的编号只是建议优先级；不要求四模块、两种端口或全部迁移先齐备。未列依赖的外部交付按本任务 Blocker 独立解除，不以其他能力未完成阻塞本能力。

## #23 同步本轮口径与工单索引（第 0 步）
Status: done
Outcome: 独立文档 PR，纳入确认稿和原样 DECISIONS.md，同步交接、B 计划/工单、相关契约与索引；文档链接可访问后同步 GitHub #24/#21 及受影响 D 工单说明。
Evidence: [文档 PR #39（待合并）](https://github.com/githubleelee/AIManagement/pull/39)；[#24 补充确认](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6232875888)。已更新 GitHub #21/#24/#31/#34/#36/#37 的说明并保留原文，工单仍 open、标签不变；41 tasks / 48 dependencies 校验通过，18 条索引全部非正文元数据与基线一致，独立测试复核与审查通过。
Note: 以上为**历史第 0 步**记录，任务数/依赖数系当时口径；远端 PR #39 仍 open 未合并，#24 补充确认仍含「A 域 C3 待统一」「权限排除」旧口径，**不含本轮 C 12 项确认及对应 DECISIONS 追加条目**；本次 C 决定同步由 #42 承担，尚未发布。
Done when: 新授权、权限排除、业务文件具体授权、优先级非硬依赖、AI/AC13 例外、四类证据、D 通知时区与 A 域 C3 待统一均已准确登记；工单索引全部非正文元数据不变；使用 to-tasks 技能目录中的 `scripts/check-tasks.mjs` 全文校验通过（非仓库脚本）；独立 PR 与 #24 补充确认有真实链接，明确 PR 待合并，不提交无关材料、不改标签、不合并或关闭工单。
Dependencies: none

## #24 按能力接收最小 AI / 事件端口提案
Status: not started
Outcome: D 的 AI 与事件提案分别留存签名、输入输出、实现工厂、注入和最小测试示例的接收结论。
Done when: 两类提案分别记录已确认/待补充、证据链接与后续分批字段申请；任一提案先就绪即可独立推进其已授权公共实现，不要求本任务整体完成，也不要求字段迁移或四模块一次交齐；不代 D 写业务实现。
Dependencies: none
Blocker: 待 D 提交最小 AI / 事件端口提案；两类独立接收，不以另一类缺件阻塞已就绪部分。

## #25 落地事件 schema 与迁移
Status: not started
Outcome: B 单写的最小事件存储模型、索引与顺序迁移。
Done when: 依据 D 本能力字段提案完成幂等/查询所需最小数据结构，核对现有数据影响和迁移验证；不等 AI/附件/通知模型，不写入未决业务规则。
Dependencies: none
Blocker: 待 D 的事件字段/迁移提案及本批编码授权。

## #26 组装事件运行时与必要路由
Status: not started
Outcome: `src/app.ts` 构造 D 的独立事件实现并注入端口；有明确查询路由需求时由 `src/routes.ts` 集中注册。
Done when: 生命周期/依赖注入和错误处理有证据，无跨业务 service 调用；所需事件迁移可用；不扩展业务生产者，不代写 A/C 逻辑；不等待其他能力。
Dependencies: #28 [FS], #25 [FF]
Blocker: 待 D 事件实现工厂、注册/生命周期补丁与本批编码授权。

## #27 验证事件公共集成
Status: not started
Outcome: 事件公共层的定向集成证据和未完成验收项清单。
Done when: 相关模块测试、typecheck 与真实存储/订阅/幂等接入检查通过；模拟生产者与真实业务生产者明确分开；真实生产方未就绪则登记未验证，不声称业务端到端完成；真实外部 AI API 对本能力不适用，不作为本任务阻塞。
Dependencies: #25 [FS], #26 [FS]

## #28 实现已确认的最小公共事件端口
Status: not started
Outcome: `src/shared/` 的事件信封、发布/订阅端口与必要校验。
Done when: 仅依据已接收的事件提案实现；记录事件名、项目/操作者/对象引用、发生时间、载荷、幂等语义与敏感边界；独立可编译并提供给各域，不等待 AI 提案或数据库迁移。
Dependencies: none
Blocker: 待 D 最小事件提案确认与本批编码授权；不要求 #24 两类提案全部接收完成。

## #29 实现已确认的最小公共 AI 端口
Status: not started
Outcome: `src/shared/` 的供应商无关 AI 输入/建议输出/错误与显式运行模式端口。
Done when: 独立可编译；不绑定 SDK，不含 key，区分本地桩与真实 API；遵守演示数据和敏感对象边界；无需等待事件、AI 存储或供应商选型；供 C #32 复用。
Dependencies: none
Blocker: 待 D 最小 AI 提案确认与本批编码授权；不要求 #24 两类提案全部接收完成。

## #30 落地 AI 建议记录 schema 与迁移
Status: not started
Outcome: B 单写的 AI 建议/确认/审计记录最小模型与迁移。
Done when: 按 D 字段提案覆盖建议、审核与最终应用追溯需求，核对索引和历史数据影响；不代替 PM 确认建议，不自行扩张写权限。
Dependencies: none
Blocker: 待 D 本能力字段/迁移提案与本批编码授权。

## #31 组装本地 AI 桩与路由
Status: not started
Outcome: app 中显式构造/注入 D 本地桩及 AI 插件，集中注册已确认路由。
Done when: 所需模型可用，开发模式可识别，失败不静默退回桩；前端无 key，后续 API 配置仅后端 env；不实现供应商 adapter，不把桩记录为真实 API 接入。
Dependencies: #29 [FS], #30 [FF]
Blocker: 待 D 独立实现/插件与组装补丁、相关最小端点契约及本批编码授权。

## #32 最小挂载需求详情 AI 组件
Status: not started
Outcome: `RequirementDetailPage.tsx` 接入 D 独立 AI 组件与必要路由文档说明。
Done when: 仅增加已确认 Props/上下文与刷新回调，保留原业务行为；D 负责组件和应用逻辑；后端未就绪的模拟页面标开发态，不用作最终验收；不等其他组件。
Dependencies: none
Blocker: 待 D AI 组件/Props/挂载补丁和本批编码授权。

## #33 验证 AI 公共接入
Status: not started
Outcome: 本地桩链路、模块测试、真实 API 与真实业务联调的分栏证据。
Done when: 相关测试/typecheck 和本地桩浏览器链路通过；真实 API 未接时明确未验证而非阻塞所有本地验证；不得宣称原 AC13 或真实模型验收通过；不替 D 完成本域 AC。
Dependencies: #30 [FS], #31 [FS], #32 [FS]

## #34 落地附件 schema 与迁移
Status: not started
Outcome: B 单写的附件元数据模型、索引及迁移。
Done when: D 本能力字段/删除关联策略明确；迁移顺序和数据影响已验证；下载/清理规则遵循确认稿，旧任务后端扩展另走具体授权。
Dependencies: none
Blocker: 待 D 附件字段/迁移提案与本批编码授权。

## #35 接入附件路由及上传目录忽略
Status: not started
Outcome: 附件插件集中注册，项目根 `/var/uploads/` 纳入 `.gitignore`，按需完成 app 依赖组装。
Done when: 所需迁移可用；服务端策略按白名单、扩展名+MIME、10,000,000 B 执行；上传目录不公开静态暴露；任务删除失败不先删文件；不越权修改旧任务服务。
Dependencies: #34 [FF]
Blocker: 待 D 附件插件/注册补丁与本批编码授权；本任务不代写 D 上传/下载/清理实现。

## #36 最小挂载现有任务区附件组件
Status: not started
Outcome: `TaskSection.tsx` 嵌入 D 附件组件及必要路由文档更新。
Done when: 仅传入已确认任务上下文/刷新回调，不另造任务详情页，不改任务状态权限；组件可独立接入开发态，正式联调另留证据。
Dependencies: none
Blocker: 待 D 附件组件/Props/挂载补丁与本批编码授权。

## #37 验证附件公共接入
Status: not started
Outcome: 附件公共挂载、注册、存储边界的定向测试与浏览器证据。
Done when: 相关测试/typecheck 与真实上传/列表/下载链路通过；校验体积、类型、敏感/非成员隔离、忽略规则和失败清理；仍需旧模块授权的删除链路明确未验证，不虚构端到端完成。
Dependencies: #34 [FS], #35 [FS], #36 [FS]

## #38 落地通知 schema 与迁移
Status: not started
Outcome: B 单写的通知记录、接收者/去重等必要模型与迁移。
Done when: 按 D 字段提案实现索引和约束并验证迁移；保留事件发生/条件成立时间，不能从消费时间重新计时；遵守全项目 Asia/Shanghai 口径，不自行决定尚未确认的六状态转换。
Dependencies: none
Blocker: 待 D 通知字段/迁移提案与本批编码授权。

## #39 组装通知订阅、定时生命周期与路由
Status: not started
Outcome: app 注入事件端口，注册 D 通知实现/生命周期与已确认列表/已读路由。
Done when: 所需模型可用，启停可控；D 通知采用已确认的**全项目** `Asia/Shanghai` 时区与 `planEnd` 次日 00:00 未 `CLOSED` 即逾期口径；其他六状态转换未一并批准，不接受双最终口径；不代写业务生产事件。
Dependencies: #28 [FS], #38 [FF]
Blocker: 待 D 通知实现/生命周期/注册补丁与本批编码授权。

## #40 最小挂载顶栏通知入口
Status: not started
Outcome: `AppLayout.tsx` 接入 D 独立通知入口与必要路由文档说明。
Done when: 仅按组件 Props 注入上下文，不重写公共布局或通知业务；在线刷新和错误态可验证；不等待 AI/附件组件全部完成。
Dependencies: none
Blocker: 待 D 通知组件/Props/挂载补丁与本批编码授权。

## #41 验证通知公共接入
Status: not started
Outcome: 通知基础真实接入、模块模拟与六类生产方联调的分栏证据。
Done when: 相关测试/typecheck 与基础订阅/入库/查询/页面链路通过；≤60 秒从业务成功或条件成立计量；模拟生产者不替代六类真实生产方联调；生产方未齐或其他六状态转换未确认时相关最终 AC 不通过，不阻塞已明确基础链路的验证记录。
Dependencies: #26 [FS], #38 [FS], #39 [FS], #40 [FS]

---

## C #32 公共集成任务（本轮修订）

本地 `#42–#50` 不是 GitHub 工单编号。这些是 B 侧为 C `#32` 提供的公共集成任务：C 负责业务 / 整份原子写 / 快照 / 幂等，B 只落公共声明 / 模型 / 权限 / 组装 / 挂载。**依赖只按真实接口 / 验收关系登记，不用优先级造边。** 历史修订时本节仅保存计划；随后本轮获准执行 `#43/#46` 的本地提案，其余按各项 Status / Evidence 为准。追加授权仅允许准备 `#03/#42` 本地待发布文本，不发布、不编码；当前进度见各项证据。

## #42 同步 C #32 新确认到文档与工单说明
Status: done
Evidence: 已完成并合入 main：docs/team-handoff.md、docs/handoff-issues.json、docs/sprint1-spec-interface-contract.md、docs/frontend-routes.md 的 C2/C3/C6 + 权限例外 + task 窗口 + #30 挂载例外补丁（PR #42/#47）；#24 集中同步评论 issuecomment-6245135447 与 #32 核对请求 issuecomment-6245135807 已发布；DECISIONS.md 20 条入库（含被误删后恢复的 permissions.risk-and-project-close）。
Outcome: 把本地 C 确认稿与 `DECISIONS.md` 追加条目同步到 `docs/team-handoff.md`、#24、#32 及相关工单索引说明的更新草案与发布记录；覆盖全项目 C2/C3/C6、#32 PM-only 权限例外、`task/` 限范围授权，并保留历史与变更来源。
Evidence: docs/role-b-publication-package.md §4.0/§5 已记录发布与补丁明细。2026-10-18：① 发布 #24 集中同步 https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6245135447 与 #32 核对请求 #issuecomment-6245135807；② 经 PR #42（未合并）使 DECISIONS.md 与 #43/#46 DRAFT 可访问；③ 用户授权“在分支中落地”后，team-handoff.md、handoff-issues.json、sprint1-spec-interface-contract.md、frontend-routes.md 的同步补丁已按“保留原文+追加变更说明”提交到该分支（含并入 PR #39 文档更新，提交 ea81b3e）；④ #31/#32/#33 票面 C4 旧句已追加更正块（保留原文），三票仍 open、标签未变。
Done when: 明确标注「本地已存在 / 远端未发布」；更新草案区分全项目口径与 #32 限定口径，登记权限排除旧条目与 `supersedes` 关系；发布后记录链接；不把远端 PR #39 或 #32 正文描述为已同步；不批量改标签、不合并 PR、不替其他角色确认；对外发布需另行授权。
Dependencies: none
已解除：交接正文补丁已合入 main（PR #42/#45/#47），#24/#32 同步评论已发布，PR #39 已关闭。

## #43 拟定并冻结 C #32 所需的最小只读数据契约
Status: done
Outcome: #32 可消费的 #26 / #27 最小只读契约与样例，含输入范围 / snapshot / 有效权限语义候选、PM 全项目基数与 MEMBER/VIEWER 可见范围基数、AI 参与子集说明。
Evidence: C 的书面核对已到（#32 评论 6247293014），B 逐项答复全部接受（#32 评论 6260611783）；`docs/role-b-scheduling-data-contract.md` 由 DRAFT **冻结为 v1.0**（PR #66 → main `cafce79`，含 §Z 冻结变更记录：7 问落点、受众拆独立 DTO 出口、排敏覆盖关联故事、`asOf` 为一致读取标记、可用性两态 + 截断另列元数据、基线 398aa76→9c380ca）。

Done when: 覆盖成员负载、任务计划日期、FS 依赖、里程碑的最小字段与合法读取方式；明确敏感过滤在查询层、AI 子集重算、不得冒充全局基数；只读消费不直接改 #26/#27 派生结构，已授权日期应用由统一受控路径承担且应用后随原任务数据更新；契约文本与 C 核对后冻结；与本地 #04/#09 双向协调，但可先完成已明确的最小字段，不要求它们全部设计完成或 GitHub #26/#27 整体验收；不在本任务发布远端说明或实施数据接口。
Dependencies: none

## #44 落实 #32 最小 PM-only 权限
Status: not started
Outcome: `src/modules/authz/permissions.ts` 与共享 `Action` / 对象 scope 的 #32 最小改动，统一走 `can()`/`visibilityScope()`。
Done when: 仅覆盖 #32 生成 / 查看 / 采纳 / 修改后采纳 / 拒绝 / 审计**全部 PM-only**；未登录 401、外项目或不可见 404、可见无操作权 403；每次请求与重试重新鉴权，**撤权重试不可读历史结果**；**其他既有 `Action` 权限不变**；不把整个 authz 模块或其他票权限转给 B；如该文件存在其他写者，先登记排他窗口；具体 `Action` 命名待方案确认。
Dependencies: none
Blocker: 本批编码授权与 `Action`/scope 命名方案确认；#32 权限范围已由项目负责人确认，但不代表 C11/C12。

## #45 落地共享 AI 建议 / 处置记录 schema 与迁移（#32 + #33 复用）
Status: not started
Outcome: B 单写的**共享**「建议 + 处置」存储最小模型、索引与顺序迁移（ROLE-C #32 与 ROLE-A #33 复用同一套，不各建表）。
Done when: 字段以 D 的 #31 字段提案为源、并与 #43 数据契约及 A 的 #33 字段需求合并成一份后再落表（`DECISIONS.md` `ai.suggestion-store-shared`）；覆盖场景 / 分析类型、输入范围与 snapshot / fingerprint、生成时间、模型或桩标识与实际可得版本、建议内容、处置结论（采纳 / 修改后采纳 / 拒绝）、处置人、理由、最终应用结果；快照有效权限与唯一处置 / 冲突所需字段以 #46 提案为准；不用 `AuditLog` 承载建议；处置动作按 `permissions.ai-suggestion-disposal` 与 #32 共用**同一个** Action（#44 一并加入 `can()`）；不替 A / C 实现业务、不擅自扩张写权限；核对历史数据与迁移验证。
Dependencies: #46 [FS]
Blocker: 待 D 的 #31 字段 / 端口提案 + A 的 #33 字段需求汇总，以及 #46 事务 / 幂等 / 快照字段接口明确与本批编码授权。

## #46 确认公共读 / 写端口与事务 / 鉴权协议
Status: done
Outcome: #32 公共读 / 写端口、事务边界、事务内鉴权与任务规则复用协议，以及幂等 / 冲突 / 事件提交语义的书面提案与确认结论。
Evidence: C 的 12 问书面核对已到并逐项接受（#32 评论 6260611783）；`docs/role-b-scheduling-transaction-proposal.md` 由 DRAFT **冻结为 v1.0**（PR #66 → main `cafce79`）。其中 C2 窄 `Pick` 已先期落地（`AuthzDb`，PR #57）；C6 采纳 C 的独立处置请求标识取代 B 的纯摘要候选；C4 唯一处置约束 + CAS、C9 失败证据分流、C10「重放先于快照复核」均入册；§5.5 动作命名与 §8 事件签名仍待 D 提案（不阻塞本冻结）。

Done when: 明确 `createAuthorization` / 内部 helper / `assertTaskAssignment` 如何支持事务内鉴权与规则复用（具体 `Pick` / `union` 签名待提案核对，**B 不擅定**）；snapshot 数据定义与有效权限语义；一份建议唯一处置、相同请求重试返回已有、异内容 / 并发冲突、**成功重放不误判自身日期更新为过期**、**先鉴权后重放**、**事件失败重试不重复改计划**；不擅定幂等键 / hash / `outbox` / URL；读写/事务协议与 C 核对，涉及公共 AI/事件签名的部分再按对应已就绪提案与 D 核对；不以本地 #24 两类端口提案全部接收作为门槛。协议可与 #43 数据契约并行设计，最终收口对齐已冻结字段，不要求先交运行时实现。
Dependencies: #43 [FF]

## #47 组装公共端口与 app / routes 注入
Status: not started
Outcome: 落实 #32 必要共享端口声明，`src/app.ts` 注入 C 域实现，`src/routes.ts` 集中注册已确认路由。
Done when: 按 #46 已确认协议实现，不跨业务 service；受控确认路径的最终鉴权/约束复核在同一事务，允许事务前入口检查但不能仅靠它；模型迁移及公共 AI 端口最终可用。C 本域实现经约定端口接入，B 不代写业务或生产事件；不等待 D 的其他模块。
Dependencies: #46 [FS], #45 [FF], #29 [FF]
Blocker: 待 C 独立实现/注册与注入补丁及本批编码授权；AI 签名按已接收 AI 提案对齐，不等待事件或其他 D 能力。

## #48 登记 task 写窗口并完成现写者交接
Status: done
Outcome: B 登记的 `src/modules/task/routes.ts`、`rules.ts` 具体文件与范围清单，以及 A / 当前写者写锁状态与实际交接记录。
Evidence: 写窗口已登记并对 C 开放（#32 评论 6260611783 第三节四要素）：写者 **ROLE-C**；可交接基线 `9c380ca`；文件范围 `src/modules/task/rules.ts` + `src/modules/task/routes.ts` + C 自有目录测试（不新增 `task/service.ts`、不改其他旧模块）；窗口自评论起开放、至其 PR 合入或双方书面关闭。核对：A 的在途 PR（#55/#63/#64/#65）均已合入，B 在窗口期内不改这两个文件；C 尚未推分支（窗口空闲未使用）。
Done when: 改动清单先经 B 登记；核对 `task/` 当前写锁**不得假定空闲**；若 A 持锁，先等其当前小任务合入再交接；C 仅在登记范围内最小修改，**复用原有项目隔离 / 有效负责人验收人 / 日期与敏感可见性等基础校验**；**不把 #32 独有 TODO-only / 应用规则强加给所有旧手工 PATCH 或其他业务**；公共层仍 B 单写，不另建旁路、不调 task service。
Dependencies: none
Note: 交接核对已完成：C 尚未推分支（窗口空闲未使用）；B 在窗口期内不改 `task/rules.ts`、`task/routes.ts`，不假定写锁空闲；不重复申请已确认的 #32 限范围许可。

## #49 挂载 C 前端排期路由与导航
Status: not started
Outcome: `web/src/pages/scheduling` 路由、导航入口与 `docs/frontend-routes.md` 更新。
Done when: 路由 / 导航由 B 统一挂载，URL 与 C 在前端路由清单确认；不把 D 的三个入口文件当作 C 的修改许可；加载 / 空态 / 错误 / 无权限反馈可验证；不代写 C 业务页面逻辑。
Dependencies: none
Blocker: 待 URL 确认、C 组件 Props / 挂载点就绪与本批编码授权。

## #50 验证 C #32 公共接入集成
Status: not started
Outcome: #32 公共权限、模型、端口与挂载的定向集成证据及未完成项清单。
Done when: 覆盖 PM-only 生成 / 查看 / 采纳 / 修改后采纳 / 拒绝 / 审计、外项目 404、撤权重试不可读历史、其他既有 `Action` 不变；硬阻断 vs 仅提示；整份事务原子与失败回滚；幂等重放（含成功重放不误判自身日期更新、先鉴权后重放、异 payload / 并发冲突）、事件失败重试不重复改计划；本地桩与真实 API、真实业务联调分栏留证；未就绪项明确未验证，不以 fixture 冒充最终 AC；不宣称原 AC13。
Dependencies: #44 [FS], #47 [FS], #48 [FS], #49 [FS]
Blocker: 待 C 本域实现及本批公共接入的前置交付/真实任务数据就绪；外部 AI API 未接不阻塞本地桩与模块验证。真实模型/生产方联调另列未验证，不以 fixture 冒充相关最终 AC；不宣称原 AC13。

---

---

## #51 落地 risk.flow 鉴权与 authz 窄签名（#21 分派批次）
Status: done
Outcome: `ObjectRef` 增 `risk` 类型、`permissions.ts` 增 `risk.flow` 对象关系判定、`AuthzDb` 窄 `Pick`（root/tx 兼容，C 的签名请求同批），并保持错误信封 I-3 不变。
Evidence: PR #57 → main `2782c47`。src/shared/types.ts（Action `risk.flow`、ObjectRef `risk`）；src/modules/authz/permissions.ts（导出 AuthzDb；createAuthorization/loadTarget/roleIn 改用窄类型；loadTarget 增 case 'risk'；第 4.6 条判定）；test/authz-risk-flow.test.ts 8 例（PM / MEMBER 本人 / MEMBER 他人 / VIEWER（被指为负责人）/ outsider / 不存在 riskId / 跨项目真实归属 404 / 事务客户端内 can()）。验证：npm run typecheck exit 0；8/8；全量 npm test 53 文件 / 1224 用例通过（基线 52/1216）。登记：#24 评论 6249399218 + 台账 §8；通知 A：#30 评论 6249510864。未改错误信封（contract.close-blocking-response）、未动 A/C/D 业务模块、task/rules.ts 由 C 自行放宽。
Done when: 依 `DECISIONS.md` `permissions.risk-flow-guard` 落地并验证；与 C 的 authz 签名请求合并为同一批；不改错误信封；测试覆盖五类角色；完成后通知 A。
Dependencies: none

---

---

## #52 评审 ROLE-A 的 PR #55（US-10）并落地裁定
Status: done
Outcome: B 侧边界与契约核对全部通过；两份独立评审（鉴权 / 口径与测试）+ 独立实跑交叉验证；裁定写入 `DECISIONS.md` 并下发 A 的合并前待办。
Evidence: PR #55 评审评论 6250626777（含 H1「改绑负责人再流转」两步绕过、H2「10/25pp 浮点边界错分」两个阻断项与分级发现）；实跑证据 56 files / 1282 passed（正文 53/1250 过期）；裁定 PR #61 → main `a2d67a1`（`analytics.dashboard-window-basis`、`permissions.risk-ownership-change`）；下发 #55 评论 6250738153 与 #30 评论 6250740833；#30 票面追加口径更新块；追认 `docs/frontend-routes.md` 3 行（其中 acceptance 行系 B 在 `ea81b3e` 误删）并接管维护。
Done when: 给出可执行结论（含阻断项与复现）、裁定落地并通知 A；不改 A/C/D 业务模块、不改错误信封。
Dependencies: none

---

---

## #53 按 C 核对冻结 #32 契约 v1.0 + 采纳跨票依赖验收三分法
Status: done
Outcome: C 的 7 + 12 项核对全部答复并接受；两份 #32 契约由 DRAFT 冻结为 v1.0（含 §Z 冻结变更记录）；A 提议的「跨票依赖验收三分法」经 B 作为技术负责人确认后落入 `docs/team-handoff.md` §7.1 与 `DECISIONS.md`；`task/` 写窗口对 C 开放。
Evidence: PR #66 → main `cafce79`（#43/#46 冻结 v1.0）；PR #67 → main `84ea318`（§7.1 三分法 + `deps.sibling-ticket-ac-layering`，含 #28/#34 互锁 AC 口径变更）；#32 评论 6260611783（逐项答复 + 写窗口四要素）与 6260626307（就绪声明）；#24 评论 6260639193。另：独立验证 A 的 H1/H2 修复（全量 58 files / 1346 passed、typecheck exit 0，子 agent `main-verify-post-a`）。
Done when: C 的书面核对得到逐项答复、契约状态明确（冻结或列明未决）、写窗口四要素给出、跨票 AC 写法规则落地并通知相关角色。
Dependencies: none

---

---

## #54 甘特写侧前端 UI（里程碑 / FS 依赖可视入口）
Status: done
Outcome: 甘特页在 **PM** 下提供里程碑新建 / 行内编辑 / 删除与 FS 依赖新建 / 删除入口；非 PM 只读并显示提示；类型固定 FS 不可选；写成功后重拉聚合视图作唯一真相；错误就近展示（403 / 404 用页面口径，409 贴服务端 message 并定位字段）。
Evidence: PR #69 → main `e9055b2`（`web/src/pages/gantt/**` 8 文件 / +1210−77：新增 `GanttMilestoneEditor.tsx`、`GanttDependencyEditor.tsx`）。`npm run typecheck` exit 0；`npm run build:web` exit 0。**浏览器走查（主代理实跑）**：PM 新建里程碑 → 改名+改关联（**抓包确认 PATCH 只带改动字段**）→ 新建依赖 A3→B1 → **故意造环得 409「加入该依赖会形成 FS 环」+「后继任务：取值非法」且计数不变** → 重复边 409「该依赖已存在」→ 删除依赖 / 里程碑（确认框 → 204 → 重拉，计数回 2/2，DB `TaskMilestone` 无孤儿）；MEMBER / VIEWER **零写按钮** + 只读提示，MEMBER 直连接口 **403 FORBIDDEN**。截图：`docs/ai-records/B/issue-26/evidence/B-I26-20261019-{pm-gantt-write-ui,member1-gantt-readonly-ui}.png`；记录 `B-I26-20261019-bmaster-02.md`。
Done when: 写入口仅 PM 渲染且服务端权威（403 实测）；里程碑 / 依赖的增删改全流程可用；环与重复边有可读错误；不泄漏不可见任务（选择器只用视图内可见任务）；不改后端与骨架。
Dependencies: #12 [FS]

---

---

## #55 US-15 UML 设计稿与口径冻结（#35）
Status: done
Outcome: `docs/role-b-uml-design.md` 从 DRAFT 冻结为 **FROZEN v1.0**（关联对象 4 类、7 个 model、§Z 12 项结论、§Z2 P1 实测状态）。
Evidence: 设计稿 commit `573b7bd`；三处取舍经实测（不落坐标；四张真 FK 关联表拿 DB 级 Cascade；`UmlEdge` 复合外键使跨图建边物理不可能 P2003）；裁定入库 PR #72 → main `aa69288`（`uml.minimal-model-and-visibility`、`permissions.uml-write`）；项目负责人 2026-10-19 裁定关联 4 类；冻结 PR #77 → main `dad65e3`；#24 评论 6263362484（交付与裁定）、#35 评论 6263746115（冻结通知）。
Done when: 最小关系 / 消息集合、角色、敏感、删除四项口径获批；模型 / 校验 / 可见性 / 接口 / 批次 / 待决 / AC 方案齐备；未批准项不写死。
Dependencies: none

## #56 US-15 UML P1：模型 + 迁移 + 测试基建 + uml.write
Status: done
Outcome: 7 个 model（`UmlDiagram`/`UmlNode`/`UmlEdge` + 目标/活动/故事/任务四张关联表）+ 迁移 + 重置顺序 + 表集合快照 + 行为验证 + `Action 'uml.write'`（仅 PM）。
Evidence: PR #78 → main `d8315c4`（8 文件 / +979−3）；迁移 `20261019090000_add_uml_models`（14 FK = 2 RESTRICT + 12 CASCADE，**无 ALTER**）；空库 deploy 实测 21 张表、`Uml*` 按 ASCII 序落在 `TaskMilestone` 与 `User*` 之间；`src/modules/uml/uml-schema.test.ts` 25 例（含删任务→关联行消失、删节点→边消失、**跨图边 P2003**）；`typecheck` exit 0、全量 **61 文件 / 1420 例全绿**；设计稿 §7 数字已校正并追加 §Z2；#35 评论 6264046314 给出就绪 SHA。
Done when: 模型 / 迁移 / 测试基建 / 权限动作齐备并验证；不新增端点、不改 `routes.ts`/`app.ts`、不碰 `web/**`。
Dependencies: #55 [FS]

## #57 US-15 UML P2/P3：本域类型与端点（C 实现，B 复核）
Status: not started
Note: P1 已就绪（`d8315c4`），等 ROLE-C 开 P2（`src/modules/uml/types.ts` + `validation.ts`/`schemas.ts`）与 P3（`service.ts` / `plugin.ts` / 测试）；B 复核其可见性交集查询、整图替换事务与错误映射（只用契约 I-4 表内 code）。
Outcome: C 域 UML 服务与 6 个端点实现，含可见性交集、整图替换、校验与错误映射。
Done when: C 交付并给出测试证据；B 复核通过（不越权、不泄漏不可见关联、404 文案统一、无镜像写路径）。
Dependencies: #56 [FS]

## #58 US-15 UML P4/P5：注册行 + 骨架挂载 + 路由文档
Status: not started
Note: 等 P3 导出 `registerUmlRoutes` 后由 B 落笔（`src/routes.ts` 注册行、`web/src/routes.tsx` 路由行、`ProjectLayout.tsx` 左导航行、`docs/frontend-routes.md` 表行）；页面本体归 C（`web/src/pages/uml/**`）。
Outcome: 端点与页面在公共层挂载完成，路由文档同步。
Done when: 注册行 / 路由行 / 导航行 / 文档行落笔并验证（`typecheck` + 浏览器走查）；同一时刻同一文件单写。
Dependencies: #57 [FS]

---

## 估算拆分（本轮修订口径）

仅为 B 侧工作量初估，不是追加预算或整体延期批准，也不要求原 18 人日无条件吸收。新任务编号不是预算归属：文档/提案协调仍计原统筹项，原 B 票的模型/挂载/验证不重复收费。

| 项 | 范围 | 口径 / 初估 |
|---|---|---|
| 原 B 业务三票 | GitHub #25/#26/#27 原已含的业务与模型/路由/挂载/验证 | 16 人日保持原票口径，不重复计入下方新增项 |
| 原契约统筹 | GitHub #24 的确认/协调，含本地 #23 文档同步及 #24 提案接收的协调部分 | 已含原 B 18 人日中的 2 人日，不重复新增；实际占用超出时另报 |
| D 能力新增公共端口实现 | 本地 #28/#29；不含提案接收协调 | 0.5–1 人日 |
| D 能力新增 schema/迁移 | 本地 #25/#30/#34/#38，仅各能力最小模型 | 0.75–1.5 人日 |
| D 能力新增运行时/路由 | 本地 #26/#31/#35/#39，不含 D 业务逻辑 | 0.5–1 人日 |
| D 组件最小挂载及配套 | 本地 #32/#36/#40、#35 的忽略规则和必要路由文档 | 0.5–1 人日 |
| 新增公共集成验证（D） | 本地 #27/#33/#37/#41，仅 B 新接入部分 | 0.75–1.5 人日 |
| **D 净新增实现合计** | 以上五项；任务 #35 的运行时和忽略规则按分项拆工时，不重复累计 | **3–6 人日，待 D 补丁后细化** |
| C #32 新增 B 公共集成 | 本地 #44 权限 0.25–0.5、#45 差异模型 0.25–0.5、#47 端口组装 0.5–1、#49 前端挂载 0.25–0.5、#50 针对性验证 0.25–0.5 | **1.5–3 人日初估，待 #46 协议与字段细化后修正** |
| C 提案同步 / 协调 | 本地 #42 文档、#43 最小契约设计、#46 协议协调、#48 写窗口登记 | 优先计入原 2 人日统筹；原 B 数据接口仍计原票；实际超出另报，不重复新增 |

- 不包含 D / C 业务实现、供应商 adapter、全局联调，也不把原 B 三票已含的公共改动再次计算；C 业务实现与既有 B 数据查询 / D 公共 AI **不重复收费**。
- 假设 D / C 提供可编译独立实现、最小补丁和模块验证；若需重做设计/修复业务实现，应先明确责任并重估，不自动转成 B 业务任务。
- 每批范围变化须另报授权；本轮仅完成获准的本地复核 / 设计 / 提案与状态记录，未提交、未推送、未发布，后续实现任务均未启动。
- 不宣称预算或整体延期已获批；原 18 人日不承诺无条件吸收新增项。
