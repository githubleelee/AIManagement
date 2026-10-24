# ROLE-C / #32 本域闭环实现与公共装配交接

> 后续更新（2026-10-24）：本页保留上一轮本地实现快照；本轮已获用户授权提交/推送，最新代码事实与复测见 [六项接口事实](issue-32-interface-facts.md)，实际远端交付以随后发布回执为准。下文“未提交/未推送”及169计数不应覆盖新批次实际状态。

> 本文件保留 2026-10-23 本地实现阶段事实；后续分支交付、最新基线与六项接口事实以 [public-interface-handoff](issue-32-public-interface-handoff.md) 为准，不把下文旧“尚未推送”描述当作后续状态。

## 状态与边界

- 已推送旧基线：`main@014555ba7843863ef7230956b89081b8ccd2f461`。
- 本批新增/修改代码仍在 `feat/US12-scheduling-core` 本地工作树，**尚未提交或推送**；不可把下述新文件称为远端已交付。
- 本轮只动 C 域、C 页面及本次独立交接/证据；原有未提交文档不纳入本批，也不覆盖。
- `task/routes.ts`、`task/rules.ts` 当前写者为 B，本轮没有新增在途 task 改动；C 同意按 PR #99 已合入的结束条件交接，不再占用旧提炼窗口。
- 采用 [负责人最新确认](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6365252149)，不重问 PM-only、过期拒绝、422/409 或原子事务规则。

## 已实现的本域代码

- `src/modules/ai-scheduling/workflow.ts`：按 metadata→实时鉴权→保护读取编排列表、详情、统计、审计、日期评估与处置。专项读授权缺失则拒绝，不借通用 project.read/写 Action 代替对外读取权限；列表不丢 total/limit/truncated，listPage 缺失明确不可用。
- 采纳/修改后采纳：同 caller transaction 内复读保护来源、校验原建议范围、TODO/成员/真实 FS/日期、CAS 唯一处置、日期批量写、应用结果及成功审计；任一失败全回滚。模型不再调用。原始建议不变，人工修改独立存储。
- 拒绝：理由必填，允许来源过期；仍鉴权/归属/幂等/CAS/审计，不做日期可应用验证、不写任务。
- 重放：每次先鉴权，同 actor/requestId/digest 才重放，重放先于来源校验；异请求/异内容/异 actor 冲突；遇外来半提交的 DISPOSED/APPLICATION_FAILED 记录明确拒绝，不擅自重新应用任务。自己的失败整份回滚后仍 PENDING，可用同请求重试。
- `plugin.ts`：C 独立 HTTP 插件，actor 来自认证上下文，拒绝请求体注入身份；仅供 B 后续挂载。没有改 `routes.ts/app.ts`，也没有声称正式接口已经注册。
- `generation.ts`：补保留安全的 AI_TIMEOUT/AI_SERVICE_UNAVAILABLE/AI_INVALID_RESPONSE 标签，不保存 provider 原始异常。模型输入统一 SCHEDULING；两处 localeCompare 改 UTF-16 比较，未把集合式来源 digest 冒充共享算法。
- `web/src/pages/scheduling/api.ts`：浏览器独立 DTO、校验、真实请求客户端；移除 scheduling 页面/预览对后端模块和规则实现的导入。没有静默 fixture 回退。
- `SchedulingPage.tsx`：列表/截断提示、加载/错误、模型追溯、日期编辑与服务端评估、警告/参与负载、过期拒绝、审计读取。失联处置锁定原内容/requestId 后重试；权限/身份/项目变化清理草稿和请求；真正 APPLIED 后调用父层刷新回调。
- `browser.fixture.*` 和 `browser-smoke.mjs` 是未注册、纯合成传输的组件测试入口，不是生产模型/API 或正式链路。

## 实际验证

工作目录均为 `D:/临时项目/AIManagement-US12-core`。当前工具运行 bash 在 WSL，Windows 程序用 `/init /mnt/d/nodejs/node.exe node.exe ...` 启动；下列省略该桥接前缀，仅列真实 Node 参数。

| 命令 | 结果 |
|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | 通过 |
| `node node_modules/typescript/bin/tsc -p web/tsconfig.json --noEmit` | 通过 |
| `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` | 通过 |
| `node node_modules/vite/bin/vite.js build --config web/vite.config.ts` | 通过；C 页面仍未挂载，不能把现有主包构建当挂载完成 |
| `node node_modules/vitest/vitest.mjs run src/modules/ai-scheduling --maxWorkers=1 --minWorkers=1 --testTimeout=60000 --hookTimeout=60000 --reporter=json --outputFile=docs/role-c/evidence/issue-32-local-completion/scheduling-result.json` | **169 通过 / 12 TODO** |
| `node node_modules/vitest/vitest.mjs run --config src/modules/ai-scheduling/frontend.vitest.config.ts --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=docs/role-c/evidence/issue-32-local-completion/frontend-result.json` | **13 通过** |
| `node node_modules/vitest/vitest.mjs run src/modules/task src/db/ai-repository.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=60000 --hookTimeout=60000 --reporter=json --outputFile=docs/role-c/evidence/issue-32-local-completion/task-shared-regression.json` | **387 通过** |
| `node src/modules/ai-scheduling/browser-smoke.mjs` | **Chromium 组件验证 8 项通过**，零未捕获异常；纯合成 transport，非正式 API 联调 |

机器结果、源码 SHA-256 和截图见 [evidence/issue-32-local-completion](evidence/issue-32-local-completion/validation-summary.json)。

本批首轮 TypeScript 曾发现逗号/JSX 闭合及 fixture 空数组推断问题，已修正后复验。浏览器一次因 reload 时 Runtime 上下文切换报 `Inspected target navigated or closed`；改为先等待 Page.loadEventFired 再做 DOM 断言，随后 8 项通过。不将首轮失败称为通过；该次原始失败输出仅保留在工具会话中，未伪造完整导出附件。

## 给 B 的实际装配要求（不是已存在的 shared 声明）

权威本域签名在 `SchedulingWorkflowPorts<Tx>` / `SchedulingGenerationPorts<Tx>`。B 落公共声明时可反馈最终命名，C 适配，不跨写公共文件。

1. `authorization(tx): AiAuthorizationPort`：实际支持 caller transaction。现有 `createAiAuthorizationPort(prisma: PrismaClient)` 签名不接 tx；请 B 提供窄类型适配。另给 `readAuthorization(tx, actor, ref): Promise<AiAccessDecision>`，明确 SCHEDULING 列表/详情/统计 PM-only；审计读取还需共享 audit 能力通过。C 没有私写角色判断。
2. `writeDates(tx, projectId, changes: readonly DateChange[]): Promise<DateChange[]>`：注入真实 task 基础能力，保留 B 正在接入的 FS 等守卫，不重建镜像写路径。
3. `appendAudit(tx, SchedulingAuditEntry): Promise<void>`、`readAudit(tx, projectId, suggestionId)` 以及事务外 `recordFailure({projectId,actorUserId,requestId,code})`：成功审计与任务同事务；失败/鉴权拒绝落既定安全证据，失败可观察，DomainEvent 不能替代 AuditLog。
4. B 注册 `registerSchedulingRoutes(app, {generate, workflow})`，并挂载页面。插件相对路径候选为 `/projects/:projectId/scheduling-suggestions`，含 stats、`:suggestionId`、audit、assessment、disposition；沿用现有 `/api` 前缀代理。页面需要权威 access、随登录身份变化的 sessionKey、稳定的 client 和 APPLIED 后真实任务/甘特/负载刷新回调。
5. B/D 提供确实支持 SCHEDULING 且输出 `{changes:[{taskId,planStart,planEnd}]}` 的模型端口和明确运行配置。现成 `LocalStubAiProvider` 只支持 REQUIREMENT_BREAKDOWN，不能声称它已支持排期。外部模式仍只能合成数据，密钥不进前端、Issue 或仓库。

## 已发布的一次集中跟进

已用核验账号 `brucelyce-ux` 经用户授权代 C 在 [#32 发布一次集中交付请求](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6366837001)，并回读核验正文一致；没有新建重复票、改标签或关闭工单。[发布回执](evidence/issue-32-local-completion/issue-publish-receipt.json)。评论明确说明本批新代码仍在本地，未伪称远端已交付。

## 仍未完成

上述公共装配、真实 SCHEDULING 模型、正式挂载和完整 API/浏览器闭环。12 个最终门禁没有删改、转绿或用本批测试替代。不关闭 #32、不改标签、不替 B 写 FS 守卫。
