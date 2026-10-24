<!-- role-c-us15-picker-complete-v1 -->
## ROLE-C：可独立推进的关联选择器与验收准备已完成；本轮推送仍被工具审核故障阻断

@githubleelee 本轮继续完成 C 自有工作，不等待/重做此前已批 guard，也未越 B 的旧模块和公共装配单写窗口。

### 本地已完成

- 四类真实对象选择器，复用既有鉴权 goals 层级树与项目 tasks API；按名称/ID搜索、路径/ID区分同名、50上限、未知ID保留/移除、loading/错误/空态、断网重试、失权清空。
- 选择只改草稿，显式 POST/PATCH 才持久化；高级 ID 输入与复选框双向同步；保存刷新及另一部分草稿保留已实际验证。
- 新增 6 项 HTTP seam 用例，含项目隔离、故事/任务敏感列表过滤、匿名/外部人员拒绝、真实空项目和错误项目投影拒绝；未自建其他域 service 或假选项。
- 完成 `formal-acceptance-checklist.md`：接到你的正式接线/锚点/安全补丁 SHA 后可按清单直接执行，不把清单当已过 AC。

### 验证与明确限制

当前分支已含 main `0998f62`，本地实现提交 **`86b3b02`**。
- 定向 **4 文件 / 94 passed / 0 todo**，最终 22.91 秒，exit 0。
- 实际临时迁移库 + app/plugin + Vite proxy 的 Chromium **13 项通过**，最终 9.68 秒，exit 0；桌面/390px移动截图已实际读取。
- 两端 typecheck、server/web build、两个 C 独立入口 bundle 均通过。
- 两轮早期浏览器偶发超时完整保留，后续补了实际 404/focus响应和脱敏网络失败观察点，并有完整复测；**根因未证实，不把复跑绿说成已定位修复**。
- 全量 2 worker 独立限时 180 秒：17 个文件完成时仍持续推进，未观察到旧 Worker exited unexpectedly；到时退出124，未得完整JSON。**不宣称全库通过，也未证明旧异常根因。** 未拉长超时/改共享配置或断言造绿。

### 交付状态与待 B 收口

本轮 push 在工具自动审核阶段连续失败，用户再次授权后仍未执行，**不是 GitHub 403/网络推送失败**。独立 `ls-remote` 确认远端仍为 `ea81e4e`，暂不含 `86b3b02`，请不要依赖该本地 SHA 直接 import；恢复后会补交付通知。证据和完整进展已本地提交至 `docs/role-c/issue-35/picker-progress.md`。

安全缺口仍按 [#24 comment-6359691655](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6359691655) 请求确认后置标敏感事务置位/历史/并发；P4/P5与TaskSection锚点仍按本票 comment-6359699302 请求窗口及SHA。本条只汇报C独立项完成，不重申请旧裁定，不要求合未完成安全策略或关闭票。
