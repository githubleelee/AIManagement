# 前端路由与页面骨架（US-01 收尾）

> 本文档冻结前端路由表与页面职责，供 M2（US-01）、M4（US-03）、M5（US-05）后续填页面对齐。
> 权威接口定义仍以《需求规格说明书 · 接口契约》为准；本文档只约定**前端 URL 与页面**。

## 冻结约定

- 前端骨架（`web/src/App.tsx`、`web/src/routes.tsx`、`web/src/layouts/`、`web/src/components/`）为**共享文件**，由 M2（US-01）负责人独占维护。
- 其他模块**只往 `web/src/pages/` 下新增自己的页面**，并在 `routes.tsx` 的既有路由节点下挂载；需要改动骨架时先通知 M2。
- 路由库：`react-router-dom` v7（浏览器 History 路由，Vite 默认 SPA fallback，支持刷新与直达）。

## 路由表

| URL | 页面 | 说明 | 归属 |
|---|---|---|---|
| `/login` | `LoginPage` | 登录；支持 `?redirect=` 回跳 | M1/M2 |
| `/projects` | `ProjectListPage` | 我的项目列表（端点 4） | M2 / T1.2 |
| `/projects/new` | `NewProjectPage` | 新建项目（端点 3） | M2 / T1.1 |
| `/projects/:projectId` | `ProjectLayout` | 工作台骨架：拉项目（端点 5）、左导航；无权限/不存在 → 404 页 | M2 / T1.2、T1.7 |
| `/projects/:projectId`（index） | → 重定向 `overview` | | M2 |
| `/projects/:projectId/overview` | `ProjectOverviewPage` | 项目概览：元信息 + 成员数 + 需求/任务占位卡片 | M2 / T1.2 |
| `/projects/:projectId/members` | `ProjectMembersPage` | 成员管理：添加 / 列表 / 改角色 / 移除（端点 6–9） | M2 / T1.3–T1.6 |
| `/projects/:projectId/requirements` | `ProjectRequirementsPage` | 需求层级占位 | M4 / US-03（T3.x） |
| `/projects/:projectId/requirements/:storyId` | `RequirementDetailPage` | 需求详情占位 | M4 / US-03（T3.x） |
| `/projects/:projectId/tasks` | `ProjectTasksPage` | 任务列表占位 | M5 / US-05（T5.x） |
| `*` | `NotFoundPage` | 全局 404 | M2 |

## 页面职责与数据来源

- **AppLayout**：顶栏（品牌、当前用户、退出登录）+ 内容区。已登录用户可见。
- **ProtectedRoute**：未登录重定向 `/login?redirect=<原路径>`；令牌失效（401）清理后回登录页。
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
