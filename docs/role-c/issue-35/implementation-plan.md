# ROLE-C / #35：实施方案与公共层申请（DRAFT）

> **历史提案保留**：下文是最初 fe824f2 阶段的设计/申请，不是当前状态。后续批准、B FROZEN v1.0/P1 已接收及实际实现见 [当前交付](editor-handoff.md)，真实结果见 [验证记录](verification.md)。不再以早期未批准/P1 未就绪阻塞实施。

## 0. 状态与依据

- 执行票：https://github.com/githubleelee/AIManagement/issues/35 （US-15）
- 角色父票：https://github.com/githubleelee/AIManagement/issues/22
- 契约门：https://github.com/githubleelee/AIManagement/issues/24
- 本轮检查基线：`fe824f2189358cb50f4ce7c6eebd7776baeeeda0`（新建工作区时的 origin/main）。
- 工作区：`D:/临时项目/AIManagement-US15`；分支：`feat/US15-uml`。
- 状态：**仅设计、申请及验收准备；不是接口冻结、授权批准或功能实现声明。**
- 已读：team-handoff、sprint1-baseline、sprint1-spec-interface-contract、frontend-routes、DECISIONS、role-b-contract-register，以及 #35 / #22 / #24 正文与讨论。
- 本轮用户允许执行可执行部分，不等于批准 C5、UML 权限或敏感规则；未决事项继续只设计。

## 1. 现状与范围

当前 main 没有 UML 后端目录、前端目录、模型、Action、对象 scope 或路由。已有项目→业务目标→用户活动→用户故事→任务数据，可从 UML 独立模块只读查询，不调用其他业务 service。

交付 UML 图 CRUD、两类图在线编辑、五类对象关联、跨项目拒绝、核心时序图追踪和权限测试。

不做其他图种、专业 UML、实时协同、外部建模服务、AI 绘图、图片附件系统、其他故事。上传图片不是在线编辑的替代品。

#35 没有执行票或接口先行依赖。#24 是软门，仅本域未决规则限制相关实现，不等待其他域全部定案。#32 的 task 修改授权不适用于 #35。

## 2. C5 交互提案（待 B + C + 项目负责人确认）

推荐结构化编辑 + 浏览器本地 SVG 实时预览，不引入外部服务或新的绘图库：

- 用例图：添加/编辑/删除参与者、用例和关系，选择关系端点。
- 时序图：添加/编辑/删除生命线和消息，调整消息顺序，选择发送方、接收方与消息类型。
- 保存后重开继续编辑；预览不是静态图片，也不是只读演示。
- 关系类型及消息类型的最小集合、布局方式和编辑能力须随 C5 明确；本轮不提前固定枚举。
- 所有显示文本作为文本渲染，不接受任意 HTML、脚本、原始 SVG 或外链图片。

备选：本地文本 DSL + 本地渲染。是否接受文本式在线编辑须人工确认，不能由开发者自行降低 AC1。

## 3. 数据模型与关联结构提案（交 B，非可执行迁移）

### 3.1 图资源 UmlDiagram（候选字段）

| 字段 | 用途 | 状态 |
|---|---|---|
| id / projectId | 图标识与项目边界，projectId 从路由父项目推导 | 提案 |
| kind | 用例图 / 时序图，线上常量候选 USE_CASE / SEQUENCE | 待 C5 冻结 |
| title | 列表及详情标题 | 长度、空白规则待冻结 |
| document / formatVersion | 结构化图数据及格式版本，SQLite 可用 JSON 文本列 | 待 C5、字段限额冻结 |
| createdByUserId / createdAt / updatedAt | 作者和时间戳，时间序列化 ISO UTC | 提案 |
| isSensitive | 图自身敏感性，不能仅依赖关联对象状态 | 待权限与可见性裁决 |

节点/消息使用稳定局部 id；关系端点必须存在于同一图文档。document 的两个变体在 C5 确认后再冻结，拒绝只存上传图地址的模型。

并发更新暂不承诺版本锁；若要求防止覆盖，应另行批准 revision/CAS 与 409 行为。

### 3.2 关联 UmlAssociation（推荐候选）

优先使用可验证的类型化关联：diagramId，加 projectId / goalId / activityId / storyId / taskId 中恰好一个目标字段；以真实外键保护存在性，应用层校验恰好一类目标与同项目。具体唯一约束、索引及删除动作由 B 在批准后落地。

替代方案为 targetType + targetId 多态关联，但不能建立目标外键；这会带来目标删除清理问题，**不得静默采用**。若选择多态关联，先明确旧删除路径的具体授权或已批准的失效引用语义。

无论采用哪种结构：

1. 关联创建时按目标 id 现查真实归属；不信任请求体 projectId、标题、敏感标志或白名单。
2. 拒绝跨项目引用；调用者同时是两项目 PM 也不能跨项目关联。
3. 目标不可见时按统一鉴权返回 404，不能通过关联校验反推其存在。
4. 关联变更及必要的图更新在同一数据库事务提交，失败不留部分结果。
5. 不存目标标题/正文快照以替代目标鉴权；展示时重新读取有权的最小字段。
6. “项目关联”须明确是图所属项目自动关联，还是独立关联行；建议所属即关联，不允许关联另一项目。

### 3.3 删除策略必须先批准

候选 A：目标被图引用时 Restrict。好处是不产生失效引用；代价是旧 DELETE 可能出现新的外键失败，需审查旧接口错误映射，必要时具体申请旧模块授权。

候选 B：目标删除时清理关联。必须解决图正文可能包含原敏感内容、解绑后意外公开的问题；不能简单 Cascade 后按剩余关联重新开放图。

候选 C：保留失效引用、整图 fail-closed，PM 可修复。需要明确失效引用的存储和可见性策略。

三者均未批准，本轮不生成 schema 或迁移补丁。

## 4. 权限与敏感规则申请

### 4.1 写权限（待项目负责人 + 权限负责人确认）

- PM：可新建、修改、删除和管理关联。
- VIEWER：只读；可见但写入 403。
- MEMBER：票面允许“参与或只读”，尚未定案；建议本期只读。若开放编辑，请明确作者本人 / 指定协作者 / 所有成员的范围，以及删除和关联管理是否同权。
- outsider：404；未登录：401。

### 4.2 图自身与关联的可见性（待确认）

建议图自身权限与关联对象可见性取交集：任一关联不可见时整图不可见，而非仅隐藏链接。图正文、标题及消息可能已包含关联内容，局部遮挡不足以保证保密。

同时须确认：

- 图是否允许自身标敏及白名单；若允许，ObjectVisibility / VisibilityObjectType 如何扩展，敏感管理入口及撤权语义。
- 图最初公开后再关联敏感对象，或目标后来被标敏，下一请求如何立即收敛。
- 解除敏感关联/删除敏感目标后是否保持图敏感，如何经 PM 显式审核解除，避免自动降密。
- 图列表、详情、关联候选、计数、错误及跳转均不得泄漏不可见对象的 id/标题/正文或存在性。
- 按 can()/visibilityScope() 查询层过滤；不能先查全量图正文，再在内存过滤并计数。

### 4.3 公共鉴权支持申请

申请 UML Action（候选 uml.write；若拆动作另冻结）、UML ObjectRef、图列表 scope 及真实对象加载支持。具体名称与语义由公共契约确认。

permissions.ts 不在 B 的一般授权内；既有 #32 和 risk.flow 特例不覆盖 UML。须由权限负责人批准并明确落地人。C 不修改权限文件，不用 can() 默认允许作为 UML 写权限，不散写角色判断。

## 5. API 与前端接入提案（待冻结）

| 方法与候选路径 | 能力 |
|---|---|
| GET /projects/:projectId/uml | 图列表，仅返回可见范围 |
| POST /projects/:projectId/uml | 新建图 |
| GET /projects/:projectId/uml/:diagramId | 图详情与有权关联 |
| PATCH /projects/:projectId/uml/:diagramId | 部分更新图，校验合并结果 |
| DELETE /projects/:projectId/uml/:diagramId | 删图并处理本图关联 |
| PUT /projects/:projectId/uml/:diagramId/associations | 原子替换关联集合 |

若批准图自身白名单，另冻结独立 sensitivity 端点，不塞入普通 PATCH。

沿用 I-3 错误信封、I-4 错误码：不可见 404，可见禁写 403，非法数据 422，批准的冲突 409；列表 { items }、删除 204、时间 ISO UTC。跨项目错误只在调用者有权验证目标时使用 CROSS_PROJECT_REF，不能泄漏未知目标。

页面候选：/projects/:projectId/uml、/projects/:projectId/uml/:diagramId。B 确认并挂载，C 不直接改骨架。

需求跳转复用现有 requirements/:storyId；目标/活动复用已有详情路由。main 无独立任务详情页，不编造 tasks/:taskId URL。优先复用故事详情任务区；若 AC4 要求精确定位，另申请 TaskSection.tsx 的 taskId 锚点/定位最小改动和单写窗口。

## 6. 文件边界与责任

C 在确认后实现：

- src/modules/uml/{plugin,service,schemas}.ts 与同目录 *.test.ts。
- web/src/pages/uml/ 下页面、两类编辑器、关联面板、api 与本域样式。
- docs/role-c/issue-35/ 下本票文档和后续验证证据。

B 单写（C 仅提交批准后的需求/接口提案）：

- src/db/schema.prisma、src/db/migrations/<UML 迁移>/。
- src/shared/types.ts、validation.ts（必要错误补充另申请，不预设新增错误码）。
- src/routes.ts；src/app.ts 仅确需额外注入时申请。
- web/src/routes.tsx、layouts/ProjectLayout.tsx、docs/frontend-routes.md。

权限文件按专项批准执行，不擅自并入 B 的一般授权。

旧 requirement/task/project 后端目前不申请修改；删除策略或任务定位确需改动时先报具体文件/范围。test/factories.ts、已有测试基础设施全员只读；新增模型对测试重置/建库的影响由 B 核对必要公共变更，不绕过外键。

## 7. 执行次序与放行条件

1. 当前已执行：独立 worktree、只读基线复核、设计/申请/验收文档。
2. 人工确认接单身份，并批准发布评论后，在 #22 留接单、#35 留范围、#24 留最小契约申请；不自动发布。
3. B + C + 项目负责人确认 C5；项目负责人 + 权限负责人确认写权限、敏感和删除语义。
4. B 分批落实 UML 模型、共享契约和挂载；权限落地人完成对应支持，通知就绪 SHA。
5. C 从最新 main 同步公共成果，只在本票独立目录实现，按已明确文件边界保持单写。
6. 完成真实数据库 HTTP 测试、typecheck、浏览器主链路/越权/敏感走查；每条 AC 以证据勾选，不以文档或 mock 代替。

本文件不批准规则、不修改标签、不关闭 Issue、不创建或合并 PR，不承诺工期或已验收。
