# 排期模型端口验证与范围（2026-10-24）

工作目录：`/workspace/scratch/05204396b77e/ai-scheduling-update`。
基线：main `8018c6407a7dd2041e3ba8c56f55c69b88e30228`；分支 `feat/D-scheduling-model-port`。

|实测命令|结果|原始输出|
|---|---|---|
|npm ci|成功，Prisma client 6.19.3已生成|安装日志未单独归档；工具可见输出，不补造文件|
|npx vitest run src/modules/ai/scheduling-provider.test.ts（首批）|42通过|initial-provider-tests.txt|
|npx vitest run src/modules/ai/scheduling-compatibility.db.test.ts（首批）|7通过|initial-compatibility-tests.txt|
|npx vitest run src/modules/ai src/modules/ai-scheduling|14文件通过、1文件跳过；304通过、12todo|ai-regression.txt|
|npx vitest run src/modules/ai/scheduling-provider.test.ts src/modules/ai/scheduling-compatibility.db.test.ts（最终）|2文件61通过（54+7）|targeted-tests.txt|
|npm run typecheck（最终）|退出0，两端通过|typecheck.txt|
|npm run build|退出0，server+web通过|build.txt|
|git diff --check（跟踪文件预检查）|退出0|此时新增证据尚未加入暂存区|
|git diff --cached --check（首次暂存）|仅原始日志的EOF空行告警|保留原始输出，不删除日志空行造绿|
|git -c core.whitespace=-blank-at-eof diff main...HEAD --check|退出0|仅忽略原始日志末尾空行，其他空白检查保留|

回归批次304通过发生在最后新增5项输入边界测试之前；生产代码相同，最终定点61包含新增5项。不将两个批次重叠测试相加为唯一测试数，不宣称全仓回归通过。没有测试失败需要隐藏：初批通过后补上配置工厂及更多边界测试再验证，12个原TODO未改动。

## 实际证据

- 所有新增HTTP测试使用 `node:http` 在127.0.0.1随机端口真实监听，适配器使用真实fetch；无vi.mock、无fetch替换。响应为明确编写的合成completion，不做模型推理，不与公有云通信。
- 7项兼容测试使用现有helper独立临时SQLite、未修改的C reader/generator和正式共享Prisma仓储：有效建议保存PENDING/API trace；正式任务日期不变且无处置/应用记录；失败保存GENERATION_FAILED；member/真实项目分类在网络前拦截；模型调用中真实撤权或来源变化后不保存有效建议。
- 模型入口不读取秘密；仅假测试凭据随本机HTTP请求传输。代码manifest在source-sha256.json，不含.env/数据库/私有报告。

## 人工代码复核所需的关键点

生产变更仅D目录新增adapter、factory re-export与README；测试才导入C的生成器/reader，不新增生产跨域service调用。C和公共冻结区的git差异为零。未更改权限、公共类型、schema、app/routes、task或前端骨架。

## 未测/未完成（不得当作通过）

1. 真实供应商/模型/地址/凭据未选，故未执行真实外部模型推理；不声称原AC13满足。
2. B专项授权、日期写/FS、审计/失败证据、API与页面组装仍需B完成。测试里的tx授权/recordFailure是明确测试装配，不替代生产适配。
3. 正式页面没有本轮新挂载，未做正式用户界面端到端走查，不用测试面板/截图冒充。C接线后继续12门禁和真实API/浏览器闭环。
4. 这次交付不关闭#32，不合并PR，不更新团队统一Backlog或全局AI索引。

## 发布过程追加

本地提交5552756后尝试 `GIT_TERMINAL_PROMPT=0 git push -u origin feat/D-scheduling-model-port`，失败：`could not read Username for https://github: terminal prompts disabled`。未读凭据、未扩大权限。沿用用户先前授权，转云浏览器上传同一分支；远程提交SHA将由GitHub生成，发布后核对字节。
