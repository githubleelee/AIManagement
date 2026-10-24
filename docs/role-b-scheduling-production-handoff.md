# #32 · B 生产装配交接

> 当前为本地待交付稿：`feat/sprint3-role-b-remaining`，基于 main `4dbd1ba`。实际提交 / PR 产生后追加，不把本地文件冒充远端已可取用。

## 1. 四项装配

| 项 | 生产落点 |
|---|---|
| 后端正式入口 | `src/app.ts` 调 `createSchedulingRuntime`，`src/routes.ts` 调 C 的 `registerSchedulingRoutes`；完整组装缺失 fail-fast，无 hasRoute/skip/no-op |
| 专项授权 | `src/scheduling.ts:createSchedulingAuthorization(tx)`；仅 SCHEDULING 的 read/audit 使用既有 `can('ai.suggestion.dispose', projectRef)` 的 PM-only 策略，不执行处置；generate/dispose 保留对应现有 Action。含 suggestionId 时核对真实项目/场景；通用 AI read/audit 不改权 |
| 日期写 | C 原 workflow 同 caller-tx 先 verifier（公开及受保护 FS、TODO/日期/快照），再装配既有 `applyTaskPlanDates`（原任务分配/项目/日期校验及唯一写核心）。纯改期不进入 DOING，不能把实际开工的前置 CLOSED 条件强加给计划编辑 |
| 成功审计 / 失败证据 | `appendSchedulingAudit/readSchedulingAudit` 绑定 caller-tx，AuditLog 动作 `scheduling.disposed`，记录人工处置前后日期/理由/标识；建议仍唯一存共享三表。generate/dispose 失败在事务外写最小结构化应用日志；全部排期 HTTP ≥400 另写 server request.id/actor/project/状态码日志，不写 body/exception/prompt/密钥 |
| 前端 | 用户已确认 `/projects/:projectId/scheduling`；PM-only 左导航。wrapper 重新获取服务端项目权限，将 grant 绑定 projectId + 当前身份，非 PM 不构造 client/不加载数据；调用 C 原页面，无 demo。核对任务/甘特/负载链接进入时重新请求正式数据，无排期镜像缓存 |

共享仓储额外修正：`createAiAuthorizationPort` 参数收窄到 AuthzDb，支持真实 tx；`listPage/adoptionStats` 的 visibilityScope 改为使用当前 caller-tx，不再在事务内绕到 root client 查权限。

## 2. 路由与配置

后端保持 C 的七条 `/projects/:projectId/scheduling-suggestions` 相对路径：POST 生成，GET 列表、stats、详情、audit，POST assessment、disposition。前端沿已有 `/api` 代理，不给后端重复加 `/api`。

D 模型工厂已在 main：`createSchedulingAiModelPortFromEnvironment`。配置由服务端读取：

- `SCHEDULING_AI_MODE=EXTERNAL_CHAT_COMPLETIONS`
- `SCHEDULING_AI_ENDPOINT`、`SCHEDULING_AI_PROVIDER_ID`、`SCHEDULING_AI_MODEL`、`SCHEDULING_AI_API_KEY`（仅运行环境，不进仓库/Issue/前端）
- 可选 `SCHEDULING_AI_RESPONSE_MODEL`、`SCHEDULING_AI_TIMEOUT_MS`，完整约束见 `role-d/ROLE-D-SCHEDULING-model-port.md`。
- B 装配的 `SCHEDULING_AI_DATA_CLASSIFICATION` 默认 `PROJECT_DATA`；**仅部署负责人批准的合成演示环境**才能设 `SYNTHETIC_DEMO`。不从 HTTP body 接收分类。

完全未配置模型时保留明确 unavailable 端口：生成回执可能 HTTP 201，但 `status=GENERATION_FAILED` / `AI_SERVICE_UNAVAILABLE`，不是有效建议。部分 API 配置不完整则工厂 fail-fast；不会退回需求拆解桩。真实 EXTERNAL + PROJECT_DATA 仍拒绝外发。

程序化 server-only 装配可传 `buildApp({ scheduling: { model, dataClassification } })`；定向测试使用明确合成模型。该入口不是客户端可覆盖参数，测试结果不冒充供应商已选定。

失败证据落点是应用结构化日志，不是持久业务审计表；生产部署应保留 warn 级日志并配置留存。测试 `logger:false` 不代表生产失败证据已部署留存。

## 3. 验证记录及未完成项

- [独立 tester 原始命令及分阶段结果](ai-records/B/issue-32/evidence/B-I32-20261024-s3-production-tester-01-commands.md)：先失败、修复、重验分列。
- [B 只读评审及修复复核](ai-records/B/issue-32/B-I32-20261024-s3-backend-review-01.md)。
- [真实浏览器权限与 unavailable 链路](ai-records/B/issue-32/evidence/B-I32-20261024-s3-browser.md)。
- 永久生产装配回归 `test/scheduling-production.http.test.ts`：12 项，包含成功/修改/拒绝/审计、幂等、撤权、全角色/跨项目、受保护 FS/敏感模型出口，以及末尾 audit 写失败导致日期/处置/应用整份回滚。
- 曾有严格类型失败与 C 旧测试双注册：不能用 12 项运行期通过代替类型检查或 C 套件通过。用户已授权只调整 `workflow.db.test.ts` 测试装配，保留原 24 条断言。
- **最终独立重验通过**：server/web typecheck exit 0；B 生产装配 12/12，AI 仓储 20/20，C 排期模块 173 passed / 12 TODO（原 24 条套件恢复），`npm run build:web` exit 0。中间失败原证据保留，最终通过没有覆盖历史。未跑全仓测试。
- C 的 `integration.pending.test.ts` 12 TODO **保持原样**，由 C 接到装配 SHA 后完成正式闭环，不由 B 代签。
- 真实供应商/模型/地址/凭据尚待负责人选定；本轮未调用公有云，D 合成 completion 回环与 B 合成端口测试不是外部模型验收。
- #36 的 C DELETE/TaskSection 接线与本交付独立；B 未修改 task/routes、task/rules 或 TaskSection，不因附件未完成而暂停排期。
- PB-06 任务锚点仍等 C 具体补丁/窗口；PB-09 里程碑口径不在本次修改。
