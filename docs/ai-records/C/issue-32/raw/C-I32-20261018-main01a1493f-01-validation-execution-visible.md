# 验证执行：可见输入、进度与工具结果节录

完整工具自带会话导出未取得；本文件为真实可见节录，不是无删节原件。不含隐藏思维链，也未补录此前被用户豁免的交互。

## 人类输入原文

执行验证，看一下目前版本是否可用

## 助手可见进度原文

我会按策略执行：先保护本地未提交文件，在隔离目录中验证它们与最新 main 的兼容性，再跑规则、构建、回归和浏览器检查。最后分别说明“独立预览可用”“兼容 main”和“正式功能可用”是否成立。

候选版本的类型检查、构建和全量测试已通过：**1265 项通过，12 项真实集成仍是 TODO**。纯 main 对照运行中有两个测试 worker 意外退出，不能把它算作通过；我会单独重跑对照，并继续做浏览器验证。

浏览器已确认：排期预览的日期阻断、过期提示和草稿清理正常；隔离环境中的登录、甘特、负载、看板、任务列表也能使用，并实际完成了一次旧任务验收。纯 main 对照单独重跑后 **1216 项全部通过**。我正在做最后的文件完整性检查和证据归档；这些结果仍不代表 #32 的真实 AI 与原子应用已经完成。

## 实际证据摘要

- tester 委派失败：Subagents require tmux；没有假造子 agent 结果，由主控执行。
- 主工作目录 D:/临时项目/AIManagement-US12；本轮候选/对照 D:/临时项目/US12-validation-20261018-163716/{candidate,control}；main 固定59b5274。
- 实际 read 测试辅助/DB工厂源码，核对 datasourceUrl 注入新临时库。两次读取不存在的推测文件路径 ENOENT 后改读实际 src/db/test-support.ts；没有读取真实 DB 或 .env。
- MANIFEST_FILES=30 / COLLISIONS=0；两份 detached worktree 均从59b5274建立。
- 候选 generate/typecheck/build/targeted/full exit均0；定向49 passed/12 todo；全量1265 passed/12 todo。
- 对照 generate/typecheck/build exit均0；首次full exit1，2个 Worker exited unexpectedly，不算通过。单独重跑52文件/1216测试全部通过，未再出现unhandled error；重跑进程退出码未单独捕获。
- 浏览器测试含日期/过期/撤权/项目切换/刷新，390px iframe布局，真实旧页面及验收；实际网络验收POST200，DONE→CLOSED后负载2→1，刷新状态保留。
- 浏览器输入第一次用 input[type=text] 匹配不到无显式type的文本框、两次role选择器语法不支持，改用真实autocomplete/CSS后操作成功；不是登录/验收业务错误。
- runtime 首次 Windows import 参数失败后改 --import tsx；组件测试导出/加载时机错误后修正验证脚本；未改产品源文件。控制台遗留GitHub错误与favicon404和新鲜本地app窗口区分。
- 终检输出：MAIN_UNCHANGED=True；MANIFEST_HASH_MISMATCHES=0；CANDIDATE_TRACKED_DIFF_EXIT=0；CONTROL_TRACKED_DIFF_EXIT=0。
- 17:02:34 +08:00：STOPPED_VALIDATION_PID=49140 / 56888；ISOLATED_RUNTIME_DB_REMOVED=True。仅停止本轮服务及删除明确属于本轮runtime的临时DB，未批量清理他人目录。

[完整结果及执行命令](../../../../role-c/issue-32-validation-result.md)

[已归档测试输出、manifest、截图和验证启动器](../evidence/C-I32-20261018-main01a1493f-01-latest-validation/)

没有产品代码修改、原分支合入、commit/push、GitHub发布或标签操作。结论只放行独立预览及固定main候选组合，12个TODO与正式集成仍未通过。
