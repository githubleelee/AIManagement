# #35 C guard 接入进展（2026-10-22～23，Asia/Shanghai）

## 当前实现

- 已 fetch 并合入 main `7447a5f965e68843988316ceb62e8e5accd88325`，无文本冲突；已成功重新生成 Prisma Client。交付前再次 fetch 发现 main 更新到 `0998f626df3459a709370bfb59d938dde77658ed`，已无冲突合入并重做必要验证（见下文），schema 未再变化。
- `service.ts`：非 PM 的列表/count/详情共用当前任务/故事可见性交集 + `everRestricted=false`。仅中央 PM 的 all scope 绕过 guard。
- 新建/PATCH 建立敏感任务或故事关联时，从真实同项目对象读取敏感状态，同一事务将 guard 置 true；不存在写 false 的路径。非法引用/内容校验失败回滚整笔事务。
- 不扩充 DTO，不提供降密开关，不改 Prisma/shared/authz/生产装配/旧 task 文件。
- 更新插件注释、页面提示、旧非 PM 拒绝断言和浏览器脚本。原 3 个 todo 已用新规则下的实际测试替换，不能沿用旧白名单成功预期。
- 原有未提交交互记录、原始摘录和 `editor-handoff.md` 改动均保留，未纳入本次业务修改。

## 本轮验证（新 main 基线）

| 项目 | 实际结果 | 证据 |
| --- | --- | --- |
| Prisma Client 生成 | 成功，Prisma 6.19.3 | 工具可见输出；未迁移真实开发库 |
| 首次 UML HTTP + B schema | 77 passed / 2 failed | `evidence/guard-targeted-tests.txt` |
| 修正夹具后同范围复测 | **79 passed，0 todo**（HTTP 54 + schema 25），18.77 秒，exit 0 | `evidence/guard-targeted-tests-rerun.txt` |
| Server typecheck | exit 0，5.63 秒 | `evidence/guard-server-typecheck.txt` |
| Web typecheck | exit 0，24.23 秒 | `evidence/guard-web-typecheck.txt` |
| 真实 API Chromium | **9 项通过**，23.23 秒，exit 0 | `evidence/guard-integration-browser.txt`、`integration-browser-results.json`、对应截图 |
| 扩展 UML + schema + authz 回归 | **88 passed / 0 todo**，29.02 秒，exit 0 | `evidence/guard-authz-regression.txt` |
| Server build | exit 0，3.84 秒 | `evidence/guard-server-build.txt` |
| Web Vite build | exit 0，1.57 秒；正式入口尚不包含 UML 页面，页面本身已通过 web typecheck 和浏览器验证 | `evidence/guard-web-build.txt` |
| 后置敏感状态诊断 | task/story 均复现解绑、恢复普通或删除后 200；**这是未解决缺口，不是验收成功** | `evidence/guard-late-sensitivity-probe-rerun.txt`、`guard-late-sensitivity-observed.json` |

首次测试的两个失败均为本次新增夹具不合法：故事仍有任务时实际删除返回 HAS_CHILDREN；跨项目任务夹具的负责人/验收人相同被工厂拒绝。修正为 childless story、不同用户且补项目成员后通过；未修改业务断言或 B 的测试。

浏览器验证新增普通 VIEWER 实际 GET/只读 UI、敏感关联后解绑仍拒绝读取并清空旧图/草稿/标题/链接。仍是隔离合成迁移库、实际 app/plugin、Vite proxy，不是 B 正式挂载。

### 最终基线 `0998f62` 的复测

- `guard-final-http.txt`：3 文件 / 88 passed / 0 todo，runner 记录 END exit=0、48.02 秒；外层 WSL 工具随后报告 100 秒超时，**不把外层超时说成 exit 0**。已有完整实时日志和 Vitest 完成输出，未盲目重跑。
- `guard-final-server-typecheck.txt` / `guard-final-web-typecheck.txt`：分别 exit 0，5.83 / 10.70 秒。
- `guard-final-server-build.txt` / `guard-final-web-build.txt`：分别 exit 0，7.70 / 2.52 秒。
- `guard-final-browser.txt`：9 项实际 API Chromium 检查通过，exit 0，23.60 秒；已更新对应 JSON/截图。
- 后置敏感诊断的实测证据仍来自 `7447a5f` 基线；最终基线追加诊断因工具自动审核超时未执行，不伪称复跑成功。两基线间没有修改 UML / authz / task 敏感写点，缺口已向 [#24 comment-6359691655](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6359691655) 请求确认。

每条验证独立限时并实时写日志，超时只终止该命令拥有的子进程树。全量测试历史异常未重跑、未声称修复；独立绘图逻辑未改，未重复跑旧 34 项编辑器检查。

## 已知尚未覆盖的安全边界（不能宣称全生命周期无自动降密）

当前获批规则与 C 实现是“建立关联时，目标已敏感则置 true”。普通目标建立关联后再标为敏感，B 的敏感状态写点尚未同步更新既有图的 guard。此时当前关联交集能隐藏未获授权者，但白名单成员、随后解绑/删除/目标恢复普通后的历史保护不能由关联时置位保证。

已通过 `probe-late-sensitivity.ts` 实际 HTTP 复现（task/story 两类结果一致）：普通关联图 GET 200 → PUT sensitivity=true（白名单只含另一 MEMBER）→ VIEWER GET 404、白名单 MEMBER GET 200 → 解绑后 VIEWER GET 200；其他同批图分别在目标恢复普通、或敏感目标被真实 DELETE 后也 GET 200。该诊断只读写隔离合成库，不接触真实项目数据。首次诊断因 sensitivity=false 请求缺少必填 visibleMemberIds 返回 422，补合法请求体后复测完成，首次日志保留。

需要 #24 明确是否将普通→敏感的真实写事务扩展为同项目关联图批量置 true、由 B 在 task/story 敏感写点实施，并覆盖历史这类图与并发次序。本次未擅改 B 的敏感写点，也未用只读接口偷偷修数据库，更不把该边界记成验收通过。

## 正式集成仍依赖 B

1. P4：`src/routes.ts` 注册 `registerUmlRoutes(app, context)`。
2. P5：ProjectLayout 下 `/projects/:projectId/uml`，`?diagram=<id>` 详情；导航和路由文档。
3. AC4：TaskSection 可见行 hash 定位/聚焦，按已给最小 diff 或等价方案实施后给 SHA。
4. C 接到 SHA 后验证正式路由、精确任务行点击、刷新深链、同页 hash 和历史导航。

## 本轮交付状态

- 实现本地提交 `cefe96c`；分支 `feat/US15-uml` 已包含 main `0998f62`。
- 使用用户确认的 `brucelyce-ux` 已发布并回读核对两条评论：[#24 保密边界确认](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6359691655)、[#35 正式接线/锚点请求](https://github.com/githubleelee/AIManagement/issues/35#issuecomment-6359699302)。两条评论发布时正文均如实注明尚未推送；后续重试已成功（见下）。
- 先前 push 被工具自动审核错误阻断，Git 命令并未执行，不是 GitHub 权限/网络/代码拒绝。用户要求修复后，使用同一账号和同一正常 push 命令成功：`7e226db..a4a8a4d HEAD -> feat/US15-uml`。随后 `ls-remote` 独立确认远端 SHA 为 `a4a8a4d4cd5f874d7b0beabbc4e51c78fdbd2fb0`，与当时本地 HEAD 一致，已包含 `cefe96c` 实现。未改凭据、全局配置或传输方式，未强推。
- 两条已发评论的原文和 `guard-publication.json` 记录技术请求及实际发布结果，不导出任何凭据或排除归档的前次交互。

**后续更新**：四类真实对象选择器及对应回归已完成，见 [picker-progress.md](picker-progress.md)；本页其余结果保留为 guard 阶段记录。补充图片上传/高级 UML/事件接线未新增。未合 PR、未关 Issue、未勾整票 AC。
