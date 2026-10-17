# 角色 B 开发工单清单

> 历史批准为保存清单。2026-10-17 项目负责人另行批准本轮第 0 步文档 PR 与相关工单说明同步；后续编码、合并 PR 和未决业务规则确认不在本轮授权内。

依据：`docs/plans/role-b-development.md`（已批准）。

## 执行规则

- 本文 #01–#41 是本地任务编号，不是 GitHub Issue 编号；GitHub 工单在正文明确标注。#01–#22 保留原编号，后续新增任务继续递增。
- 主线 `#27 → #26 → #25`（GitHub #27/#26/#25）是**优先级顺序，不是硬依赖**：三票在各自独立目录（`workload/`、`gantt/`、`board/`）可并行推进设计与实现；公共文件由 B 单写、组件按就绪挂载，**不整模块等待**；不得据此新增跨票硬边。
- Dependencies 使用前置任务编号及类型：FS 为前置完成后才能开始，SS 为前置开始后才能开始，FF 为前置完成后才能完成。本地排期边不回写为 GitHub 的整体验收依赖，不把角色父票或契约票变成硬依赖。**仅保留真实接口 / 验收依赖**，删除只由排序产生的硬边。
- 独立文件、目录可在各自范围获批后并行；先划清写入边界，同文件不并发修改，公共文件仍由 B 单写。校验器就绪不等于编码已获授权。
- 状态以**证据**为准：本轮仅 #23 文档同步有执行进展，状态及完成证据见该任务，其余保持 `not started`；每票开工须重新核对最新 main。
- Blocker 表示需解除的外部条件，不是新增业务规则；基于已批准计划登记，实际执行前复核并补证据。解除阻塞不自动代表任务完成。
- 仅由对应负责人确认业务规则、授权旧业务文件扩展。B 不代其他角色确认，不新建旁路写入口。

## 本轮口径同步（2026-10-17，项目负责人授权）

> 本节记录项目负责人（GitHub `githubleelee`，即 ROLE-B）本轮明确的口径更新。旧历史以「适用范围 + 变更说明」保留在各自文档中，不全局替换；来源见 `docs/role-d-start-confirmation.md` 与 `DECISIONS.md`。

- **公共文件归属变更**：项目负责人已明确授权 ROLE-B = `githubleelee` 统一修改 / 合入 `src/shared/*`、`src/db/schema.prisma` 及迁移、`src/routes.ts`、`src/app.ts`、前端公共骨架（`web/src/App.tsx`、`web/src/routes.tsx`、`web/src/layouts/`、`web/src/components/`）、`docs/frontend-routes.md` 及 `var/uploads` 的 `.gitignore`。**排除**：`src/modules/authz/permissions.ts` 的权限 / 签名，须按适用契约另行确认。该授权来自**项目负责人**，不代表原技术负责人 / 前端骨架原修改人已单独表态。
- **旧业务文件**（`requirement/`、`task/`、`project/`、`authz/` 等）仍须原 owner 对**具体文件 / 范围**书面授权后才能改；不得旁路新建镜像写路径。
- **4 类证据分开**：桩（本地 mock / 可替换接口）、模块测试、真实 API、真实生产方联调分别留证，任一不得冒充另一类（尤其 mock 不得冒充真实 AI 验收或六类通知端到端送达）。
- **AI 外部演示范围**与 **AC13 冲突**：按 `DECISIONS.md` `role-d.ai.demo-external-api-scope` 执行，不声称满足原 AC13。
- **通知时区**：D 域 `Asia/Shanghai` 已确认（`DECISIONS.md` `notifications.events-timing-timezone`）；A 域 C3 逾期时区仍待定，**不得形成 D 已确认 + A 未确认的双最终口径**。C11 操作授权 / C12 协作人模型**未自动确认**。
- **净新增集成估算单列**：见文末「估算拆分」；原 2 人日契约统筹预算只覆盖原 B 票已含工作，不重复计算，也不暗示已批准延期或无条件吸收 18 人日。
- 本轮已授权 #23 文档 PR 及相关工单说明同步；其余具体方案、编码和对外操作另行核准，不合并 PR、关闭工单或批量移除标签。
- 后续每次状态或阻塞更新均运行任务校验器；保留编号，新增任务另分配编号。mock 可支持设计与模块验证，不充当最终验收证据。

## #01 复核基线并建立验收对应表
Status: not started
Outcome: 最新 main、适用契约和 B 域三票实际实现的证据清单，以及逐条 AC 对应表。
Done when: 记录复核提交号；核对六状态、故事 PATCH 审计事件、现有权限、里程碑与依赖模型；为 GitHub #25/#26/#27 每条 AC 标明现状、交付物和验证方式，不重复建设。
Dependencies: none

## #02 编制 B 域最小契约与申请草稿
Status: not started
Outcome: B 域确认草稿、GitHub #27 开工边界、GitHub #26 提前申请、GitHub #25 旧模块申请，以及未决事项台账。
Done when: 每项写明问题、确认人、确认/待确认状态、所影响的开发与验收部分、证据位置；覆盖六状态、C2/C6/C11/C13、甘特汇总、FS 执行落点、事件接口和公共文件归属；C5 仅登记协调，不承诺替 C 实现；草稿未擅自发布或代确认。
Dependencies: #01 [FS]

## #03 获批并发出首批契约与旧业务文件授权申请
Status: not started
Outcome: 经用户认可的 B 域最小确认及申请记录；提前登记甘特字段、类型、事件与挂载需求（公共层由 B 单写），并提交负载挂载与看板旧业务模块的**具体文件 / 范围**授权需求。
Done when: 用户批准具体对外文本与操作；发布后记录链接、接收负责人和待回复项；未获决定的问题保持待确认，不要求所有议题定稿，不代删执行票标签。
Dependencies: #02 [FS]
Blocker: 本次第 0 步补充说明发布已获准；本任务涉及的 B 业务开工确认及旧业务文件申请具体文本仍待核准。

## #04 完成成员负载单票方案与接口设计
Status: not started
Outcome: GitHub #27 的字段、端点设计、成员与任务关联、权限边界、页面方案及文件清单。
Done when: 覆盖成员列表、负载摘要、任务详情、空态和工作台一致性；明确六状态与 C6 未决部分，不把 DONE 当 CLOSED，不擅自扩展协作人模型；可实施部分与待确认部分分开，提交用户审阅。
Dependencies: #02 [FS]

## #05 实现成员负载后端只读查询
Status: not started
Outcome: `src/modules/workload/` 中的授权查询与负载数据接口。
Done when: 直接读库且不跨业务 service；只查本项目成员；复用 can()/visibilityScope()；敏感过滤进入数据库查询；任务列表与计数同口径，按已确认规则计算未关闭任务；不改公共文件（由 B 单写）。
Dependencies: #03 [FS], #04 [FS]
Blocker: 需用户批准 GitHub #27 编码范围，并取得计数所需六状态落地及 C6 规则证据；不得自行制定替代规则。

## #06 实现成员负载页面与成员详情
Status: not started
Outcome: `web/src/pages/workload/` 的成员负载、成员—任务关联与详情页面。
Done when: 能展示状态和计划时间；具备加载、空态、错误与无权限反馈；按确认的接口开发；后端未接入时仅标为开发态，不能宣称真实计数已验收；不改前端骨架。
Dependencies: #03 [FS], #04 [FS]
Blocker: 需用户批准 GitHub #27 的前端编码范围；未决权限和状态语义不得写死。

## #07 完成成员负载真实接口与挂载联调
Status: not started
Outcome: 可在应用中访问、使用真实后端的成员负载与详情链路。
Done when: 公共层（B 单写授权）完成必要后端路由、前端页面挂载及按需类型修改；前后端真实数据一致；记录修改与授权证据，无 mock 冒充正式接口。
Dependencies: #05 [FS], #06 [FS]
Blocker: 需公共层（B 单写授权）完成挂载及必要公共文件改动。

## #08 验收并交付成员负载
Status: not started
Outcome: GitHub #27 AC1–AC6 的证据包及供 GitHub #32/#33 消费的数据契约。
Done when: 本模块测试与 npm run typecheck 通过；浏览器验证负载图到成员详情；覆盖 PM/member/viewer/outsider、敏感计数、跨项目、列表计数一致及 DONE 不等于 CLOSED；与工作台按同账号同授权视角核对，外部未就绪项不得假称通过；记录全部 AC 结论及 PR 草稿/链接，不自动合并或关闭工单。
Dependencies: #07 [FS]

## #09 提前完成甘特模型、接口与验收设计
Status: not started
Outcome: GitHub #26 的模型与接口设计、公共文件细化申请及测试场景，不含实现代码。
Done when: 覆盖需求/任务/里程碑/FS 数据、Milestone 与 TaskDependency 字段约束索引、故事日期进度聚合、无任务/空值/部分可见边界；明确 C2、真实开工路径、事件接口和权限待决项；设计供公共层（B 单写授权）小批次顺序合入，不擅自新增故事排期状态。
Dependencies: #02 [FS]

## #10 落实甘特开工授权与最小模型条件
Status: not started
Outcome: GitHub #26 独立分支/worktree、用户认可的实施范围，以及首批模型/迁移/类型的公共层交付证据（B 单写授权）。
Done when: 复核最新 main；用户批准甘特单票方案；公共层按 B 单写授权提供首批读接口所需模型与迁移；只确认本阶段最小契约，未决 C2 等不阻塞已明确的展示工作。`#27` 仅作优先级参考，**不作硬前置**。
Dependencies: #09 [FS]
Blocker: 需用户批准 GitHub #26 实施；相关迁移与类型由公共层（B 单写授权）交付。

## #11 实现甘特聚合读接口
Status: not started
Outcome: `src/modules/gantt/` 中需求、任务、里程碑和依赖的聚合数据接口。
Done when: 支持故事展开任务、任务计划时间、确认后的故事进度日期及里程碑汇总；查询层敏感过滤，依赖与汇总不泄漏无权对象；不跨业务 service；与任务视图按同授权视角一致。
Dependencies: #10 [FS]
Blocker: 需确认本任务涉及的聚合、空值和汇总权限规则，未决部分仅保留设计。

## #12 实现里程碑与 FS 依赖写操作及事件
Status: not started
Outcome: 已授权的里程碑/依赖写接口、业务校验与本域事件发布。
Done when: 仅接受 FS；拒绝自依赖、环与跨项目依赖；完成任务里程碑及汇总；按确认的权限判定与公共事件接口处理写入及事件，不直接调用 D 域业务 service，不在敏感载荷中带未授权标题内容。
Dependencies: #11 [FS]
Blocker: 需写操作授权、必要 schema 交付，以及公共事件接口、放置/注入与失败处理契约；真实事件接入须由公共事件实现方（GitHub #37，D）提供。

## #13 落实真实任务入口的 FS 放行校验
Status: not started
Outcome: 按 C2 批准规则执行、不能绕过的任务开工约束。
Done when: 获得 DONE 或 CLOSED 放行的书面结论；明确真实任务开工路径的 owner 与实施范围；必要旧模块授权留痕；验证直接调用真实入口也拒绝未放行的后置开工，不仅依赖甘特按钮禁用，不新增镜像任务写路径。
Dependencies: #12 [FS]
Blocker: C2 放行条件、相关状态落地、真实开工入口归属及必要旧模块授权尚需证据。

## #14 实现甘特时间轴页面
Status: not started
Outcome: `web/src/pages/gantt/` 中需求/任务/里程碑统一视图。
Done when: 支持故事展开、计划时间、汇总进度、里程碑和 FS 关系展示，具备空态与错误反馈；不做复杂拖拽、自动调度或其他依赖类型；未决放行规则不写死。
Dependencies: #11 [FS]

## #15 验收并交付甘特图
Status: not started
Outcome: GitHub #26 AC1–AC7 证据包及交付 C 域 GitHub #32 的数据契约。
Done when: 公共层（B 单写授权）完成必要路由与页面挂载；本模块测试与 npm run typecheck 通过；浏览器验证展开、汇总、里程碑；覆盖 FS、环、跨项目、敏感过滤及真实任务开工路径；事件联调保留真实证据，不能只用模拟替代；未决或外部不可验证项不勾完成，不建立对 GitHub #32 的反向依赖。
Dependencies: #12 [FS], #13 [FS], #14 [FS]
Blocker: 需实际路由/页面挂载与真实事件接入条件到位，相关公共层修改留痕。

## #16 提前完成故事看板方案与授权细化
Status: not started
Outcome: GitHub #25 只读看板、状态写路径、审计及事件的单票设计和具体文件授权申请。
Done when: 固定 DRAFT/PLANNING/DONE 三列；明确复用现有故事 PATCH，不新建镜像写路径；列出 requirement 具体修改文件/范围、C11/C13、写入审计事件一致性待决项，以及地图/详情同步方案，不含编码。
Dependencies: #02 [FS]

## #17 实现故事只读看板
Status: not started
Outcome: `src/modules/board/` 按需聚合读与 `web/src/pages/board/` 的状态列、卡片及计数。
Done when: 用户批准 GitHub #25 方案及只读编码范围；从最新 main 建独立分支；正式故事三状态展示正确；查询层敏感过滤，计数与列表一致；不复制 requirement service，不改骨架。`#26` 仅作优先级参考，**不作硬前置**。
Dependencies: #16 [FS]
Blocker: 需用户批准 GitHub #25 的单票方案及只读实现。

## #18 扩展获授权的故事状态写路径
Status: not started
Outcome: 既有故事 PATCH 的状态操作授权、who/when/before/after 审计与状态变更事件。
Done when: C11 成员操作及 Action 规则已书面确认；C13 对具体文件范围已授权；复用 can()；按确认的一致性策略完成真实写入、审计、事件处理；公共文件由 B 单写、旧业务文件须原 owner 具体授权后改，不绕过 requirement.write，不创建替代写入口。
Dependencies: #17 [FS]
Blocker: 需 C11/C13 结论、原 owner 的具体旧模块授权，以及事件接入和写入/审计/事件失败一致性契约。

## #19 接入看板状态操作与跨视图同步
Status: not started
Outcome: 看板调用既有 PATCH 调整状态，并在重新拉取后与故事地图、详情及统计一致。
Done when: 公共层（B 单写授权）完成必要挂载；交互按已确认角色授权展示，服务端仍判权；成功与失败反馈正确；同账号同授权视角下多视图一致；涉及他人业务页面文件须先获具体授权，不擅自修改。
Dependencies: #18 [FS]
Blocker: 需实际页面/后端挂载；如需旧页面改动，先取得其 owner 授权。

## #20 验收并交付故事看板
Status: not started
Outcome: GitHub #25 AC1–AC6 的模块、浏览器与审计事件证据包。
Done when: 本模块测试与 npm run typecheck 通过；浏览器验证看板改状态后地图/详情同步；覆盖 PM/member/viewer/outsider、跨项目、越权和敏感计数；审计及事件来自真实状态写路径；逐条 AC 留证，不自动合并或关闭工单。
Dependencies: #19 [FS]

## #21 持续跟踪 B 域契约、授权与跨域交接
Status: not started
Outcome: 持续更新的 B 域契约 / 公共文件授权台账，以及最终的已确认、待确认、后续处理清单。
Done when: B 域所用规则与授权均可追溯（已交付部分逐项登记，未交付部分明确标待后续）；未决项明确确认人、影响和移交对象；C5 等跨域事项有状态但不代确认；其他角色未完成确认时不宣称 GitHub #24 整票完成。
Dependencies: #03 [SS]

## #22 汇总 B 域最终交付与一致性证据
Status: not started
Outcome: 三票 AC 总表、同账号同授权视角的一致性证据、契约授权索引及未决交接清单。
Done when: 负载/工作台、甘特/任务、看板/地图/详情按已具备的真实链路核对；外部未就绪链路明确列为未完成，不冒充全局回归通过；记录每票分支、PR 草稿/链接、测试和浏览器证据；不扩大到全仓测试，不自动关闭旧工单、合并 PR 或替他域签字。
Dependencies: #08 [FS], #15 [FS], #20 [FS], #21 [FS]

---

## 公共集成任务（新增，2026-10-17）

本地 #23–#41 不是 GitHub 工单编号。#23 文档同步、#24 提案接收在原 2 人日统筹项内核算；仅后续 D 能力公共实现单列净新增估算。各能力独立，下面的编号只是建议优先级；不要求四模块、两种端口或全部迁移先齐备。未列依赖的外部交付按本任务 Blocker 独立解除，不以其他能力未完成阻塞本能力。

## #23 同步本轮口径与工单索引（第 0 步）
Status: done
Outcome: 独立文档 PR，纳入确认稿和原样 DECISIONS.md，同步交接、B 计划/工单、相关契约与索引；文档链接可访问后同步 GitHub #24/#21 及受影响 D 工单说明。
Evidence: [文档 PR #39（待合并）](https://github.com/githubleelee/AIManagement/pull/39)；[#24 补充确认](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6232875888)。已更新 GitHub #21/#24/#31/#34/#36/#37 的说明并保留原文，工单仍 open、标签不变；41 tasks / 48 dependencies 校验通过，18 条索引全部非正文元数据与基线一致，独立测试复核与审查通过。
Done when: 新授权、权限排除、业务文件具体授权、优先级非硬依赖、AI/AC13 例外、四类证据、D 通知时区与 A 域 C3 待统一均已准确登记；工单索引全部非正文元数据不变；使用 to-tasks 技能目录中的 scripts/check-tasks.mjs 全文校验通过（非仓库脚本）；独立 PR 与 #24 补充确认有真实链接，明确 PR 待合并，不提交无关材料、不改标签、不合并或关闭工单。
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
Outcome: src/app.ts 构造 D 的独立事件实现并注入端口；有明确查询路由需求时由 src/routes.ts 集中注册。
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
Outcome: src/shared/ 的事件信封、发布/订阅端口与必要校验。
Done when: 仅依据已接收的事件提案实现；记录事件名、项目/操作者/对象引用、发生时间、载荷、幂等语义与敏感边界；独立可编译并提供给各域，不等待 AI 提案或数据库迁移。
Dependencies: none
Blocker: 待 D 最小事件提案确认与本批编码授权；不要求 #24 两类提案全部接收完成。

## #29 实现已确认的最小公共 AI 端口
Status: not started
Outcome: src/shared/ 的供应商无关 AI 输入/建议输出/错误与显式运行模式端口。
Done when: 独立可编译；不绑定 SDK，不含 key，区分本地桩与真实 API；遵守演示数据和敏感对象边界；无需等待事件、AI 存储或供应商选型。
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
Outcome: RequirementDetailPage.tsx 接入 D 独立 AI 组件与必要路由文档说明。
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
Outcome: 附件插件集中注册，项目根 /var/uploads/ 纳入 .gitignore，按需完成 app 依赖组装。
Done when: 所需迁移可用；服务端策略按白名单、扩展名+MIME、10,000,000 B 执行；上传目录不公开静态暴露；任务删除失败不先删文件；不越权修改旧任务服务。
Dependencies: #34 [FF]
Blocker: 待 D 附件插件/注册补丁与本批编码授权；本任务不代写 D 上传/下载/清理实现。

## #36 最小挂载现有任务区附件组件
Status: not started
Outcome: TaskSection.tsx 嵌入 D 附件组件及必要路由文档更新。
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
Done when: 按 D 字段提案实现索引和约束并验证迁移；保留事件发生/条件成立时间，不能从消费时间重新计时；不自行决定 A 域 C3 或六态转换。
Dependencies: none
Blocker: 待 D 通知字段/迁移提案与本批编码授权。

## #39 组装通知订阅、定时生命周期与路由
Status: not started
Outcome: app 注入事件端口，注册 D 通知实现/生命周期与已确认列表/已读路由。
Done when: 所需模型可用，启停可控；D 通知采用 Asia/Shanghai 已确认规则；A 域 C3 待统一项继续记录，不接受双最终口径；不代写业务生产事件。
Dependencies: #28 [FS], #38 [FF]
Blocker: 待 D 通知实现/生命周期/注册补丁与本批编码授权。

## #40 最小挂载顶栏通知入口
Status: not started
Outcome: AppLayout.tsx 接入 D 独立通知入口与必要路由文档说明。
Done when: 仅按组件 Props 注入上下文，不重写公共布局或通知业务；在线刷新和错误态可验证；不等待 AI/附件组件全部完成。
Dependencies: none
Blocker: 待 D 通知组件/Props/挂载补丁与本批编码授权。

## #41 验证通知公共接入
Status: not started
Outcome: 通知基础真实接入、模块模拟与六类生产方联调的分栏证据。
Done when: 相关测试/typecheck 与基础订阅/入库/查询/页面链路通过；≤60 秒从业务成功或条件成立计量；模拟生产者不替代六类真实生产方联调；生产方未齐及 A 域 C3 未统一时相关最终 AC 不通过，不阻塞已明确基础链路的验证记录。
Dependencies: #26 [FS], #38 [FS], #39 [FS], #40 [FS]

---

## 估算拆分（本轮口径，2026-10-17）

仅为 B 侧工作量初估，不是追加预算或整体延期批准，也不要求原 18 人日无条件吸收。新任务编号不是预算归属：文档/提案协调仍计原统筹项，原 B 票的模型/挂载/验证不重复收费。

| 项 | 范围 | 口径 / 初估 |
|---|---|---|
| 原 B 业务三票 | GitHub #25/#26/#27 原已含的业务与模型/路由/挂载/验证 | 16 人日保持原票口径，不重复计入下方新增项 |
| 原契约统筹 | GitHub #24 的确认/协调，含本地 #23 文档同步及 #24 提案接收的协调部分 | 已含原 B 18 人日中的 2 人日，不重复新增；实际占用超出时另报 |
| D 能力新增公共端口实现 | 本地 #28/#29；不含提案接收协调 | 0.5–1 人日 |
| D 能力新增 schema/迁移 | 本地 #25/#30/#34/#38，仅各能力最小模型 | 0.75–1.5 人日 |
| D 能力新增运行时/路由 | 本地 #26/#31/#35/#39，不含 D 业务逻辑 | 0.5–1 人日 |
| D 组件最小挂载及配套 | 本地 #32/#36/#40、#35 的忽略规则和必要路由文档 | 0.5–1 人日 |
| 新增公共集成验证 | 本地 #27/#33/#37/#41，仅 B 新接入部分 | 0.75–1.5 人日 |
| **净新增实现合计** | 以上五项；任务 #35 的运行时和忽略规则按分项拆工时，不重复累计 | **3–6 人日，待 D 补丁后细化** |

- 不包含 D 业务实现、供应商 adapter、全局联调，也不把原 B 三票已含的公共改动再次计算。
- 假设 D 提供可编译独立实现、最小补丁和模块验证；若需重做设计/修复业务实现，应先明确责任并重估，不自动转成 B 业务任务。
- 每批范围变化须另报授权；本轮仅 #23 文档和相关工单说明更新已获实施授权且已完成；PR 仍待合并，后续实现任务均未启动。
