# #32 ROLE-C → B：公共接入六项接口事实

对应 B 的请求：[#32 comment-6369353812](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6369353812)。本文件随 C 分支交付，**只交本域实现，不注册生产入口、不直接合 main、不关闭票**。共享三表已就绪，绝不是本次阻塞。

## 1. 路由与工厂

文件：`src/modules/ai-scheduling/plugin.ts`，导出 `registerSchedulingRoutes<Tx>(app, { generate, workflow })`。

- `generate = createSchedulingGenerator<Tx>(generationPorts)`，来自 `generation.ts`。
- `workflow = createSchedulingWorkflow<Tx>(workflowPorts)`，来自 `workflow.ts`。
- 所有 handler 先 `requireAuth`，actor 只由 `currentUserId(request)` 注入。
- B 在 `app.ts/routes.ts` 注册上述插件，C 不再要求 B 逐条抄写 handler 或代写排期业务。
- 相对路径如下；沿用当前前端 `apiFetch` 的 `/api` 代理前缀，无需在后端路径额外加入 `/api`。

设 `P = /projects/:projectId/scheduling-suggestions`：

| method | path | 请求 | 响应 |
|---|---|---|---|
| POST | P | `{requestId}` | 201 生成回执 |
| GET | P | 可选 query `limit`，1..200 | 建议摘要分页 |
| GET | P/stats | 无 | 采纳统计 |
| GET | P/:suggestionId | 无 | 详情 DTO |
| GET | P/:suggestionId/audit | 无 | `{items: AuditEntry[]}` |
| POST | P/:suggestionId/assessment | `{changes: DateChange[]}` | 受保护日期评估的安全投影，不写数据 |
| POST | P/:suggestionId/disposition | 见下一节 | 200 处置回执 |

B 如调整最终路由前缀，请同步 C client；当前七条路径已作为唯一相对路径交付，不存在 review 同义别名。

## 2. DTO 字段（不返回共享仓储整条记录）

### 基本类型

- `DateChange = {taskId, planStart, planEnd}`；日期为有效 `YYYY-MM-DD`，自然日/Asia/Shanghai。
- `Model = {provider, model, version, mode, execution}`，mode=`STUB|API`，execution=`LOCAL|EXTERNAL`，未知版本=`未提供`。
- `Generation = {requestId,status,generatedAt,error}`；status=`SUCCEEDED|FAILED|TIMED_OUT`；error 为 null 或 `{code,message,retryable}`。
- `Receipt = {id,status,disposition,application}`：后三字段均是字符串，不是嵌套 record。status 使用共享 AiSuggestionStatus；disposition=`PENDING|ACCEPTED|MODIFIED|REJECTED`；application 使用共享派生状态。

### 生成

HTTP 请求仅 `{requestId}`。projectId 来自路径、actorUserId 来自认证，拒绝额外 body 字段。回执为 `{id,status,generation:Generation}`；生成失败记录可返回 `GENERATION_FAILED`，**201 不代表模型成功**。没有在 HTTP body 开放 dataClassification。

### 处置

请求严格三选一，`requestId` 均必填：

```ts
{requestId, status:'ACCEPTED', note?:string}
{requestId, status:'MODIFIED', note:string, changes:DateChange[]}
{requestId, status:'REJECTED', note:string}
```

note trim 后 1..2000，MODIFIED/REJECTED 必填。ACCEPTED/REJECTED 不接受 changes。projectId/suggestionId 来自路径；body 不接受 actor、项目或建议身份覆盖。响应 `Receipt`，同请求重放仍返回同形回执。

### 列表、详情、统计

- `Summary = Receipt & {projectId,model:Model,generation:Generation}`。
- 分页：`{items:Summary[],total,limit,truncated}`，不把 items.length 当 total；仓储 listPage 缺失则明确不可用，不降级为假精确总数。
- 详情：`Summary & {sourceState,changes,tasks,reason,finalChanges}`。
  - sourceState=`current|stale|unavailable`。
  - changes 是原始模型日期建议；tasks 是对应的 `{id,title,planStart,planEnd}[]` 原计划安全投影。
  - reason 为最终理由或 null；finalChanges 为最终独立修改/采纳内容或 null。
  - **不返回 snapshot、revision、constraintDigest、serverPrivate、pmProtected、全项目/排除敏感计数**。
- stats：共享 `{pending,accepted,modified,rejected,adoptionRate}`。

### 日期评估、审计

- assessment：`{state,assessment}`，state=`ok|stale|invalid-changes|out-of-scope|unavailable`。非 ok 时 assessment 为 null；ok 时含 `{canApplyDates,blockers,warnings,workload,scope}`。
  - blockers/warnings：`{code,taskIds,message}[]`，隐藏约束只返回合并后的通用提示。
  - workload：`{userId,openTaskCount}[]`，仅非敏感参与范围，非 CLOSED 含 DONE。
  - scope：`{label,participatingTaskIds,taskCount}`。
  - 不返回 verifier 内部的 sourceRevision；预评估不是锁，正式处置仍复核。
- `AuditEntry = {projectId,suggestionId,actorUserId,requestId,status,reason,at,before:DateChange[],after:DateChange[]}`。
  - at 为 ISO UTC。拒绝 before/after 均为空，仍写成功审计但不写计划。

浏览器权威消费形状在 `web/src/pages/scheduling/api.ts` 的 Zod DTO；没有从后端业务模块导入运行时代码或类型。

## 3. scenario、scope 与双指纹映射

- 模型 request.scenario、模型 input.scenario、存储 record.scenario、权限资源 ref.scenario 均已统一 **`SCHEDULING`**；不再保留 scheduling 小写映射。
- `source.snapshot.capturedAt → record.snapshot.asOf`，记录源捕获时刻；`generation.generatedAt` 另记模型结束时刻，不混为一个时间。
- 模型只收到 `schedulingModelInput(source)`：排除敏感任务及敏感父故事后的任务、公开 FS/里程碑、参与范围负载，不含保护 revision/隐藏边/计数/角色清单。
- inputScope.populationBasis=`VISIBLE`，表示模型实际参与子集；objects 从 `source.aiInput.tasks` 映射为 `{objectType:'task',objectId:id}`；filters=`{isSensitive:false,parentStoryIsSensitive:false}`；includedFields/excludedFields 见生成记录实现。
- 保护 inputScope.population：sourceCount=PM 查询得到的项目总数；includedCount=aiInput.tasks.length；excludedSensitiveCount=任务或父故事敏感的数量。只保存在服务端保护记录，不发模型或当前详情 DTO，不能把这组数当模型全量参与。
- 权限资源 ref.populationBasis=`GLOBAL` 只是按 project 判定此次排期操作，不表示 inputScope 也是全项目输入。

### 两个 digest 不混用

1. **C 来源协议**：`source.ts/sourceDigest` 产生内部 `us12-source-v1` revision。对受控来源（任务/成员/相关角色/FS/里程碑/完整性/私有约束摘要）规范化，排除捕获时间后 SHA-256；serverPrivate 只留私有约束摘要，不存敏感正文。verifier 在同 caller-tx 内复读/重算，用服务端保存的 sourceRevision 判断来源过期。
2. **共享快照协议**：C 以 `canonicalAiJsonDigest(record.snapshot.data)` 另算 fingerprint，algorithm 明确 `SHA-256_CANONICAL_JSON_V1`。data 包含保护的 source、verification、serverPrivate、pmProtected。正式应用先校验保存的共享 fingerprint，再复核原建议 taskIds 与内部来源 revision。
3. 处置 contentDigest 同样使用共享 canonicalAiJsonDigest，但先把 MODIFIED 日期集合按 taskId 排序；摘要内容 `{status,reason,changes}`。ACCEPTED/REJECTED 的 changes 为 null，reason 缺省为 null。

所有保护上下文从保存记录恢复，不信客户端回传；**任何摘要都不是并发锁**，CAS/事务/实时复读仍不可省。

## 4. 模型端口要求与 unavailable

只消费 `src/shared/ai.ts` 的 `AiModelPort`；不调用 D service、不绑定 SDK。输入是共享 `AiGenerationRequest`（上述 SCHEDULING/最小 input），要求返回：

```ts
{requestId, descriptor:{provider,model,version,mode,execution},
 output:{changes:[{taskId,planStart,planEnd}]}}
```

requestId 必须匹配，descriptor 必须与调用前声明一致；输出严格校验字段、合法日期、唯一任务、原范围、TODO 及公开规则。保护约束在正式应用时验证。原始模型建议不可被人工修改覆盖。

现有 D `LocalStubAiProvider` 只支持 REQUIREMENT_BREAKDOWN，**不能当成排期 provider 已就绪**。B 无适用端口时请不开放生成，或注入明确 unavailable 的适配器抛共享 `AI_SERVICE_UNAVAILABLE` 标签，C 会保存失败记录而非有效建议；不把需求拆解输出改名成排期，不静默返回 fixture。必须如实展示不可用/失败，不能把保存失败记录的 201 解释为生成成功。

C 已处理安全错误标签 AI_TIMEOUT/AI_SERVICE_UNAVAILABLE/AI_INVALID_RESPONSE，不保存 provider 原始异常。缺少配置/未知异常失败，不回退桩。外部模型仅允许部署侧已批准的 SYNTHETIC_DEMO；默认 PROJECT_DATA，EXTERNAL+PROJECT_DATA 直接拒绝；配置和凭据不进 HTTP body、前端或 Issue。

## 5. 排序/序列化及软连字符复现

已删除两处 localeCompare。`digests.test.ts` 对 `ab` 与 `a\u00ADb` 提供四项可复现断言：

- 对象键和日期 taskId 用 JS `<`/`>` 的精确 UTF-16 码元比较，不用区域排序；`ab` 排在 `a\u00ADb` 前，不把它们判等。
- C 来源协议递归规范化对象键，数组递归序列化后以默认 UTF-16 排序，保留重复元素；同一来源集合反序 digest 一致，但软连字符值不同则 digest 不同。
- 共享算法对象键 UTF-16 排序、数组保持顺序；不能直接拿集合来源 digest 冒充它。
- MODIFIED 的日期集合在计算共享处置 digest 前使用 orderedChanges，调换同一集合的输入顺序仍可识别同一请求。

## 6. caller-tx、鉴权、审计和失败语义

### 生成

短 tx1：统一生成鉴权、读取一致保护来源 → **事务外**模型调用 → 短 tx2：再次统一鉴权、复读来源、确认 revision 未变、共享仓储 create。模型结束撤权则不保存可用建议/不返回模型结果；来源变则冲突。异常在事务外调 recordFailure，失败证据写失败不能吞掉。

### 处置

一个 caller-tx：最小 metadata/项目/场景检查 → 实时 dispose 鉴权 → 保护记录 → 同 actor/requestId/digest 的已完成结果重放 → 无终态时验证来源及规则 → finalizeDisposition CAS → writeDates → updateApplication → appendAudit。任一异常整个事务回滚；**CAS 的 APPLIED 不等于任务已应用**。

- 拒绝跳过来源/日期可应用验证，可拒绝过期建议，理由必填；仍有归属、实时鉴权、幂等/CAS/同事务审计，不写任务、不调模型。
- 自己的应用失败整份回滚后仍 PENDING，可同请求重试；遇其他路径产生的半提交 DISPOSED/APPLICATION_FAILED 记录明确冲突，不悄悄再次应用任务。
- 来源过期/不同最终处置/内容冲突为 409，非法字段/日期为 422，缺端口/来源不可用为失败；401/403/404 沿统一出口。没有新增公共错误码。

### B 实际要注入什么（不要求新增 Action）

公共文件/组装仍 B 单写，C 不私写角色分支，不把 shared 通用 member-readable read 当 #32 专项读。请在 B 权威适配中按既定 can()/visibilityScope() 实现显式 SCHEDULING PM-only 场景授权，无需重新批准规则或新增 Action。

```ts
// generationPorts + workflowPorts 的完整权威定义见对应 TS 文件
transaction<T>(work:(tx:Tx)=>Promise<T>):Promise<T>
authorization(tx:Tx): AiAuthorizationPort
readAuthorization(tx:Tx, actor:string, ref:AiResourceRef):Promise<AiAccessDecision>
repository: AiSuggestionRepository<SchedulingSuggestionRecord,Tx>
readSource(tx,actor,projectId):Promise<SchedulingSourceResult>
verify(tx,actor,projectId,context,changes,now):Promise<SchedulingVerification>
writeDates(tx,projectId,changes:readonly DateChange[]):Promise<DateChange[]>
appendAudit(tx,entry:SchedulingAuditEntry):Promise<void>
readAudit(tx,projectId,suggestionId):Promise<SchedulingAuditEntry[]>
recordFailure({projectId,actorUserId,requestId,code}):Promise<void> // 事务外
now():Date
// 生成另需 model:AiModelPort、newId():string、可选 deployment dataClassification
```

- readAuthorization 缺失：列表/详情/统计拒绝，**不借写 Action 做 C 自设对外读 fallback**。audit 还经过共享 audit capability；缺能力仍拒绝。
- writeDates/appendAudit 缺失：不处置/不写计划。日期端口须指向 B 统一基础写入口并保留后续 FS 守卫，不允许 C 导入其他域 service 或 DB 实现。
- 成功 appendAudit 必须使用同 tx；失败和鉴权拒绝由 B 按既定安全证据落点处理，只有最小标识/code，不记提示词/敏感正文/密钥；失败可观察。DomainEvent 不是 AuditLog。
- B 当前 `createAiAuthorizationPort(PrismaClient)` 是 root 签名；请以实际窄类型/绑定 tx 适配提供 factory，不用强转 root 冒充 tx。

前端由 B 挂载 `SchedulingPage`：props 为 projectId、sessionKey（身份变化必变）、权威 access、稳定的 `createSchedulingClient(projectId)`、可选 onApplied（刷新正式任务/甘特/负载）；demo/initialDetail 仅预览，不用于生产。页面不会因前端隐藏按钮而省略后端鉴权。

## 验证、范围和剩余

本批已整合 `main@aa62c0de502d5c75ac965ba8815f59ac81eed082`；本地整合节点 `a82cfc4b3b7cea06b00647ef68a3dfb4a8a90418`。没有新增 task/shared/app/routes/authz 修改，原有未提交历史文档不纳入本批。task 窗口已交 B；附件/UML 是其他任务，不捎带改。

最新定点：排期 **173 passed / 12 TODO**，前端 **13 passed**，Chromium 合成组件 **8/8**；生成 Prisma client、两端类型检查、server build 类型检查和 web build 通过。源数据/仓储/处置使用真实临时 SQLite 的测试装配；组件使用明确合成 transport，不冒充生产授权/正式模型/最终12门禁。

首个 generate+typecheck+排期/task/仓储联合命令180秒超时，未取得完整报告；拆开类型检查和排期定点后通过。后续单独 task+共享仓储回归150秒也超时，**本基线不宣称全 task 或全仓通过**；旧014555b基线的387通过不能移作本基线结论。没有反复拉长超时。

机器报告/截图见 `docs/role-c/evidence/issue-32-delivery-20261024/`。仍待 B 公共权限/日期/审计/失败证据装配、正式路由/页面挂载和适用模型端口；到位后再做正式 API/浏览器闭环，12 TODO 保留。
