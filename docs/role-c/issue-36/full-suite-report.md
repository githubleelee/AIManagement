# 全量测试结果（2026-10-24，main `dcc66f1`）

## 结论

| 范围 | 文件 | 用例 | 通过 | 失败 | 跳过 | todo |
|---|---|---|---|---|---|---|
| 主配置 `test/**` + `src/**` | 105 | 2079 | 2076 | **1** | 2 | 0 |
| `web/**` 补跑 | 2 | 18 | 18 | 0 | 0 | 0 |
| **合计** | **107** | **2097** | **2094** | **1** | **2** | **0** |

运行方式：`vitest run`（**使用 `vitest.config.ts` 的 8 worker 配置**，未覆盖并发度）。
耗时：主配置 179.6 秒；web 补跑 2.0 秒。工作树与 `origin/main` 内容完全一致（`git diff --name-only origin/main HEAD` 为 0 文件）。

## 唯一失败项：并发伪失败，已单跑证伪

- 文件：`src/modules/ai-scheduling/integration.pending.test.ts`
- 用例：`G6: browser generation → confirm → actual task/gantt/workload changes → audit`
- 全量中的报错：`locator.click: Timeout 30000ms exceeded`，等待 `getByRole('button', { name: '展开故事「G6 合成故事」的任务' })`
- **单独复跑（1 worker）：该文件 12 项全部通过**，G6 浏览器用例 40.8 秒完成，整文件 61.1 秒。
- 判定：8 worker 并发下真实浏览器用例的 30 秒定位超时，属**测试基础设施并发伪失败**，不是产品缺陷，也不是本次改动引入（该文件属 `#32` 门禁，由 A 交付）。

证据：`full-suite-results.json`、`full-suite-summary.txt`、`probe-g6-isolated.log`、`full-suite-8w.txt`。

## 2 个跳过项：设计内说明，非缺陷

`src/modules/task/task-events.test.ts` 的两条端到端用例显式标注「需桥接运行，见文件内说明」后 `skip`：
- 创建任务 → 任务负责人收到 `task.assigned`
- 进入 DONE → 验收人收到 `acceptance.submitted`

这是文件自身的运行条件说明，不是被本次改动禁用的断言。

## 过程中的两个错误认知（已纠正，留痕）

1. **以为全量"挂起"**：首次用 400 秒上限跑全量，`exit=124`。随后 24 文件批次也 240 秒超时，一度判断为 hang。实际原因有两层：
   - `vitest run test` 中的 `test` 是**文件名过滤器**，不是目录，实际匹配了远超预期的文件；
   - 更关键的是我传了 `--maxWorkers=2`，**覆盖了项目配置的 8 worker**（该配置是 2026-10-24 为规避 `database is locked` 而设），导致耗时放大数倍。

   改回配置默认 8 worker 后，179.6 秒跑完。原超时日志保留：`full-suite-400s-timeout.log`、`full-batch-a-timeout.txt`、`probe-test-dir.log`。
2. **主配置不含 `web/**`**：`vitest.config.ts` 的 `include` 是 `['test/**/*.test.ts', 'src/**/*.test.ts']`，所以 `npm test` 本身不覆盖前端纯函数测试。本次用 `full-web.vitest.config.ts` 补跑 2 个文件 18 例，未修改主配置。

## 仍需如实保留的限制

- 全量绿**不代表**历史保护问题解决：已失去关联、无可靠历史证据的旧 UML 图仍无法凭当前表宣称全覆盖（见 `docs/role-c/issue-35/formal-delivery.md`）。
- 8 worker 与本机真实浏览器用例存在已知超时交互；本次以「全量 + 失败项单跑复证」组合结论，未修改 A 的测试或调低断言。
- 全量未包含真实浏览器端到端脚本（`verify-browser.mjs`、`verify-integration.mjs`），它们按设计是独立验收工具，另有各自证据。
