# US-03 前端实施中发现的问题（提交小组讨论）

| 项目 | 内容 |
|---|---|
| 提出人 | 编码智能体（US-03 前端），由成员 3 转呈小组 |
| 日期 | 2026-09-20 |
| 我的分支 | `feat/T3.11-web-requirement`（基点 `main` = `3048af9`） |
| 核对过的远端 | `git fetch origin --prune` 成功后（exit 0），共 13 条远端分支 |
| 证据等级约定 | `[实测]` 附命令与输出；`[推断]` 附文件:行号；`[未验证]` 说明卡在哪 |

> **本文档的立场**：以下每一条都有可复核的证据，且**包含我自己的两处判断错误**（第 3 节）。
> 请把它当作"问题清单 + 证据包"，不是"甩锅清单"。

---

## 0. 三条最要紧的（TL;DR）

| # | 问题 | 影响 | 我建议的处置 |
|---|---|---|---|
| **1** | 我的前端分支**基点选错了**：真正的前端骨架与 M1/M2 后端在**未合并**的 `feat/US-01-m2-project-members` 上，我基于 `main` 开发 ⇒ `App.tsx` 已产生冲突 | 我的工作有相当一部分要重做；若直接合并会发生冲突 | **先合并/推送那条分支到 `main`**，我把 US-03 页面改建在它冻结的路由节点下 |
| **2** | **术语与口径不一致**：平台用「业务目标 / 用户活动 / 用户故事」，而实验一指导书要求「骨干活动 / 用户故事 / **MoSCoW**」、PMBOK 用「**需求** / 效益 / **WBS** / **需求跟踪矩阵（RTM）**」 | 评审时可能被质疑"有没有听课" | 改**显示文案**（位置在 `web/src/labels.ts`，零契约成本）+ 文档补术语表；**不要**在 Sprint 1 改线上字段 |
| **3** | 契约点名的 `test/factories.ts`、`test/helpers.ts` **至今不存在**（`main` 与该分支都没有） | 与契约"测试数据工厂由 T0.5 提供、全员只读"不符 | 若这就是那个未 close 的 issue，那它**确实没做完**；见第 4 节 Issue A |

---

## 1. T0 到底完成没有？（逐项核对）

**结论：T0 是"部分完成"，不是"全部完成"。** 逐项：

| 任务 | 内容 | 实测状态 | 证据 |
|---|---|---|---|
| T0.1 | 项目骨架与本地启动 | ✅ 完成 | `package.json` 的 `dev`/`build` 脚本；`src/app.ts`、`src/server.ts` `[实测]` |
| T0.2 | 决策 I-7 的 9 张表 | ✅ 完成 | `src/db/schema.prisma` + `src/db/migrations/20260919102113_init/migration.sql`（9 表齐全）`[实测]` |
| T0.3 | 端点 1/2 + `requireAuth` | ⚠️ **一半** | `src/auth/token.ts`、`src/auth/password.ts`、`src/auth/actor.ts`（`requireAuth`）在 `main` ✅；但**端点 1 `POST /auth/login`、端点 2 `GET /auth/me` 只在未合并分支**：`origin/feat/US-01-m2-project-members` 的 `src/auth/plugin.ts` `[实测]` |
| T0.4 | `can()` 骨架 | ✅ 完成 | `src/modules/authz/permissions.ts` 的 `createAuthorization()` `[实测]` |
| T0.5 | 测试运行器与数据工厂 | ⚠️ **一半** | `vitest.config.ts` ✅、`test/http-support.ts` ✅（T0 缺口修补时新增）；**但契约明列的 `test/factories.ts` 与 `test/helpers.ts` 在 `main` 与那条分支上都不存在** `[实测]` |

**关于"我是不是说过 T0 已完成"** —— 说明一下，我当时的原话（表五序号 58，2026-09-19 22:47）是**相反**的：

> `src/routes.ts` 仅注册 `/health` 与 requirement 插件，**端点 1/2/3 与成员管理均不存在**；
> `test/http-support.ts` 存在……而 `test/factories.ts`、`test/helpers.ts` 不存在

所以"端点 1/2/3 不存在"这个判断本身**没问题**（它在 `main` 上成立，`[实测]`）——**有问题的是我由此推出的结论**：我把它当成了"全组都没有"，而实际上**它早就在另一条分支上实现了，只是没合进 `main`，而那条分支当时根本不在我的本地 refs 里**（详见第 3 节）。

---

## 2. 术语与口径差距（PMBOK / 实验指导书 / 平台 三方对照）

### 2.1 三方用词对照

| 平台现用界面词 | 线上字段（**建议不动**） | 实验一指导书用词 | PMBOK 常用词 | 建议显示（双标签） |
|---|---|---|---|---|
| 业务目标 | `BusinessGoal` | （未提，团队自加） | 业务/效益目标 | 业务目标（保持，另在术语表标注对应物） |
| 用户活动 | `UserActivity` | **骨干活动**（指导书第 113 行） | 「活动」属进度管理，语义不同 | **骨干活动（用户活动）** |
| 用户故事 | `UserStory` | 用户任务 / 用户故事 | **需求（Requirement）** | **需求（用户故事）** |
| 任务 | `Task` | 任务 | 工作包（WBS 最底层）/ 活动 | 任务（术语表标注对应"工作包"） |
| 优先级 | `Priority = P0\|P1\|P2` | **MoSCoW（Must/Should/Could/Won't）** | 无强制方案 | 见 2.2，**待小组定** |
| 层级树 | — | 用户故事地图 | 需求跟踪矩阵（RTM）/ WBS | 需求层级（用户故事地图） |
| 业务价值 | `businessValue` | — | 效益（benefits） | 业务价值（效益） |

### 2.2 优先级口径：**这是真偏离，且早于 Sprint 1**

- 实验一指导书**三处**要求 MoSCoW：第 113 行「故事按 MoSCoW 方法（Must/Should/Could/Won't）标注优先级」、第 154 行「MoSCoW 优先级标注」、第 333 行交付物「含……MoSCoW 优先级」`[实测]`（docx 抽文本计数：MoSCoW 命中）
- 团队实验一产出**实际用的是 P0/P1/P2**：`爱管理_软件项目规划与实施方案总1.1.docx` 第 183 行「P0 核心闭环」、第 191 行「P1 治理增强」`[实测]`
- 平台沿用 P0/P1/P2：契约第 178/190/256 行、基线第 231/501 行；**契约与基线里 MoSCoW = 0 次**`[实测]`

⚠️ **不要自己发明对应关系**：MoSCoW 有 4 档、平台的 `Priority` 只有 3 个取值，`P0↔Must / P1↔Should / P2↔Could` 是**看似合理但没有依据的映射**。要么小组明文定一个对应表，要么在界面**并列显示**、不去宣称等价。

附带发现：基线第 577 行用 `P0/P1/P2` 描述**任务估算**（"P0 = 必须完成，P1 = 时间不足时砍"），而第 231 行用同一套标签描述**故事优先级** —— 同一套标签担了两个含义，建议一并澄清。

### 2.3 你们在实验一里自己承诺过、但平台没实现的两条

抽自 `爱管理_软件项目规划与实施方案总1.1.docx`：

> 第 1431 行：**A09：建立「需求—用户故事—任务—测试—验收」的追踪表**，至少覆盖 P0 核心链路。
>
> 第 984 行：会议纪要、需求、故事地图、**WBS**、甘特图、UML、自评中的项目范围、角色和名称**保持一致**。

- **A09 就是 PMBOK 的需求跟踪矩阵（RTM）**，是团队自己写的行动项，平台未实现 `[实测]`
- **WBS 那一侧**：实验一产出里 WBS 出现 **11 次**（两份方案各 11 次），但实验一**指导书里 WBS = 0 次**（指导书要的是甘特图 + 里程碑）`[实测]` ⇒ 所以"平台没有 WBS"**不算违反指导书**，只算**没兑现自己文档里的一致性承诺**
- 平台的 `UserActivity` 是"用户的**关键行为**"（动词），不是"可交付成果"（名词）⇒ 它**结构上无法与 WBS 对应**`[推断]`（契约决策 I-7 的 9 张表里没有任何 WBS/工作包表）

**建议**：不要在 Sprint 1 动层级结构（会推翻已合入 `main` 的 US-03 后端交付，也违反实验一自定的"四层结构"平台承诺）。改为：① 界面加「术语对照与缺口」说明；② Sprint 2 再评估补 RTM 字段（来源/干系人、验证方法、验收结论、WBS 引用）。

---

## 3. 前端挂载冲突（含**我自己的两处判断错误**，先撤回）

### 3.1 事实：前端骨架与 M1/M2 后端**已经写好了，在未合并的分支上**

`origin/feat/US-01-m2-project-members`（最新提交 `aa0d6ba`，09-19 23:20）相对 `main` 改动 **43 文件 / +3303 −91** `[实测]`，其中：

**后端（M1/M2，端点 1–9）**
- `src/auth/plugin.ts` / `schemas.ts` / `service.ts` / `auth.test.ts` → **端点 1、2**
- `src/modules/project/{plugin,service,schemas}.ts` + `project.test.ts` / `project.members.test.ts` / `project.isolation.test.ts` → **端点 3–9**
- `src/db/seed.ts` + `test/seed.test.ts`，并在 `package.json` 加了 `db:seed`
- 改了冻结件 `src/routes.ts`（注册 auth/project 插件）与 `src/error-handler.ts`

**前端骨架（M2 独占维护，见 `docs/frontend-routes.md`）**
- `web/src/App.tsx`（改成 `AuthProvider` + `AppRoutes`）、`main.tsx`、`web/src/routes.tsx`
- `web/src/layouts/{AppLayout,ProjectLayout}.tsx`、`web/src/auth/{AuthContext,ProtectedRoute}.tsx`
- `web/src/components/{Button,DataTable,EmptyState,FormField,PageHeader}.tsx`
- `web/src/api.ts`、`web/src/labels.ts`、`web/src/index.css`（+379 行）
- `package.json` 加 `react-router-dom@^7.18.4`
- **`docs/frontend-routes.md`**：冻结前端 URL 与页面职责

**而 `docs/frontend-routes.md` 里已经给 US-03 留好了位置**（原文）：

| URL | 页面 | 归属 |
|---|---|---|
| `/projects/:projectId/requirements` | `ProjectRequirementsPage` | **M4 / US-03（T3.x）** |
| `/projects/:projectId/requirements/:storyId` | `RequirementDetailPage` | **M4 / US-03（T3.x）** |

这两个文件目前是**占位页**（各 15/18 行，写着"US-03 后续实现"）`[实测]`。

该文档还规定：

> 前端骨架（`App.tsx`、`routes.tsx`、`layouts/`、`components/`）为**共享文件**，由 M2（US-01）负责人独占维护。
> 其他模块**只往 `web/src/pages/` 下新增自己的页面**，并在 `routes.tsx` 的既有路由节点下挂载。

### 3.2 我撤回两处判断（都是我基于**过期的本地远端引用**得出的）

| # | 我说过的话 | 实际情况 | 根因 |
|---|---|---|---|
| **错误 1** | "实测 5 条兄弟分支在 `web/src/pages/` 下**一条页面都没有**" | `feat/US-01-m2-project-members` 下有 **9 个页面** | ① 那条分支**当时根本不在我的本地 refs 里**（从未 fetch 过）；② 我只抽查了 5 条分支，而远端共 13 条 |
| **错误 2** | 9-19 曾据本地 `git status -sb` 判断"`origin/main` 可能已同步" | 人类 `git fetch` 后实测为 `[ahead 21]`（远端还是 `d490c64`） | **同一个根因**：本地 remote-tracking ref 不可信 |

**教训（建议写进 Sprint 回顾）**：**未 fetch 过的 remote-tracking ref 不能作为事实依据。**
本次 `git fetch origin --prune`（exit 0）后，直接多出一条从未见过的分支 `feat/US-01-m2-project-members`，而它恰好是"前端到底有没有人做"这个问题的答案。我在此之前的所有跨分支判断都应当视为**未经核实**。

### 3.3 冲突点（会真实挡路）

| 位置 | 我的分支（基于 `main`） | 那条分支 | 冲突后果 |
|---|---|---|---|
| `web/src/App.tsx` | 追加 1 行 import + 1 行渲染 | **已重写为路由外壳**（+8 −32） | **必冲突**，且我的挂载方式在他们的架构里是错的 |
| `web/src/api.ts` | 我在 `web/src/pages/requirement/api.ts` 另建了一套 | 已有**共享** `web/src/api.ts` | 重复实现 |
| `web/src/labels.ts` | 我在 `web/src/pages/requirement/labels.ts` 另建了一套 | 已有**共享** `web/src/labels.ts`（当前只有角色标签） | **术语会分叉成两处** —— 恰好是第 2 节要修的毛病 |
| 令牌/项目 id | 我做了开发后门 `devSession.ts` + 手工粘贴面板 | **有真登录（端点 1/2）+ AuthContext + seed 账号** | 后门**完全不必要**，应删除 |
| 种子数据 | 我写了仓库外的 `_us03_seed_frontend.cjs` | 已有 `src/db/seed.ts`（`db:seed`，账号 `pm`/`member1`/`member2`/`viewer1`/`outsider`，密码 `Passw0rd!`） | 重复，应改用官方的 |

---

## 4. 建议的处置顺序

1. **先合并/推送 `feat/US-01-m2-project-members` 到 `main`**（它含端点 1–9 + 前端骨架 + 官方 seed）。在那之前，任何前端页面都没有稳定的挂载点。
2. 我把 US-03 的页面**改建在** `ProjectRequirementsPage.tsx` / `RequirementDetailPage.tsx`（路由已冻结，占位已在等），复用其 `api.ts` / `labels.ts` / `components/`，并**删除我的后门与自定义 seed**。
3. 术语统一改在 **`web/src/labels.ts` + 文档**（第 2 节），**不动线上字段、不走契约变更流程**。

---

## 5. 附：可直接发 GitHub Issue 的草案（3 条）

> ### 怎么发（**不需要任何 token，推荐这条路**）
>
> 1. 打开 **https://github.com/githubleelee/AIManagement/issues/new**
> 2. 把下面 **Issue A** 的「标题」与「正文」分别复制进去 → 点 **Submit new issue**
> 3. 对 **Issue B**、**Issue C** 重复第 2 步（共 3 条）
>
> 正文段落可以直接整段复制，不含需要手工改的占位符。
>
> <details>
> <summary>如果你更希望由智能体代发（可选，需要 PAT）</summary>
>
> **PAT 是什么**：给程序用的**临时密码**（不是你的登录密码），可以限定只对某个仓库、只开某一项权限。
> 生成路径：GitHub 右上角头像 → **Settings** → 左栏最下 **Developer settings**
> → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
> → *Repository access* 选 **Only select repositories** → 勾 `AIManagement`
> → *Permissions* → **Repository permissions** → 找到 **Issues** → 选 **Read and write**
> → **Generate token** → 复制那串 `github_pat_...` 发给智能体。
>
> ⚠️ 需要知道的风险：这串字符等同"只能改 issue 的你的身份"，**不要长期保存**，
> 建议发完 3 条 issue 后立刻在 GitHub 上 **Revoke**（同一个页面里可以删）。
> 若不想处理这些，就用上面的网页粘贴法 —— **效果完全一样**。
>
> </details>


### Issue A —— T0.5 未交付契约点名的测试工厂文件

- **标题**：`T0.5：契约点名的 test/factories.ts 与 test/helpers.ts 至今不存在`
- **背景**：契约《Testing Decisions → 测试数据工厂》列出 8 个工厂函数，并声明"由 T0.5 提供，全员只读"；`test/helpers.ts` 同样被点名。
- **证据**（`[实测]`）：`git cat-file -e main:test/factories.ts` 与 `main:test/helpers.ts` 均不存在；`origin/feat/US-01-m2-project-members` 上同样不存在；两处只有 `test/http-support.ts`（T0 缺口修补时新增，内含最小版 `makeUser`/`makeProject`/`makeMember`）。
- **影响**：契约说的"全员只读的公共工厂"不存在，各模块只能自建夹具 —— 本模块就自建了 `src/modules/requirement/test-fixtures.ts`（表五序号 41 已登记），与"四个人用同一套工厂"的初衷不符。
- **建议**：明确二选一 —— ① 补 `test/factories.ts` + `test/helpers.ts` 并让各模块夹具改为引用它；② 修订契约，承认 `test/http-support.ts` 即工厂所在，并删除对不存在文件的引用。
- **验收标准**：仓库中存在契约点名的两个文件，**或**契约不再引用不存在的文件；两者必居其一。

### Issue B —— 术语与优先级口径与课程材料不一致

- **标题**：`术语口径：MoSCoW / 骨干活动 / 需求 / RTM 与平台的 P0-P1-P2 / 用户活动 / 用户故事 不一致`
- **背景**：实验一指导书第 113/154/333 行要求故事按 **MoSCoW** 标注优先级、按「用户角色 → **骨干活动** → 用户任务/用户故事 → 发布切片」组织；平台线上值为 `Priority = P0|P1|P2`，界面词为「用户活动 / 用户故事」。
- **证据**（`[实测]`）：契约与基线中 `MoSCoW` 出现 **0 次**；实验一团队产出中 `WBS` 出现 11 次、`用户故事地图` 11–20 次；实验一指导书 `WBS` 0 次。
- **另附两条团队自加承诺未兑现**：实验一方案第 1431 行 A09「需求—用户故事—任务—测试—验收的追踪表」（= PMBOK 的 RTM）、第 984 行「故事地图与 WBS 保持一致」。
- **建议**：Sprint 1 **只改界面显示文案**（位置 `web/src/labels.ts`，零契约成本，因为决策 I-1 已把线上常量与界面标签分离）；**线上字段与枚举值不动**；文档补一节「术语表 + 与 PMBOK 的映射 + 已知缺口」；MoSCoW 的具体对应关系由小组明文确认，**不自行发明**。
- **验收标准**：界面出现 PMBOK 对应词（或双标签）；文档存在术语对照表与缺口清单；线上字段无改动。

### Issue C —— 前端骨架分支未合并，导致共享文件重复与冲突

- **标题**：`前端骨架（App.tsx/routes.tsx/api.ts/labels.ts）在未合并分支上，其他模块已按其约定开发并产生重复实现`
- **背景**：`docs/frontend-routes.md` 冻结了前端骨架与 URL，并规定"骨架由 M2 独占维护、其他模块只在 `web/src/pages/` 下新增页面并挂到既有路由节点"。但该分支尚未合入 `main`，其他模块基于 `main` 开发时看不到骨架。
- **证据**（`[实测]`）：`origin/feat/US-01-m2-project-members`（`aa0d6ba`）相对 `main` = 43 文件 / +3303 −91，含 `App.tsx` 重写（+8 −32）、新增 `web/src/api.ts`、`web/src/labels.ts`、`routes.tsx`、`layouts/`、`components/`、`package.json`（+react-router-dom）。US-03 前端基于 `main` 另建了 `web/src/pages/requirement/{api,labels,session}.ts` 并改了 `App.tsx` ⇒ 冲突。
- **建议**：**尽快合并该分支到 `main`**，并在此之前不要基于 `main` 开新的前端分支；合并后由 US-03 删除重复实现、改建到冻结的路由节点下。
- **验收标准**：`main` 上存在前端骨架；其他模块的页面挂在 `routes.tsx` 的既有节点下；不存在重复的 `api.ts` / `labels.ts` 实现。

---

## 6. 本模块（US-03 前端）当前的自我状态

| 项 | 状态 |
|---|---|
| 分支 | `feat/T3.11-web-requirement`（基点 `main`，**基点已确认选错**） |
| 已交付（可复用） | 层级树 / 详情 / 术语对照 的设计稿 `web/src/pages/requirement/preview.html`；三栏布局 CSS；`shared-types.typecheck.ts`（契约漂移编译期守卫）；两个可复跑检查脚本（`_us03_preview_smoke.cjs`、`_us03_css_class_coverage.cjs`） |
| 需删除（重复/过时） | `devSession.ts`（后门）、`session.ts`、`api.ts`、`labels.ts`、`RequirementPage.tsx` 的接入区、我改的 `App.tsx` 挂载行 |
| 未提交 | 是（人类要求先审 diff 再提交） |
| 后端 | 一行未改（`src/` 零改动） |
