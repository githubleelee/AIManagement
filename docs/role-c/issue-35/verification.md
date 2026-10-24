# #35 实测结果（阶段性交付，不是最终验收）

## 环境

- 工作目录：`D:/临时项目/AIManagement-US15`；分支 `feat/US15-uml`；基线 `37287c26a2d867e938132a906f9422354f66eb7c`；代码提交 `dca876a28288ccdc6a569f3d74285ce321a1af2d`（本地）。首次推送被 GitHub 403 拒绝（[历史结果](submission-result.json)）；用户确认改用 brucelyce-ux 后已成功推送功能分支。最新 main 检查、125 项定向复测/3 todo、构建及浏览器通过、全量和最新 typecheck 超时限制见 [本轮交付记录](prepush-status.md)。
- 实际 Node `v24.15.0`，Vite `6.4.3`，Vitest `2.1.9`，Prisma Client `6.19.3`；Windows 本地真实 Chromium。
- B P1 模型已合入并 `npm run db:generate` 成功；未读取用户数据库、.env 或真实项目数据。
- 集成浏览器使用既有 createHttpTestContext/factories 生成独立临时 SQLite，应用真实迁移，显式注册实际 UML 插件，经过真实 Vite /api proxy；不是网络拦截或 mock 后端，也不是正式挂载验证。

## 已执行命令

| 命令 | 实测结果 | 证据 |
|---|---|---|
| `npx vitest run src/modules/uml/uml.http.test.ts src/modules/uml/uml-schema.test.ts src/modules/authz/sensitivity.http.test.ts` | 3 文件，**78 passed / 3 todo**；其中新增 UML HTTP 44 通过，B schema 25 通过，既有鉴权回归 9 通过 | [完整命令输出](evidence/uml-targeted-tests.txt) |
| `npm run typecheck` | exit 0（前后端） | [输出](evidence/typecheck.txt) |
| `npm run build` | exit 0；此命令的主应用 web bundle 尚不包括未挂载的 UML 页面，因此另构建独立入口 | [输出](evidence/build.txt) |
| `node docs/role-c/issue-35/verify-editor.mjs <playwright-core绝对路径> <Chromium绝对路径>` | **34 项真实浏览器检查通过**；在恢复 loopback Vite 后重新运行成功 | [逐项输出](evidence/editor-browser-final.txt)、[结构化结果](evidence/editor-browser-results.json) |
| `node docs/role-c/issue-35/verify-integration.mjs <playwright-core绝对路径> <Chromium绝对路径>` | **8 项真实 API 浏览器检查通过**；独立临时库、真实会话/API/代理，无 pageerror | [逐项输出](evidence/integration-browser.txt)、[结构化结果及不含令牌的请求证据](evidence/integration-browser-results.json) |
| Node 调用 Vite `build()`，`configFile=web/vite.config.ts`，rollup inputs 为 `preview.html` 与 `integration.html`，outDir 为系统临时目录 `aim-us15-editor-build` | exit 0；**两个入口及正式页面组件实际编译进入 bundle**；未修改 Vite 公共配置 | [输出](evidence/editor-build.txt) |

浏览器参数示例（只是本机工具路径，不是仓库依赖变更）：

```powershell
node docs/role-c/issue-35/verify-integration.mjs "$env:USERPROFILE/.pi/agent/extensions/browser/node_modules/playwright-core" "$env:LOCALAPPDATA/ms-playwright/chromium-1248/chrome-win64/chrome.exe"
```

独立编辑器脚本要求先运行 loopback Vite 5195；集成脚本自己创建及清理实际 API/Vite 服务，使用可用 loopback 端口。

## 验证覆盖

### 独立编辑器（34 项）

用例图参与者/用例/三类关系编辑和真实 SVG；非法端点、自环、重复 id/关系、合计节点上限、未知类型/字段、超长文本、非递增消息序号等拒绝；生命线/消息换序及删除本地边；只读呈现；JSON 下载、刷新后导入；用户 markup 保持为文本、无脚本/图片/外部请求；390px 窄屏无 viewport 横向溢出。

### 新增 UML HTTP（44 通过 / 3 todo）

PM 创建/保存/读取/删除两类图、全量替换事务、客户端临时 id 不更新其他图节点、服务端分配连续 seq、自消息、关联去重/四类替换/清空、图负责人转移不扩大权限、列表与总数同源/截断、非法输入回滚、跨项目与不存在引用同一错误、并发整图不混合、PM/MEMBER/VIEWER/outsider/未登录写矩阵、详情越权/不存在同一响应、真实任务删除 Cascade 后临时关闭读侧不泄漏旧正文。

3 个 todo 均是**尚未完成的非 PM 正常读取/交集/历史限制策略**，不是被跳过后仍声称全绿的验收项。

### 真实 API 浏览器（8 项）

1. 实际页面创建时序图，提交四类关联、真实服务端 id 与 seq；验证任务 href（未点击并定位目标行）。
2. 刷新恢复数据库图稿、SVG 和可编辑字段。
3. PATCH 元数据不提交图内容草稿；PUT 内容不提交元数据草稿，界面分别提示。
4. 不存在任务引用获得真实 422，草稿和旧持久化内容均保留。
5. wire 转换保留反向 association、双向有序元组、关系说明、null 消息标签，保存往返不悄悄丢失。
6. 使用另一个合成账号的真实会话后，真实拒绝清空原图、草稿与关联标题，刷新不显示写控件。**账号切换只用于临时库测试，不是生产越权绕过或白名单正例。**
7. 确认删除后实际 DELETE，刷新后原图仍不存在。
8. 实际页面编辑用例图及关系说明，保存/刷新恢复 SVG，并检查窄屏无页面溢出。

## 截图

- [独立用例图](evidence/editor-use-case.png)
- [独立时序图](evidence/editor-sequence.png)
- [独立只读呈现（非权限证据）](evidence/editor-readonly-presentation.png)
- [真实临时库保存并刷新后的时序图](evidence/integration-sequence.png)
- [真实临时库保存并刷新后的用例图](evidence/integration-use-case.png)

全部是合成数据截图，不含令牌、密码或真实项目内容。

## 失败与修复记录

- 浏览器内建工具启动失败：改用实际安装的 Chromium + Playwright 脚本，不声称原工具成功。
- 首轮独立预览定位超时：补显式 aria-label；后续 34 项通过。
- favicon 404：独立 HTML 使用 data favicon；未用忽略任意请求错误掩盖。
- 编辑修复后旧导入/导出错误提示未清除：编辑或换图时清除旧错误，已复测。
- 初次 HTTP 测试编译有数组索引 possibly undefined：对固定测试夹具索引作明确非空断言；typecheck 通过后才运行 HTTP 测试。
- 同步新基线后第一次独立浏览器复跑为 `ERR_CONNECTION_REFUSED`（5195 服务不在运行），**不是检查通过**；已重新启动 loopback Vite，最新独立 34 项重新完整通过。
- 正式页面初次截图显示独立编辑器旧提示“接口尚未接入”：改为准确的“不自动保存”提示，重新运行 8 项集成浏览器检查并更新截图。
- 子 agent 调用因非 tmux 环境失败；无子 agent 产出，均由主控实施和验证。

## 未测 / 不宣称

- 未运行本轮全库测试；78 是定向结果，不能复制 B 历史 1420 例作为 C 本轮全库结果。
- 未正式注册后端/前端路由与导航，未在真实部署或真实项目上操作。
- 非 PM 正常可见图仍被临时安全关闭，**AC5 未完成**；等待已登记的不自动降密 guard 设计。
- 未完成目标任务行真实点击跳转，**AC4 目标行定位未通过**；等 B 任务区补丁。
- 未做对象选择器，四类关联为 ID 输入；未做附件上传、乐观锁或事件接线。
- 未关闭 Issue或合 PR；按用户授权已提交并在账号确认后推送 `feat/US15-uml`，未推 main。最终 AC1–AC6 均未据此勾选。
