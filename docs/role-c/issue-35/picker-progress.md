# #35 C 可独立推进部分交付：关联选择器、回归及验收准备

日期：2026-10-23（Asia/Shanghai）。本批从 `ea81e4e` 继续，已含 main `0998f62`；未改 B 单写文件、未修改数据库/迁移/鉴权/正式路由/TaskSection。子 agent 因无 tmux 无法启动，由当前 agent 直接实施，不假定有子 agent 成果。

## 已完成

1. **四类真实关联选择器**：业务目标、用户活动、用户故事、任务。复用 `GET /projects/:id/goals` 层级树和 `/projects/:id/tasks`，只消费既有鉴权 HTTP 投影，不跨调业务 service、不新造公共契约。
2. 搜索名称/ID，活动和故事显示祖先路径，所有候选显示 ID 区分同名；复选框与高级真实 ID 输入共享同一元数据草稿。
3. 每类最多 50 个，超限明确提示；不因候选缺失静默删除既存或手输 ID，保留并可显式移除。跨项目与不存在引用仍由服务端作最终校验。
4. 选择/取消不发写请求；创建与元数据显式保存后才持久化。内容 PUT 不吞关联草稿，关联 PATCH 不吞内容草稿；已保存关联名称/链接仍只取成功服务端响应。
5. PM 才加载/显示选择器；VIEWER 没有候选 UI。mount、focus、storage、重试重新鉴权，刷新前清空候选名，旧请求取消，卸载不回写；401/403/404 走父页面拒权清空。普通错误显示可重试提示并保留 ID 草稿。
6. loading、空列表、无搜索结果、网络失败与恢复路径；390px 窄屏无页面级横向溢出。已读取实际桌面/移动截图检查，不把仅源码推测当 UI 验证。
7. 新增 `uml-picker.http.test.ts`，从真实 HTTP 列表验证四类投影、跨项目、敏感过滤、匿名/外部人员拒绝、空项目、错误项目投影拒绝。
8. 新增 [正式入口验收执行清单](formal-acceptance-checklist.md)，收敛 B SHA 前置条件和收到补丁后可直接执行的角色/保密/保存/锚点矩阵。清单是准备，不是已通过记录。

## 最终验证（同一已合入 `0998f62` 的分支基线）

| 范围 | 实际结果 | 证据（均在 evidence/） |
| --- | --- | --- |
| UML HTTP + B schema + picker HTTP + authz | **4 文件 / 94 passed / 0 todo**，22.91 秒，exit 0 | `picker-http-tests-final.txt` |
| Server typecheck | exit 0，6.36 秒 | `picker-server-typecheck-final.txt` |
| Web typecheck | exit 0，4.59 秒 | `picker-web-typecheck-final.txt` |
| Server build | exit 0，3.96 秒（之后只拆分 frontend API transport/pure decoder，不改生产 server） | `picker-server-build.txt` |
| 正式 Web Vite build | exit 0，1.62 秒；正式 UML 尚未挂载，不能只凭此宣称页面已打包 | `picker-web-build.txt` |
| C 两个独立入口 bundle | integration + preview 实际构建，exit 0，1.42 秒 | `picker-entry-build-final.txt` |
| 真实 API Chromium | **13 项通过**，9.68 秒，exit 0 | `picker-browser-release.txt`、`picker/integration-browser-results.json` |

浏览器覆盖实际选择四类后创建、搜索/上限/未知 ID、断网时清空旧候选并保留草稿、真实恢复重试、显式元数据取消/增加关联后保存并刷新、普通 VIEWER 只读、敏感建联解绑后的实际 404 与 UI 清空、空项目不混入别项目候选、既有编辑/映射/删除链路。所有令牌只在 IPC/内存；未归档 Authorization/cookie/真实项目数据。

### 失败与修正记录（不能抹掉）

- 最初 `picker-browser.txt` 在拒权 UI 提示等待 30 秒超时；随后加入仅记录 path/method/status 的失败诊断。下一轮 12 项通过，未因此宣称已定位首次原因。
- `picker-browser-final.txt` 在图内容保存等待时超时，页面为通用失败提示，未观察到成功 PUT 响应。新增 requestfailed 的脱敏诊断，并为拒权步骤增加实际 GET 404 和 focus 请求响应观察，保留原 UI/持久化断言，未放宽时间/跳过检查。
- `picker-browser-network-diagnostic.txt` 13 项通过；最终 transport 拆分后的 `picker-browser-release.txt` 再次 13 项通过。**两次早期偶发失败根因仍未证实，不把复测通过说成故障已定位修复。** 后续若再现，已有失败 JSON、pageerror 与网络失败观察点可定位。
- `picker-server-typecheck.txt` 首次报 TS2835：HTTP 测试从前端 adapter 引入了浏览器 transport 的无扩展名导入。已将纯投影解析和 HTTP transport 分开：纯 `reference-options.ts` 仅依赖 zod，transport 留在既有 `api.ts`。最终两端类型检查和两入口构建通过；没有修改共享 TS 配置来掩盖错误。

## 全量测试限时诊断结果

命令：Vitest 全量、2 worker、heap 指标、default+JSON reporter，180 秒上限，独立运行未同时跑浏览器/构建。实时日志 `picker-full-diagnostic.txt`。

- 到时仍在持续完成文件，观察到 **17 个文件完成记录**，包括以前异常退出过的 goal-tree；没有观察到 `Worker exited unexpectedly`、断言失败或 OOM 报错。
- 完成文件的 heap 指标约 28–48 MB；这是每文件完成时的 JS heap，不是整个机器/所有子进程的峰值内存。
- 最后完成 `requirement.story-read-update.test.ts` 后到达限时，runner 终止自己拥有的测试进程树，**exit 124 / 181.16 秒**。没有完整 JSON 结果，不能补造完整计数或声称全库通过。
- **结论仅是本轮未复现旧 worker 异常，观察到有限时范围内的持续工作；不能据此证明旧异常根因，也不能将其定性为内存或 migration 挂起。** 不再盲跑/拉长 timeout，不改共享测试设施、断言或配置造绿。

## 仍依赖 B / 项目负责人

- #24 后置标敏感的同事务 sticky 置位、历史回填与并发规则；本批不修 B 旧敏感写点，也不改变既定权限政策。
- #35 P4/P5 正式挂载/导航/文档、TaskSection 任务行锚点 SHA；收到后按新清单进行正式入口验收。
- 全量测试历史异常及早期浏览器偶发失败的确定根因仍未证实，必须单列；本批定向与最终组件链路验证不能冒充全库/整票通过。

此前的 `guard-progress.md` 保留为 guard 阶段记录；其中“对象选择器尚未实现”已被本文件的实际实现和证据取代。最初已有交互记录、原始摘录、editor-handoff.md 与 HANDOFF.md 仍保持未提交状态，不混入本批提交；不回填被排除归档的前次交互。
