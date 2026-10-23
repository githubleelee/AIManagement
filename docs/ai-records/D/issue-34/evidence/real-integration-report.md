# #34 真实运行与页面阻断证据（2026-10-23）

## 结论

当前 main 尚未具备正式通知运行时，**不能补出“六类通知真实送达成功”的证据**。本轮实际运行生产 buildApp、真实迁移 SQLite 和浏览器，记录未接入事实；没有注册测试通知路由、内存替身或模拟事件来造绿。

## 基线与观察

- main：`014555ba7843863ef7230956b89081b8ccd2f461`。
- D 模块文件：`feat/US14-notifications@90104eba098717e5505fcf4501a1fa13bcc06b49`，仅放入独立目录供组件走查；**没有修改 app/routes/shared/schema 或正式 AppLayout**。
- 应用通过现有 `createTestContext → buildApp`，使用新建的真实迁移 SQLite 库；全部合成用户、项目和任务。登录走 `/auth/login`，请求走监听 HTTP 端口。
- PM 经正式任务创建接口成功创建并分配任务（201），该合成项目的 `task.assigned` 领域事件计数为 0。
- 认证后实际请求 `GET /me/notifications`、`GET /notifications/unknown`、`PATCH /notifications/unknown/read`：全部 404，NOT_FOUND，“资源不存在”。PATCH 使用合法 JSON `{}`，不把缺请求体导致的 422 当作路由诊断。
- main 没有正式通知路由、通知表/查询适配、已提交事件消费桥接与成功消费账本，正式 AppLayout 没有通知挂载。

## 页面证据

1. screenshots/01-production-topbar-no-notification.png：真实产品项目页，正式顶栏未挂通知。
2. screenshots/02-component-real-404.png：独立验证页复用原 NotificationBell，访问同一个真实后端后显示“数据源未接入 / 资源不存在”，不显示“暂无通知”。页面明确说明这是阻断走查，不是六类送达通过证明。该组件在请求失败后仍显示“正在加载”，作为已有显示问题保留，不修图或隐藏。

browser-results.json 与 real-http-results.json 为原始观测，tested-manifest.json 记录精确文件散列。页面请求无 mock。没有已读/撤权/重复投递/恢复与六类时延成功证据；这些都保持未验收，不填 0 秒或 0 条来冒充可用。

## 验证

- D 通知模块 3 文件 / 38 项通过。这是模块测试，不是生产联调通过。
- 前后端 typecheck 与 build 退出码 0，见 validation-typecheck.txt / validation-build.txt。
- 本轮未跑全量。没有绑定外部大模型、发送真实数据或读取真实数据库。

## 重放与后续

real-runtime.mts 是本次脚本；notification-evidence.html 和 evidence-runtime.tsx 是额外验证页源文件。重放时分别放到 web/、web/src/pages/notification/，在本组合执行 `node --import tsx docs/ai-records/D/issue-34/evidence/real-runtime.mts`。Playwright / 便携 Chromium 的绝对导入路径是本次环境路径，其他机器需替换成自己的安装位置；不提交临时数据库或会话令牌。

B 在公共窗口完成真实 #37 订阅与提交后消费桥接、成功消费账本、权威接收者、当前可见性 SQL、调度及正式挂载；业务 owner 补真实 task.assigned、DONE 时 acceptance.submitted、验收结果和风险真实提级事件。@提及继续按已裁定后置。D 在接线完成后补六类、时延、权限、重复与重启恢复的单向取证。本轮只归档证据，不接管 B 或其他域，不合 PR/关票。
