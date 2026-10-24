# #32 合入 main 前的整合复验（2026-10-24）

用户明确指令：检查无冲突后合入 main。本批只整合已推送的 C 排期交付，不新增业务或公共装配，不改变 #32 验收状态。

- C 已推交付：`455701e`，回执归档：`7609725`。
- 获取并预检 main：`e7bc546571662b2374f7496cb44f621ef2340d83`，merge-tree exit0，无文本冲突。
- 实际本地整合：`43f1a704e6b2928068be92a8ed9649bae069ea5e`，保留 B 最新 task/acceptance FS 守卫及其他已合 main 工作；没有擅自解冲突或改公共实现。
- 原有未提交/未跟踪文件先备份至系统临时目录 `us12-before-main-merge-20261024-161831`；没有 stage/reset/覆盖这些文件。

## 实际命令与结果

工作目录 `D:/临时项目/AIManagement-US12-core`；工具 bash 在 WSL，Windows Node 通过 `/init /mnt/d/nodejs/node.exe node.exe` 桥接。下列省略桥接前缀：

1. `node node_modules/prisma/build/index.js generate`：exit0。
2. `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`：exit0。
3. `node node_modules/typescript/bin/tsc -p web/tsconfig.json --noEmit`：exit0。
4. `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`：exit0。
5. `node node_modules/vitest/vitest.mjs run src/modules/ai-scheduling src/modules/task/task-fs-start-guard.test.ts src/modules/task/task-start-guard-port.test.ts src/modules/acceptance/acceptance-fs-guard.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=60000 --hookTimeout=60000 --reporter=json --outputFile=docs/role-c/evidence/issue-32-main-merge-20261024/backend-result.json`：**227 passed / 12 TODO / 0 failed**。
6. `node node_modules/vitest/vitest.mjs run --config src/modules/ai-scheduling/frontend.vitest.config.ts --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=docs/role-c/evidence/issue-32-main-merge-20261024/frontend-result.json`：**13 passed / 0 failed**。
7. 设置 `SCHEDULING_EVIDENCE_DIR=docs/role-c/evidence/issue-32-main-merge-20261024` 后执行 `node src/modules/ai-scheduling/browser-smoke.mjs`：**8/8**，零未捕获浏览器异常，合成 transport 组件验证，非正式 API/模型验收。
8. `node node_modules/vite/bin/vite.js build --config web/vite.config.ts`：exit0，121 modules。
9. `node docs/role-c/evidence/issue-32-main-merge-20261024/summarize.mjs`：UTF-8 解析机器结果成功；C 源码相对交付摘要指纹不符 **0**。

证据：[validation-summary.json](evidence/issue-32-main-merge-20261024/validation-summary.json)、同目录原始 JSON/截图。曾用 Windows PowerShell 默认编码读取含中文 JSON 导致摘要工具解析错误，随后使用 Node 明确 UTF-8 读取核验成功；未将该工具解码错误当作产品测试失败，也未伪造报告。

## 推送边界

只允许普通 fast-forward 推送 `HEAD:main`，不 force；推送前再获取并检查远端 main 为当前 HEAD 的祖先，若 main 前进到不兼容提交则停止。证据归档只纳入本文件及本次专属 evidence 目录，不混入其他工作树脏文档。

本批不声称全仓测试通过、生产装配完成或正式 US12 验收通过。12 最终门禁仍保留，B 公共装配和适用排期模型仍按 #32 六项接口交接接续；不关票、不改标签。
