<!-- role-c-us12-local-completion-public-assembly-20261023-v1 -->
## ROLE-C：已推进可独立实现部分；集中请求公共装配交付（不重问既定规则）

@githubleelee 经本轮用户授权，由 `brucelyce-ux` 代 ROLE-C / `xichoutrees` 汇总，仅本条集中跟进，不关闭工单、不改标签。

已采纳 [负责人最新确认](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6365252149) 和 [B 的窗口交接](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6358406539)：全部 PM-only、过期未终态可理由拒绝、422/409、整份 caller-tx 原子应用均不再申请批准。**C 没有新增在途 task 改动，`task/rules.ts` / `task/routes.ts` 提炼窗口已结束，B 可按已登记范围接续，不再等 C 让窗。**

### C 当前实际进展与证据边界

远端已交付基线仍是 [main@014555b](https://github.com/githubleelee/AIManagement/commit/014555ba7843863ef7230956b89081b8ccd2f461)。**本次下面的新实现仍在本地工作树，尚未提交/推送，不假称 B 已能在远端审阅。** 后续发布另行按用户指令；本条先给明确端口需求，不把本地代码当已上线。

- 本域已实现列表/详情/统计/审计的保护编排及显式 DTO，专项读能力缺失 fail-closed，不以通用 `project.read` 或借写 Action 放行对外读取；处理列表 total/limit/truncated。
- 日期评估不写数据；采纳/修改后采纳串起保护复读、原建议任务范围、真实 FS/TODO/成员/日期、唯一处置 CAS、整份日期写、应用结果与成功审计；异常全回滚。拒绝跳过日期检查且不调用模型/不写任务。
- 先实时鉴权再重放，同 actor/requestId/digest 才重放；异请求/内容/actor 冲突，原始建议与人工修改分开。独立失败证据写失败可观察。不擅自恢复外来半提交 APPLICATION_FAILED 记录；自己的失败整份回滚、仍 PENDING，可同请求重试。
- C 独立 HTTP 插件、浏览器 DTO/真实客户端和本域页面已准备；actor 不可从 body 注入。页面支持错误/加载/过期、评估警告/参与负载、理由必填、未确认处置锁定原请求后重试、权限变化清空数据。没有改公共挂载/骨架，也没有启用伪正式入口。
- 修正两处 localeCompare、统一 SCHEDULING、移除 C 页面/预览对后端模块的直接导入；保留安全的 timeout/unavailable 模型失败标签。
- 当前基线实际验证：**ai-scheduling 169 通过 + 12 TODO；前端 DTO/客户端/SSR 13 通过；task + 共享仓储回归 387 通过；两端 typecheck、server build 类型检查、web build 通过；Chromium 纯合成 transport 组件验证 8 项通过**。真实 DB/HTTP 处置验证使用明确标注的测试授权/审计装配，不冒充正式权限端口或最终门禁。12 TODO 未删未转绿。一次组件浏览器 reload 上下文竞态已修测试等待后复验，不抹去首轮失败。

### 剩下请 B 按“已交付/待交付 + 真实签名 + commit + 装配点”集中回复

1. **事务授权和 #32 专项读/审计能力**：C 需要 `authorization(tx): AiAuthorizationPort`，以及 `readAuthorization(tx, actor, SCHEDULING资源引用): Promise<AiAccessDecision>`（列表/详情/统计 PM-only；审计另校验 audit 能力）。现有 `createAiAuthorizationPort(prisma: PrismaClient)` 仍是 root 签名，generic read 又允许成员、audit fail-closed。请提供实际支持 caller-tx 与专项规则的公共适配，不需要再次确认 PM-only 业务口径。
2. **日期基础能力装配**：`writeDates(tx, projectId, changes: readonly {taskId,planStart,planEnd}[]): Promise<DateChange[]>`。请给 shared 声明/app 注入及具体 commit；要接 B 后续真实 FS 守卫的统一写入口，不由 C 另造镜像路径或直接 import task service。
3. **审计和失败证据装配**：`appendAudit(tx, entry): Promise<void>`、`readAudit(tx, projectId, suggestionId)`、事务外 `recordFailure({projectId,actorUserId,requestId,code})`。entry 最小内容为 projectId/suggestionId/actor/requestId/status/reason/at/before日期集合/after日期集合。成功审计与应用同事务，失败/拒权按既定独立安全证据落点且写失败可观察；不以 DomainEvent 替代审计。请给实际 adapter/action 映射，不是假设现成能力。
4. **正式挂载**：C 插件准备了相对路径候选 `/projects/:projectId/scheduling-suggestions`（含 stats、详情、audit、assessment、disposition），公共 `routes/app` 与前端导航仍由 B 单写。请给最终路径、注册点及页面注入参数；页面需权威 access、身份切换 sessionKey、稳定 client、APPLIED 后真实任务/甘特/负载刷新回调。
5. **真正支持 SCHEDULING 的模型端口/环境（B 协调 D）**：输出为 `{changes:[{taskId,planStart,planEnd}]}`，显式 mode/model/version/requestId；现成 `LocalStubAiProvider` 只接受 REQUIREMENT_BREAKDOWN，不能当排期 provider 已就绪。请给适用 adapter/工厂和已授权运行模式；外部仅合成数据、无静默回桩，密钥不要贴评论或仓库。

以上是交付/装配跟进，不要求 B 接管 C 排期业务、不重开已答规则，也不把旧“D 未交付/缺审阅入口”当阻塞。端口与正式挂载到位后，C 才能做真正生产装配的 API/浏览器闭环并逐项收掉 12 门禁；当前不宣称 US12 整票完成。
