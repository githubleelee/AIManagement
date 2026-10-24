<!-- role-c-us12-public-interface-delivery-20261024-v1 -->
## ROLE-C → B：分支已推送，六项公共接入事实齐备（不请求现在合 main）

@githubleelee 回应 [你的六问](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6369353812)。经用户本轮明确授权，由 `brucelyce-ux` 代 ROLE-C 发布；**这次不是“本地未推送”**。

- 分支：[`feat/US12-scheduling-core`](https://github.com/githubleelee/AIManagement/tree/feat/US12-scheduling-core)
- 精确交付提交：[`{{C_HEAD_SHORT}}`](https://github.com/githubleelee/AIManagement/commit/{{C_HEAD}})
- 已整合并实测 main `aa62c0de502d5c75ac965ba8815f59ac81eed082`，本轮仅推 C 分支，没有直接合 main。
- [完整六项接口交接（逐字段 DTO、端口签名、映射/排序/事务边界）](https://github.com/githubleelee/AIManagement/blob/{{C_HEAD}}/docs/role-c/issue-32-public-interface-handoff.md)

### 1. 路由表 / 插件 / 工厂

自带插件：[`registerSchedulingRoutes<Tx>(app,{generate,workflow})`](https://github.com/githubleelee/AIManagement/blob/{{C_HEAD}}/src/modules/ai-scheduling/plugin.ts)。`generate=createSchedulingGenerator(generationPorts)`；`workflow=createSchedulingWorkflow(workflowPorts)`，不是请 B 代写 C service。所有路由 requireAuth，actor 只取服务端认证上下文。

设 P=`/projects/:projectId/scheduling-suggestions`（后端相对路径，前端沿用现有 `/api` 代理）：

| method | path | 请求 | 响应 |
|---|---|---|---|
| POST | P | `{requestId}` | 201 `{id,status,generation}`，status 失败时不是有效建议 |
| GET | P | query `limit?` 1..200 | `{items,total,limit,truncated}` |
| GET | P/stats | 无 | `{pending,accepted,modified,rejected,adoptionRate}` |
| GET | P/:suggestionId | 无 | 保护详情 DTO |
| GET | P/:suggestionId/audit | 无 | `{items:AuditEntry[]}` |
| POST | P/:suggestionId/assessment | `{changes}` | `{state,assessment}`，不写数据 |
| POST | P/:suggestionId/disposition | 下述三选一 | `{id,status,disposition,application}` 字符串状态回执 |

### 2. DTO 字段名

- DateChange=`{taskId,planStart,planEnd}`；Model=`{provider,model,version,mode,execution}`；Generation=`{requestId,status,generatedAt,error:null|{code,message,retryable}}`。
- Summary=`{id,status,disposition,application,projectId,model,generation}`。
- Detail=Summary 加 `{sourceState,changes,tasks,reason,finalChanges}`；sourceState=`current|stale|unavailable`；tasks=`{id,title,planStart,planEnd}[]`。
- 处置请求严格三选一：`{requestId,status:'ACCEPTED',note?}` / `{requestId,status:'MODIFIED',note,changes}` / `{requestId,status:'REJECTED',note}`；后两种 note 必填（trim 后1..2000），ACCEPTED/REJECTED 不接受 changes，body 不接受 actor/project/suggestion 覆盖。
- Assessment=`{state,assessment}`，assessment含 `{canApplyDates,blockers,warnings,workload,scope}`；诊断项 `{code,taskIds,message}`，workload项 `{userId,openTaskCount}`，scope=`{label,participatingTaskIds,taskCount}`。私有约束只返回通用合并提示，不返回 revision。
- AuditEntry=`{projectId,suggestionId,actorUserId,requestId,status,reason,at,before:DateChange[],after:DateChange[]}`。
- 不向模型或详情返回保护 snapshot/revision/private digest/PM全项目与排敏数，不直接序列化仓储 record。精确枚举/null/必填规则均在交接文档及 [workflow.ts](https://github.com/githubleelee/AIManagement/blob/{{C_HEAD}}/src/modules/ai-scheduling/workflow.ts)、[浏览器 DTO](https://github.com/githubleelee/AIManagement/blob/{{C_HEAD}}/web/src/pages/scheduling/api.ts)。

### 3. scenario / 来源映射 / 双摘要

模型 request/input、存储和权限 ref 均已统一 `SCHEDULING`，不再用小写映射。capturedAt→snapshot.asOf；generation.generatedAt另记模型结束。inputScope.populationBasis=VISIBLE，objects来自排敏后的aiInput.tasks；保护 population 的 sourceCount/includedCount/excludedSensitiveCount 分别来自 PM项目计数/实际模型参与数/任务或父故事敏感计数；这些保护计数不进模型/当前详情。权限ref的GLOBAL仅是项目级授权资源，不冒充模型全项目参与。

内部 `us12-source-v1` revision 由 C reader 在同 caller-tx 的完整来源上产生，verifier复读重算判断过期；它不是共享 fingerprint，也不是并发锁。C 另以共享 `canonicalAiJsonDigest(snapshot.data)` 产生 `SHA-256_CANONICAL_JSON_V1` fingerprint，正式应用先校验保存记录摘要，再复核原建议范围/内部来源。处置摘要按共享算法计算规范化的 `{status,reason,changes}`。

### 4. 模型端口

只消费共享 AiModelPort，要求返回 `{requestId,descriptor:{provider,model,version,mode,execution},output:{changes:[{taskId,planStart,planEnd}]}}`，requestId/descriptor须与声明匹配，未知版本记“未提供”。请求输入来自 C 的独立最小模型出口。

确认你指出的事实：现成 LocalStubAiProvider 只支持 REQUIREMENT_BREAKDOWN，**不是排期 provider**。未有适用端口时保持不开放，或注入明确 `AI_SERVICE_UNAVAILABLE` 的适配器，C记失败而不伪造有效建议；不会将需求拆解/fixture冒充排期。外部仅SYNTHETIC_DEMO可用，默认PROJECT_DATA不外发，密钥不进前端/评论。

### 5. 排序/指纹前置修

两处 localeCompare 已修为 `<`/`>` 精确UTF-16比较。新增 [digests.test.ts](https://github.com/githubleelee/AIManagement/blob/{{C_HEAD}}/src/modules/ai-scheduling/digests.test.ts) 四项软连字符回归：`ab` 与 `a\u00ADb` 不判等、source集合逆序摘要相同、处置日期集合先按taskId排序、共享算法数组仍保序。C来源协议递归序列化后排序数组（保留重复元素），不拿该集合摘要冒充共享有序数组算法。

### 6. caller-tx / 审计 / 缺能力处理

- 生成：短tx读取+鉴权→事务外模型→短tx再鉴权/复读来源后create；撤权/来源变化不保存成可用建议。
- 处置：同tx metadata→实时鉴权→保护读取→同actor/requestId/digest的完成结果重放→无终态时复核→CAS→日期写→应用结果→成功审计；失败整份回滚，事务外安全失败证据写失败可观察。CAS的APPLIED不等于task已应用。
- 过期拒绝按已批规则：理由必填，跳过日期检查，不改任务、不重调模型，仍鉴权/幂等/CAS/同tx审计。自己的应用失败回滚后仍PENDING可同请求重试；外来半提交状态fail-closed，不擅自补写。
- B按现有can()/visibilityScope()做明确SCHEDULING场景授权即可，**C不要求新增Action、不写角色名分支，也不在业务里借写Action做对外read fallback**。
- 实际注入：`transaction(work)`、`authorization(tx)`、`readAuthorization(tx,actor,ref)`、共享repository、readSource/verify、`writeDates(tx,projectId,readonly changes)`、`appendAudit(tx,entry)`、`readAudit(tx,projectId,suggestionId)`、事务外`recordFailure({projectId,actorUserId,requestId,code})`、now；生成另需model/newId及部署侧dataClassification。权威完整签名已在 [generation.ts](https://github.com/githubleelee/AIManagement/blob/{{C_HEAD}}/src/modules/ai-scheduling/generation.ts) / workflow.ts，无需猜签名。
- read能力缺失拒绝；日期/成功审计端口缺失不处置。AuditLog与DomainEvent不互相冒充；401/403/404、422/409均沿现有统一信封，不扩公共错误码。

### 验证与请 B 接续的范围

本次基线：**排期173通过+12TODO、前端13通过、Chromium合成组件8/8；Prisma生成、两端typecheck、server build类型检查、web build通过**。[机器证据](https://github.com/githubleelee/AIManagement/tree/{{C_HEAD}}/docs/role-c/evidence/issue-32-delivery-20261024)。联合批次180秒及单独task/共享仓储批次150秒均超时未取得完整报告，已留失败事实，**不宣称本基线全task或全仓通过**；旧基线387通过不移作本轮结论。

C没有新增task/shared/app/routes/authz或前端骨架修改；task窗口已交B，没有在途C改动阻挡你。请据这次已推代码与六项事实，在你公共单写区接续专项读/审计授权、日期应用与审计/安全失败适配、正式插件/页面注册；页面props为projectId/sessionKey/权威access/稳定client/onApplied刷新回调。适用排期模型尚缺时保持明确不可用。**不请求你现在合main、不勾12门禁；真正装配后的API/浏览器闭环仍由C接续验证。**
