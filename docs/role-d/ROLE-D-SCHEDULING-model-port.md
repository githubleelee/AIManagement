# ROLE-D → B/C：SCHEDULING 模型端口交付（#32 / PB-01）

## 状态与范围

基线 main `8018c6407a7dd2041e3ba8c56f55c69b88e30228`。用户授权补齐 D 的排期模型能力并更新仓库；接口依据 C 的 `docs/role-c/issue-32-public-interface-handoff.md` §4 和 #32 comment-6382012535，数据边界沿用 DECISIONS。

交付一个真正执行 HTTP 请求的、Chat Completions JSON 协议兼容的 `AiModelPort` 适配器及显式配置工厂，不选择供应商或 SDK，不增加业务路由/数据库/权限规则。未修改 B 公共区、C 的 ai-scheduling 或 task 文件，也不修改现有需求拆解桩。

**适配器实现 ≠ 已配置真实模型 ≠ US-12 正式上线。** 供应商、模型、地址、凭据尚未由负责人确定。本轮只用合成数据和本机合成响应服务验证传输、异常和兼容性，没有请求公有云模型。配置缺失直接报错，不以桩或静态排期冒充真实 AI 建议。

## B 如何接入（待 B 在公共单写窗口实施）

导出入口：`src/modules/ai/factory.ts`：

```ts
createSchedulingAiModelPort(options: SchedulingApiOptions): AiModelPort
createSchedulingAiModelPortFromEnvironment(environment): AiModelPort
```

- 选项：`endpoint / providerId / model / apiKey` 必填；`responseModel / timeoutMs` 可选。
- B 在服务端组装时调用工厂，将返回值注入 C 的 `createSchedulingGenerator({ ...generationPorts, model })` 的 **model** 参数。
- 不把它传给需求拆解专用 `createAiBreakdownService`，不调用 D 的业务 service，不改共享 AiModelPort 签名。
- 配置/凭据只在后端；工厂不在 import 时读取 process.env，不从 HTTP body 接收 URL、model、key 或 dataClassification。
- 默认没有回退模型，工厂不会自行联网探测。缺配置时 B 可保持该功能不可用，不要用原 LocalStubAiProvider 代替排期模型。

### 环境字段（由 B 显式传入 environment；此文不创建或读取真实 .env）

|字段|要求|
|---|---|
|SCHEDULING_AI_MODE|必须显式为 EXTERNAL_CHAT_COMPLETIONS；其他/缺省立即 AI_MODE_NOT_CONFIGURED|
|SCHEDULING_AI_ENDPOINT|完整 Chat Completions URL；须 HTTPS（本机 127.0.0.1 / ::1 回环 HTTP 可用于合成集成验证）；不得含 URL 用户密码、查询参数或 fragment|
|SCHEDULING_AI_PROVIDER_ID|负责人选定的稳定提供方标识，不伪称自动识别|
|SCHEDULING_AI_MODEL|真实部署要求发送的模型 ID，不设默认、不替负责人选型|
|SCHEDULING_AI_RESPONSE_MODEL|可选；部署别名解析后的真实返回 model ID。如未填，返回 model 必须与请求 model 相同；不匹配记无效响应，不静默假记原模型|
|SCHEDULING_AI_API_KEY|仅后端运行环境注入，不能提交仓库、Issue 或前端|
|SCHEDULING_AI_TIMEOUT_MS|可选，默认30000；整数100..120000，覆盖响应头和完整响应体读取|

C generator 的 `dataClassification` 是独立的**可信部署配置**，默认 PROJECT_DATA。只有负责人批准且实际为合成演示数据的部署才可显式设 SYNTHETIC_DEMO；不能为了消除错误将真实项目标成合成数据。即使工厂已配置，C 与 D 两层仍拒绝 EXTERNAL + PROJECT_DATA。

## 输入、输出与追溯

消费 C 的 `schedulingModelInput(source)` 原形，不读取或重建数据库：

```ts
{
  scenario: 'SCHEDULING', projectId, capturedAt, scope,
  tasks: [{id,title,ownerUserId,status,planStart,planEnd}],
  dependencies: [{predecessorId,successorId}],
  milestones: [{id,taskIds,date}],
  workload: [{userId,openTaskCount}]
}
```

严格拒绝多余字段（包括 snapshot/revision/serverPrivate/pmProtected/memberRoles/apiKey），跨项目、敏感标志或非合成分类在网络请求前拒绝。真实敏感任务与父故事排除仍由 C 权威 reader 负责，D 不把字段白名单当作数据来源授权。只发送最小 input 和服务器生成的北京时间 today，不发送 actor、调用 context、内部 requestId 或保护计数。

输出满足 C 已交付的共享端口：

```ts
{
  requestId: /* 原调用者 requestId */,
  descriptor: {provider,model,version:'未提供',mode:'API',execution:'EXTERNAL'},
  output: {changes:[{taskId,planStart,planEnd}]}
}
```

- 配置中的 responseModel/model 与响应 model 必须一致，descriptor 在调用前后稳定且只读。Chat Completions 没有标准模型版本字段，不从时间戳/别名/system_fingerprint 猜版本。
- 输出必须为 JSON 对象，不能是 Markdown、截断内容、拒答或工具调用。至少一项且无重复任务，只允许输入中 TODO 任务和三个日期调整字段；日期真实存在、起止有序、开始不早于北京时间今天。
- 不推断技能、工时权重、协作人或隐藏任务，不改负责人。公开 FS、权限、来源过期、完整依赖、成员、审计与原子应用仍由 C/B 在既有受保护流程复核。模型输出只是建议，不具有写入授权。
- 请求/响应各限 1 MiB，重定向拒绝，不自动重试，不静默回桩。失败后重新生成沿用 C 的鉴权/快照规则。

## 失败语义

|情况|D 错误标签|行为|
|---|---|---|
|配置缺失/非法|AI_MODE_NOT_CONFIGURED|启动组装失败，不返回伪模型|
|PROJECT_DATA、敏感或非最小输入|AI_DATA_POLICY_VIOLATION|零网络发送；不回显保护字段|
|无 TODO 参与任务|AI_SERVICE_UNAVAILABLE（retryable=false）|不伪造空成功，零网络发送|
|超时（含响应体）|AI_TIMEOUT|取消请求；无回退|
|HTTP失败/网络异常/重定向|AI_SERVICE_UNAVAILABLE|不读取HTTP错误正文、不记录原始异常或凭据|
|模型身份不匹配、拒答、截断、非法JSON/范围/日期/超限|AI_INVALID_RESPONSE|不返回原始输出、不保存有效建议|

C 当前已有共享标签处理：TIMEOUT/UNAVAILABLE/INVALID_RESPONSE 可写成脱敏的生成失败记录，数据策略错误可能转为通用失败（或先在 C 分类门禁拦截）。**201 失败回执不是生成成功。** 不新增公共 HTTP 错误码，不修改 C 的映射或其未完成的审计能力。

## 证据与剩余交接

当次原始输出和限制见 `docs/ai-records/D/issue-32/`。HTTP 服务端是明确标识的合成响应端点，真实发请求但不做大模型推理；DB兼容测试使用真实临时SQLite、原C reader/generator和共享仓储，授权工厂与失败证据sink是明确测试装配，不冒充B生产装配。

B仍需：选定部署供应商/真实模型/地址并安全配置凭据，将D端口注入C generator；完成专项PM-only授权、日期写/FS守卫、审计/失败证据、正式注册与页面挂载。C在真正装配后继续12门禁与真实API/浏览器闭环；本交付不关闭#32、不合并PR、不改变PB-01/PB-02状态。

### 协议依据

- 官方 Chat Completions API 参考（messages/model/choices/finish_reason）：https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- 官方结构化输出说明（JSON mode不等于业务schema保证，须自己验证）：https://developers.openai.com/api/docs/guides/structured-outputs

仅使用协议形状，不意味着项目已选择OpenAI供应商，也不承诺所有所谓“兼容”部署都符合该响应协议；最终部署须进行真实合成数据联调。
