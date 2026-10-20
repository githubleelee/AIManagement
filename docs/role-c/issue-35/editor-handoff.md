# #35 / US-15：当前交付与接线边界

## 基线与状态

- worktree `AIManagement-US15`，分支 `feat/US15-uml`，main 基线 `37287c26a2d867e938132a906f9422354f66eb7c`；代码已本地提交 `dca876a28288ccdc6a569f3d74285ce321a1af2d`。推送被 GitHub 403 拒绝（xichoutrees 无仓库写权限），**未形成远端可获取交付**；后续文档提交见 git log。
- 已接收 B P1：`d8315c4830b01773fd3e6f053b6f3389e40a656a`，#35 comment-6264046314。已重新生成 Prisma Client。
- 按 `docs/role-b-uml-design.md` FROZEN v1.0 的 §Z/§Z2 覆盖早期 DRAFT：7 表、四类关联、PM 写、服务端 seq、自消息、列表 total、nodes 200/edges 500/关联各 50。
- **目前为未正式挂载的集成开发交付，不是 #35 完成**。MEMBER/VIEWER 读取仍安全关闭；任务行定位待 B 落笔；没有勾最终 AC。

## C 已实现的文件

| 文件 | 内容 |
|---|---|
| `src/modules/uml/document.ts` | 编辑器本地文档与校验；与 wire 明确分离；清理编辑器本地边、消息换序 |
| `src/modules/uml/schemas.ts`、`types.ts` | 正式 wire 输入/输出类型、Zod 校验、枚举与技术上限 |
| `src/modules/uml/service.ts` | 中央 can()/visibilityScope()、PM CRUD、四类真实归属校验/替换、整图事务、临时 id 重映射、服务端 seq、同源 list/count；非全局读 scope fail-closed |
| `src/modules/uml/plugin.ts` | 导出 `registerUmlRoutes(app, ctx)`，6 端点，不自行注册到生产应用 |
| `src/modules/uml/uml.http.test.ts` | 44 项真实 HTTP 测试通过，3 项非 PM 正常读取策略明确 todo；真实会话和独立迁移 SQLite |
| `web/src/pages/uml/UmlEditor.tsx`、`UmlPreview.tsx`、`uml.css` | 两类受控编辑器、SVG 预览、三类用例关系/三类消息、自消息、生命线与消息换序、关系说明、只读呈现及窄屏 |
| `web/src/pages/uml/api.ts` | 复用 apiFetch；运行时响应校验；明确 wire/editor 转换，保留关系说明、反向 association、空/null 消息标签；不把本地 kind 或 seq 原样发给服务端 |
| `web/src/pages/uml/UmlPage.tsx` | 实际 API 清单/新建/详情/保存/删除及四类关联；已存关联链接；当前错误和集成限制提示；权限拒绝后清空标题、图稿、草稿和关联；未正式挂载 |
| `EditorPreview.tsx`、`preview.html` | 纯本地独立预览及 JSON 下载/载入，不冒充项目保存 |
| `IntegrationPreview.tsx`、`integration.html` | 使用正式页面组件与真实项目上下文的独立开发入口；不是另造业务实现 |
| 本目录 `verify-editor.mjs`、`integration-server.ts`、`verify-integration.mjs` | 真实 Chromium 验证；集成脚本启动独立临时库 + 实际 API + Vite proxy，结束清理；临时测试令牌仅 IPC 内存传递，不输出归档 |

本批没有修改 schema、迁移、shared、authz、routes、项目布局/导航、旧任务/需求模块、package/lockfile。B 已交付 `uml-schema.test.ts` 保持原样。

## 真实行为与已知限制

- **创建**将图内容、基本信息和四类关联放在一个 POST 事务；**已存在图**的内容 PUT 与元数据/关联 PATCH 分别保存，界面明确标识，不把两次请求伪装成一个原子保存。
- PATCH 成功保留未提交的内容草稿；PUT 成功保留未提交的基本信息草稿，并采用服务端新生成的节点/边 id。
- 四类关联暂为真实 ID 输入（逐行/逗号分隔），**不是对象选择器**；去重及项目隔离均由服务端验证。负责人亦为用户 ID，不能因为图负责人是 VIEWER 就获得写权限。
- 没有自动保存、坐标持久化、外部模型服务、附件上传、乐观锁或真实事件接线；并发采用已批准的最后写入者全胜，事务冲突返回 409。
- 正式页面没有导入/下载入口；撤权后不能保留可下载的旧图稿。独立本地预览的 JSON 下载不作为持久化验收。

## B 接线请求（暂不申请按“完成”合入）

1. **P4**：`src/routes.ts` import 并调用 `registerUmlRoutes(app, context)`；公共层由 B 单写。
2. **P5**：页面默认导出 `web/src/pages/uml/UmlPage.tsx`，在 ProjectLayout 下单一路径 `/projects/:projectId/uml` 挂载；使用 `useOutletContext<ProjectView>()`。详情通过 `?diagram=<diagramId>` 保持可刷新深链，无须新增详情路由；骨架/导航/路由文档由 B 写。
3. **AC4 任务行锚点**：见 [精确补丁](task-anchor-proposal.md)，已发 #35 comment-6282421130。链接为 `/projects/:projectId/requirements/:storyId#task-<taskId>`。当前只验证 href，未宣称目标行实际定位成功。
4. 正式挂载与最终非 PM 浏览器验收须等下面的保密问题收清；不要将临时安全关闭当作正常只读能力。

## 唯一未收清的保密冲突

已在 #24 发布并 GET 回读验证：
https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6282420799

冻结稿 §5.3/§5.5 仍认为“关联敏感任务后保留的图正文，在任务被删或 PM 解除最后一条关联后可自动对全体成员开放；因查询算法没变，不算降密”。实际结果是原先 404 的成员现在能读到保留正文，违反已批复的“不自动降密”。不能用 every(empty)=true 证明保密要求满足。

C 没有擅自加图独立敏感标记或拿 AuditLog 充当权限主存储。`service.ts` 目前对非全局 scope 额外添加数据库层 deny 条件，列表/计数同源得到 0，详情与不存在一致 404；正常 MEMBER/VIEWER 读取 **未实现、不计 AC5 通过**，有 3 个明确 todo。

B / 负责人须给出持续可见性 guard 的已批准字段与语义，或明确 supersedes 政策变更，再替换临时 deny 并补全矩阵。该问题没有阻止 PM 写入、校验、事务、前端/API 适配及真实临时库验证。

## 验证

见 [verification.md](verification.md)。当前：34 项独立编辑器浏览器检查 + 8 项真实 API 浏览器检查通过；78 项定向测试通过、3 项 todo；typecheck / build / 两个独立入口 bundle 通过。不是正式平台全流程或最终 AC 通过声明。
