# #32 当前版本验证结果（2026-10-18）

## 结论

- **L1：当前独立规则与虚构预览可用。** 只限已实现范围，不是正式排期工具。
- **L2：与固定 main 的候选组合检查通过，未发现新增回归或路径覆盖。** 未进行真实 feature commit 的 merge/rebase，不能称 Git 合并已完成，也不保证未来 main 不冲突。
- **L3：正式 AI 排期功能不可用/未完成。** 无真实公共 AI、共享建议持久化、#32 统一权限与原子应用、正式挂载的集成证据；12 项集成 TODO 未实现/未通过。

## 1. 可复现范围

- 原工作树：AIManagement-US12；HEAD=398aa76d02f66ce9d62e4e1c340de408f15a1f0f，分支仍 behind 35，没有合入、提交或推送。
- 本次开始 fetch 与结束再次 fetch 的 main 均为 **59b52741834ba9c38ad846821df7a2c9a489b174**。
- 在仓库外 `US12-validation-20261018-163716` 建立同一 SHA 的 detached candidate/control worktree。候选只叠加本票白名单；原本未跟踪的 30 份代码/文档/记录先备份并登记 SHA-256。
- 同路径覆盖数 0。结束时原文件及候选文件相对 manifest 摘要不符数 0；candidate/control 的 tracked diff 均 exit 0。没有产品或冻结文件改动。
- 环境：Windows，Node v24.15.0，npm 11.12.1；锁定安装的 Vitest v2.1.9、Vite v6.4.3。
- 验证自 16:37 开始，17:02 完成核验和隔离 runtime 清理（UTC+08:00）。不是每一步精确计时。

## 2. 实际命令与结果

候选与对照均从各自工作目录运行，未复制 .env 或现有数据库。使用显式、仓库外丢弃型 DATABASE_URL。安装用 `npm ci --ignore-scripts`，随后单独生成客户端。

| 项目 | candidate（main + 本票文件） | control（纯 main） |
|---|---|---|
| npm ci --ignore-scripts | exit 0 | exit 0 |
| npm run db:generate | exit 0 | exit 0 |
| npm run typecheck | exit 0 | exit 0 |
| npm run build | exit 0 | exit 0 |
| 本域定向测试 | 49 passed / 12 todo，exit 0 | 无本域文件，不适用 |
| 首轮全量测试 | **1265 passed / 12 todo**，53 文件通过+1 TODO 文件，exit 0 | 1196 个测试执行通过；2 worker 意外退出，50/52 文件完成，**exit 1，不算通过** |
| 对照单独重跑 | 不需要重跑，候选首轮全量正常 | **52/52 文件、1216/1216 测试通过**，完整输出无 unhandled errors；后台进程退出码未单独捕获，不伪称 exit 0 |

实际定向命令：

```text
npx vitest run src/modules/ai-scheduling/policy.http.test.ts src/modules/ai-scheduling/integration.pending.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

首轮全量命令（两环境各运行一次）：

```text
npm test -- --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

对照重跑命令（单独后台进程，随后 Wait-Process 等其结束）：

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

候选通过数 1265 = main 1216 + 本域 49；12 个 TODO 不算通过。没有新增/删改测试来获得本结果，没有运行覆盖率统计。

### 异常处理

- 安装后首次 generate 的 PowerShell 包装因将 Prisma 的弃用 warning 作为 NativeCommandError 提前停止；保留说明。改用 cmd 重定向重新运行，两环境实际 generate exit 0；未改产品代码。弃用 warning 不是本票功能失败。
- 首轮 control 两次 `Worker exited unexpectedly` 原因未定，不能直接断言是资源不足。单独重跑全量恢复正常，记录初次失败而不覆盖原日志。
- 临时浏览器 runtime 首次启动因 Windows `--import` 使用盘符路径而失败；改成候选 cwd 下 `--import tsx` 后启动成功。是本轮验证启动器问题，不是 app 修改。

## 3. DB 安全与回归范围

已读 test/helpers.ts、http-support.ts、src/db/test-support.ts：测试每次 mkdtemp 建 SQLite 文件，通过 datasourceUrl 注入，并在新临时库上运行 migrate deploy；reset 顺序已含 Risk/TaskDependency/TaskMilestone/Milestone。测试不是向开发 DB 清库；没有执行 migrate reset 或 db:seed CLI。

候选全量包括任务创建/更新/分配/敏感/进度/删除、验收、权限、项目/需求、甘特、负载、看板、schema、迁移重复部署、删除约束、隔离及 seed 单测等。seed 单测使用新临时库，不等于 CLI 对开发库 seed。未拿真实数据库做旧版本升级验证。

浏览器 runtime 也以 createTempDatabase 的新空库迁移并构造普通虚构用户/项目/任务，buildApp 注入其 Prisma；默认单例仅指向验证根目录内的 unused 文件，不使用 .env。实际生产路由注册表不含 `_test`；没有给产品注册新测试入口。

## 4. 实际浏览器证据

服务均来自 candidate：Vite 127.0.0.1:5197，隔离 backend 127.0.0.1:3197；不是原目录遗留预览。

### 排期独立预览

- 初始无建议；载入样例后 fixture/STUB/非正式提示明确。
- 编辑日期实际触发 FS、结束早于开始、新开始早于上海今天的阻断。
- 合法日期出现同人重叠、新结束推迟、超里程碑三项提示，不误写为硬阻断。
- 生成、采纳、修改后采纳、拒绝始终禁用，没有伪造正式成功。
- 模拟快照变化后整份过期、日期输入禁用。
- 模拟 403 后任务/输入消失；恢复 allowed 后审核理由为空，原编辑草稿不复活。这是 UI 模拟，不是服务端鉴权证据。
- 额外在浏览器隔离组件探针中用同 proposalId 切换 A→B 项目，B 内容出现、A 内容消失、理由/日期编辑重置；仅测试组件 props 生命周期，不代表真实跨项目 API 联调。
- 刷新后恢复空态。390px iframe 内检查：document 宽度390、无页面级横向溢出；日期表格在自身容器内横向滚动。不是手机设备仿真或全机型兼容声明。
- 清空历史缓冲后重新加载/操作，浏览器 network 只有本机静态资源；performance 中 `/api/` 和外部资源均空；无外部模型请求。仅证明当前预览没有外发，不能外推未来真实模型合规。
- 新鲜 console 只有 Vite/React 开发信息，无 app JS 异常。首次 favicon 404 单独观察到，不影响业务；更早 GitHub 页面缓冲错误不计为本地 app 错误。组件探针初次 CJS 导出取法错误及 iframe 加载时机错误均属验证脚本，调整后检查通过，未改产品。

### main 普通页面及旧验收链路

使用纯虚构 validation-pm 登录，真实 `/api/auth/login`、`auth/me` 返回200；进入隔离项目：

- 甘特：1 故事、3 任务、1 里程碑、1 FS 边正常显示。
- 负载：当前成员2项未关闭，包含 DONE、不含 CLOSED。
- 看板：虚构故事在“规划中”列正常显示。
- 验收：读取1条待验收，点击“通过/确认通过”，真实 acceptance POST 返回200；待验收归零，任务变 CLOSED。
- 再读负载从2变1，任务列表显示2个已验收、3条匹配；刷新仍保持。这是旧验收链路的真实隔离 DB 冒烟，不是 #32 应用证据。
- 本轮观察到的这些页面 API 均200；新鲜 console 无 app JS 错误。没有以此代替全角色/全业务浏览器覆盖，任务手工编辑/进度等以现有 HTTP 测试覆盖。

## 5. 当前仍不能放行的内容

1. 12 项集成 TODO 保留；真实公共 AI、存储、权限、task 写窗口及挂载未交付，不能正式生成或改期。
2. 当前候选 snapshot 仍是本域临时类型，依赖/里程碑数组没有正式可用性/截断协议；父故事敏感、角色/私有约束摘要等须与冻结契约补齐。当前49测试不证明这些未来适配器已正确实现。
3. 不可把 PM 甘特/负载完整响应当模型输入；真实应用需同事务重读、完整性检查、敏感过滤与原子处置。当前纯比较函数不是并发锁。
4. 未对原开发分支做 merge/rebase；候选组合没有路径覆盖、类型/构建/回归通过，不等于真实 Git 合并已验证。合入前需对新 main 重验。
5. 未运行真实 API、公有云、生产部署、正式排期全流程、全设备 E2E、真实数据迁移升级或全量依赖安全审计，不称这些已通过。

## 6. 证据与现场

[归档证据目录](../ai-records/C/issue-32/evidence/C-I32-20261018-main01a1493f-01-latest-validation/) 含 manifest、两组生成/类型/构建输出、定向及全量原始测试输出（含初次对照失败和重跑）、生产路由清单、仅用于验证的 runtime 脚本文本及截图。安装日志从 PowerShell UTF-16 转为 UTF-8，内容未改；其他日志保留原始 ANSI。

- [日期提示截图](../ai-records/C/issue-32/evidence/C-I32-20261018-main01a1493f-01-latest-validation/preview-warnings.png)
- [过期截图](../ai-records/C/issue-32/evidence/C-I32-20261018-main01a1493f-01-latest-validation/preview-stale.png)
- [真实旧验收后任务截图](../ai-records/C/issue-32/evidence/C-I32-20261018-main01a1493f-01-latest-validation/task-after-acceptance.png)
- [390px 容器截图](../ai-records/C/issue-32/evidence/C-I32-20261018-main01a1493f-01-latest-validation/preview-narrow-frame.png)

17:02:34 已停止本轮两个服务 PID，并删除明确归属本轮 runtime 的临时 DB 目录；没有清理其他人的测试临时目录。候选/对照 worktree、白名单备份保留以便复查；不提交数据库或 node_modules。原分支及产品文件未动，无 commit/push、GitHub 写入或权限/标签修改。
