# 爱管理（AI Management）Sprint 1 —— 项目交接（Handoff）

> 本文档面向接手本项目的开发者/评审者，概括「是什么、怎么跑、做到哪、还剩啥」。
> 权威契约以 `docs/sprint1-spec-interface-contract.md` 为准；前端路由以 `docs/frontend-routes.md` 为准。

## 1. 项目概览

新一代 AI 驱动的软件项目管理平台。Sprint 1 目标：打通「**项目 → 权限 → 需求 → 任务**」的最小可运行链路——项目经理建立带权限边界的项目空间，结构化建立业务目标/用户活动/用户故事，并把故事拆成带负责人与验收人的任务。

本轮 4 个用户故事：**US-01 项目与成员、US-02 权限与敏感可见、US-03 需求层级、US-05 任务**（US-04 看板顺延 Sprint 2）。

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React + TypeScript + Vite + react-router-dom v7 |
| 后端 | Node + TypeScript + Fastify |
| 数据库 | SQLite + Prisma（枚举列用 String，取值靠 Zod） |
| 校验 | Zod（字段级错误码桥接 `shared/validation.ts`） |
| 测试 | Vitest + supertest（唯一 seam = HTTP 接口层） |

## 3. 快速开始

```bash
npm install
npm run db:migrate      # prisma migrate deploy（应用 src/db/migrations）
npm run db:seed         # 演示账号 + 演示项目
npm run dev             # 前端 5173 + 后端 3000（concurrently）
```

其它脚本：`npm test`（全量接口测试）、`npm run typecheck`（后端 + 前端）、`npm run build`（server tsc + web vite）。

## 4. 目录结构

```text
src/
  shared/        types.ts / errors.ts / validation.ts   （冻结：类型、错误、校验器）
  db/            schema.prisma / client.ts / test-support.ts / seed.ts / migrations/
  error-handler.ts   （唯一错误出口：AppError/ZodError → 统一信封）
  routes.ts      （冻结：集中注册各模块插件）
  auth/          M1 身份与会话（actor/token/password/plugin/schemas/service）
  modules/
    project/     M2 项目与成员（plugin/schemas/service）
    authz/       M3 鉴权与敏感（permissions.ts=can/visibilityScope；plugin/sensitivity=端点23/30）
    requirement/ M4 需求层级（plugin/schemas/service）
    task/        M5 任务（routes/rules）
web/src/
  api.ts         （冻结骨架：apiFetch + 令牌 + /api 前缀）
  auth/ layouts/ components/ routes.tsx    （冻结骨架，M2 维护）
  pages/         Login/ProjectList/NewProject/ProjectOverview/ProjectMembers/ProjectRequirements/
                 ProjectTasks/RequirementDetail/NotFound + requirement/（M4）+ SensitivityEditor
docs/            契约、基线、前端路由、T5 工单、AI 互动记录（表5）
test/            T0/T0.5 的数据库契约测试、http-support、seed 测试
```

## 5. 后端：模块与端点（30 个全到位）

| 模块 | 用户故事 | 端点 | 文件 |
|---|---|---|---|
| M1 会话 | — | 1 `POST /auth/login`、2 `GET /auth/me` | `src/auth/plugin.ts` |
| M2 项目与成员 | US-01 | 3 `POST /projects`、4 `GET /projects`、5 `GET /projects/:id`、6 `POST .../members`、7 `GET .../members`、8 `PATCH .../members/:userId`、9 `DELETE .../members/:userId` | `src/modules/project/plugin.ts` |
| M3 鉴权+敏感 | US-02 | `can()` / `visibilityScope()`；23 `PUT /stories/:id/sensitivity`、30 `PUT /tasks/:id/sensitivity` | `src/modules/authz/` |
| M4 需求层级 | US-03 | 10–22（目标/活动/故事 CRUD、排序、层级树、删除保护） | `src/modules/requirement/` |
| M5 任务 | US-05 | 24 故事任务列表、25 建任务、26 项目任务列表(owner 过滤)、27 详情、28 编辑、29 删除 | `src/modules/task/` |

**鉴权（全项目唯一入口）**：`can(actorUserId, action, ref)` 自己按 id 查库、直接返回 `403/404` 状态码；写类动作对 MEMBER/VIEWER 返回 403，非成员/不可见一律 404（响应体不含对象字段）。列表可见性用 `visibilityScope()` 在**查询层**过滤。

## 6. 前端：路由与页面

| URL | 页面 | 状态 |
|---|---|---|
| `/login` | 登录（`?redirect=` 回跳） | ✅ |
| `/projects` | 我的项目列表 | ✅ |
| `/projects/new` | 新建项目 | ✅ |
| `/projects/:id` → `/overview` | 项目工作台（左侧导航） | ✅ |
| `/projects/:id/overview` | 概览（元信息+成员数+占位卡） | ✅ |
| `/projects/:id/members` | 成员管理（增删改角色） | ✅ |
| `/projects/:id/requirements` | 需求层级树（目标→活动→故事） | ✅（US-03） |
| `/projects/:id/requirements/:storyId` | 需求详情（编辑/敏感/任务） | ✅（任务经 TaskSection 接真实端点 24/25/27/28/29/30） |
| `/projects/:id/tasks` | 项目任务总表 | ✅（端点 26 + ownerUserId 过滤） |
| `*` | 404 | ✅ |

> 关键：前端 API 统一走 `/api` 前缀（Vite 只代理 `/api` 并 rewrite），否则 SPA 深链会被 `/projects` 代理劫持。

## 7. 各用户故事完成度

| 故事 | 后端 | 前端 | 合入 main | 备注 |
|---|---|---|---|---|
| US-01 | ✅ 全 | ✅ 全 | ✅（到 `aa0d6ba`） | AC-04 文案改动 + 表5 记录在本收尾分支（待合并） |
| US-02 | ✅ can/visibility/敏感/审计 | ✅ 敏感开关（故事 + 任务） | ✅ | 任务敏感经 `SensitivityEditor kind='task'` 挂入任务编辑 |
| US-03 | ✅ 全 | ✅ 全 | ✅ | 需求详情任务列表已接真实端点 24，`temporary-data.ts` 已删 |
| US-05 | ✅ 全（24–29） | ✅（本收尾分支） | ✅（后端） | `TaskSection`（故事内）+ `ProjectTasksPage`（项目级） |

## 8. 关键契约与约定（别踩）

- **冻结文件**：`src/shared/*`、`src/db/schema.prisma`、`src/routes.ts`、`src/error-handler.ts`（技术负责人唯一修改人）；前端 `web/src/api.ts`、`routes.tsx`、`layouts/`、`components/`（M2 维护）。改动走「提出→全员确认→单人修改→通知」。
- **模块边界**：模块只导出路由插件 `(app, ctx)`，不 import 全局 Prisma 单例、不互相调 service；数据访问层 + 共享类型可共用。
- **id 全为 string（uuid）**；`createdAt` 为 ISO 8601 UTC 字符串；`planStart/planEnd` 为 `YYYY-MM-DD` 字符串。
- **三套状态枚举独立**（GoalStatus/StoryStatus/TaskStatus 都有 `DONE`，禁止互传）。
- **`isSensitive`/`visibleMemberIds` 只能经端点 23/30 改**，不进任何 PATCH 请求体。
- **子对象 `projectId` 一律从父级推导**，不接受请求体传入。
- **删除保护靠外键 RESTRICT**（`ProjectMember` 除外用 CASCADE）；`ObjectVisibility` 是多态列无外键，删故事/任务时由模块同事务清理。
- **列表不分页**（有意简化）；排序：目标/活动 `sortOrder` 全量替换，故事 `createdAt`、任务 `planStart`。

## 9. 测试

- seam = HTTP 接口层；工厂自建数据（`test/http-support.ts` 的 `createHttpTestContext`/`makeUser/makeProject/makeMember`；M4 另有 `pages/requirement` 同目录夹具）。
- 每端点正反例、只断言状态码+错误码（不 mock 内部、不断言中文文案）。
- 数据库用临时 SQLite 文件（非 `:memory:`）；清库按外键逆序。
- 全量 `npm test`：main 上约 670+ 例；`npm run typecheck` 覆盖后端+前端。

## 10. 演示账号（seed）

密码统一 `Passw0rd!`：`pm`(PM)、`member1`/`member2`(MEMBER)、`viewer1`(VIEWER)，均在「演示项目」；`outsider` 不在该项目、另有自己的项目（用于项目隔离演示）。

## 11. 剩余工作（待办）

1. **合并收尾分支** `feat/sprint1-wrapup`：US-05 任务前端、需求详情接真任务、删 `temporary-data.ts`、US-01 AC-04 文案与表5 记录（102–105）。
2. **验收材料**：Sprint 评审（表6）/回顾（表7）/自评（表8）、10 步演示录屏。
3. **可选打磨**：`getTask`（端点 27）前端未用（任务详情内联在故事详情，未做独立 `/tasks/:taskId` 页，符合 `docs/frontend-routes.md`）。

## 12. 分支与集成状态

- `main`（= `origin/main`，最新 `cb2670e`）：T0 + US-01(到 `aa0d6ba`) + US-02 + US-03 + US-05 后端。
- `feat/sprint1-wrapup`：**收尾分支（本次工作，已完成、待合并）**——US-05 前端 + 需求详情接真任务 + US-01 AC-04 + 表5 102–105。
- `feat/US-01-m2-project-members`：US-01 完整，领先 main 1 提交（AC-04 + 表5 58–63，序号与 main 撞车，已被 `sprint1-wrapup` 的 102–105 取代，可归档）。
- `feat/US-01-create-project-and-members`：**旧分支，含重复且不兼容的 T0，勿合并**。
- `integration/T5-task-management`、`feat/T5-*`、`feat/T3.*`、`feat/T2-*`：各模块历史分支。

## 13. 已知问题 / 坑

- **表5 序号冲突**：US-01 旧分支用了 58–63，与 main 现存的 58–101 重叠；收尾分支已改用 102–105 避开。
- **M4 并发测试超时**：`requirement.adversarial2.test.ts` 的并发用例在本机默认 5s 超时（环境问题，非回归）。
- **前端无自动化测试**（契约只要求接口层），验收靠手工走查。
- **无注册端点**：账号靠 seed；`POST /auth/login` 账号/密码错误统一 401 不区分。
