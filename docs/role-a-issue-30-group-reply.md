# US-10（#30）开工批复通知 · 发群版

> **可直接复制到群里的一句话回复：**
> **同意 US-10 的 4 项。第 1、2 项已由 B 作为公共文件单写人落地；第 3、4 项授权 A 在 B 登记的范围内自行挂载；健康度阈值本次一并定死。完整批复见 `docs/role-a-issue-30-confirmation.md`。**

| 项目 | 内容 |
|---|---|
| 批复人 | GitHub `githubleelee`，即 ROLE-B / 项目负责人 |
| 接收人 | ROLE-A（#30 / US-10 负责人） |
| 日期 | 2026-10-18 |
| 状态 | 4 项全部同意；本文**不代表**已在 GitHub 发布、评论或移除任何标签 |

---

## 一、逐条批复

| # | 申请内容 | 批复 | 现状 / 由谁完成 |
|---|---|---|---|
| 1 | 新增 `Risk` 表 + `Project` 加 `status` 列 + 1 个迁移 | 同意（**已落地**） | B 已完成：`src/db/schema.prisma`、迁移 `20261018033000_add_risk_and_project_status`、`src/db/test-support.ts` 清理顺序；A 只读使用 |
| 2 | 新增 `risk.write` / `project.close` 两个动作 | 同意（**已落地**） | B 已完成：`src/shared/types.ts`、`src/modules/authz/permissions.ts`；`test/t0-gap-fix.test.ts` 已有权限断言 |
| 3 | 后端把 2 个新端点挂到 `src/routes.ts` | 同意，**改由 A 自行挂载** | A 完成，须先向 B 登记文件与改动范围 |
| 4 | 前端挂 2 个页面 + 左导航 2 项 | 同意，**改由 A 自行挂载** | 同上 |

> **更新（2026-10-18 晚些）**：公共支持已经 PR #43 合入 **main**（rebase 后 `47eee93` → 合并提交 `648a6575`，随后 #44 合并为 `c59611c`）。**A 请直接基于最新 `main` 开发**，不要再基于旧的 `feat/risk-actions-schema@9952740`。仍未跑 `typecheck` / `vitest`（B 本机无 `node_modules`），该项待补。

---

## 二、开始动手前必须知道的三件事

1. **不要再申请第 1、2 项，也不要重复实现。** `Risk` 模型、`Project.status` 列与两个权限动作已在 **main**（PR #43 已合并）；A 的业务分支直接从最新 `main` 起。
2. **第 1、2 项的收尾状态**：PR 已开并合入 main（#43）；**`typecheck` + `vitest` 仍未运行**（B 本机无依赖）—— 这一项待补，结果会另行同步；在此之前 A 可开发，但不要把「公共层已验证」当成前提。
3. **远端查不到 A 的 US-10 分支**。申请里写「只读部分已经做完并提交」，但本次核对的所有远端分支里没有对应分支（仅有 B 的 `feat/risk-actions-schema`）。请 A 补推分支并附地址，便于复核。

---

## 三、本次定死的规则（已写入 `DECISIONS.md`）

| 事项 | 结论 |
|---|---|
| `risk.write` | PM + 项目成员可写；`VIEWER` 一律 403 只读 |
| `project.close` | 仅 PM（MEMBER / VIEWER 403）；重开同样仅 PM |
| 实际进度 | 已关闭任务数 ÷ 项目任务总数 |
| 计划时间进度 | 已过自然日数 ÷ 计划总自然日数；计划区间取全部任务的 `min(planStart)` ~ `max(planEnd)`，自然日、含首尾、`Asia/Shanghai` |
| 健康度分级 | 偏差 = 计划时间进度 − 实际进度；≤10pp 健康、10–25pp 预警、>25pp 风险（比较用未舍入值） |
| 无任务 | 显示「暂无计划数据」，不做分级 |
| 可见范围 | PM 用全项目基数；MEMBER / VIEWER 用各自可见范围并标注「可见范围」 |
| 关闭阻断 | 存在未 `CLOSED` 任务，或未处理 / 处理中（`OPEN` / `IN_PROGRESS`）风险时，拒绝关闭并返回 409 + 清单 |
| 关闭入口 | 放在 US-10 自己的模块，不塞进项目模块；**不改**共享 `Project` 返回结构 |
| 风险敏感 | 继承所关联任务的可见性，不扩展 `ObjectVisibility` 对象类型 |

---

## 四、A 的开工边界

**不得修改（公共层）**

- `src/shared/*`
- `src/db/schema.prisma` 及迁移
- `src/modules/authz/permissions.ts`
- `src/app.ts`

**登记后可直接修改（仅新增本票所需内容）**

- `src/routes.ts`：注册本票端点
- 前端骨架的**页面路由 / 左导航挂载行**（如 `web/src/routes.tsx`、`web/src/layouts/AppLayout.tsx`）
- 改动前把**文件清单 + 用途 + 预计行数**发给 B 登记；**同一时刻同一文件只允许一个写者**，若 B 正在改同一文件则等其回合或请 B 代改；不得顺手改动骨架其他结构

**验收证据**

- 本域模块测试 + `npm run typecheck`
- 界面票补浏览器走查（主链路 / 越权 / 敏感）
- **只读预览不得冒充 AC3 / AC4 / AC5 完成**

---

## 五、合并注意（B 与 A 双方）

`DECISIONS.md` 目前有两个并行副本，都记录了挂载责任，措辞不同：

| 条目 | 时间戳 | 措辞 |
|---|---|---|
| `permissions.risk-and-project-close` | 2026-10-18T11:30 | 路由 / 前端挂载「待 A 就绪后由 B 补挂」 |
| `ownership.public-files-single-writer`（新） | 2026-10-18T11:45:50 | #30 授权 A 在 B 登记范围内自行挂载 |

合并时**保留两条并按时间戳排序，以较新的 `ownership` 条目为准**，避免 A 与 B 都以为对方在挂载。

---

## 六、声明

- 本文档只记录批复结论，**不代表已在 GitHub 发布、评论或改动任何 Issue / 标签**；`needs-confirmation` 由有权限者逐票核对后处理。
- 公共支持的最终合入以 B 的 PR 与测试结果为准。
- A 的实际进度以 A 推送的提交为准。
