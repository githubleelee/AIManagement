# DECISIONS

项目级长期决策记录。格式：key / value / timestamp / rationale（一句）。追加式；如需变更，以 `supersedes: <key>@<timestamp>` 注明被取代条目，最新适用条目生效。

---

## `role-d.ai.demo-external-api-scope`

- **value:** 演示部署范围内，AI 先本地桩开发，后续接外部公有云大模型 API；普通虚构教学/演示数据可入外部模型，不要求复杂数据脱敏；仍禁止外发真实密码、token、密钥、真实个人信息及未授权真实资料，被标敏感对象默认不入上下文；具体供应商/模型暂未确定，期间允许先做本地桩和可替换接口，公共端口不绑定供应商 SDK，前端不放 key、backend 从 env 读 key，mock 不得冒充真实 AI 验收，API 切换显式；关键 AI 建议仍由 PM 人工确认后应用并留审计。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 项目负责人明确将本轮演示范围改为可接外部公有云大模型 API，故原「仅本地私有化、真实数据不得外发云」不再作为本轮口径（原 AC13 不声称满足）；含 2026-10-17 补充确认（供应商未定期间先做本地桩与可替换接口）。

## `arch.shared-ports-and-assembly`

- **value:** 公共 AI/事件类型与端口放 `src/shared/`，运行时由 `src/app.ts` 应用组装注入；禁止业务模块互调 service；D 写 AI/事件独立实现，B 落公共接入，A/C 复用端口不调用 D 业务 service；事件域 D 只做传输/存储/订阅/幂等，领域生产者仍由原业务域负责。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 维持单一组装点与依赖方向，避免模块间 service 循环依赖。

## `ownership.public-files-single-writer`

- **value:** 公共文件统一由 ROLE-B = `githubleelee` 修改/合入，D 提交接口/字段/迁移/补丁申请、不并发直接写；范围含 `src/shared/*`、`src/db/schema.prisma` 及迁移、`src/routes.ts`、`src/app.ts`、前端公共骨架、`docs/frontend-routes.md`、`var/uploads` 的 `.gitignore`；`src/modules/authz/permissions.ts` 的权限/签名不在本次授权内，须适用契约另行确认；其他业务域修改权限不自动扩大。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 原冻结归属变更经项目负责人授权给 B 统一写入，保证公共层一致性。

## `attachments.policy`

- **value:** 白名单 png/jpg/jpeg/webp/pdf/docx/xlsx/zip；服务端单文件 ≤10MB，扩展名与 MIME 联合校验（不扩 svg/gif/doc/xls/宏 Office/可执行/脚本）；按字节时用严格 SI 10,000,000 B 且前后端一致；数据库存元数据、实体文件放项目根 `var/uploads/` 并加入 `.gitignore`；下载按任务权限；任务成功删除时元数据与实体同时清理、失败可追踪重试、任务删除失败不先删文件（DB 与文件系统非天然原子）；ZIP 不自动解压运行，不加额外杀毒。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 统一受限类型与体积口径，明确元数据/实体文件的落点与清理约束。

## `notifications.events-timing-timezone`

- **value:** 仅站内通知（不做邮件/短信/企业 IM），时区 Asia/Shanghai；逾期为 planEnd 当日结束后次日 00:00 仍未关闭（含 DONE 未关闭），同任务+截止日期+接收者只提醒一次；覆盖分配、@提及、逾期、验收提交、验收通过/驳回、正式风险新建/等级提升、节点六类事件，接收者与节点固定规则按本次确认表执行（节点：里程碑无单独负责人时只发 PM，有负责人时发 PM + 负责人并去重，不推断他人）；普通事件从业务写入成功计时、定时事件从约定条件成立计时，≤60 秒入库且目标账号可查询，在线同步显示、离线不要求 60 秒打开或已读；不重发相同通知、不泄漏权限。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 冻结通知渠道、事件/接收者映射、计时起点、去重与时效口径，避免各域各自解释；含 2026-10-17 补充确认（节点无单独负责人时只发 PM）。

## `ownership.public-files-single-writer`

- **value:** 公共文件统一由 ROLE-B = `githubleelee` 修改/合入，D 提交接口/字段/迁移/补丁申请、不并发直接写；范围含 `src/shared/*`、`src/db/schema.prisma` 及迁移、`src/routes.ts`、`src/app.ts`、前端公共骨架、`docs/frontend-routes.md`、`var/uploads` 的 `.gitignore`；**2026-10-17 追加授权**：为落实 #32 US-12 的 PM-only 权限，B 可最小修改 `src/modules/authz/permissions.ts` 及必要共享 `Action`/对象范围，**不代表 C11/C12 完成**，不改其他任务的编辑/验收/协作人权限；其他业务域修改权限不自动扩大。
- **supersedes:** ownership.public-files-single-writer@2026-10-17T17:55:19+08:00
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 为 #32 统一鉴权落实最小权限例外，保留原公共归属与 D 补丁边界，故以同 key 新条目取代旧排除权限改动的口径。

## `scheduling.permission-pm-only`

- **value:** #32 AI 排期建议仅 PM 可生成/查看/采纳/修改后采纳/拒绝/查看建议审计；MEMBER/VIEWER 不开放这些入口（只能看既有有权限的正式任务计划）；对象对调用者不可见或 outsider 返回 404、可见无操作权 403、未登录 401；新 `Action` 与对象 scope 由 ROLE-B 落到统一 `can()`/`visibilityScope()`，业务不私写角色判定；每次请求及每次确认/重试都重新鉴权，撤权即时收敛。
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 冻结 #32 建议的生成/查看/确认/审计权限口径与统一鉴权接入，避免业务私写角色判定。

## `scheduling.fs-release-closed-natural-days`

- **value:** 全项目 FS 放行前置必须为 `CLOSED`，`DONE` 不算验收通过，适用于 A 任务流/B 甘特/C 排期；计划按自然日含周末、起止日均计入；FS 后继建议开始不得早于前置计划结束日的次日；实际开工另检查前置 `CLOSED`；不做工作日/节假日/技能/请假/并行度等高级排期因素。
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 统一 FS 放行与自然日计划口径，避免各域各自解释 `DONE`/`CLOSED` 与日期边界。

## `timezone.project-wide-asia-shanghai`

- **value:** 全项目统一 `Asia/Shanghai`，日期语义 `YYYY-MM-DD`；`planEnd` 当日结束后次日 00:00 仍未 `CLOSED` 即视为逾期；覆盖 A/B/C/D，不限 D 通知域；其他六状态转换细节未一并批准。
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 将逾期与时区口径提升为项目级统一口径，与 `notifications.events-timing-timezone` 对齐。

## `scheduling.load-aggregation-baseline`

- **value:** 本期统一 C6 基础负载与汇总口径：负载=负责人名下所有非 `CLOSED` 任务数（含 `DONE`），不做工时/技能/产能评分；PM 看全项目汇总，MEMBER/VIEWER 只看各自授权可见任务汇总并标「可见范围」；AI 排除敏感并标注实际参与任务范围/来源快照，不得以 AI 子集冒充 PM 全项目基数；不构成健康度阈值等其他业务批准。
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 冻结本期统一的负载定义、全局/可见基数与 AI 参与范围口径，不扩张到其他业务。

## `scheduling.advice-apply-scope-and-validation`

- **value:** #32 应用只允许 `TODO` 任务的 `planStart`/`planEnd`，不改负责人/验收人/状态/依赖/里程碑，其他状态只提示；采纳按建议日期，修改后采纳只在上述字段范围内改后重新校验，拒绝不改计划仅处置审计；硬阻断：日期倒置、`TODO` 新开始早于北京时间今天、违反 FS 计划约束、非 `TODO` 或越字段写；仅提示：同一人任务日期重叠、新结束晚于原计划、超过已有关联里程碑日期；无关联不编造、不自动改里程碑；负载只给分布不设「超过 N 即过载」阈值。
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 冻结 #32 可应用字段、采纳/修改/拒绝语义及阻断与提示条件。

## `scheduling.advice-snapshot-transaction-idempotency`

- **value:** 建议需记录输入范围/关键数据 snapshot/fingerprint 与生成时间；应用前核对相关任务日期/状态/负责人、成员、FS、milestone、参与负载范围与权限，相关数据变化则整份过期并要求重新生成（不为所有旧接口加全局乐观锁，仅 #32 应用受控路径检查；PM 生成后编辑建议日期不等于基线改变但必须重新校验）；同一 DB 事务复核 snapshot/权限/业务约束并批量计划写、处置及成功审计，任一失败全部不改、不部分成功；模型调用在事务外，不用逐条 HTTP PATCH 伪装原子；相同请求重复提交返回已有结果、不重复写/发事件；一份建议只允许一个最终处置，并发/不同内容再次处置返回冲突；每次重试先鉴权不能借幂等越权；失败/timeout/权限拒绝另记必要失败或安全日志，不当采纳成功、不泄漏 payload/密钥、不与已回滚成功事务混淆。
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 冻结 #32 的过期基线、整份原子应用、幂等与失败留痕规则，避免部分成功与重复应用。

## `arch.legacy-task-controlled-extension`

- **value:** 旧模块扩展由原 owner 对具体文件/范围书面授权后仍由本票角色实现、公共文件仍 B 单写；#32 经授权在 B 协调的独占窗口内由 C 最小修改 `src/modules/task/routes.ts`、`rules.ts` 及必要本域测试，专用于统一计划写路径/原有约束复用/整份事务应用，不另建旁路镜像写路径、不调 task service；改动先提清单由 B 登记，若 A 持有写锁先等其当前小任务合入再交接、不假定空闲；公共端口/`Action`/DB/注入/前端挂载仍 B 单写，跨模块应用端口由 B 落实共享声明并组装注入；C 业务写路径不得转嫁 B。
- **timestamp:** 2026-10-17T18:41:26+08:00
- **rationale:** 冻结旧业务模块受控扩展与单写者交接架构，兼顾 #32 落地与公共层一致性。


## `arch.legacy-task-controlled-extension`

- **value:** 其他旧模块仍按既定的原 owner 限范围授权流程执行；对 #32，项目负责人已明确授权 C 在 B 登记具体文件/范围并完成现写者交接后的独占窗口内，最小修改 `src/modules/task/routes.ts`、`rules.ts` 及必要本域测试，不再额外等待原 owner 重复同意。若 A 持锁，先等其当前小任务合入后交接，不假定空闲。扩展仅用于统一计划写路径、复用原任务校验及整份事务应用，不另建旁路、不跨模块调 service；公共端口/Action/数据库/组装/前端挂载仍 B 单写。项目隔离、有效负责人/验收人同项目且互异、适用成员数量约束、日期与敏感可见性等原校验继续生效，AI 排期新增阻断不是完整校验清单。C 的业务实现不转嫁 B；线上引用待 #24 留痕，不虚构原 owner 单独同意。
- **timestamp:** 2026-10-17T18:51:32+08:00
- **rationale:** 澄清已获项目负责人批准的 #32 例外授权来源，保留实际写锁交接及所有原业务约束，避免重复审批或旁路写入。
- **supersedes:** arch.legacy-task-controlled-extension@2026-10-17T18:41:26+08:00

## `audit.scheduling-decision-traceability`

- **value:** #32 生成阶段在数据库写事务外调用模型并保存建议/输入快照；确认阶段应用已保存建议或 PM 允许的日期修改，不重新调用模型替换待确认内容。记录场景、输入范围及快照、模型标识/实际可得版本、生成时间、建议、审核人、采纳/修改后采纳/拒绝、人工修改与理由、最终应用结果；权限不足/超时/失败只留必要安全或失败证据，不泄漏敏感内容，也不记为成功采纳。
- **timestamp:** 2026-10-17T18:51:32+08:00
- **rationale:** 补全排期确认的可追溯字段并区分生成与应用，确保 PM 审核内容和实际应用内容一致。


## `permissions.risk-and-project-close`

- **value:** 风险台账写操作 `risk.write` 对项目 PM 与 MEMBER 开放、VIEWER 一律 403（只读）；`project.close` 仅 PM（对 MEMBER / VIEWER 403）。ROLE-B 作为公共文件单写人落地共享 `Action`、`can()` 判定、`Risk` 模型与 `Project.status` 列及其迁移；风险三级 / 四态取值、敏感继承关联任务、关闭阻断清单与 409 语义属 ROLE-A 的 `risk` / `analytics` 模块业务；路由挂载（`src/routes.ts`）与前端挂载的归属见最新 `ownership.public-files-single-writer` 条目（2026-10-18 追加授权 A 在登记窗口内自挂）。
- **timestamp:** 2026-10-18T11:30:00+08:00
- **rationale:** 项目负责人 2026-10-18 就 #30 的公共文件 / 权限申请给出授权范围（risk.write = PM + 成员，project.close = 仅 PM），使 A 在不越权改公共文件的前提下继续开发。

## `analytics.health-thresholds-and-planned-progress`

- **value:** 项目实际进度 = 已关闭任务数 ÷ 项目任务总数；计划时间进度 = 已过自然日数 ÷ 计划总自然日数，其中计划区间取该项目全部任务的 `min(planStart)` ~ `max(planEnd)`、按自然日含首尾、时区 `Asia/Shanghai`，已过自然日数 = 今天 − `min(planStart)` + 1 并截断到 `[0, 区间天数]`，项目无任务时显示「暂无计划数据」且不做分级。偏差 = 计划时间进度 − 实际进度，单位为百分点，比较用未舍入值、展示可保留 1 位小数；分级阈值：偏差 ≤ 10pp 健康、> 10pp 且 ≤ 25pp 预警、> 25pp 风险。覆盖范围与负载口径一致：PM 用全项目基数，MEMBER / VIEWER 用各自可见范围并标注「可见范围」，不得以可见子集冒称全项目。
- **timestamp:** 2026-10-18T11:45:50+08:00
- **rationale:** 冻结 US-10 健康度算法与三档阈值，使项目模块无需新增起止日期列即可判定健康 / 预警 / 风险，并与既有负载可见性口径保持一致。

## `ownership.public-files-single-writer`

- **value:** 公共文件统一由 ROLE-B = `githubleelee` 修改/合入，D 提交接口/字段/迁移/补丁申请、不并发直接写；范围含 `src/shared/*`、`src/db/schema.prisma` 及迁移、`src/routes.ts`、`src/app.ts`、前端公共骨架、`docs/frontend-routes.md`、`var/uploads` 的 `.gitignore`；**2026-10-17 追加授权**：为落实 #32 US-12 的 PM-only 权限，B 可最小修改 `src/modules/authz/permissions.ts` 及必要共享 `Action`/对象范围，不代表 C11/C12 完成，不改其他任务的编辑/验收/协作人权限；**2026-10-18 追加授权（#30）**：项目负责人授权 ROLE-A 在 B 登记的范围内直接修改 `src/routes.ts` 的路由注册行与前端骨架的页面路由 / 左导航挂载行，用于挂载 US-10 自己的端点与页面，同一时刻同一文件只允许一个写者、A 与 B 不得并发修改，A 仍不得修改 `src/shared/*`、`src/db/schema.prisma` 及迁移、`src/modules/authz/permissions.ts`、`src/app.ts`，超出登记范围的改动须另行申请；其他业务域修改权限不自动扩大。
- **supersedes:** ownership.public-files-single-writer@2026-10-17T18:41:26+08:00
- **timestamp:** 2026-10-18T11:45:50+08:00
- **rationale:** 记录 #30 的限范围挂载授权（A 只挂自己模块的路由与导航行、公共层保持单写者），避免 A 因等待挂载而停工或重复实现公共代码。


## `ai.suggestion-store-shared`

- **value:** AI 建议的持久化采用**一套共享的「建议 + 处置」存储**，由 ROLE-D 的 #31 公共 AI 框架提出字段与端口提案、ROLE-B 作为公共文件单写人落地，ROLE-A（#33 AI 分析）与 ROLE-C（#32 AI 排期）复用同一套，不各自建表；字段至少覆盖场景/分析类型、输入范围与快照、模型或桩标识与实际可得版本、生成时间、建议内容、处置结论（采纳/修改后采纳/拒绝）、处置人、理由、最终应用结果。ROLE-A 暂不新建独立建议表，以字段需求形式提交给 B/D；若共享存储落地后 #33 仍有额外字段需求，另提具体补充申请。生成阶段在数据库写事务外调用模型并保存建议，处置阶段应用已保存建议、不重新生成替换待确认内容；桩与真实 API 必须可辨识、未知版本记「未提供」。审计流水表 `AuditLog` 不用作建议存储。
- **timestamp:** 2026-10-18T12:03:04+08:00
- **rationale:** 避免 #32 与 #33 各建一套建议表导致采纳质量统计与审计口径分裂，并复用 D 的 #31 追溯字段提案。

## `permissions.ai-suggestion-disposal`

- **value:** 处置 AI 建议（采纳 / 修改后采纳 / 拒绝）**仅 PM** 可操作；MEMBER / VIEWER 只读，不得处置。ROLE-A 的 #33 与 ROLE-C 的 #32 使用**同一个**共享处置动作，由 ROLE-B 在共享存储落地时一并加入统一 `can()`，不新增两个语义重复的 Action；分析结果可见性沿用既有汇总口径（PM 全项目，MEMBER / VIEWER 各自可见范围并标注「可见范围」）。AI 建议未经人工处置不得写入正式数据，处置须记录结论与理由。
- **timestamp:** 2026-10-18T12:03:04+08:00
- **rationale:** 冻结 #33 处置权限并与 #32 的 PM-only 口径合并为一个动作，避免同一语义出现两套鉴权与统计口径。


## `permissions.risk-status-flow`

- **value:** 风险状态流转（未处理 / 处理中 / 已解决 / 已关闭，含重开）按风险归属判权：MEMBER 只能流转 `ownerUserId` = 本人的风险、不得改他人风险（403）；PM 可流转全部；VIEWER 一律 403；非成员 / outsider 404。状态判定仍走统一 `can()`，归属以库中真实 `projectId` / `ownerUserId` 为准。风险的新增、编辑、状态流转（含重开）均写 `AuditLog`（操作者 / 动作 / 对象 / 前后值 / 时间）；AI 建议存储不走 `AuditLog`（见 `ai.suggestion-store-shared`）。线上取值：`level` = `HIGH` / `MEDIUM` / `LOW`；`status` = `OPEN` / `IN_PROGRESS` / `RESOLVED` / `CLOSED`，由风险模块 Zod 落地。健康度阈值以 `analytics.health-thresholds-and-planned-progress` 的「偏差 = 计划 − 实际」方向为准。
- **timestamp:** 2026-10-18T15:35:24+08:00
- **rationale:** 在已定 `risk.write` = PM + MEMBER 的基础上限定成员只能流转自己负责的风险，并统一审计与枚举口径，避免成员越权关闭他人风险。

## `analytics.project-close-blocking`

- **value:** 项目关闭存在阻断项（任何未 `CLOSED` 的任务，或状态为 `OPEN` / `IN_PROGRESS` 的风险）时，关闭请求一律拒绝并返回 409 CONFLICT + 阻断清单，**不允许强制关闭**；关闭与重开项目均仅 PM（`project.close`），重开同样不绕过既有校验。关闭 / 重开端点路径 `/projects/:projectId/close`，handler 位于 US-10 自己的模块，不改 `src/modules/project/`；`Project.status` 取值 `ACTIVE` / `CLOSED`，**不进共享 `ProjectView`**，由本票端点自行返回。关闭与重开动作写 `AuditLog`。
- **timestamp:** 2026-10-18T15:35:24+08:00
- **rationale:** 落实报告第 11 节「必须阻止关闭并显示清单」的要求，并固定端点命名空间、状态列可见性与审计留痕，避免绕过阻断或改动项目模块。


## `permissions.risk-flow-guard`

- **value:** 风险状态流转的鉴权在公共层显式化：`ObjectRef` 增加 `risk` 类型（含 riskId 与所属 projectId），`permissions.ts` 增加与 `task.progress` / `task.accept` 同型的对象关系判定 `risk.flow` —— PM 由 `can()` 第 3 条放行，MEMBER 仅当 `ownerUserId` = 调用者时允许、否则 403，VIEWER 一律 403，非成员 / outsider 404；业务代码不得私写角色判断。该公共层改动由 ROLE-B 落地。**在公共层就绪前，风险状态流转先 fail-closed：MEMBER 一律 403（不得流转任何风险状态）**，就绪后再放开「自己负责的风险」；此期间不得以此勾选最终 AC。本条目与此前的 `permissions.risk-status-flow` 配套：后者定义业务口径，本条目定义鉴权落地方式与过渡期行为。
- **timestamp:** 2026-10-18T19:09:17+08:00
- **rationale:** 让「成员只能流转自己负责的风险」在统一鉴权入口内表达，避免业务层自行判角色，并在公共层缺位期间以最小越权面收敛。

## `contract.close-blocking-response`

- **value:** 项目关闭被阻断时**不修改**契约 I-3 的错误信封（不给 `details` 增加 `blockers` 字段）：响应为 409 CONFLICT + 计数摘要（未关闭任务数、未处理 / 处理中风险数），并提示调用 `GET /projects/:projectId/closure-check` 获取阻断清单；清单只由该端点返回且必须按调用者权限过滤，无权者不得看到敏感任务 / 风险，也不得通过计数反推。其他客户端无需适配新信封。关闭与重开仍仅 PM、不允许强制关闭（见 `analytics.project-close-blocking`）。
- **timestamp:** 2026-10-18T19:09:17+08:00
- **rationale:** 保留已冻结错误信封的形状，同时满足「阻止关闭并显示清单」的验收要求，避免为单一场景改公共契约。

## `analytics.dashboard-window-basis`

- **value:** 项目仪表盘（`GET /projects/:projectId/dashboard`）的统计基数与计划区间**同源同窗口**：PM 取**全项目**任务；MEMBER / VIEWER 取**各自可见范围**（`visibilityScope` 结果）。分子（已关闭数）、分母（任务总数）与计划区间 `min(planStart) ~ max(planEnd)` 必须来自同一个窗口，不得混用全项目与可见范围。界面必须标注「可见范围」。据此，`analytics.health-thresholds-and-planned-progress` 中「取该项目全部任务」仅适用于 PM，其余角色按可见窗口执行；不泄漏不可见任务的存在性与日期。本条仅澄清原句的内部矛盾，其余口径（含首尾自然日、Asia/Shanghai、偏差 = 计划 − 实际、≤10 / ≤25 / >25 分级、比较用未舍入值、无任务不分级）不变。
- **timestamp:** 2026-10-18T21:53:24+08:00
- **rationale:** 原条目同句既写「取该项目全部任务」又写「MEMBER / VIEWER 用各自可见范围」，实现侧（US-10）取可见窗口更保守且与 C6「分子分母同源」自洽；经 ROLE-B 评审与项目负责人 2026-10-18「按 B 的建议」确认，显式化以避免成员与 PM 口径分裂或日期泄漏。

## `permissions.risk-ownership-change`

- **value:** 风险的**归属 / 关联变更视同流转**：`ownerUserId` 或 `taskId` 发生变更时，除 `risk.write` 外还必须通过 `can('risk.flow')` 的对象关系判定（PM 放行；MEMBER 仅当库中 `ownerUserId` = 本人；VIEWER 403；非成员 / outsider 404），与状态流转同口径。**创建风险时状态只能为 `OPEN`**，其余三态必须经流转产生。非状态字段（标题 / 描述 / 等级 / 解决说明）的编辑仍按 `risk.write`（PM + MEMBER）执行，允许成员编辑他人负责风险的非状态字段。风险审计必须记录**全部可写字段**的前后值（含 `ownerUserId` / `taskId` / `description`）。关闭项目后是否冻结项目内任务 / 风险写入仍为待定项，本条目不覆盖。
- **timestamp:** 2026-10-18T21:53:24+08:00
- **rationale:** 堵住评审 H1 的两步绕过（成员先把自己的 `ownerUserId` 写进他人风险、再走 `risk.flow` 流转），在「业务层不判角色」的前提下让归属变更与状态流转同权；同时封死「创建即 CLOSED」这类绕过，并让归属变更在审计中可追溯。
