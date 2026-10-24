# B-I26-20261024c-gantt-final-acceptance-01

- 负责人 / GitHub：githubleelee；角色B；Issue：https://github.com/githubleelee/AIManagement/issues/26（本地 #15）
- 工具 / 模型：pi 主控（浏览器走查 + 真实 HTTP/DB 核对），实际版本未记录
- 指令来源：主控（#15 Done when 的最后一项：合并后浏览器复核）
- 基线：main `e7bc546`（含 #114 FS 双入口、#116 D 附件修正、#117 UML P2/P3+P4/P5）
- 环境：隔离库（`mktemp` + 迁移 + seed）、API 3213、Vite 5281、headless Chromium
- 记录时间：2026-10-24T16:30:00+08:00

## 表 5 摘要

| 序号 | 时间 | AI智能体角色 | 任务场景 | 人类输入摘要 | AI输出要点 | 团队处置及理由 |
|---|---|---|---|---|---|---|
| 1 | 2026-10-24 16:1x–16:2x | B主控 | #15 合并后复核 | 主控：#13 已合，补最后一次浏览器+接口复核 | PM 编辑器与写接口 201；重复/成环 409（细码正确）；member1 写控件 0 且直连 403；进度 0%（0/3） | 待确认；#15 的 FS 依赖与 UI 证据齐 |
| 2 | 同批 | B主控 | 发现并登记未记录口径 | 走查发现 member1 看不到无关联任务的里程碑 | 代码里是**刻意 fail-closed**（里程碑可见性由可见关联任务派生）；已在设计稿 §9.5 登记为已决口径 + 已知限制 | 待确认；不改行为，先登记事实 |

## 真实证据

- PM：页面含 `＋ 新建里程碑` / `编辑` / `删除` / `＋ 新建依赖` / `删除`；故事显示「进度 0%（已关闭 0 / 共 3 个任务）」；里程碑「甘特验收里程碑」截止 2026-10-30；依赖「甘特前置 → 甘特后继（FS）」。截图 [PM](evidence/B-I26-20261024c-gantt-pm.png)。
- API：`POST /projects/:id/milestones` = **201**；`POST /projects/:id/task-dependencies` = **201**；重复依赖 = **409** `CONFLICT + successorTaskId:DUPLICATE`；反向成环 = **409** `CONFLICT + successorTaskId:INVALID_VALUE`；member1 直连两个写端点 = **403 / 403**。
- member1 浏览器：写控件 **0**，文案「可见范围 / 只有项目经理可以维护里程碑与依赖；你当前是只读访问。」；计数 1 故事 / 2 任务 / **0 里程碑** / 1 依赖边。截图 [member1 只读](evidence/B-I26-20261024c-gantt-member1-readonly.png)。
- 原始矩阵：[matrix](evidence/B-I26-20261024c-gantt-matrix.txt)。

## 发现并登记的口径（非缺陷）

`src/modules/gantt/service.ts:210-213` 对非 PM 使用 `where: { projectId, tasks: { some: { taskId: { in: visibleTaskIds } } } }`：
里程碑可见性**由当前可见关联任务派生**，因此**无关联任务的里程碑对非 PM 不返回**（PM 全量可见）。
设计稿原 §9.5 第 5 项把该问题列为「待核对/待裁定」；本批按实现的 fail-closed 选择**登记为已决口径与已知限制**（避免「无可见关联也返回」暴露「某里程碑存在且与不可见任务相关」的存在性信号），并写明如需改变须先裁定并同步测试/文案。**本批不改行为。**

## 命令

| 命令 | exit | 证据 |
|---|---|---|
| `npm run typecheck`（main `e7bc546`，独立 tester） | 0 | 见 tester 记录 |
| `npx vitest run`（全量，独立 tester） | 0 | 见 tester 记录 |
| 浏览器 + curl 矩阵（本记录） | — | [matrix](evidence/B-I26-20261024c-gantt-matrix.txt) |

## 限制

- 未验证「关联了敏感任务的里程碑对未授权成员」的端到端矩阵（依赖既有 C10/跨可见记录与单测；本批只补合并后复核）。
- 全量测试由独立 tester 在 main 上跑，结果单独记录。
- 无关联里程碑对成员不可见属已知限制（见上），未改代码。

## 人工复核
- 处置：待确认
