# B-I32-20261024-s3-production-tester-01 · 命令 / 结果 / 限制

- cwd：`/home/lee/aim-wt/b-sprint3-remaining`
- 时区 / 时间：Asia/Shanghai（CST +0800），2026-10-24 18:06–18:12
- 基线：HEAD `4dbd1ba660f2b95003638237c55591ea0cb0338f` + B 未提交改动
- 环境：Node v24.9.0、npm 11.6.0、Vitest 2.1.9；本 worktree 内 `npm ci` 本地生成 Prisma Client v6.19.3（未复用/未污染其他 worktree；未改版本文件）
- 供应商/模型：未选、未请求公有云。HTTP 对端为进程内注入的**合成模型端口**（`SYNTHETIC_DEMO`），不是真实供应商/大模型验收。
- 重要：验证期间主控/评审**并发修改**了 `src/scheduling.ts`（18:09）。故本目录同时保留「先失败」与「修复后」两份原始 stdout，不以后者抹掉前者。

## 时间线（真实先后）

| 阶段 | 命令 | 结果 |
|---|---|---|
| 初测（18:06–18:08，修复前） | `npm ci` | 成功；392 packages；`prisma generate` 成功 |
| 初测 | `npx tsc -p tsconfig.json --noEmit` | **失败 exit=2** → `typecheck-server-initial.txt`（`src/scheduling.ts(143,60)` / `(147,7)` 两处 Tx 推断错误） |
| 初测 | `npx tsc -p web/tsconfig.json --noEmit` | 通过 exit=0 → `typecheck-web-initial.txt` |
| 初测 | `npx vitest run test/probe-b-s3-production.http.test.ts` | 8/8 通过 → `probe-tests-initial.txt`（对修复前运行时代码，esbuild 不做类型检查） |
| 并发修复 | 评审/主控在 `src/scheduling.ts` 两工厂显式加 `<Prisma.TransactionClient>`，并在 `src/app.ts` 加排期路径 `onResponse` 最小安全日志 | `src/scheduling.ts` mtime 18:09:05；sha256 见 `current-revision.txt` |
| 复测（18:11，修复后） | `npx tsc -p tsconfig.json --noEmit` | 通过 exit=0 → `typecheck-server-current.txt` |
| 复测 | `npx tsc -p web/tsconfig.json --noEmit` | 通过 exit=0 → `typecheck-web-current.txt` |
| 复测 | `npx vitest run test/probe-b-s3-production.http.test.ts` | **9/9 通过** → `probe-tests-current.txt`（新增安全日志用例） |

## 定向 HTTP probe 覆盖（真实 buildApp + 临时 SQLite + supertest，修复后 9/9）
1. 七条排期路由在真实 app 上注册。
2. 七条路由未登录 → 401。
3. PM 可 list / stats（`total=1`、`pending=1`）。
4. MEMBER / VIEWER → 403；outsider → 404（读与生成）。
5. 未配置模型 → 生成 201 且保存 `GENERATION_FAILED` / `generation.status=FAILED` / `AI_SERVICE_UNAVAILABLE`，详情 `suggestion=null`、`changes=[]`，无假成功。
6. 合成模型注入 `options.scheduling` → 生成 → assessment → ACCEPT（应用日期）→ 审计 1 条 → 原请求重放（幂等，审计仍 1 条）→ 撤权（PM 降 MEMBER）后重放 → 403。
7. MODIFIED / REJECTED 处置各写成功审计；REJECTED 不改任务日期。
8. 来源已变更（任务转 DOING）时 ACCEPT → 409，`aiDisposition=0`、`aiApplication=0`、`auditLog=0`，未触碰任务写入。
9. 仅日期写入后任务 `status` 仍为 `TODO`（未进入 DOING / 未误触 FS 开工基础）。
10. 排期路径 HTTP≥400 `onResponse` 安全日志：读(list)/审计(audit)/生成 403 均产生 `HTTP_403` 记录，字段恰为 `{projectId, actorUserId, requestId(server request.id), code}`，无 `body/cause/err/stack`。

## 限制
- 这是**合成**模型与合成数据验证，不是真实供应商/模型验收。
- probe 为临时验证夹具（`test/probe-b-s3-production.http.test.ts`，未改生产代码），原始副本见 `raw/`；主控可自行决定是否保留。
- 事务回滚只通过真实冲突路径（SOURCE_STALE 409）观测「无部分提交」；注入式中途失败回滚未在本 probe 覆盖。
- 生成拒绝的 `排期操作失败/安全证据` 日志（既有 failure sink）会记录**客户端传入的 `requestId`**（领域幂等/关联键）；本次实测该值进入日志，但非任意请求体或 cause。新 `onResponse` 钩子本身只用服务端 `request.id`。
- 未跑全仓测试、未跑 build、未测正式前端（URL 已被用户批准，但本轮未做浏览器验证）。
- 未给 C 的 12 门禁代勾。

## 归因更正（追加，不覆盖上文）

- 上表「并发修复」一行归因更正：显式 `<Prisma.TransactionClient>` 与排期路径 HTTP≥400 `onResponse` 安全日志**由主控 `s3-main` 修改落地**；reviewer 仅只读发现/复核，未改文件。
- 先失败后通过的原始结论与 stdout 证据保持不变。

## 阶段 2（18:16–18:19 Asia/Shanghai）：主控晋升的永久回归 + 定向回归

- cwd：`/home/lee/aim-wt/b-sprint3-remaining`；HEAD `4dbd1ba`；快照 sha 见 `…-current-revision-2.txt`。
- 对象：`test/scheduling-production.http.test.ts`（9→12 例，永久生产装配回归；原临时 probe 已更名，`raw/` 历史保留）。

| 命令 | 结果 | 原始 stdout |
|---|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **失败 exit=2** | `…-typecheck-server-2.txt` |
| `npx tsc -p web/tsconfig.json --noEmit` | 通过 exit=0 | `…-typecheck-web-2.txt` |
| `npx vitest run test/scheduling-production.http.test.ts` | **12/12 通过** | `…-scheduling-production-http-2.txt` |
| `npx vitest run src/db/ai-repository.test.ts` | 20/20 通过 | `…-ai-repository-2.txt` |
| `npx vitest run src/modules/ai-scheduling` | **exit=1**：`workflow.db.test.ts` 重复路由，24 例 skipped；其余 149 通过、12 todo 保持 | `…-ai-scheduling-suite-2.txt` |

### 阶段 2 失败要点（保留原始 stdout）
- typecheck：`test/scheduling-production.http.test.ts(261,45)` `taskIds[0]` 为 `string | undefined`，不能作为 `successorTaskId`。
- 套件：`FastifyError: Method 'POST' already declared for route '/projects/:projectId/scheduling-suggestions'`（`workflow.db.test.ts` 在 `buildApp` 已注册后再手动 `registerSchedulingRoutes`）。

### 阶段 2 限制
- 只跑上述定向范围，未跑全仓/build/浏览器。
- 仅追加记录与证据，未改生产文件或既有测试。

## 阶段 3（18:34–18:37 Asia/Shanghai）：单文件 C 测试接线修正 + B 回归类型修正后复跑

- 上轮失败原 stdout（`…-*-2.txt`）全部保留；本轮为 `…-*-3.txt`。
- 快照 sha256 见 `…-current-revision-3.txt`。

| 命令 | 阶段 3 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 通过 exit=0 |
| `npx tsc -p web/tsconfig.json --noEmit` | 通过 exit=0 |
| `npx vitest run test/scheduling-production.http.test.ts` | 12/12 通过 |
| `npx vitest run src/db/ai-repository.test.ts` | 20/20 通过 |
| `npx vitest run src/modules/ai-scheduling` | exit=0：6 passed / 1 skipped；173 passed、12 todo（185）；`workflow.db.test.ts` 24 例恢复 |

### 阶段 3 限制
- 只跑上述定向范围，未跑全仓/build/浏览器；12 todo 非 C 门禁代勾。
- 仅追加记录与证据，未改生产文件或既有测试文件。

### 阶段 3 补充：`npm run build:web`（18:38 Asia/Shanghai）

- 结果：通过 exit=0；vite v6.4.3，125 modules transformed；`dist/web/index.html` + CSS/JS assets。
- 原始 stdout：`…-build-web-3.txt`。含正式路由挂载（`web/src/routes.tsx` `<Route path="scheduling">`，导航 `canAccessScheduling`），产物含 `scheduling-suggestions`/`scheduling-page` 标识。
- 未跑全仓 test、未跑 `build:server`。
