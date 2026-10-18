# ROLE-A #30 公共支持通知（ROLE-B → ROLE-A / lyh）

> **可转发**。来源：项目负责人 2026-10-18 授权 + 已合并的 PR #42（文档）/ PR #43（代码）。
> 本文只说明**公共层已落地什么、你要接手什么、还有哪些待你确认**；**不代表 #30 的任何 AC 已通过**，也不改你票内的业务设计。
> 基线：main `648a65755c8adf04855a4528f5db3228905513e3`（2026-10-18 合并 #42、#43 之后）。

---

## 1. 已合并的公共支持（你可以直接开始用）

| 项 | 落点 | 内容 |
|---|---|---|
| 权限动作 | `src/shared/types.ts` | `Action` 新增 `'risk.write'`、`'project.close'` |
| 权限判定 | `src/modules/authz/permissions.ts` | `project.close` 进 `WRITE_ACTIONS`（非 PM → 403）；新增第 5.5 条：`risk.write` 且 `role === 'VIEWER'` → 403（MEMBER 落到第 6 条放行） |
| 数据模型 | `src/db/schema.prisma` | 新增 `Risk` 模型；`Project` 加 `status`（默认 `'ACTIVE'`）；`User.ownedRisks`、`Project.risks`、`Task.risks` 反向关系 |
| 迁移 | `src/db/migrations/20261018033000_add_risk_and_project_status/migration.sql` | 纯新增表 + `ALTER TABLE "Project" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE'`（既有数据自动回填，无数据丢失） |
| 测试清理 | `src/db/test-support.ts` | `resetDatabase` 先清 `Risk`（其 `projectId` 为 `Restrict`，否则 `project.deleteMany()` 会失败） |
| 快照测试 | `test/db-schema.test.ts`、`test/db-schema-contract.test.ts` | 表集合更新为 11 张（含 `Risk`）；`EXPECTED_COLUMNS.Project` 增加 `status` 列；**契约的 9 表 14 处外键清单未动**（沿用 US-09 先例，新表不进契约清单） |
| 权限回归 | `test/t0-gap-fix.test.ts` | 新增 2 条断言：PM/MEMBER/VIEWER/outsider × `risk.write` / `project.close` |
| 决策记录 | `DECISIONS.md` `permissions.risk-and-project-close` | 记录本次授权范围与边界 |

## 2. 权限口径（项目负责人 2026-10-18 确认，以此为准）

| 角色 | `risk.write`（风险增删改） | `project.close`（关闭 / 重开项目） |
|---|---|---|
| PM | 允许 | 允许 |
| MEMBER | **允许** | 403 |
| VIEWER | **403（全项目只读）** | 403 |
| 非项目成员 / outsider | 404（不泄漏项目存在性） | 404 |

调用方式（统一入口，不要自己写角色判断）：

```ts
const decision = await can(actorUserId, 'risk.write', { kind: 'project', projectId })
// decision = { allow: true } | { allow: false, status: 403 | 404, code: 'FORBIDDEN' | 'NOT_FOUND' }
```

**请注意一处不一致**：`#30` 票面写的是「member：只读按可见性」，与本次实现（MEMBER 可写风险台账）相反。
请以本文第 2 节为准，并**自行更正 #30 票面表述**；若你的本意确实是「member 只读」，请提出，由项目负责人重新裁决（那会需要把 `risk.write` 拆成更细的动作或改判定）。

`ObjectRef` 目前**没有** `risk` 类型：请用 `{ kind: 'project', projectId }` 调权（对象归属由你从库里取真实 `projectId`，不要信任请求体自报）。敏感风险继承关联任务的做法仍按你的设计在模块内处理，不扩展 `ObjectVisibility` 的对象类型。

## 3. 数据模型（你按此实现业务层）

`Risk` 字段（`src/db/schema.prisma`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `String @id @default(uuid())` | 主键 |
| `projectId` | `String` | FK → `Project`，`onDelete: Restrict` |
| `title` | `String` | 必填 |
| `description` | `String?` | 可空 |
| `level` | `String` | 三级；**线上取值由你的 Zod 定义**（迁移注释里按 `HIGH` / `MEDIUM` / `LOW` 示例） |
| `status` | `String @default("OPEN")` | 四态；**线上取值由你的 Zod 定义**（示例 `OPEN` / `IN_PROGRESS` / `RESOLVED` / `CLOSED`） |
| `ownerUserId` | `String` | FK → `User`，`onDelete: Restrict` |
| `taskId` | `String?` | 可选关联任务（敏感继承入口）；FK → `Task`，`onDelete: SetNull` |
| `resolution` | `String?` | 处理说明 |
| `createdAt` / `updatedAt` | `DateTime` | `updatedAt` 由 Prisma `@updatedAt` 维护 |

索引：`@@index([projectId, status])`、`@@index([ownerUserId])`、`@@index([taskId])`。
删除语义：**删项目 / 删用户会被 Restrict 拦住**（风险不会变孤儿）；**删任务只置空 `taskId`**，风险本身保留。

`Project.status`：`'ACTIVE' | 'CLOSED'`，默认 `'ACTIVE'`。按你的设计**不进共享 `ProjectView`**——现有项目模块是显式字段映射（`src/modules/project/service.ts` 的 `toProject`），所以端点 3/4/5 的响应形状未变，你可以自己读该列并在本票响应里返回。

DB 层**不校验**枚举合法性与「`taskId` 与 `projectId` 同项目」——按仓库既有惯例由你的模块校验（`schema.prisma` 顶部已声明该约定）。

## 4. 你要接手的部分（B 不做）

- `src/modules/risk/`（风险 CRUD、四态流转、关闭阻断清单、审计）与 `src/modules/analytics/`（进度 / 健康度）业务代码与 Zod 校验；
- 关闭阻断的 HTTP 语义（你拟 `409 CONFLICT`、不允许强制关闭——需项目负责人确认）；
- 敏感风险不计入无权者总数 / 清单（`can()` / `visibilityScope()` 目前没有 risk 对象类型，需在你的查询层按你的方案过滤）；
- **路由与前端挂载由 B 补挂**：你的 `registerRiskRoutes` / `registerAnalyticsRoutes` 与页面组件就绪后，请把入口与 Props 发我，B 在 `src/routes.ts`、`web/src/routes.tsx`、`web/src/layouts/ProjectLayout.tsx`、`docs/frontend-routes.md` 补挂（这些是 B 单写文件，不要自行修改）。

## 5. 验证状态（如实说明）

- 独立静态评审已完成；评审用 `node:sqlite` 在临时库**按序重放全部 5 个迁移（exit 0）**，实测：`Risk` 外键删除行为、`status` 默认值、旧 `Project` 行回填 `'ACTIVE'`、索引名与 `@@index` 一致。
- **未运行**：`npm run typecheck`、`vitest`、`prisma validate` / `prisma generate`（我这台机器没有 `node_modules`，本轮未安装依赖）。请你在装好依赖的环境跑一次，并把原始输出回传；合入后的回归也要留证。
- 快照测试已随本次改动同步，避免主分支变红（这是 US-09 的先例做法）。

## 6. 待你回复（5 项）

1. `Risk.level` / `Risk.status` / `Project.status` 的**线上取值**确认（或直接以你的 Zod 为准并回我一句）；
2. `MEMBER` 能否改 `status`（含重开），还是只能增删改字段 —— 若只允许 PM 流转状态，需要再拆动作或加条件判定；
3. `/projects/:projectId/close` 的**路径命名空间**是否可落（`src/routes.ts` 由 B 单写，需你确认命名）；
4. `Project.status` 不进共享 `ProjectView` 是否接受（你原方案如此，这里再确认一次）；
5. 是否需要 B 在你模块就绪前先挂一个临时占位页 / mock，还是等真实接口。

## 7. 链接

- 文档 PR（已合并）：https://github.com/githubleelee/AIManagement/pull/42
- 代码 PR（已合并）：https://github.com/githubleelee/AIManagement/pull/43
- 契约门集中同步评论：https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6245135447
- 授权条目：`DECISIONS.md` → `permissions.risk-and-project-close`
- 迁移：`src/db/migrations/20261018033000_add_risk_and_project_status/migration.sql`
