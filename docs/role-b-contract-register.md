# ROLE-B：最小契约台账与申请草稿

> 本地任务 #02 的交付物。本文只登记已知结论、实现差异、待核对接口及授权申请草稿；**未发布任何留言、未修改标签、未代其他角色确认，也不授权代码实施**。
> 已确认业务规则来自项目负责人本地确认稿与 `DECISIONS.md` 最新适用条目；接口候选需相应角色书面核对，不能把“有草稿”当成“已冻结”。

## 1. 来源与适用范围

- 代码基线：`398aa76d02f66ce9d62e4e1c340de408f15a1f0f`，详见 [基线复核](role-b-baseline-review.md)。不以较老工作区 HEAD 冒充当前 main。
- 本地授权与规则：`DECISIONS.md`、`docs/role-c-issue-32-confirmation.md`、`docs/role-d-start-confirmation.md`。
- 历史公开记录：[文档 PR #39](https://github.com/githubleelee/AIManagement/pull/39)（已关闭，内容并入 #42）与 [#24 上轮补充确认](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6232875888)。本轮已发布 [#24 集中同步](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6245135447) 与 [#32 核对请求](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6245135807)。
- ROLE-A 批复与落地：`docs/role-a-issue-30-confirmation.md`、`docs/role-a-issue-30-public-support-notice.md`、`docs/role-a-issue-33-group-reply.md`、`docs/role-b-issue-33-impact-notice.md`（均在 main）。
- 本轮设计：[C 最小数据契约](role-b-scheduling-data-contract.md)、[C 事务协议](role-b-scheduling-transaction-proposal.md)，两者均 DRAFT、未冻结。
- 本文编号 C1–C13 是 GitHub #24 的议题编号；本地任务编号见 `docs/tasks/role-b-development.md`，两套编号不可混用。

## 2. 已确认、实现状态与待确认台账

“待确认人”只对尚缺的部分负责；已确认的结论不重复申请业务拍板。运行时交付、接口设计冻结、线上同步是不同状态。

| 项 | 已确认或现状 | 尚缺事项 / 确认人 | 影响与可先做部分 | 证据 |
|---|---|---|---|---|
| 公共文件归属 | B 单写 shared、schema/迁移、routes、app、前端骨架、路由文档、uploads 忽略规则 | 每批补丁范围和单写排期由 B 登记；不假称原 owner 已同意 | 可接收独立提案；不一次改完所有公共文件 | `ownership.public-files-single-writer` 最新条目 |
| C1 健康阈值 | **A 域已确认并入库**（2026-10-18）：偏差 = 计划时间进度 − 实际进度；≤10pp 健康、10–25pp 预警、>25pp 风险（未舍入值比较）；计划时间进度 = 已过自然日数 ÷ 计划总自然日数（`min(planStart)~max(planEnd)`、含首尾、Asia/Shanghai）；无任务显示「暂无计划数据」不分级。见 `DECISIONS.md` `analytics.health-thresholds-and-planned-progress` | B 负载侧仍不设「超过 N 即过载」阈值；跨域复用时不得与 B 的负载口径混用 | #30 批复；`DECISIONS.md`；基线 |
| C2 FS | 已定前置 CLOSED，DONE 不放行；自然日含起止，后继建议不早于前置计划结束次日 | 依赖模型与真实开工入口实现；B 甘特旧入口的具体授权/现写者交接 | 可设计数据与时间轴，不再重复询问 DONE/CLOSED 二选一；真实守卫未实现不得勾 AC | `scheduling.fs-release-closed-natural-days`；基线 §4 |
| C3 时区 | 已定全项目 Asia/Shanghai，planEnd 次日 00:00 仍非 CLOSED 逾期 | A 工作台仍用 UTC，需由 A/对应写者收敛实现；B 登记协调 | 不再把 A 域时区标待拍。基础非 CLOSED 计数不依赖日期；日期相关跨视图验收待一致后实测 | `timezone.project-wide-asia-shanghai`；`workbench/service.ts:41/153-158 @398aa76` |
| C4 AI | 演示先本地桩、后可接外部 API；敏感默认排除，秘密/真实个人信息/未授权资料禁外发；不宣称原 AC13 | D 的具体端口/工厂提案；供应商、模型、地址在真实接入前确定 | AI 与事件两类提案独立接收；不等供应商或四模块全齐，不绑定 SDK | `role-d.ai.demo-external-api-scope`；D 确认稿 |
| C5 UML | 未确认，C #35 不在本轮 B 实现范围 | B + C + 项目负责人 | 仅登记，不转成 B 绘图实现，不扩 #32 授权到 #35 | C 确认稿 §1；#24 C5 |
| C6 基础负载 | 非 CLOSED 含 DONE；PM 全局，MEMBER/VIEWER 可见范围；AI 再排敏感并重算子集 | 响应字段/受众形状与 C 核对；故事进度/空值等不在基础负载决定中 | 不因过载阈值未定阻塞基础负载；不向无权角色/AI泄漏隐藏计数 | `scheduling.load-aggregation-baseline`；数据契约 §2.4 |
| C7 附件 | D 白名单、MIME 联合校验、10,000,000 B、var/uploads、鉴权下载与失败清理已定 | D 单能力字段/路由/组件补丁；旧 task 删除接入超出公共范围时另申请 | B 后续最小挂载/忽略规则，不代 D 写业务，不把前端挂载授权当后端授权 | `attachments.policy`；D 确认稿 §4 |
| C8 通知 | D 六类、接收者、去重、业务成功/条件成立计时和 ≤60 秒规则已定；时区遵循全项目 C3 | D 事件/通知接入；各域真实生产者交付 | 可先设计基础订阅/存储/页面；模拟事件不能替代六类真实送达 | `notifications.events-timing-timezone`；D 确认稿 §5 |
| C9 项目关闭 | 关闭阻断规则/入口归属仍待落定，未见 close endpoint | 项目负责人 + A、相关技术 owner | 不由 B 增造关闭路径或代 A 实现风险逻辑 | #24 C9/C13；基线未决项 |
| C10 进度 | 原交接给出 closed/total 口径，但书面确认及甘特故事汇总边界仍需收口 | 项目负责人 + A；B 提故事汇总/空值候选 | 不把 Task.progress 的存在当成故事汇总公式已批准；DONE 不冒充 CLOSED | #24 C10；甘特 AC3 |
| C11 权限 | #32 全部 PM-only 已局部确认；main 已有 task.progress/task.accept 成员关联动作；普通故事/任务写仍限 PM | 看板成员状态操作等其他矩阵仍待权限负责人/项目负责人 | 记录现有行为，不回滚 A 已合动作、不扩大其他票权限；看板可先做只读和写路径方案 | `scheduling.permission-pm-only`；`authz/permissions.ts:146-164 @398aa76` |
| C12 协作人 | 未确认；当前 Task 无协作人字段 | 技术负责人 + 项目负责人 + A | 基础负载先以负责人定义；不擅称协作人报告范围已实现或永久排除 | #24 C12；C 确认稿未一并批准 |
| C13 旧业务授权 | 公共层已授权 B；C #32 可按登记范围及实际交接窗口改 task/routes.ts、rules.ts、必要测试；**A #30 可在向 B 登记窗口后自改 `src/routes.ts` 注册行与前端骨架挂载行**（2026-10-18 批复） | #25 requirement 后端、#26 真实开工守卫仍需各自具体授权；#32 写窗口实际状态待核对 | C/A 例外均不覆盖 B 甘特开工入口，也不覆盖其他业务文件；不假定写锁空闲 | `arch.legacy-task-controlled-extension`、`ownership.public-files-single-writer`（2026-10-18）；#30 票面挂载授权块 |
| 六状态 | main 已有六态/Zod/读映射、progress/blockedReason 与验收记录 | 完整转换规则及普通 PATCH 与验收入口的适用差异仍需对应负责人统一 | 不再以 CLOSED 不存在阻塞，但不把枚举支持当完整状态机已验收 | 基线 §2/§2.2 |
| #32 公共读/写协议 | 已定同事务最终鉴权/复核、仅 TODO 日期、整份原子、唯一处置、重试先鉴权、模型调用在写事务外 | C 核对请求身份/snapshot/事务端口；D 对对应 AI/事件签名补提案 | #43 与 #46 并行；C 模型/后端未实现不阻塞设计冻结；不以 D 两提案全齐为前提 | C 确认稿 §7–10；事务提案 §5–§13 |

## 3. B 三票的最小开工边界

| 票 | 本轮可完成的设计 | 仍未获本轮实施授权 / 尚缺部分 |
|---|---|---|
| GitHub #27 负载 | 字段、查询过滤、成员详情、角色矩阵、与工作台同源比较、可见范围/AI基数分离 | 编码与公共挂载的具体批次；异常历史成员关系等数据边界需明确；不能因 CLOSED 已存在就跳过验证 |
| GitHub #26 甘特 | 最小模型提案、FS 图校验、查询聚合/展开、里程碑与真实入口方案、逐 AC 验证计划 | 故事进度/空值/里程碑汇总口径；旧开工入口的具体授权/写窗；事件接入契约；不新增高级调度 |
| GitHub #25 看板 | 正式三列、既有读写路径复用、只读权限/敏感计数、原 PATCH 审计和事件扩展申请 | requirement 具体文件授权、适用 C11、事件提交语义；不新建看板镜像写路径或自造状态 |

旧 #27→#26→#25 仅优先级；以上设计及独立目录工作不增加跨票硬依赖。本轮只执行设计，未授权在这些目录写业务代码。

## 4. 申请与同步草稿（均未发送）

### 4.1 B 域确认 / #24 台账更新草稿

```text
我是 ROLE-B / githubleelee。本条拟同步本地最新确认及实现基线，尚待核准发布。
- 项目负责人已明确公共文件由 B 单写；不把旧“B 不直接修改”作为阻塞，也不声称原 owner 单独同意。
- C2=CLOSED 实际放行；C3=全项目 Asia/Shanghai；基础 C6=非 CLOSED 含 DONE及授权基数。
- #32 的 PM-only 权限窄例外和 C 旧 task 限范围写窗，不代表其他 C11/C12或状态转换全部批准。
- 最新 main 398aa76 已有六态及工作台/验收；B 三票、里程碑/依赖和公共事件等仍未交付。
- 工作台当前 UTC 日期与已定全项目日期口径有实现差异，登记交对应业务写者收敛，不重新拍板时区。
- 新的数据/事务文件为 DRAFT，未取得 C 对字段和协议的书面核对；D 的对应提案按能力分批接收。
```

上述草稿不能自动等同本地 #03 或 #42 的发布完成，也不自动改变标签。

### 4.2 GitHub #25：旧故事写路径最小扩展申请

```text
申请角色：ROLE-B / githubleelee；用途：GitHub #25，不扩其他故事功能。
拟申请文件：
- src/modules/requirement/service.ts：updateUserStory 中发生状态变化的既有写路径，补必要 before/after 与审计。
- src/modules/requirement/plugin.ts：既有 PATCH /stories/:storyId 的必要依赖传递/状态事件接入，不另注册镜像写入口。
- src/modules/requirement/requirement.story-read-update.test.ts：仅补上述路径的审计、越权与状态变更回归；本票新测试放 board 自身目录。
保留 requirement.write / can / visibilityScope 与原字段校验，不借看板扩成员写权限。
公共事件签名/提交与失败语义按 D 提案再核对；不预设 outbox 或静默失败策略。
请明确授权本票修改的文件、函数范围及当前写者/移交窗口；未获授权前不改这些旧文件。
```

依据：`requirement/service.ts:860-884`、`requirement/plugin.ts:854-917 @398aa76`；相关既有测试路径已在快照核对。该申请不使用 C #32 的 task 授权。

### 4.3 GitHub #26：真实开工入口 FS 守卫范围申请

```text
申请角色：ROLE-B / githubleelee；用途：GitHub #26 的真实 FS 放行 AC。
已确认规则不再申请二选一：前置必须 CLOSED，DONE 不放行。
先登记现有写入口：src/modules/task/routes.ts（PATCH /tasks/:taskId，现基线402-525）及src/modules/task/rules.ts。
请与当前任务流写者核对哪些操作会构成“开始执行”、守卫的共同落点、需要修改的具体函数/测试及排他窗口。
至少不得通过直接状态更新绕过前置校验；完整状态转换细节不由B单方制定。
这不是 C #32 仅日期应用窗口的延伸；不得借该窗口擅改普通状态/验收规则。
任何超出已登记文件的抽取或新文件另提明确范围，不默认由B接管整个task模块。
```

此处只提交范围问题和候选落点，不宣布已获旧模块许可，也不在本轮写守卫代码。

### 4.4 C #32：最小消费与写窗口核对草稿

```text
请 ROLE-C / xichoutrees 分别核对：
1. 数据契约 §5：最小字段、受众/AI子集、缺失约束、读取方式及应用后的同源刷新。
2. 事务提案 §12：统一计划写能力、事务内权限/旧规则复用、请求身份、快照及提交/事件边界。
3. 给出旧 task/routes.ts、rules.ts 和必要测试的具体改动清单及期望交接基线。
项目负责人对 #32 的限范围许可已经明确，不重复索要原 owner 同意；仍需核对当前写者/实际窗口，不能假定空闲。
两份提案都可先收口已明确部分，不等待 B 两票整体验收，也不等待 D 四模块齐备。
```

本轮不联系 C/A 或发帖；待用户另行批准对外动作，再引用具体文档/提交并取得真实书面结论。

### 4.5 A 工作台日期实现收敛提示草稿

```text
规则已确认：全项目 Asia/Shanghai，不再是 C3 业务待定。
main 398aa76 的 workbench/service.ts isoToday/basis 仍按 UTC；请对应负责人定向收敛并保留日期边界测试。
B 不代写 A 业务；负载基础计数可先按非 CLOSED 做，日期相关跨视图最终一致性需真实实现对齐后核验。
```

## 5. 接口、公共补丁与验证纪律

- D 的 AI/事件提案先交最小签名、工厂/注入与示例，哪个先就绪先收，不要求 schema/四模块一起齐备；未见公开提案不等于 D 没有私下实现。
- C 的生成只读消费；确认可经统一受控能力写 TODO 的两日期，B 视图随 Task 更新，不直接写派生聚合/依赖/里程碑。
- Actor/项目归属来自当前会话及存储目标，不凭调用方自报角色或 projectId 放权；#32 读/审计同样 PM-only。
- can/assignment 当前 PrismaClient 签名问题交 #46；不在 C 业务里复制角色判断，不用类型强转假称事务安全。
- 不把未知依赖当作空数组；数据可用性包装的具体名字仍候选。正式应用必要约束未能核验时，不能标验证成功或跳过后写计划。
- 相同项目、负责人、调用账号及授权视角比较负载；不能把工作台五块相加、混用项目总计或用截断明细长度冒充总数。
- 本地桩、模块测试、真实 API、真实生产方联调分栏；样例/测试设计不冒充运行通过。

## 6. 本文完成检查

- 每项均记录已确认/待补/待确认、责任人、影响和来源；不把已定 C2/C3/基础 C6 再标待拍。
- 未决 C11/C12/转换/汇总细节保留；三票文件边界、敏感权限与后续验证有明确记录。
- #25/#26 的具体旧文件申请与 #32 例外分开，草稿未发布，无代码或标签改动。
- 本文供本轮设计任务引用；后续接口冻结、授权窗口与真正实现分别留证，不因 #02 台账完成自动授权编码。

---

## 7. 2026-10-18 追加登记（A #30 / #33 批复与落地、验证、发布）

> 本节为 #21（持续跟踪）的追加登记，保留前文历史不改写；与上文冲突时以本节为准。

### 7.1 已落地并验证的公共支持

| 项 | 内容 | 证据 |
|---|---|---|
| A #30 公共层 | `Action` 新增 `risk.write` / `project.close`；`permissions.ts` 第 5.5 条（VIEWER 403、MEMBER 放行）与 `project.close` 入 `WRITE_ACTIONS`；`Risk` 模型 + `Project.status` + 迁移 `20261018033000_add_risk_and_project_status`；`test-support` 清理顺序；两个 db-schema 快照 + `t0-gap-fix` 权限断言 | PR #43 → main；`DECISIONS.md` `permissions.risk-and-project-close` |
| 验证 | `npm run typecheck` exit 0；`npm test` 49 文件 / 1182 测试全绿（首跑暴露 `Project` 列序断言，已修） | PR #46；`docs/ai-records/B/issue-30/evidence/B-I30-20261018-bmaster-06-{typecheck,vitest}.txt` |
| A 的挂载窗口 | A 在向 B 登记后自改 `src/routes.ts` 注册行与前端骨架页面路由 / 左导航挂载行；其余公共文件仍 B 单写；`docs/frontend-routes.md` 仍 B 维护 | `ownership.public-files-single-writer`（2026-10-18 11:45:50）；`team-handoff.md` §4.1；#30 票面 |
| A #33 追加批复 | 处置 AI 建议**仅 PM**、与 #32 共用**同一个** Action；不批 A 独立建表，改为共享「建议 + 处置」存储（D 的 #31 提字段、B 落公共层、A/C 复用） | `DECISIONS.md` `ai.suggestion-store-shared`、`permissions.ai-suggestion-disposal`（12:03:04） |
| A 的进度 / 健康度 | 实际进度 = 已关闭 ÷ 总数；计划时间进度与三档阈值已冻结；关闭阻断 409 + 清单；`Project.status` 不进共享 `ProjectView` | `analytics.health-thresholds-and-planned-progress`；`role-a-issue-30-confirmation.md` |

### 7.2 发布与文档状态

- 已合并：PR #42（文档同步 + AI 记录）、#43（#30 公共支持）、#44（转发通知）、#45（批复归档 + DECISIONS 恢复）、#46（列序修复 + 验证证据）、#47（A 自挂载 / #33 对齐）；PR #39 已关闭（内容并入 #42）。
- 已发布评论：#24 集中同步、#32 核对请求、#26/#27/#25 三条、#21 指针、#30 协调与两次通知。
- `DECISIONS.md` 在 main 共 20 条；`permissions.risk-and-project-close` 曾被误删并已恢复（append-only）。

### 7.3 仍未解除的阻塞（确认人 / 影响 / 移交）

| 未决项 | 确认人 | 影响 | 状态 |
|---|---|---|---|
| #43 数据契约 §5 与 #46 事务协议 §12 的书面核对（含生成 / 读 / 审计是否与处置动作分离） | ROLE-C | 两文件冻结与 #44/#45/#47 的实现 | 已发布请求，**未见回复** |
| D 的最小 AI / 事件端口提案（#31 / #37） | ROLE-D | 共享建议存储字段、事件提交语义、#24/#25/#26/#28/#29 | #31/#37 均 0 评论；已登记「未见公开提案 ≠ 无实现」 |
| A 的 US-10 分支与挂载登记清单 | ROLE-A | #30 实现与挂载、`needs-confirmation` 摘除 | 远端无 US-10 分支 |
| #25 requirement 具体文件授权、#26 真实开工守卫授权 | 原 owner / 任务流写者 | #17/#18/#13 | 申请已发布，未见回复 |
| C11（成员能否改故事状态等）、C12（协作人） | 权限负责人 / 项目负责人 | 看板写路径、负载模型 | 仍未确认 |
| C10 故事级进度汇总、C5 UML | 项目负责人 + A / B+C | 甘特 AC3、C #35 | 未确认 |
| D 的附件 / 通知 / 组件补丁 | ROLE-D | 本地 #32/#36/#40 等 | 未提交 |

### 7.4 结论

- B 域已用规则与授权均可追溯到 `DECISIONS.md` 条目、批复稿、PR 或评论链接；未决项均写明确认人与影响。
- 本票（#21）为持续台账：本节随新增确认追加，不改写历史；当前快照满足其 Done when。

---

## 8. 2026-10-18 追加登记：authz 单批改动（`risk.flow` + C 的窄 Pick 签名）

> 依据：`DECISIONS.md` `permissions.risk-flow-guard`（2026-10-18T19:09:17+08:00，随 PR #56）、
> [#21 分派](https://github.com/githubleelee/AIManagement/issues/21#issuecomment-6249175879)、
> C 在 #24 的请求（[comment](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6247293283) 第 2 节）。
> 登记评论：[#24](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6249399218)。

| 文件 | 改动 | 归属 |
|---|---|---|
| `src/shared/types.ts` | `Action` 增 `'risk.flow'`；`ObjectRef` 增 `{ kind: 'risk'; projectId; riskId }` | B 单写 |
| `src/modules/authz/permissions.ts` | 新增导出 `AuthzDb`（实际 delegates 的窄 `Pick`；`PrismaClient` 与 `Prisma.TransactionClient` 均满足）；`createAuthorization` / `loadTarget` / `roleIn` 参数改用 `AuthzDb`（调用语义不变）；`loadTarget` 增 `case 'risk'`；新增第 4.6 条 `risk.flow` 对象关系判定（VIEWER 403 / owner 放行 / 否则 403 / 不存在 404） | B 单写 |
| `test/authz-risk-flow.test.ts`（新增） | 8 例：PM、MEMBER 本人、MEMBER 他人、VIEWER（即使被指为负责人）、非成员/outsider、不存在 riskId、跨项目按真实归属 404、事务客户端内 `can()` 可用 | B |

**未做 / 不做**：错误信封保持契约 I-3 形状（`contract.close-blocking-response`：409 + 计数摘要 + `GET /projects/:projectId/closure-check` 清单）；不改 A/C/D 业务模块；`task/rules.ts` 的签名放宽由 C 在其登记窗口内自行完成。

**验证**：`npm run typecheck` exit 0；`npx vitest run test/authz-risk-flow.test.ts` 8/8；`npm test` 全量 53 文件 / 1224 用例通过（基线 52/1216）。落地后已通知 A 放开「成员流转自己负责的风险」（#30）。
