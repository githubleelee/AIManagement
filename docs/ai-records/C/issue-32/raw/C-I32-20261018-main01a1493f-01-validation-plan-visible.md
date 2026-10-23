# 验证策略：可见输入与输出节录（非完整导出）

## 本轮人类输入原文

设计一套验证策略，确保现版本能正常使用且不会和主分支产生冲突

## 助手可见进度原文

我会把验证分成两条线：一条检查当前独立规则和预览是否正常，另一条在隔离目录中验证它们能否兼容最新 main。同时区分“Git 文件冲突”和“规则、权限、数据语义冲突”；没有文本冲突并不代表集成安全。

## 实际产出

[完整验证策略](../../../../role-c/issue-32-validation-strategy.md)：L1 独立预览、L2 固定 main 候选兼容、L3 真实集成三等级；G0–G5 及提交前门禁；隔离 DB、对照实验、路径 manifest、浏览器、受影响回归与并发/失败矩阵；只完成设计，不声称执行通过。

## 工具事实节录

cwd D:/临时项目/AIManagement-US12。

- git status --short --branch：feat/US12-ai-scheduling behind 35；docs/ai-records、docs/role-c、src/modules/ai-scheduling、web/src/pages/scheduling 未跟踪。
- git rev-parse HEAD：398aa76d02f66ce9d62e4e1c340de408f15a1f0f。
- git rev-parse origin/main：59b52741834ba9c38ad846821df7a2c9a489b174。
- git diff --name-only：无已跟踪改动输出；另执行 git ls-files --others --exclude-standard -- 本域白名单，明确未跟踪源文件存在，不能据空 diff 声称无变更。
- read：package.json、vitest.config.ts、integration.pending.test.ts、web/vite.config.ts、policy.ts。
- git ls-tree -r --name-only origin/main -- 限定测试/模块路径：核实 task、acceptance、authz、gantt、workload 和 test 下回归文件路径；shared 仅 errors/types/validation，无本域生产路径。
- git diff --name-only HEAD origin/main -- package.json package-lock.json vitest.config.ts web/vite.config.ts tsconfig.json：无输出。
- Get-Date 实测：起点 2026-10-18 16:01:33 +08:00；第二次核对 2026-10-18 16:33:19 +08:00，非精确各步时间。

没有 fetch/合入/提交/推送、测试、迁移、服务启动或浏览器执行。此处只登记本轮，未收录上一轮明确要求不记录的交互。

完整工具自带原始导出仍未取得；这是诚实节录，不是无删节原件，也不是测试通过证据。
