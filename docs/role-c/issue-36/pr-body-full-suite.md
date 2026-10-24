## 目的

记录 ROLE-C 在 main 上执行的真实全量测试结果。**只新增文档/证据/辅助脚本，不改产品代码、测试断言或主配置。**

## 全量结果（`origin/main` = `dcc66f1`，工作树内容与之 0 文件差异）

| 范围 | 文件 | 用例 | 通过 | 失败 | 跳过 | todo |
|---|---|---|---|---|---|---|
| 主配置 `test/**` + `src/**` | 105 | 2079 | 2076 | 1 | 2 | 0 |
| `web/**` 补跑 | 2 | 18 | 18 | 0 | 0 | 0 |
| **合计** | **107** | **2097** | **2094** | **1** | **2** | **0** |

主配置耗时 179.6 秒；`vitest run` 使用 `vitest.config.ts` 的 **8 worker**，未覆盖并发度。

## 唯一失败：并发伪失败，已单跑证伪

`src/modules/ai-scheduling/integration.pending.test.ts` 的 `G6` 真实浏览器门禁在全量中 `locator.click` 30 秒超时；**单独 1 worker 复跑该文件 12 项全部通过**（G6 用 40.8 秒，整文件 61.1 秒）。判定为 8 worker 并发下真实浏览器用例的定位超时，非产品缺陷，也非本次改动引入（该文件属 #32 门禁，A 交付）。未修改该测试、未调低断言。

## 2 个跳过：设计内说明

`src/modules/task/task-events.test.ts` 两条端到端用例自带「需桥接运行，见文件内说明」并主动 `skip`，不是被本次改动禁用的断言。

## 过程中纠正的两个错误认知（已在报告内留痕）

1. 曾把全量判为「挂起」：实际是 `vitest run test` 的 `test` 被当作**文件名过滤器**，且我传入 `--maxWorkers=2` **覆盖了项目配置的 8 worker**（该配置 2026-10-24 为规避 `database is locked` 而设）。改回配置默认后 179.6 秒完成。超时日志保留。
2. 主配置 `include` 为 `['test/**/*.test.ts', 'src/**/*.test.ts']`，**不含 `web/**`**；本次用独立 `full-web.vitest.config.ts` 补跑 2 文件 18 例，未改主配置。

## 明确不做

- 不改产品代码、不改任何测试、不调 `vitest.config.ts`、不改 `DECISIONS.md`。
- 不声称历史保护问题已解决（已失关联、无可靠历史证据的旧 UML 图仍无法凭当前表宣称全覆盖）。
- 不把全量绿等同于真实浏览器验收（`verify-browser.mjs` / `verify-integration.mjs` 是独立脚本，另有证据）。

## 复核要点

看 `docs/role-c/issue-36/full-suite-report.md` 与 `evidence/full-suite-combined.txt`、`evidence/probe-g6-isolated.txt` 是否与 `origin/main` 实际一致。
