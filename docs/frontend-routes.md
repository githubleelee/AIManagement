# 前端路由与页面骨架（US-01 收尾）

> 本文档冻结前端路由表与页面职责，供 M2（US-01）、M4（US-03）、M5（US-05）后续填页面对齐。
> 权威接口定义仍以《需求规格说明书 · 接口契约》为准；本文档只约定**前端 URL 与页面**。
> **实现进度不写在这里**：各页面「已实现 / 占位 / 在收尾分支」的当前状态见 [`docs/sprint1-current-status.md`](sprint1-current-status.md)（下表最后一列只标归属，不再标占位）。

## 冻结约定

> **口径变更（2026-10-17，项目负责人授权）**：前端公共骨架（`web/src/App.tsx`、`web/src/routes.tsx`、`web/src/layouts/`、`web/src/components/`）与本文档的唯一修改人，由「M2（US-01）负责人」变更为 **ROLE-B = `githubleelee`（项目负责人授权）**；组件**按就绪挂载**，不整模块等待。历史归属（M2 / 前端骨架原修改人）按本节保留，不追溯撤销既有记录。来源见 `docs/role-d-start-confirmation.md` §2、`docs/team-handoff.md` §4.1。

- 前端骨架（`web/src/App.tsx`、`web/src/routes.tsx`、`web/src/layouts/`、`web/src/components/`）为**共享文件**，现由 **ROLE-B（`githubleelee`）** 单写维护。
- 其他模块**只往 `web/src/pages/` 下新增自己的页面或独立组件**，提供接入补丁，由 B 在 `routes.tsx` 或已授权接入点最小挂载；公共文件由 B 单写，组件按就绪挂载。
- **#30 限范围例外（2026-10-18 批复）**：ROLE-A 可在向 B 登记后自行修改 `web/src/routes.tsx` 等骨架的**页面路由 / 左导航挂载行**（仅挂载 US-10 自己的页面，同一时刻一个文件只允许一个写者）；本文件（`docs/frontend-routes.md`）仍由 B 维护，A 的页面路由行由 B 补录。
- 本轮三个接入点：`RequirementDetailPage.tsx` 的 AI、`pages/task/TaskSection.tsx` 的附件、`layouts/AppLayout.tsx` 的通知。仅嵌入组件不意味着新增 URL；不另造任务详情页，不接管 D 业务。
- 路由库：`react-router-dom` v7（浏览器 History 路由，Vite 默认 SPA fallback，支持刷新与直达）。

## 路由表

| URL | 页面 | 说明 | 归属 |
|---|---|---|---|
| `/login` | `LoginPage` | 换账号登录后进入我的项目主页；首次深链登录支持回跳 | M1/M2 |
| `/projects` | `ProjectListPage` | 我的项目列表（端点 4） | M2 / T1.2 |
| `/projects/new` | `NewProjectPage` | 新建项目（端点 3） | M2 / T1.1 |
| `/projects/:projectId` | `ProjectLayout` | 工作台骨架：拉项目（端点 5）、左导航；无权限/不存在 → 404 页 | M2 / T1.2、T1.7 |
| `/projects/:projectId`（index） | → 重定向 `overview` | | M2 |
| `/projects/:projectId/overview` | `ProjectOverviewPage` | 项目概览：元信息 + 成员数 + 需求/任务占位卡片 | M2 / T1.2 |
| `/projects/:projectId/members` | `ProjectMembersPage` | 成员管理：添加 / 列表 / 改角色 / 移除（端点 6–9） | M2 / T1.3–T1.6 |
| `/projects/:projectId/requirements` | `ProjectRequirementsPage` | 需求层级树：目标 → 活动 → 故事（端点 10–22，**已实现**） | M4 / US-03（T3.x） |
| `/projects/:projectId/requirements/goals/:goalId` | `RequirementHierarchyDetailPage` | 业务目标详情与管理操作 | M4 / US-03 |
| `/projects/:projectId/requirements/activities/:activityId` | `RequirementHierarchyDetailPage` | 用户活动详情与管理操作 | M4 / US-03 |
| `/projects/:projectId/requirements/:storyId` | `RequirementDetailPage` | 需求详情：编辑 / 敏感 / 故事内任务（端点 20/21/23；任务区端点 24/25/27/28/29/30 **已实现，随收尾分支合入**） | M4 / US-03、M5 / US-05 |
| `/projects/:projectId/tasks` | `ProjectTasksPage` | 项目任务总表（端点 26 + `ownerUserId` 过滤，**已实现，随收尾分支合入**） | M5 / US-05（T5.x） |
| `/projects/:projectId/workload` | `WorkloadPage` | 成员任务图与负载：成员非 CLOSED 负载数 + 可见范围标签 + 单成员未关闭任务明细（`GET /projects/:projectId/workload`、`.../workload/:userId`，**本阶段新增，不在 Sprint 1 的 30 个端点内**） | B / US-07（#27） |
| `/projects/:projectId/gantt` | `GanttPage` | 甘特图：需求 / 任务 / 里程碑与 FS 依赖统一时间轴，故事可展开任务；故事日期为**候选汇总口径**、进度待 C10 确认（`GET /projects/:projectId/gantt`，**本阶段新增，不在 Sprint 1 的 30 个端点内**） | B / US-06（#26） |
| `/projects/:projectId/board` | `BoardPage` | 故事看板：按正式故事状态（`DRAFT` / `PLANNING` / `DONE`）三列展示，卡片含目标/活动路径与优先级；**本批只读**，状态写入仍走端点 21（`GET /projects/:projectId/board`，**本阶段新增，不在 Sprint 1 的 30 个端点内**） | B / US-04（#25） |
| `*` | `NotFoundPage` | 全局 404 | M2 |

## 页面职责与数据来源

- **AppLayout**：顶栏（品牌、当前用户、退出登录）+ 内容区。已登录用户可见。
- **ProtectedRoute**：明确退出后重定向 `/login` 并清除旧页面回跳；首次访问深链时使用 `/login?redirect=<原路径>`。
- **ProjectLayout**：按 `:projectId` 调 `GET /projects/:projectId`：
  - 成功：左侧导航（概览 / 需求 / 任务 / 成员）+ `<Outlet context={project}>`
  - 404：渲染「项目不存在或无权访问」页（与后端非成员 404 行为一致，不泄漏对象）
  - 子页面通过 `useOutletContext<ProjectView>()` 取项目与 `myRole`
- **写操作可见性**：仅 `myRole === 'PM'` 时显示添加/改角色/移除入口；服务端仍强制校验（前端隐藏仅为体验，不作为权限依据）。

## T1.x → 页面/区域 对照（US-01 验收）

| 任务 | 交付 | 承载位置 |
|---|---|---|
| T1.1 建项目 | 端点 3 | `/projects/new` |
| T1.2 列表 / 详情 | 端点 4/5 | `/projects` + `/projects/:id/overview` |
| T1.3 加成员 | 端点 6 | `/projects/:id/members` 顶部表单 |
| T1.4 成员列表 | 端点 7 | `/projects/:id/members` 表格 |
| T1.5 改角色 | 端点 8 | `/projects/:id/members` 行内下拉 |
| T1.6 移除成员 | 端点 9 | `/projects/:id/members` 操作列 |
| T1.7 项目隔离 | 端点 3–9 鉴权 | 跨页面：非成员直达任意 `/projects/:id/*` → 404 页 |

## 演示账号（seed）

| 账号 | 密码 | 说明 |
|---|---|---|
| `pm` / `member1` / `member2` / `viewer1` | `Passw0rd!` | 均在「演示项目」中，角色见 seed |
| `outsider` | `Passw0rd!` | 不属于演示项目，用于演示非成员 404 与列表隔离 |
