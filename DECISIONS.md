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

## `deps.sibling-ticket-ac-layering`

- **value:** 同级票（兄弟票）之间的依赖按**三层**处理，**不得把他票的交付物写进本票 AC 的前置条件**：① **接口层** —— 签名与信封（事件信封、订阅签名、错误码）先冻结，双方各自开发、互不阻塞；② **降级层** —— 对方数据源未就绪时，本域必须**如实返回三态**（`state='unavailable'` / `total=null` / `note` 说明原因），**不得用 `0` 或空数组冒充「没有」**；③ **联调层** —— 端到端联动证据由**后交付的一方单向取证**（用对方已上线的写路径真实触发一次、观察本侧产出），不要求双方「同时已完成」。禁止条款：AC 不得写「需 X 票的真实数据才勾」，应改写为 `(a) 接口已对接 + 无数据源时如实 unavailable（本票可验收）` 与 `(b) 真数据联调（由后交付方单向取证，记为后置联调项，不列为 AC 前置）`。自查法：把各票 AC 的「需…才勾」抽成有向图，互相指向即为**验收层环**，按三层法改写。`depends_on` / `interface_depends_on` 字段语义不变，本条目只约束 AC 写法。落点：`docs/team-handoff.md` §7.1。
- **timestamp:** 2026-10-19T13:52:00+08:00
- **rationale:** #28 AC5 与 #34 AC1/AC2 的文字互为前置（消费者等生产者、生产者等消费者），使两票都无法结案；而两票说明段本就写了「接口先行、不制造硬环」——把该意图落到**可勾选的 AC** 上，避免跨域无限期互等。

## `permissions.gantt-write`

- **value:** 甘特图的**里程碑与 FS 依赖写路径**（`POST /projects/:projectId/milestones`、`PATCH|DELETE /milestones/:milestoneId`、`POST /projects/:projectId/task-dependencies`、`DELETE /task-dependencies/:dependencyId`）使用新增动作 `gantt.write`，**仅 PM**：`can()` 第 3 条放行 PM，`gantt.write` 列入 `WRITE_ACTIONS` 后对 MEMBER / VIEWER 返回 403（保持 `#26` 的「PM 建改、MEMBER / VIEWER 只读」）。按 id 操作先按 id **最小解析真实 `projectId`** 再判权，**对象不存在与非成员一律 404 且文案一致**；业务层不得私写角色判断。写入仅接受 `type='FS'`，拒绝自依赖、跨项目引用（**不可见与不存在同一条**）、重复边与 FS 环；**环判定与插入在同一事务内**（迭代式 BFS），环与重复边返回 **409 `CONFLICT`**、其余校验返回 **422**；`details[].code` 一律取自契约 I-4 冻结表（**不新增 code、不扩 `FieldErrorCode`**，前端 `FIELD_ERROR_HINT` 穷举表不受影响）。并发删除竞态（Prisma `P2025`）与事务写冲突（`P2034`）映射为 404 / 409，不落 500。**事件发布不在本条目范围**：由 D 的 `#37` 提供传输后接线，本批只在 `src/modules/gantt/types.ts` 留 `GanttEventPort` 占位与写点事件名注释。
- **timestamp:** 2026-10-19T15:10:00+08:00
- **rationale:** `docs/role-b-gantt-design.md` §7 要求「写权限必须经统一 `can()` 落实、不得用 `project.read` 充当写授权；如需新增 Action 须本票另获范围许可」；项目负责人 2026-10-19 授权「先做 #12 写路径（事件后接）」。故以最小新增动作（PM-only，不扩权给 MEMBER / VIEWER）落地，并同时冻结错误码来源与并发语义，避免后续各域各自解释。

## `uml.minimal-model-and-visibility`

- **value:** US-15（在线 UML）本期最小口径：**仅两类图** —— 用例图（参与者 / 用例 / 关系）与时序图（生命线 / 有序消息）。用例图关系**仅** `ASSOCIATION`（参与者—用例）、`INCLUDE`、`EXTEND`（用例—用例）三类；时序图消息 `sync` / `async` / `return` 三选一，`seq` **严格递增**；**不做**泛化 / 组合 / 泳道 / 片段 / 自动布局 / 自由画布语义校验。交互为**本地结构化编辑 + SVG 即时预览**，**不引入外部建模服务**。**权限**：PM 可 CRUD 与管理关联；**MEMBER / VIEWER 本期只读**（不为本期新造对象关系判定）。**敏感**：**不给图加独立敏感标记**；可见性 = **关联对象（任务 / 故事）可见性的交集**，任一关联不可见时该图对调用者**整体不返回**（404，且与「不存在」逐字一致）；**不做遮链接式降级**、不返回标题占位；解除关联或目标被删**不自动降密**（不改变既有可见性判定）。**删除**：图 → 项目 / 负责人 `Restrict`；图 ↔ 任务 / 故事的关联行 `Cascade`（关键理由：若对任务引用用 `Restrict`，会让**既有 `DELETE /tasks/:taskId` 开始失败**）；既有 `TaskDependency` 的 `Restrict` 与端点 29 的 `P2003 → 409` 错误映射仍为**独立待办**，不在本条目范围。**读取**：列表与计数同源、可见性在**本模块查询层**过滤，**不新增 `visibilityScope` 对象类型**。
- **timestamp:** 2026-10-19T16:20:00+08:00
- **rationale:** ROLE-C 在 #35 提出最小契约申请（#24 评论 6249728765），ROLE-B 逐项答复技术建议（#24 评论 6261802627），项目负责人 / 权限负责人 2026-10-19 批准（「我批准你开始做了」）。固定最小集合与可见性 / 删除语义，避免各域各自解释 UML 关系种类、出现第二套敏感模型，或为 UML 关联改坏既有任务删除行为。

## `permissions.uml-write`

- **value:** 新增动作 `uml.write`（用例图 / 时序图及其类型化关联的增删改），**仅 PM**：列入 `WRITE_ACTIONS` → MEMBER / VIEWER 一律 **403**、PM 由 `can()` 第 3 条放行；**不新增 `ObjectRef`**（写侧按项目引用 `{ kind:'project', projectId }`，PM-only 无需对象关系判定）；读侧**不新增 scope**（可见性在 `uml` 模块查询层按 `uml.minimal-model-and-visibility` 的交集口径过滤）；所有 `uml.write` 动作在 `can()` **显式拒绝非 PM**，不得落默认允许；业务层不得私写角色判断。事件（若需要）走 D 的 `#37` 端口，**本批不接线**。`#32` / `risk` 的既有权限例外**不覆盖**本动作。
- **timestamp:** 2026-10-19T16:20:00+08:00
- **rationale:** 与刚合入的 `gantt.write`（`permissions.gantt-write`）同型，避免为同一语义造两套判定；`docs/role-b-gantt-design.md` §7 与 C 的 #35 申请均要求「新 Action 须单独批准」，现由项目负责人 / 权限负责人批准后落地。

## `analytics.story-progress-aggregation`

- **value:** 甘特「故事进度」= 该故事**可见任务集合**中 `status = 'CLOSED'` 的任务数 ÷ **同一集合**的任务总数（`DONE` 不计入分子）；统计集合 = 读侧已用于故事 `min(planStart) ~ max(planEnd)` 汇总的**同一集合**（PM = 全项目，MEMBER / VIEWER = `visibilityScope` 可见范围，界面沿用既有 `basis.scopeLabel` 标注）；**无任务 → `progress = null`**（不显示 0%，沿用「算不出来就不编数字」）；故事**日期**仍为候选汇总口径（`aggregation = 'candidate-minmax'`，**不**改为已确认）；**不做**加权 / 故事点 / 工时 / 自定义权重，**不得**由部分可见子集推全局；**一致性（可测）**：同一账号同一时刻，「故事进度」与 `GET /projects/:projectId/dashboard` 的实际进度对**同一任务集合**必须给出相同结果 —— 故沿用仪表盘 `ProjectProgress` 的形状与取整规则（`closed` / `total` / `ratio`，`ratio` 保留 4 位小数，`total = 0` 时 `null`），不另立第二套表达。
- **timestamp:** 2026-10-19T16:14:00+08:00
- **rationale:** ROLE-B 建议见 #26 评论 6262495800，项目负责人 2026-10-19 批准（按 B 的建议）；沿用仪表盘已冻结的 `closed` / `total` / `ratio` 形状与 4 位小数取整，避免同一个「进度」在甘特与仪表盘出现两套口径。


## `permissions.story-status-write`

- **value:** **故事状态写入不扩权**：唯一写路径仍为端点 21 `PATCH /stories/:storyId`，鉴权沿用 `requirement.write`（**仅 PM**）；**不新增** `story.flow` 一类动作，也**不**为成员开放「按可见性改任意故事状态」。看板（`GET /projects/:projectId/board`）的写入口**只对 PM 渲染**；MEMBER / VIEWER 保持只读。故事**没有归属字段**，故不存在「成员只能改自己负责的故事」这种对象关系判定可用；任何成员写故事状态都属扩权，本期不做。
- **timestamp:** 2026-10-19T16:50:00+08:00
- **rationale:** C11 自 2026-10-17 起登记未决，ROLE-B 在 #24 提出逐项三选一（授权 / 不授权 / 最保守），项目负责人 2026-10-19 选 **(1) 不扩权**。避免为「看板上改状态」这一 UI 便利引入无归属依据的权限语义；本地 #18/#19/#20 相应收敛为「PM 写 + 审计 + 跨视图一致」。

## `legacy.requirement-status-audit-authorization`

- **value:** 授权 ROLE-B 在**登记窗口内**最小修改 `src/modules/requirement/service.ts` 的 `updateUserStory`（及必要测试），为故事状态变更补：① `AuditLog` 记录（操作者 / 动作 / 对象 / **前后值** / 时间，沿用既有审计模型与写法）；② **事件提交点**（类型占位，实现待 D 的 `#37` 端口，**本批不接线**）。**不得**改鉴权、不得改其他 requirement 行为、不得新增端点或镜像写路径。窗口：文件清单先登记并通知模块原负责人（ROLE-A），同一时刻同一文件单写；B 落笔后给出 commit 与验证输出。
- **timestamp:** 2026-10-19T16:50:00+08:00
- **rationale:** 现状端点 21 改状态**不留审计、不发事件**，直接影响本地 #18（写路径审计）与 #19（跨视图同步）；C13 原为「旧业务文件须原 owner 对具体文件 / 范围授权」，ROLE-B 在 #24 逐项申请，项目负责人 2026-10-19 选 **(1) 授权最小改动**。

## `legacy.task-start-guard-authorization`

- **value:** **排队授权**：待 ROLE-C 的 `task/` 写窗口关闭后（其 PR 合入或双方书面关闭），授权 ROLE-B 最小修改 `src/modules/task/routes.ts` 与 `src/modules/task/rules.ts`，在**真实写入口**落地 FS 开工守卫：前置任务必须 `CLOSED`（`DONE` 不算）、后继建议开始不得早于前置计划结束日次日（自然日含首尾、Asia/Shanghai），并补回归用例；**不得**新增镜像任务写路径、不得改鉴权选择与其他状态转换、不得把 `#32` 的 TODO-only / 应用规则强加给普通手工 PATCH。窗口期内 B **不修改**这两个文件；落笔前先给出改动清单与验证方案。
- **timestamp:** 2026-10-19T16:50:00+08:00
- **rationale:** `scheduling.fs-release-closed-natural-days` 已确认该规则，但真实入口 `PATCH /tasks/:taskId` 无守卫，直连接口可绕过（甘特 UI 提示不算）；本地 #13 因此无法开工、#15 该项无法勾选。ROLE-B 在 #24 逐项申请，项目负责人 2026-10-19 选 **(1) 排队授权**（尊重 C 的写窗口，不并发改同一文件）。

## `workload.no-collaborator-model`

- **value:** 本期**不引入协作人模型**：`Task` 不新增协作人字段，成员负载（`GET /projects/:projectId/workload`）与相关汇总一律按**负责人**（`ownerUserId`）定义；`#27` 的「可见范围」口径不变。C12 若后续要求协作人，须另案裁定并显式说明对负载 / 报告范围的影响，不得以「报告范围已实现」或「永久排除」两种口径默认替代。
- **timestamp:** 2026-10-19T16:50:00+08:00
- **rationale:** C12 长期未决使负载模型口径悬空；ROLE-B 在 #24 附带申请，项目负责人 2026-10-19 以「按你的来」采纳 B 建议（不引入），据此固定本期口径并保留后续另案空间。

## `uml.no-auto-declassification-guard`

- **value:** US-15 的「不自动降密」以**持久 guard** 落实，取代「仅靠交集算法不变」的口径（该口径存在真实降密路径）：`UmlDiagram` 增加 **`everRestricted Boolean @default(false)`** —— 一旦该图**曾**关联过敏感对象（建立任务 / 故事关联时目标 `isSensitive = true`，在**同一事务**内置位），**永不自动清除**；此后**非 PM 读取一律 404**（列表、`total`、详情共用同一条件，且与「不存在」逐字一致）。即：非 PM 可见 = **当前关联交集可见 且 `everRestricted = false`**；解除关联或目标被删**不**恢复非 PM 可见性。**显式降密**（PM 动作 + 审计 + 明确影响面）属**另案**，本期不提供，也不得由业务层用 `AuditLog` 或内存状态冒充主权限存储。迁移对已存在的图按「当前是否仍关联敏感对象」回填，避免历史受限图漏置位。字段与索引由 ROLE-B 落（`UmlDiagram` 属公共模型）；**置位与查询 guard 由 `uml` 服务在同一事务 / 同一 `where` 实现**。
- **timestamp:** 2026-10-21T20:30:00+08:00
- **rationale:** ROLE-C 在 #24 指出冻结设计的真实反例（图关联敏感任务 → member2 得 404；PM 删任务触发关联行 Cascade → `every(empty)=true` → 同一 member2 可见图正文，**实际可见范围扩大**），并要求持久 guard 或明确 supersedes。项目负责人 2026-10-21 裁定 **A（持久「曾经受限」标记，一旦受限非 PM 永久 404）**；既满足「不自动降密」，又不引入按用户的白名单（不违背「不给图加独立敏感标记」的本意）。

## `permissions.ai-suggestion-generate`

- **value:** AI 建议新增统一动作 **`ai.suggestion.generate`（仅 PM）**：与 `ai.suggestion.dispose` 同型加入统一 `can()` 的 `WRITE_ACTIONS` —— MEMBER / VIEWER 一律 403，PM 由判定顺序第 3 条放行，本入口不为 AI 单开角色分支。**读取复用既有 `project.read` + 查询层可见性作用域**，不新增读动作。**不实现** D 协议里的 `ai.suggestion.audit`（死能力，本批不加动作）；权限适配器对它 fail-closed（403），不留无人判定语义的空壳能力。`ai.suggestion.dispose` 的仅 PM 口径见 `permissions.ai-suggestion-disposal`。
- **timestamp:** 2026-10-21T21:00:00+08:00
- **rationale:** #31 US-11 公共接入时，D 的接口协议列出 read / generate / dispose / audit 四个能力；按 PR #82 评审结论与 B 的裁定，生成与处置均仅 PM、read 复用 `project.read`、不引入没有动作的 audit 能力，避免同一语义出现两套鉴权。

## `ai.suggestion-store-shape`

- **value:** AI 建议共享存储的落地形状（`src/shared/ai.ts` + 迁移 `20261021150000_add_ai_suggestion_store`）：**三张表** `AiSuggestion`（唯一真源 `status`、`projectId` 外键 RESTRICT、生成时间 `generatedAt` 为 `DateTime`）/ `AiDisposition`（`suggestionId` **主键** 1:1 子表，外键 CASCADE）/ `AiApplication`（`suggestionId` 主键 1:1 子表，外键 CASCADE；`application.status` **不落库**，为 `AiSuggestion.status` 的派生视图）。**唯一最终处置**由 `AiDisposition.suggestionId` 主键在数据库层兜底（并发下第二条处置 P2002），`finalizeDisposition` 再叠加唯一真源 `PENDING → DISPOSED` 的**条件更新（CAS）**。**幂等三元组** `(suggestionId, actorUserId, requestId)`：同 actor 同 requestId 同 `contentDigest` → 重放（返回首次结果）；异 digest → 409；不同 actor 不算同一请求。`contentDigest` 由 `SHA-256_CANONICAL_JSON_V1` 规范 JSON 规则计算（**稳定键序 + UTF-16 码元比较，不用 `localeCompare`**）。**理由规则**：`ACCEPTED` 可不填；`MODIFIED` / `REJECTED` 必填（校验层强制）。应用结果的 `updateApplication(id, patch, expectedStatus, tx?)` 只做**字段级补丁 + CAS**（不整行覆盖），CAS 期望状态集合 `{DISPOSED, APPLICATION_FAILED}`（**应用失败可重试**）。事务由调用方传入、适配器**不自行提交**（缺省时内部事务不提前提交）。**可见性在查询层**：列表 / 统计用 `visibilityScope()` 生成 `where`，PM 全量、MEMBER / VIEWER 按其 `inputScope` 对象引用过滤，不可见与不存在同一条 404；列表另加行数上限 `AI_SUGGESTION_LIST_LIMIT = 200` + `truncated` / `total` 截断标记。**仅合成数据可用外部 API**：`EXTERNAL + PROJECT_DATA` 一律拒绝。**不得**用 `AuditLog` 当建议存储。
- **timestamp:** 2026-10-21T21:00:00+08:00
- **rationale:** 落实 `ai.suggestion-store-shared` 的字段与端口提案，并固定 PR #82 的 H1/H3/M4/M7/M8/L12/L15 结论为可复用的公共形状，使 #32 / #33 复用同一套存储而不各自建表。

## `events.business-domain-production`

- **value:** 业务域事件的**生产接线**口径（本批接入甘特 5 个 + 需求 1 个；风险域同口径待 A 落地）：域内写路径必须在**业务写入的同一个 `$transaction` 内**调用 `repository.appendIfAbsent(envelope, tx)` 追加事件 —— 适配器**不自行提交、不派发订阅者**（派发是 `app.events.publisher` 的职责）。**发布失败 = 业务写入回滚**（刻意：宁可业务失败，也不产生「业务成功但事件丢失」）；**无 outbox、不承诺 exactly-once**。**适配器位置**：放各自模块目录（`src/modules/<domain>/event-port.ts`，导出 `create<Domain>EventPort({ repository, newId?, now? })`），**禁止** `src/db/** → src/modules/**` 与 `src/shared/** → src/modules/**` 反向 import；信封补齐（`id` / `schemaVersion` / `storedAt`）集中由 `src/shared/events.ts` 的**纯函数** `buildDomainEventEnvelope(input, { id, storedAt })` 完成（该文件会被前端打包，**不得** import `node:crypto` / `node:process`）。**组装**：`src/app.ts` 用**同一个** `PrismaEventRepository` 实例同时供 D 的基础设施与域内适配器使用，避免「查询看不到域内写入」的裂缝；域端口作为 `RouteContext` 可选字段注入，插件缺失时 **fail-fast 报组装缺失**，**不得**静默跳过发布（也**不得**提供 no-op 默认实现）。**命名规范** `<domain>.<object>.<action>`（全小写点分三段，action 用过去式），事件目录（名字 / object / 载荷 / 幂等键 / 敏感判定来源）登记在 `src/shared/events.ts` 的「业务域事件目录」表，新增事件必须登记。**幂等键（确定性）**：创建 / 删除 → `<eventName>:<objectId>`；更新 / 状态变更 → `<eventName>:<objectId>:<occurredAt ISO>`（同毫秒内同对象同动作因键相同被去重为 `DUPLICATE`，属**有意**的可接受行为）；唯一约束仍由 `(projectId, eventName, idempotencyKey)` 兜底。**敏感规则（契约 I-6，强制）**：只要事件涉及的 `task` / `story` 里存在敏感对象（依赖两端任务、里程碑经 `TaskMilestone` 关联的任务、敏感故事），该事件**必须**以敏感事件发布（`sensitive: true`，载荷**只能**是 `{references: EventObjectRef[]}`），否则 `src/db/event-repository.ts` 的查询层过滤看不见它、会泄漏给非授权成员；`before` / `after` 等业务值留在同一事务的 `AuditLog` 审计行，**不**重复进事件载荷。敏感判定必须在**同一事务内**查（`DELETE` 分支须在级联清关联行**之前**读）。
- **timestamp:** 2026-10-21T22:10:00+08:00
- **rationale:** 事件基础设施（PR #86）就绪后，业务域若不接线则 `DomainEvent` 表永远为空、查询 / 重投端口无实际语义；本口径把「同事务、可回滚、按可见性过滤、幂等、可登记」固化为所有域复用的一套规则，避免各域自拼信封、自定命名与幂等键而彼此漂移。


## `attachments.storage-and-cleanup`

- **value:** 任务附件（#36 公共接入）的落地口径。**存储**：元数据落 `Attachment` 表（迁移 `20261023050228_add_attachment`），实体文件落项目根 `var/uploads/`（加入 `.gitignore`，**不注册为公开静态目录**）；磁盘存储键 = 服务端 UUID + 已验证扩展名（`storagePath` **唯一**，不覆盖写入），原始文件名只作元数据、**绝不参与路径拼接**；`LocalAttachmentStorage` 必须校验解析后仍在存储根内（防目录穿越）。**公共类型**：`src/shared/attachments.ts` 为唯一权威定义，`src/modules/attachment/contracts.ts` 只 re-export。**删除语义（裁定 1，明确不用 `Cascade`）**：`Attachment.taskId` **可空** + 外键 `onDelete: SetNull` —— 任务删除**不得**被附件关系阻塞；任务删除在**同一事务**内把该任务 `ACTIVE` 附件标为 `DELETING`（记录 `deleteRequestedAt`），事务提交后由清理执行器 `runAttachmentCleanup` 扫描 `DELETING` / `CLEANUP_FAILED`（按 `state` 而非 `taskId`，因任务行删除后 `taskId` 已 SetNull）删除物理文件：成功 → 删行；失败 → 置 `CLEANUP_FAILED` + 累加 `cleanupAttempts` + 记录 `cleanupLastError`（安全错误码 `FILE_DELETE_FAILED`），可重试。**绝不允许先删实体**；`Cascade` 会让清理状态随行消失、失败无法重试，故排除。**可见性**：列表 / 详情只返回 `state = 'ACTIVE'`（`DELETING` / `CLEANUP_FAILED` 对用户不可见），过滤在**查询层**（`WHERE taskId = ? AND state = 'ACTIVE'`），不取全量后内存剔除；单对象鉴权走统一 `can()` 现查任务 / 成员 / 角色 / `objectVisibility`，敏感任务未授权成员读 / 写 / 下载与「不存在」同一条 404。**权限**：读 / 下载复用 `project.read`，写复用 `task.progress`（均为既有 `Action`，**不新增 Action、不写角色名字面判断**）；下载响应必须带 `Content-Disposition: attachment`。**组装**：`src/app.ts` 显式注入 prisma 仓储 + 本地存储 + 权限适配器 + service；`src/routes.ts` 注册 `registerAttachmentRoutes`，`RouteContext.attachmentService` 缺失即 fail-fast（注册延到 boot 阶段并用 `hasRoute` 守卫，以兼容 D 模块测试的预注册）。
- **timestamp:** 2026-10-23T13:20:00+08:00
- **rationale:** 落实 `attachments.policy` 的「元数据入库、实体 `var/uploads/`、任务成功删除时清理且失败可追踪重试、删除失败不先删文件」，并固定 B 的数据库删除方案（SetNull + 清理状态机 + 查询层可见性 + 既有 Action 复用），避免清理状态丢失、任务删除被附件阻塞与敏感附件泄漏。
