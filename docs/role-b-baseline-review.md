# ROLE-B：最新 main 基线复核与逐条验收对应表

> 本地任务：#01。本文记录静态源码事实、可复用前提、缺口和后续验证方法，**不把代码存在、PR 合并或历史测试记录当作本轮 AC 已通过**。
> 本轮没有运行应用测试、构建、迁移或 seed，没有读取真实数据库或密钥，没有修改业务代码。

## 1. 基线与方法

| 项目 | 本轮证据 |
|---|---|
| 最新 main | `398aa76d02f66ce9d62e4e1c340de408f15a1f0f`，本轮 `git fetch origin main` 后固定快照 |
| 代码链接 | https://github.com/githubleelee/AIManagement/tree/398aa76d02f66ce9d62e4e1c340de408f15a1f0f |
| 当前工作区 HEAD | `fb5cee2537b8537e64106857080b98af68dad563`；保留其未提交材料，未切换、合并或覆盖 |
| 只读源码快照 | `/tmp/role-b-main-398aa76.GvfwFS`，由该 main 的 src/web/docs/test/package.json 导出；下文相对路径和行号均对应此 commit |
| 新 main 增量 | 已合 PR #40（US08 工作台）、PR #41（US09 验收）；合并事实不是本轮测试证据 |
| 业务授权来源 | 工作区 `DECISIONS.md` 最新适用条目及 `docs/role-c-issue-32-confirmation.md`；本地新决定与远端尚未同步的历史说明分开处理 |
| AC 来源 | 本轮只读获取 GitHub #25/#26/#27 正文；逐条比对 main 的 `docs/handoff-issues.json`，三票全部一致，共 19 条 |

线上 AC 快照：[#25](https://github.com/githubleelee/AIManagement/issues/25) 更新于 `2026-10-17T09:26:12Z`；[#26](https://github.com/githubleelee/AIManagement/issues/26) 更新于 `2026-10-17T09:26:14Z`；[#27](https://github.com/githubleelee/AIManagement/issues/27) 更新于 `2026-10-17T09:26:16Z`。这些时间是 GitHub 正文版本时间，不是功能验收时间。

## 2. 当前事实、复用点与限制

| 事项 | 事实与源码证据 | 对 B 的影响 |
|---|---|---|
| 任务六状态 | `src/shared/types.ts:38`、`src/shared/validation.ts:20` 已有 TODO/DOING/BLOCKED/SUSPENDED/DONE/CLOSED；`task/routes.ts:78/89/185` 解析、映射并读取六态 | 删除“无 CLOSED / 尚无六态”的技术不存在阻塞；不能因此宣称所有转换规则已确认 |
| 状态落库 | `src/db/schema.prisma:127` 的 Task.status 为 String（模型起始 :117）；main 已有 progress/blockedReason、AcceptanceRecord 对应迁移 | 六态常量扩展本身无需数据库 enum 迁移；真实历史数据有效性未在本轮验证 |
| 故事状态 | `src/shared/types.ts:32`：DRAFT/PLANNING/DONE | 看板复用三态，不与任务六态混用 |
| 任务计划与汇总输入 | Task 有 planStart/planEnd、ownerUserId、status、progress；故事没有独立计划日期字段 | 甘特需设计任务向故事汇总；不反向新建故事排期状态 |
| B 三个模块 | main 未见 board/gantt/workload 模块及其页面挂载；集中注册见 `src/routes.ts`、`web/src/routes.tsx` | 三票尚未交付，不因共用任务读接口存在而判 AC 通过 |
| 甘特模型 | schema 无 Milestone/TaskDependency | 字段、索引、迁移、里程碑汇总和 FS 校验为待实现范围 |
| 故事写路径 | `src/modules/requirement/service.ts:860-884` 的 updateUserStory 直接更新，无审计/领域事件 | #25 必须在具体旧文件授权后补齐，不能旁路复制写入口 |
| 任务读路径 | `src/modules/task/routes.ts:204/248/373`：按故事、按项目及详情；项目列表可按 ownerUserId 过滤 | #27 可复用字段、权限和查询范式，但仍需成员负载聚合 |
| 基础权限 | `authz/permissions.ts:123` 按存储目标和当前项目成员判权；普通 requirement.write/task.write 非 PM 403 | 看板不得绕过 requirement.write；非成员/不可见对象按 404 处理 |
| 已有条件动作 | `authz/permissions.ts:146-163` 的 task.progress/task.accept 按负责人/验收人关系允许成员，VIEWER 不获写权 | 不能再概括“全部写操作都仅 PM”；#32 的 PM-only 新动作不改变这些已有动作 |
| 可见性过滤 | `authz/permissions.ts:182`；`workbench/service.ts:109-131` 将权限与业务条件组合进查询 | B 列表、计数共用过滤条件，禁止查询后剔除敏感再计数 |
| 事务内复用 | createAuthorization 和 assertTaskAssignment 仍硬编码 PrismaClient，见 `permissions.ts:122`、`task/rules.ts:53` | #32 仍需事务客户端接入方案；问题是当前签名，不是没有事务能力 |
| 事务样例 | `acceptance/service.ts:250` 已有交互式事务与条件更新；验收入口鉴权在事务前 | 可参考事务范式，但不能声称已满足 #32 同事务最终鉴权和批量计划应用 |
| 公共运行时 | 未见事件/AI/通知/附件运行时；`acceptance/types.ts:124-139` 的事件类型明确未接线 | D 公共端口仍需提案；占位类型和模拟事件不替代真实集成 |
| 新增 UI | routes/layouts 已挂工作台和验收；无 board/gantt/workload/scheduling 入口 | B 的新挂载应基于新 main，避免覆盖 A 已合 UI |

### 2.1 工作台一致性：区分计数与日期问题

`src/modules/workbench/service.ts:153` 的“待办”条件为本人负责且 `status != CLOSED`，包含 DONE，与基础 C6 非 CLOSED 负载可对齐。该查询覆盖本人参与的所有项目；比较单项目负载时应使用相同项目/负责人/授权范围，**不能把五块计数相加当作负载**，各块有重叠，且明细有每块最多 50 条限制。

同文件 `isoToday():41` 用 UTC 日期，`basis:158` 也标 UTC；最新本地决策已定全项目 Asia/Shanghai。此差异影响逾期/近期日期边界，**不直接改变单纯非 CLOSED 任务数量**。后续须与 A 协调实现收敛，不重新把 C3 标为待拍，也不由 B 越权修改 A 业务。涉及日期的跨视图最终一致性，在收敛和实测前不得宣称通过。

### 2.2 状态值支持不等于完整转换规则或 FS 已实现

`src/modules/task/routes.ts:402-525` 选择 task.write/task.progress/task.accept 后执行形状、原分配规则和 BLOCKED 原因校验，未形成完整状态转换图或 FS 起步校验；验收专用路径 `acceptance/service.ts:243` 则限定从 DONE 处理。各入口规则差异需专项核对，不在本轮擅自改状态权限或替其他域批准转换。

本地已确认 C2：FS 实际前置须 CLOSED；B 仍要在真实开工入口落实 FS，不能只禁用甘特按钮。C #32 的旧 task 日期应用授权不等于 B 获得该开工入口的修改许可。

## 3. #25 故事看板：6 条 AC

以下“前提可复用”不是本票 AC 已通过。所有运行测试和浏览器验证均待实施后执行。

| AC（线上原义） | 当前状态与证据 | 本票交付物 / 缺口 | 后续完成检查 |
|---|---|---|---|
| AC1 看板列与正式需求状态一致，无自造状态 | 看板未实现；StoryStatus 三态已有，types.ts:32 | board 读视图、三列页面、最小挂载 | 三列和值映射测试；浏览器核对无自造列 |
| AC2 调整后重拉，地图/详情状态同步 | 既有读写路径可复用；看板交互未实现 | 复用故事 PATCH；成功后重新拉取；另对接状态事件要求 | 同账号看板改状态后核对地图/详情，不用 mock 冒充 |
| AC3 写 who/when/before/after 审计 | 未实现；requirement/service.ts:860-884 无审计 | C13 对具体文件授权后补原写路径及审计 | HTTP 触发真实状态变化并查审计前后值/操作者/时间 |
| AC4 无权限/跨项目拒绝，非成员 404 | can 与原写端点具备前提；新看板未验 | 新入口继续统一鉴权和项目隔离 | PM/member/viewer/outsider 与外项目 HTTP 矩阵 |
| AC5 敏感不展示，计数与列表一致 | 可见性入口已有；看板查询未实现 | 查询层权限过滤，同一 where 生成列表与计数 | 敏感白名单及非授权对象不出现、不增计数 |
| AC6 不绕过 requirement.write | 原 PATCH 有门禁；看板不存在，不能标通过 | 复用唯一故事写路径，不另造镜像写入口 | 检查调用路径及直接越权请求；前端隐藏不能替代服务端拒绝 |

范围：`src/modules/board/`、`web/src/pages/board/`；原 requirement 文件仅在具体授权后扩展。事件发布通过待确认的公共端口，D 不代本域生产事件。本地 C 的 task 授权不覆盖此 requirement 改动。

## 4. #26 甘特图：7 条 AC

| AC（线上原义） | 当前状态与证据 | 本票交付物 / 缺口 | 后续完成检查 |
|---|---|---|---|
| AC1 同视图展示需求/任务/里程碑 | 未实现；schema 无 Milestone | 甘特聚合、模型迁移、统一时间轴 | 真实响应和页面同时包含三类对象 |
| AC2 故事展开任务及计划时间 | 按故事列任务接口可复用，task/routes.ts:204 | 甘特展开与关联聚合 | 模块关联测试和浏览器展开 |
| AC3 故事计划/进度来自任务且一致 | 未实现；任务日期与 progress 可作为输入 | 明确汇总公式、空值/无任务规则后实现，不自行定进度算法 | 与同账号同授权任务视图核对；未知公式先列待确认 |
| AC4 任务里程碑关联及汇总 | 未实现；无模型 | Milestone 关系、必要索引、日期/汇总契约 | 关联、汇总和边界测试 |
| AC5 仅 FS、未放行不允许开工、拒绝环 | 未实现；无 TaskDependency/真实开工 FS 检查；C2 规则已确认 | FS 图、环检测、真实入口守卫；自然日起止与后继次日规则 | DONE 不放行/CLOSED 放行；自环/多节点环、计划日期和直接入口绕过测试 |
| AC6 拒绝跨项目依赖，直接读库校验 | 未实现；其他外键/成员规则不能替代 FS 校验 | 按存储任务 projectId 核对依赖两端 | 伪造项目/任务引用请求不得建立跨项目边 |
| AC7 敏感对象不出现在甘特和汇总 | 可见性规则可复用，甘特未实现 | 查询层过滤故事/任务及关联数据，不借边/里程碑泄漏 | 列表、依赖、里程碑及计数的敏感矩阵 |

范围：`src/modules/gantt/`、`web/src/pages/gantt/`，B 单写模型/迁移/挂载。真实旧任务开工入口需具体范围授权与写窗口；不把 C #32 的仅计划日期应用许可扩大到任务状态守卫。

## 5. #27 成员任务图与负载：6 条 AC

| AC（线上原义） | 当前状态与证据 | 本票交付物 / 缺口 | 后续完成检查 |
|---|---|---|---|
| AC1 按成员列未关闭数量与清单 | 未实现；项目任务接口按 ownerUserId 过滤可复用 | workload 直接读库聚合；非 CLOSED 含 DONE | 相同过滤下数量与清单一致，覆盖零任务成员 |
| AC2 点击成员看状态/计划时间 | 任务详情与任务列表现成，成员视图未实现 | 成员—任务关联及详情交互 | 浏览器负载→成员详情→真实任务数据 |
| AC3 与任务列表/工作台同口径 | 同源 Task 与工作台非 CLOSED 条件可复用；日期有 §2.1 差异 | 按相同项目/负责人/授权范围比较，不求五块计数和 | 负载与过滤后的真实任务清单/工作台 todo 一致；日期边界另验 |
| AC4 仅统计本项目成员，outsider 404 | 项目成员接口、can 可复用；负载未实现 | 当前项目成员范围与项目访问校验 | 非成员/外项目请求 404，不混入其他项目成员 |
| AC5 敏感任务不计入无权负载/计数 | visibilityScope 可复用；负载 where 待实现 | 权限条件进入查询，列表和计数一致 | 无权敏感任务既不返回也不加计数 |
| AC6 viewer 范围按 C6 | 最新本地基础规则已确认，线上仍旧待确认文案 | PM 全局；MEMBER/VIEWER 授权可见且标可见范围 | 三角色基数与标签；AI 再排敏感，不外发隐藏对象数量 |

范围：`src/modules/workload/`、`web/src/pages/workload/`；不调用 project/task/workbench service，不新增角色、协作人模型或过载阈值。已有数据接口的实现仍计原 B 票，不因 C 消费重复估算。

## 6. 旧阻塞的本轮修正依据

| 旧表述 | 当前结论 | 后续处理 |
|---|---|---|
| 尚无 CLOSED / 六态待落地 | 源码常量、Zod 与读取已支持 | 从任务 Blocker 中去掉“六态不存在”；不据此标业务实现或转换图完成 |
| 无 task.accept / 所有写类操作非 PM 均拒绝 | task.progress/task.accept 条件动作已合入；普通故事/任务写仍 PM 限定 | 保留既有条件动作，不把 #32 的 PM-only 覆盖到 A 的动作 |
| C2 在 DONE/CLOSED 间待选 | 本地已确认 CLOSED | 只追踪依赖模型、真实入口、具体授权和测试，不重复申请业务二选一 |
| A 域 C3 待定 | 本地已定全项目 Asia/Shanghai；工作台仍按 UTC 实现 | 登记跨域实现差异；交 A/协调者处理，不让 B擅改 A 业务 |
| 基础 C6 待确认 | 非 CLOSED 含 DONE、基数可见性已定 | 只保留健康阈值/未知汇总细节，不将其当负载基础计数的额外门槛 |
| 无事件/里程碑/依赖/AI 建议表 | 仍成立 | 保留真实能力缺失与对应提案/实施待办，不用空数组或占位冒充可用 |
| can / assignment 不能直接接事务客户端 | 类型事实仍成立 | #46 提方案，由 B/C 核对，不自行改 helper 签名或在业务重写角色判定 |

## 7. 未决项与本轮不越界事项

- C1 健康阈值、C5 UML 交互、C9 项目关闭入口、C10 进度公式确认、其他 C11/C12 和相关旧文件 C13 仍需对应负责人处理。
- 六态值已存在；完整状态转换、验收与普通 PATCH 差异须按适用契约核对，不擅自决定回退/重开规则。
- #32 的权限例外、C 的 task 写窗口仅按限定范围记录；不转成 B/C 对其他业务域的通用授权。
- 复核未见可引用的 D 最小端口提案；#31/#37 当前无评论不等于 D 私下没有实现。D 的签名和 B/C 书面核对不能伪造。
- 三票共 19 条 AC 本轮均未执行运行验收，本文不勾业务 AC；本地 #01 的“基线复核完成”与业务票“功能完成”完全不同。

## 8. 本文完成检查与后续波次

- 固定最新 main 提交，明确工作区代码不是本次源码基线。
- 逐条核对六态、权限、schema、旧写路径与工作台可复用口径，并给出相对路径/行号。
- 线上 19 条 AC 与同提交索引逐条一致，分别列出现状、交付物和后续验证方法。
- 独立 tester 已核对 19 条 AC 覆盖和关键源码事实；其指出的三处引用行号已修正（validation:20、task/routes:78/89/185、schema:127）。这是静态复核证据，不是业务测试通过；据此完成本地 #01 并解锁 #02。
- #43/#46 为独立契约提案，仍需 C 对字段与协议书面核对；本文不代其冻结，也不把后端实现当成设计必须先完成的条件。
