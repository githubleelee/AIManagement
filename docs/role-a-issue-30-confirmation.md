# ROLE-A / #30（US-10）开工授权确认 · 项目负责人回复

> 本文档为中文确认稿，可直接转发。仅记录项目负责人对本申请的逐项批复，**不代表已在 GitHub 发布、评论或改动任何 Issue / 标签**。

| 项目 | 内容 |
|---|---|
| 确认人 | GitHub `githubleelee`，即 ROLE-B / 项目负责人 |
| 被确认人 | ROLE-A（#30 负责人；本申请未填写账号，以 #24 接单留言为准） |
| 涉及工单 | #30（US-10）为主，#24 为契约留痕 |
| 日期 | 2026-10-18 |
| 结论 | **4 项全部同意**：第 1、2 项已由 B 作为公共文件单写人落地；第 3、4 项改由 A 在 B 登记的范围内自行挂载 |

## 0. 一句话结论

A 不需要再等公共文件授权：第 1、2 项公共支持已在 `feat/risk-actions-schema`（`9952740`）完成；第 3、4 项挂载**改授权 A 自己在登记范围内完成**。A 现在可以在自己的模块目录内开发，并把 US-10 的端点与页面接上线。

## 1. 四项逐条批复

| # | 申请内容 | 批复 | 现状 / 由谁完成 |
|---|---|---|---|
| 1 | 新增 `Risk` 表 + `Project` 加 `status` 列 + 1 个迁移 | 同意（已落地） | **B 已完成**：`src/db/schema.prisma`、迁移 `20261018033000_add_risk_and_project_status`、`src/db/test-support.ts` 清理顺序；A 只读使用，不修改 |
| 2 | 新增 `risk.write` / `project.close` 两个动作 | 同意（已落地） | **B 已完成**：`src/shared/types.ts`、`src/modules/authz/permissions.ts`（`project.close` 进 `WRITE_ACTIONS`；`VIEWER` 对 `risk.write` 403）；`test/t0-gap-fix.test.ts` 已有断言 |
| 3 | 后端把 2 个新端点挂到 `src/routes.ts` | 同意，**改由 A 自行挂载** | A 完成，须先向 B 登记文件与改动范围（见第 5 节） |
| 4 | 前端挂 2 个页面 + 左导航 2 项 | 同意，**改由 A 自行挂载** | 同上 |

> 说明：B 的公共支持分支 `feat/risk-actions-schema` **尚未开 PR / 合并 main**，且作者自述未跑 typecheck 与测试，见第 6 节待办。

## 2. 权限映射（与已记录决策一致）

- `risk.write` = **PM + MEMBER**；`VIEWER` 一律 403（只读，列表可见性不变）。
- `project.close` = **仅 PM**（MEMBER / VIEWER 403）。
- 风险三级 / 四态取值、状态流转细节，以及「MEMBER 能否改 `status` / 重开风险」由 A 在 #30 业务层定义并写测试；公共层只保证「MEMBER 可写、VIEWER 不可写」这一层。
- 敏感风险**继承所关联任务的可见性**，不扩展 `ObjectVisibility` 的对象类型。
- 统一走 `can()` / `visibilityScope()`，不在业务代码私写角色判定。

## 3. 进度与健康度口径（本次确认，冻结）

- **实际进度** = 已关闭任务数 ÷ 项目任务总数。
- **计划时间进度** = 已过自然日数 ÷ 计划总自然日数：
  - 计划区间 = 该项目全部任务的 `min(planStart)` ~ `max(planEnd)`，**自然日、含首尾**，时区 `Asia/Shanghai`；
  - 已过自然日数 = 今天 − `min(planStart)` + 1，截断到 `[0, 区间天数]`；
  - 项目无任务 → 显示「暂无计划数据」，**不做分级**。
- **偏差** = 计划时间进度 − 实际进度（单位：百分点）。比较用**未舍入值**，展示可保留 1 位小数。
- **分级阈值**：偏差 ≤ 10pp 为**健康**；> 10pp 且 ≤ 25pp 为**预警**；> 25pp 为**风险**。
- **覆盖范围**与负载口径一致：PM 用全项目基数；MEMBER / VIEWER 用各自**可见范围**并在界面标注「可见范围」，不得以可见子集冒称全项目。

## 4. 项目关闭阻断（AC4 / AC5）

- 关闭 / 重开入口与端点放在 **US-10 自己的模块**（不塞进项目模块），由 A 实现。
- 阻断条件：存在**未 `CLOSED` 的任务**或**未处理 / 处理中（`OPEN` / `IN_PROGRESS`）的风险**时拒绝关闭，返回 409 + 阻断清单。
- 项目关闭状态只由本票端点返回，**不改共享 `Project` 返回结构**（项目模块无需改动）。
- 关闭动作鉴权用统一入口的 `project.close`；重开同样仅 PM。

## 5. 开工条件与边界

**公共层（A 不得修改）**：`src/shared/*`、`src/db/schema.prisma` 及迁移、`src/modules/authz/permissions.ts`、`src/app.ts`。

**登记后可直接修改（仅限新增本票所需内容）**：

- `src/routes.ts`：注册本票端点；
- 前端骨架的**页面路由 / 左导航挂载行**（`web/src/routes.tsx`、`web/src/layouts/AppLayout.tsx` 等）。
- 要求：改动前把**文件清单 + 用途 + 预计行数**发给 B 登记；**同一时刻一个文件只允许一个写者**，若 B 正在改同一文件则等其回合或请 B 代改；不得借此改动骨架的其他结构。

**开发基线**：业务分支**基于 `feat/risk-actions-schema`（`9952740`）**，或在公共支持合入 main 后 rebase；**不得在分支内重复实现 `Risk` 模型或权限动作**。

**不做 / 不越界**：不改 D、C 的模块；不动项目模块既有写路径；不改共享 `Project` / `Action` 类型；不新建敏感对象类型。

**验证与证据**：本域模块测试 + `npm run typecheck`；界面票补浏览器走查（主链路 / 越权 / 敏感）；**只读预览不得冒充 AC3 / AC4 / AC5 完成**。

**AI 交互记录**：按 `docs/ai-interaction-recording-guide.md` 独立文件登记本票交互。

## 6. 需要同步 / 待办（不阻塞 A 开发）

| 事项 | 负责人 |
|---|---|
| 为 `feat/risk-actions-schema` 开 PR，跑 `typecheck` + `vitest` 后合入 main | B |
| 合并 `DECISIONS.md` 时保留 `permissions.risk-and-project-close`（2026-10-18T11:30）并按时间戳排序，不丢条目 | B |
| 在 #24 / #30 引用本确认，并在 #30 记录第 3、4 项的挂载范围 | A |
| A 的 GitHub 账号；以及「只读部分已提交」的分支地址（本次核对**未在远端查见** US-10 业务分支） | A |
| A 有标签权限则自行移除 #30 的 `needs-confirmation`；无权限由 B 代操作（不批量处理其他票） | A / B |

## 7. 声明

- 本文档不代表已在 GitHub 发布、评论或改动任何 Issue / 标签；`needs-confirmation` 由有权限者逐票核对后处理。
- 本次未在远端找到 A 的 US-10 分支，实际进度以 A 推送的提交为准。
- 公共支持的最终合入以 B 的 PR 与测试结果为准；未合并前 A 的分支需自行处理基线。
