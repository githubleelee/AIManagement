# 爱管理 · 阶段交接与开工指南

> 本文档与 `docs/handoff-issues.json` 一起，**在当前 `docs/team-handoff` 分支的 PR 中交付**。
> 合并前请**阅读 PR 分支版本，或先合入本文档 PR**；业务分支一律以**最新 `main`** 起。
> **原交接阶段说明（历史）**：本文档是阶段分工与开工约定，当时不新建 `DECISIONS.md`。本轮已有长期授权与架构决策，现引用并原样纳入现有 `DECISIONS.md`，不重复追加。
> 本文档不自动覆盖既有业务规则；**本轮项目负责人已明确授权的公共文件归属变更以 §4.1 为准**，不再以旧「B 不直接修改」条款阻塞。其他冲突仍遵循既有契约与具体授权流程，变更在 `CONTRACT` 留痕，不虚构原 owner 同意。
>
> **本轮口径同步（2026-10-17，项目负责人授权）**：项目负责人 `githubleelee`（ROLE-B）已明确授权 B 统一修改 / 合入一组公共文件（见 §4.1），并确认 AI 演示外部范围、通知时区等口径；变更来源见 `docs/role-d-start-confirmation.md` 与 `DECISIONS.md`。旧历史按「适用范围 + 变更说明」保留，不全局替换。本轮授权已确认；文档通过 [PR #39](https://github.com/githubleelee/AIManagement/pull/39) 交付，**截至本次同步为待合并**，后续以 GitHub 状态为准。[#24 补充确认](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6232875888) 已发布，#21/#31/#34/#36/#37 已同步说明；不把授权确认、文档合并与功能实现混为一谈。
>
> **本轮口径同步（2026-10-18，ROLE-C #32 确认）**：项目负责人已就 #32 逐项确认 C2 / C3 / C6 全项目口径、PM-only 权限最小例外与 `task/` 限范围写窗口，逐项原文见 `docs/role-c-issue-32-confirmation.md`，长期条目见 `DECISIONS.md`（含同 key `supersedes` 链）。该同步已以 [#24 集中同步评论](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6245135447) 与 [#32 核对请求](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6245135807) 发布；本文与 `docs/handoff-issues.json` 的对应更新经 [PR #42](https://github.com/githubleelee/AIManagement/pull/42) 交付（**待合并**）。旧文按「追加变更说明 + 保留原文」处理，不追溯改写；C11 / C12、C1 阈值、C10 故事级汇总等仍未一并确认。

链路：`clone → env → install → migrate → seed → dev`，对应 README「首次运行（新 clone 必做）」。**跳过 env / migrate / seed 会表现为服务能起、`/health` 正常，但任何走数据库的接口 500。**

---

## 1. 阅读顺序与范围

| 顺序 | 对象 | 目的 |
|---|---|---|
| 1 | 本文档 | 分工、边界、流程、命令 |
| 2 | 角色父票 [#20](https://github.com/githubleelee/AIManagement/issues/20) / [#21](https://github.com/githubleelee/AIManagement/issues/21) / [#22](https://github.com/githubleelee/AIManagement/issues/22) / [#23](https://github.com/githubleelee/AIManagement/issues/23) | 确认自己域内的子票、估算、接单模板 |
| 3 | 契约门 [#24](https://github.com/githubleelee/AIManagement/issues/24) | 确认本域开工所需最小契约；登记未决业务规则 |
| 4 | 自己的执行票 [#25](https://github.com/githubleelee/AIManagement/issues/25)、[#26](https://github.com/githubleelee/AIManagement/issues/26)–[#35](https://github.com/githubleelee/AIManagement/issues/35)、[#36](https://github.com/githubleelee/AIManagement/issues/36)、[#37](https://github.com/githubleelee/AIManagement/issues/37) | 范围、路径、交付物、逐条 AC、证据 |
| 5 | 三份既有规则文档 | 冻结契约与前端路由，权威来源 |

**背景基线**：Sprint 1 已完成 US-01 / US-02 / US-03 / US-05。本文档涉及的 11 个用户故事（US-04、US-06 至 US-15）与两个公共能力（附件、公共事件）**当前均无实现**，从 TODO 起步。
报告原文（完整项目规划，尤其第 5 / 7 / 8 / 10 / 13 节验收口径）供团队查阅，**不得**将真实私有报告原文件提交到本仓库。

### 1.1 18 票总表

| KEY | 标题 | 角色 | 类型 | 执行依赖 | 接口先行 |
|---|---|---|---|---|---|
| [#20](https://github.com/githubleelee/AIManagement/issues/20) | 汇总：工作台 / 验收 / 进度风险 / AI 分析 | A | role | — | — |
| [#21](https://github.com/githubleelee/AIManagement/issues/21) | 汇总：看板 / 甘特 / 成员负载 + 契约统筹 | B | role | — | — |
| [#22](https://github.com/githubleelee/AIManagement/issues/22) | 汇总：AI 排期 / 在线 UML | C | role | — | — |
| [#23](https://github.com/githubleelee/AIManagement/issues/23) | 汇总：AI 拆解 / 通知 / 附件 / 公共事件 | D | role | — | — |
| [#24](https://github.com/githubleelee/AIManagement/issues/24) | 开工契约确认（gate） | B 统筹 | gate | — | — |
| [#25](https://github.com/githubleelee/AIManagement/issues/25) | 故事看板 | B | story | — | [#37](https://github.com/githubleelee/AIManagement/issues/37) |
| [#26](https://github.com/githubleelee/AIManagement/issues/26) | 甘特图（含 FS、里程碑） | B | story | — | [#37](https://github.com/githubleelee/AIManagement/issues/37) |
| [#27](https://github.com/githubleelee/AIManagement/issues/27) | 成员任务图与负载 | B | story | — | — |
| [#28](https://github.com/githubleelee/AIManagement/issues/28) | 个人工作台与任务状态 / 进度 | A | story | — | [#37](https://github.com/githubleelee/AIManagement/issues/37) |
| [#29](https://github.com/githubleelee/AIManagement/issues/29) | 任务验收（通过 / 驳回 / 重验） | A | story | [#28](https://github.com/githubleelee/AIManagement/issues/28) | [#36](https://github.com/githubleelee/AIManagement/issues/36)、[#37](https://github.com/githubleelee/AIManagement/issues/37) |
| [#30](https://github.com/githubleelee/AIManagement/issues/30) | 进度、健康度与风险（含关闭阻断） | A | story | [#28](https://github.com/githubleelee/AIManagement/issues/28)、[#29](https://github.com/githubleelee/AIManagement/issues/29) | [#37](https://github.com/githubleelee/AIManagement/issues/37) |
| [#31](https://github.com/githubleelee/AIManagement/issues/31) | AI 需求拆解 + AI 框架接口 | D | story | — | — |
| [#32](https://github.com/githubleelee/AIManagement/issues/32) | AI 排期建议 | C | story | [#26](https://github.com/githubleelee/AIManagement/issues/26)、[#27](https://github.com/githubleelee/AIManagement/issues/27) | [#31](https://github.com/githubleelee/AIManagement/issues/31) |
| [#33](https://github.com/githubleelee/AIManagement/issues/33) | AI 质量 / 进度 / 风险 / 效率分析 | A | story | [#27](https://github.com/githubleelee/AIManagement/issues/27)、[#29](https://github.com/githubleelee/AIManagement/issues/29)、[#30](https://github.com/githubleelee/AIManagement/issues/30) | [#31](https://github.com/githubleelee/AIManagement/issues/31) |
| [#34](https://github.com/githubleelee/AIManagement/issues/34) | 站内通知（6 类 / 1 分钟） | D | story | — | [#37](https://github.com/githubleelee/AIManagement/issues/37) |
| [#35](https://github.com/githubleelee/AIManagement/issues/35) | 在线用例图 / 时序图 | C | story | — | — |
| [#36](https://github.com/githubleelee/AIManagement/issues/36) | 任务附件（≤10MB、受限类型） | D | common | — | — |
| [#37](https://github.com/githubleelee/AIManagement/issues/37) | 公共领域事件基础 | D | common | — | — |

> 正文中以**双花括号包裹的工单 key**（如 [#26](https://github.com/githubleelee/AIManagement/issues/26)）是发布占位符：工单创建后用实际链接或编号替换，见第 12 节。合并前看到的是占位符属正常现象。

---

## 2. 分支、合并与旧工单

- **文档单独交付**：本文档与 JSON 在 `docs/team-handoff` 分支的 PR 中；先合文档 PR，或按 PR 分支版本阅读。**不要**在文档 PR 里夹带业务代码。
- **业务分支从最新 `main` 起**；每个任务独立分支，建议用 `git worktree` 隔离，避免同机多任务互相污染。
- 分支命名 `feat/<KEY>-<短描述>`（如 `feat/US09-acceptance`）；完成即合，不留长分支。
- 提交信息建议 `feat(USxx): ...`；PR 描述写 `Closes #<本票号>`（票号发布后填入）。
- **旧 issue #4–#18 仍为 open**，其中部分（例如测试工厂、骨架相关）**代码可能已合入但工单未关**。要求：
  1. 开工第一步**复核当前 `main` 的实际实现**，不据旧票标题推断「缺实现」；
  2. 已实现则在本票说明并**引用证据**，不要重复造；
  3. **不得自动关闭**旧工单；关闭由相应负责人在复核后处理。
- 当前**没有**与本次 18 票重复的规划票；本索引即为本次要创建 / 核对的 18 票清单。

---

## 3. 开工命令（clone / env / install / migrate / seed / dev）

```bash
git clone https://github.com/githubleelee/AIManagement.git && cd AIManagement

# 1. 安装依赖（postinstall 会执行 prisma generate）
npm install

# 2. 创建本地环境变量文件（缺它报 "Environment variable not found: DATABASE_URL"）
cp .env.example .env

# 3. 建库并应用迁移（缺它报 "The table main.Project does not exist"）
npm run db:migrate

# 4. 写入演示账号与演示项目（幂等，可重复执行）
npm run db:seed

# 5. 启动后端 3000 + 前端 5173
npm run dev
```

**PowerShell（Windows）注意**

```powershell
Copy-Item .env.example .env          # 对应 cp
$env:DATABASE_URL = "file:./dev.db"  # 需要临时覆盖环境变量时
npm run db:migrate
npm run db:seed
npm run dev
```

- `.env` 与 `*.db` 都在 `.gitignore`；**绝不提交真实凭据、数据库文件与私有报告**。
- 演示账号出处：`src/db/seed.ts`（由 `npm run db:seed` 创建），统一密码 `Passw0rd!`：

| 账号 | 姓名 | 演示项目内角色 |
|---|---|---|
| `pm` | 王经理 | PM |
| `member1` | 李工 | MEMBER |
| `member2` | 张工 | MEMBER |
| `viewer1` | 刘总 | VIEWER |
| `outsider` | 外部用户 | 非成员（验证列表隔离 / 404） |

---

## 4. 角色、估算与文件边界

| 角色 | 子票 | 估算（人日） | 合计 |
|---|---|---|---|
| A | [#28](https://github.com/githubleelee/AIManagement/issues/28)、[#29](https://github.com/githubleelee/AIManagement/issues/29)、[#30](https://github.com/githubleelee/AIManagement/issues/30)、[#33](https://github.com/githubleelee/AIManagement/issues/33) | 6 / 5 / 8 / 11 | **30** |
| B | [#25](https://github.com/githubleelee/AIManagement/issues/25)、[#26](https://github.com/githubleelee/AIManagement/issues/26)、[#27](https://github.com/githubleelee/AIManagement/issues/27)、[#24](https://github.com/githubleelee/AIManagement/issues/24) | 4 / 8 / 4 / 2 | **18** |
| C | [#32](https://github.com/githubleelee/AIManagement/issues/32)、[#35](https://github.com/githubleelee/AIManagement/issues/35) | 9 / 9 | **18** |
| D | [#31](https://github.com/githubleelee/AIManagement/issues/31)、[#34](https://github.com/githubleelee/AIManagement/issues/34)、[#36](https://github.com/githubleelee/AIManagement/issues/36)、[#37](https://github.com/githubleelee/AIManagement/issues/37) | 6 / 6 / 3 / 3 | **18** |

1 人日 ≈ 6 小时。A 的内部拆分 6/5/8/11，合计 30。

> **集成估算单列（2026-10-17）**：上表 B = 18 人日中已含 **#24 的 2 人日契约统筹**，本轮文档同步、提案接收和确认协调优先在该项内核算，不重复计入新增实现。B 三票原已包含的模型、路由、页面挂载与模块验证仍计原票。仅 D 能力带来的**公共端口实现、schema / 迁移、app·routes 组装、三个组件最小挂载及新增集成验证**在原估算之外单列，初估 **3–6 人日（待 D 补丁后细化）**；分项见 `docs/tasks/role-b-development.md`。不表示追加预算或整体延期已批准，也不要求原 18 人日无条件吸收。D 业务实现、供应商 adapter、全局联调不重复计入。

### 4.1 公共文件归属与唯一修改人（2026-10-17 项目负责人授权更新；历史归属见下方变更说明）

| 对象 | 当前唯一修改人 | 说明 |
|---|---|---|
| `src/shared/*`（`types.ts` / `validation.ts` / `errors.ts` 等） | **B（`githubleelee`，项目负责人授权）** | 枚举 / 类型 / 校验器 |
| `src/db/schema.prisma` 及迁移 | **B（授权）** | 新表（附件 / 通知 / 风险 / AI / 事件 / UML / 里程碑 …）均在此改；小批次顺序合入 |
| `src/routes.ts`、`src/app.ts` | **B（授权）** | 路由注册表与应用组装注入 |
| `web/src/routes.tsx`、`App.tsx`、`layouts/`、`components/` | **B（授权）** | 页面**挂载行**按就绪添加 |
| `docs/frontend-routes.md` | **B（授权）** | 路由文档随骨架更新 |
| `var/uploads` 的 `.gitignore` 规则 | **B（授权）** | 由 B 统一落实 |
| `src/modules/authz/permissions.ts`（`can()` / `visibilityScope()` 签名） | 权限模块负责人 | **明确排除**在本次授权外：签名冻结；改内部实现也需原负责人 / 适用契约确认。**2026-10-18 追加（仍限于 #32）**：为落实 #32 PM-only，项目负责人额外授权 B 最小修改本文件及必要共享 `Action` / 对象 scope，不代表 C11 / C12 或其他票权限（`DECISIONS.md` `ownership.public-files-single-writer` 最新条目 + `scheduling.permission-pm-only`；旧条目保留） |
| `src/modules/*/` 各业务模块（requirement / task / project / authz 等） | 对应模块当前写者 | **旧业务文件**：须原 owner 对**具体文件 / 范围**书面授权后由本票角色改；不得新建镜像写路径 |
| `test/factories.ts` | T0.5 提供 | 全员只读 |

- **历史归属变更说明（保留旧历史）**：本轮之前，`src/shared/*`、`schema.prisma`、`routes.ts` 归「技术负责人」，前端骨架与 `docs/frontend-routes.md` 归「前端骨架原唯一修改人」。项目负责人本轮**明确授权** B 统一单写上表已列范围（来源 `docs/role-d-start-confirmation.md` §2、`DECISIONS.md` `ownership.public-files-single-writer`）；**该授权来自项目负责人，不代表原技术负责人 / 前端骨架原修改人已单独表态**。`permissions.ts` 不在本次公共单写授权内（#32 PM-only 的最小例外见 §4.1 表中该行）。
- **B 不再「只统筹」**上述已授权公共文件，而是作为**单写人**直接落地；未授权范围与旧业务文件仍按申请 / 授权流程。
- **切换任一唯一修改人**必须在 [#24](https://github.com/githubleelee/AIManagement/issues/24) 记录明确、可追溯的交接；本轮公共文件归属切换由**项目负责人授权**（来源同上），未经授权不得改旧归属或扩大其他业务域权限。
- **旧模块扩展授权**：实现必需的旧模块扩展**不必禁止，也不由其他角色代写**。由原 owner 书面授权本票负责人改**具体文件 / 范围**（或书面转交）后，业务改动仍由**本票角色**完成；**不得旁路旧规则新建镜像写路径**。见 [#24](https://github.com/githubleelee/AIManagement/issues/24) C13。
- **schema 迁移**：允许**小批次按顺序合入**，不要求所有模块一次做完。
- 新增业务代码只落在**本票独立目录**，不抢既有 `requirement/`、`task/`、`project/`、`authz/` 文件。
- **同模块单写者**：同一时刻一个模块只允许一个**写者**。多 AI 智能体可并行，但必须先明确文件边界；AI agent 做**只读审查 / 复核**时可与其他写者并行，**不得**并发修改同一文件。

### 4.2 新模块目录建议（每票独立，避免抢文件）

| 票 | 后端新目录 | 前端新目录 |
|---|---|---|
| US04 | `src/modules/board/` | `web/src/pages/board/` |
| US06 | `src/modules/gantt/` | `web/src/pages/gantt/` |
| US07 | `src/modules/workload/` | `web/src/pages/workload/` |
| US08 | `src/modules/workbench/` | `web/src/pages/workbench/` |
| US09 | `src/modules/acceptance/` | `web/src/pages/acceptance/` |
| US10 | `src/modules/risk/`、`src/modules/analytics/` | `web/src/pages/risk/`、`web/src/pages/analytics/` |
| US11 | `src/modules/ai/`（A/C 的场景代码放各自目录，不入此处） | `web/src/pages/ai/` |
| US12 | `src/modules/ai-scheduling/` | `web/src/pages/scheduling/` |
| US13 | `src/modules/ai-insights/` | `web/src/pages/insights/` |
| US14 | `src/modules/notification/` | `web/src/pages/notification/` |
| US15 | `src/modules/uml/` | `web/src/pages/uml/` |
| ATTACH | `src/modules/attachment/`（文件落 `var/uploads/`，`.gitignore` 规则由 B 统一落实，已授权） | `web/src/pages/attachment/` |
| EVENTS | `src/modules/events/` | — |

> 目录名为**建议**，可由角色负责人在本票确认后微调，但**不得抢他人文件**。

---

### 4.3 D 组件的已授权最小挂载

D 提供独立组件、Props 与补丁，由 B 在 `web/src/pages/RequirementDetailPage.tsx` 挂 AI、`web/src/pages/task/TaskSection.tsx` 挂附件、`web/src/layouts/AppLayout.tsx` 挂通知。仅上述最小接入已获项目负责人授权，不要求额外旧 owner 同意；超范围业务改动仍具体申请。组件就绪即可单独挂载，不等待四模块完成；B 不接管 D 的业务实现。

优先分批接收最小 AI / 事件端口提案（签名、数据形状、实现工厂/注入、最小测试示例）；两类独立接收，不要求迁移补丁或四模块一次交齐。后续字段、路由、组件与证据按能力逐批提交。

## 5. 每票开工流程（四步）

1. **先到角色父票留言确认身份与权限**（A → [#20](https://github.com/githubleelee/AIManagement/issues/20)，依此类推）。模板见 [#20](https://github.com/githubleelee/AIManagement/issues/20) 等父票正文。
2. 确认**适用契约、文件边界、验收口径**后，**自行移除** `needs-confirmation` 再开工（`CONTRACT` 不代删）。
3. 建**短分支 / worktree**，只在本票目录内新增文件；已授权公共文件由 B 单写、旧业务文件须原 owner 对**具体文件 / 范围**授权后改。
4. 完成「模块测试 + typecheck」；界面票补浏览器端到端证据；提 PR 写 `Closes #<本票号>`。

**阻塞处理**：阻塞**只阻塞被依赖的部分**；界面设计、测试设计可先行。卡住先在本票留言，不要闷头调。

---

## 6. 标签、身份与状态口径

- **发布标签**：全部 18 票加 `handoff`；角色标签 `role:A` / `role:B` / `role:C` / `role:D`；全部加 `needs-confirmation`。
- **不设 assignee**（人员身份未定）；**不标 ready-for-agent**。
- **每票子任务负责人仍是同一角色，不跨角色支援**（本阶段分工约束）。
- **六状态为本阶段必交**：`TODO` / `DOING` / `BLOCKED` / `SUSPENDED` / `DONE` / `CLOSED`。当前代码仅有 `TODO` / `DOING` / `DONE`；枚举映射 / 转换 / 授权 / 迁移与单写人见 [#24](https://github.com/githubleelee/AIManagement/issues/24) 第 2 点，**未落地前 US08/09/10 最终 AC 不勾**；不接受“是否扩展”的替代结论或用接口评审替代最终 AC。
- **`DONE != 验收关闭`**：`DONE` 是执行人提交，验收通过才是关闭。
- **验收人是任务字段，不是新增项目角色**。
- 旧工单与新票均**不自动关闭**；关闭需复核 + 证据。

---

## 7. 依赖与并行（避免伪串行与环）

依赖字段只包含**执行子票**；**父票（ROLE-*）不作执行依赖**；`CONTRACT` 是**软门**而非硬依赖，不必等所有话题锁死。

| 类型 | 含义 |
|---|---|
| `depends_on` | 整体验收依赖：被依赖票的基本功能到位后才能端到端验收 |
| `interface_depends_on` | 接口先行：只要接口 / 类型 / 边界冻结即可开工，不要求对方整体完成 |

关键边（与 JSON 一致；`depends_on` 是**整体验收依赖，不是开发开工依赖**）：

- [#29](https://github.com/githubleelee/AIManagement/issues/29) `depends_on` [#28](https://github.com/githubleelee/AIManagement/issues/28)；`interface_depends_on` [#36](https://github.com/githubleelee/AIManagement/issues/36)、[#37](https://github.com/githubleelee/AIManagement/issues/37)。
- [#30](https://github.com/githubleelee/AIManagement/issues/30) `depends_on` [#28](https://github.com/githubleelee/AIManagement/issues/28)、[#29](https://github.com/githubleelee/AIManagement/issues/29)；`interface_depends_on` [#37](https://github.com/githubleelee/AIManagement/issues/37)。
- [#33](https://github.com/githubleelee/AIManagement/issues/33) `depends_on` [#27](https://github.com/githubleelee/AIManagement/issues/27)、[#29](https://github.com/githubleelee/AIManagement/issues/29)、[#30](https://github.com/githubleelee/AIManagement/issues/30)；`interface_depends_on` [#31](https://github.com/githubleelee/AIManagement/issues/31)。
- [#32](https://github.com/githubleelee/AIManagement/issues/32) `depends_on` [#26](https://github.com/githubleelee/AIManagement/issues/26)、[#27](https://github.com/githubleelee/AIManagement/issues/27)；`interface_depends_on` [#31](https://github.com/githubleelee/AIManagement/issues/31)。
- [#25](https://github.com/githubleelee/AIManagement/issues/25) / [#26](https://github.com/githubleelee/AIManagement/issues/26) / [#28](https://github.com/githubleelee/AIManagement/issues/28) / [#34](https://github.com/githubleelee/AIManagement/issues/34) `interface_depends_on` [#37](https://github.com/githubleelee/AIManagement/issues/37)。
- [#27](https://github.com/githubleelee/AIManagement/issues/27) / [#35](https://github.com/githubleelee/AIManagement/issues/35) 无依赖，可独立开工。
- [#36](https://github.com/githubleelee/AIManagement/issues/36) / [#37](https://github.com/githubleelee/AIManagement/issues/37) / [#31](https://github.com/githubleelee/AIManagement/issues/31) 是基础先行来源。

并行约束：

- 上述 `depends_on` **只影响最终验收**：各票可用 mock / 接口占位 + **独立目录**并行开发，最终验收再按链路对账；图上**无环**。
- **B 域 `#27 → #26 → #25` 顺序仅为优先级，不是硬依赖**：三票在 `workload/`、`gantt/`、`board/` 独立目录可并行推进设计与实现；公共文件由 B 单写、组件按就绪挂载，**不整模块等待**。`docs/tasks/role-b-development.md` 中已取消仅由顺序产生的 FS / FF 硬边。
- A 的 [#28](https://github.com/githubleelee/AIManagement/issues/28) / [#29](https://github.com/githubleelee/AIManagement/issues/29) / [#30](https://github.com/githubleelee/AIManagement/issues/30) / [#33](https://github.com/githubleelee/AIManagement/issues/33) **接口并行**，不互相串行等待。
- [#34](https://github.com/githubleelee/AIManagement/issues/34) 通知**基础先做**（订阅事件 → 落库 → 拉取）；6 类通知的**最终送达 AC** 需 [#26](https://github.com/githubleelee/AIManagement/issues/26) / [#28](https://github.com/githubleelee/AIManagement/issues/28) / [#29](https://github.com/githubleelee/AIManagement/issues/29) / [#30](https://github.com/githubleelee/AIManagement/issues/30) 真实生产方联动证据，模块内模拟事件测试**不替代**端到端；**不要**制造 US08↔US14 硬环。
- [#28](https://github.com/githubleelee/AIManagement/issues/28) 的「被提及」同样必须接真通知数据（[#34](https://github.com/githubleelee/AIManagement/issues/34)）后才验收。
- 阻塞只阻塞被依赖部分的**最终验收**；UI / 测试设计先行。

---

## 8. 公共 AI / 事件接入规则（对决策 I-9 的处理；2026-10-17 已确认）

- 决策 I-9 **禁止跨业务模块互相调用 service**。因此 **A（[#33](https://github.com/githubleelee/AIManagement/issues/33)）/ C（[#32](https://github.com/githubleelee/AIManagement/issues/32)）不得直接调用 D 的业务模块 service**。
- **放置与注入已确认**：公共 AI / 事件**类型与端口放 `src/shared/`**，运行时由 **`src/app.ts` 应用组装注入**（来源 `docs/role-d-start-confirmation.md` §1、`DECISIONS.md` `arch.shared-ports-and-assembly`）。D 写 AI / 事件独立实现，**B 落公共接入**，A / C **复用端口**、不调用 D 业务 service。
- **#32 只读消费边界（2026-10-18 确认）**：C 生成阶段只读消费 #26 / #27 的最小契约（待 B 发布、待 C 书面核对），**不直接写** B 的派生聚合 / 依赖 / 里程碑结构；人工确认后仅经统一受控路径写 `TODO` 任务的 `planStart` / `planEnd`，B 的甘特 / 负载视图随原任务数据自然更新。
- **AI 演示外部范围**：先本地桩开发，后续接外部公有云大模型 API；普通虚构教学 / 演示数据可入外部模型；**仍禁止**外发真实密码 / token / 密钥 / 真实个人信息 / 未授权真实资料；敏感对象默认不入上下文；**不得声称满足原 AC13**；供应商 / 模型未定期间允许先做本地桩与可替换接口，端口不绑定 SDK（来源 `DECISIONS.md` `role-d.ai.demo-external-api-scope`）。
- [#37](https://github.com/githubleelee/AIManagement/issues/37) 只做**传输 / 存储 / 订阅 / 幂等基础**；**发出方各自实现自己的领域事件**，D 不替业务域写逻辑，也不把所有修改丢给 D。

---

## 9. 跨票必守验收口径

| 主题 | 要求 |
|---|---|
| 敏感 | 列表 / 计数 / AI 上下文 / 通知 / 附件 / 事件载荷均**不得泄漏**；复用 `can()` / `visibilityScope()`，查询层过滤，禁止内存过滤后计数 |
| 每票用例 | 至少覆盖 **PM / member / viewer / outsider + 敏感对象** 四类角色 |
| 附件 | 服务端单文件 **≤10,000,000 B**，扩展名与 MIME 联合校验；D 域清单已确认，见确认稿 §4 / C7 |
| 依赖 | 本期仅 **FS**（完成—开始）。**C2 已确认**（2026-10-18，全项目）：真实放行前置必须 `CLOSED`，`DONE` 不算验收通过；计划按自然日（含周末）、起止日均计入；FS 后继建议开始不得早于前置计划结束的次日；实际开工另检查前置 `CLOSED`（`DECISIONS.md` `scheduling.fs-release-closed-natural-days`）。原「待 #24 C2」表述保留为历史 |
| 甘特 | 需求 / 任务 / 里程碑统一展示，含**任务里程碑 + 汇总** |
| 工作台 | 固定 **5 块**：待办 / 逾期 / 待验收 / 被提及 / 近期计划 |
| 通知 | **6 类**：分配 / @提及 / 逾期 / 验收 / 风险 / 关键节点；目标事件后 **1 分钟内**；时区 **Asia/Shanghai**（D 域已确认，来源 `DECISIONS.md` `notifications.events-timing-timezone`） |
| 风险 | **3 级**（高 / 中 / 低）+ **4 态**（未处理 / 处理中 / 已解决 / 已关闭）；有未关闭任务或未处理 / 处理中风险时**阻止项目关闭** |
| 进度 | **已关闭任务数 ÷ 项目任务总数**（`DONE` 不计入） |
| AI | 关键建议**人工确认**后才应用；全过程**审计**；演示范围见下条 |
| AI 数据边界 | **默认不纳入敏感对象**；普通虚构教学 / 演示数据可入外部公有云大模型 API（项目负责人本轮变更，来源 `DECISIONS.md` `role-d.ai.demo-external-api-scope`）；**仍禁止**外发真实密码 / token / 密钥 / 真实个人信息 / 未授权真实资料；**不得声称满足原 AC13**；供应商 / 模型未定期间允许先做本地桩与可替换接口 |
| 六状态 | 本阶段必交 `TODO / DOING / BLOCKED / SUSPENDED / DONE / CLOSED`；未落地前 [#28](https://github.com/githubleelee/AIManagement/issues/28) / [#29](https://github.com/githubleelee/AIManagement/issues/29) / [#30](https://github.com/githubleelee/AIManagement/issues/30) 最终 AC 不勾 |
| 多视图一致性 | 按**同一账号、同一授权视角**比较（地图 / 看板 / 甘特 / 工作台 / 仪表盘口径一致）；保留 C6 的**全局基数 / 可见基数**语义。**C6 基础口径已确认**（2026-10-18）：负载 = 负责人名下非 `CLOSED` 任务数（含 `DONE`），不做评分；PM 看全项目汇总，MEMBER / VIEWER 只看各自授权可见任务汇总并标「可见范围」；AI 排敏后以子集重算，不得冒充全局基数（`DECISIONS.md` `scheduling.load-aggregation-baseline`）；健康度阈值等未确认 |
| UML | 平台内**在线**创建 / 编辑用例图与时序图，**关联**项目 / 目标 / 活动 / 故事 / 任务；上传图片**不替代**在线绘图 |

**不擅自规定**：高级拖拽、高级调度、额外外部服务。后置范围见报告 §2.3，不扩项。

---

## 10. 估算与预留

- 汇总口径：**A 30 / B 18 / C 18 / D 18 人日**；1 人日 ≈ 6 小时。
- **全局验收与联调另预留 15–20%**（不进上述子票估算）。
- **不承诺** agent 线性提速，**不承诺** 8 周必完；8 周为内部建议窗口，实际节点以团队与课程安排为准。

---

## 11. 待确认清单（摘要）

以下业务 / 技术规则按行区分**已确认 / 部分确认 / 待确认**，统一登记 [#24](https://github.com/githubleelee/AIManagement/issues/24)。**仅未决部分限制为设计，不写死实现**；已确认部分可在另获实施授权后推进：

| 编号 | 话题 |
|---|---|
| C1 | 项目健康度阈值（健康 / 预警 / 风险的偏差口径） |
| C2 | FS 放行条件 —— **已确认**（2026-10-18，全项目）：前置必须 `CLOSED`，`DONE` 不算验收通过；自然日含起止；后继建议开始不早于前置结束次日（`DECISIONS.md` `scheduling.fs-release-closed-natural-days`）。原问句保留为历史 |
| C3 | 逾期判定时区边界 —— **已确认**（2026-10-18，全项目含 A/B/C/D）：统一 `Asia/Shanghai`，日期语义 `YYYY-MM-DD`；`planEnd` 当日结束后、次日 00:00 仍未 `CLOSED` 即逾期（`DECISIONS.md` `timezone.project-wide-asia-shanghai`）。原「D 已确认 + A 待统一」为历史；A 工作台 `isoToday()` 仍用 UTC 属**实现差异**，由对应写者收敛，不作为口径待定 |
| C4 | AI 服务与资源 —— **本轮变更**：演示范围可接外部公有云大模型 API、普通虚构演示数据可入（`DECISIONS.md` `role-d.ai.demo-external-api-scope`）；具体供应商 / 模型 / 地址未定，允许先做本地桩与可替换接口；端口不绑定 SDK |
| C5 | UML 交互方案（在线编辑方式，不引入外部服务） |
| C6 | 汇总权限口径 —— **基础口径已确认**（2026-10-18）：负载 = 负责人名下非 `CLOSED` 任务数（含 `DONE`）、不做评分；PM 全项目汇总，MEMBER / VIEWER 可见范围汇总并标注；AI 排敏后以子集重算、不得冒充全局基数（`DECISIONS.md` `scheduling.load-aggregation-baseline`）。健康度阈值（C1）等其他规则仍未确认 |
| C7 | 附件受限类型清单与存储位置 —— **D 域已确认**：png/jpg/jpeg/webp/pdf/docx/xlsx/zip，服务端 ≤10MB（SI 10,000,000 B）、扩展名与 MIME 联合校验，元数据入库、实体文件 `var/uploads/` 并 `.gitignore`（`DECISIONS.md` `attachments.policy`；`.gitignore` 由 B 落实） |
| C8 | 通知 6 类判定与「1 分钟」口径 —— **D 域已确认**：仅站内、Asia/Shanghai、逾期次日 00:00、去重规则与接收者映射见 `DECISIONS.md` `notifications.events-timing-timezone` |
| C9 | 项目关闭阻断的执行入口与清单口径 |
| C10 | 进度口径确认（= closed/total，DONE 不计入） |
| C11 | 操作授权 `Action` / 角色映射（US04 成员能否改故事；US08 负责人更新 / PM 管理边界；US09 指定验收人可验、VIEWER 是否允许、验收人可选范围；现无 `task.accept`；不得绕 `can()` / `visibilityScope()`）—— **未自动确认**，仍待权限负责人 + 项目负责人拍板 |
| C12 | 协作人模型 / 任务成员权限（当前 `Task` 无协作人，不得擅自缩减报告范围）—— **未自动确认**，仍待技术负责人 + 项目负责人 + A |
| C13 | 旧模块修改归属与项目关闭入口 —— **部分更新**：公共文件已授权 B 单写（见 §4.1）；旧业务文件仍须原 owner 对具体文件 / 范围授权；项目关闭入口当前无 close endpoint，归属待确认。**#32 限范围例外（2026-10-18）**：C 在 B 登记具体文件 / 范围并完成现写者交接后的独占窗口内，最小改 `src/modules/task/routes.ts`、`rules.ts` 及本域测试，不另建旁路、不调 task service；**不覆盖** B 甘特旧入口、也不覆盖 requirement 等其他旧模块（`DECISIONS.md` `arch.legacy-task-controlled-extension` 最新条目）；不假定写锁空闲 |

> **六状态不属于「待确认」范畴**：它是**本阶段必交**，见 [#24](https://github.com/githubleelee/AIManagement/issues/24) 第 2 点（枚举映射 / 转换 / 授权 / 迁移 / 单写人）；US08/09/10 的最终 AC 依赖其落地。C1–C13 的状态以各行结论为准，未决部分只做设计；D 域确认不代替 A / C 域确认。

---

## 12. 工单索引格式说明（`docs/handoff-issues.json`）

本文件是本次 18 票的**工单索引**：UTF-8 JSON 数组，18 条，顺序固定。每条字段：

| 字段 | 说明 |
|---|---|
| `key` | 工单标识；角色父票为 `ROLE-A`…`ROLE-D`，其余为 `US04`、`US06`…`US15`、`ATTACH`、`EVENTS`、`CONTRACT` |
| `title` | 工单标题 |
| `role` | 负责人角色，**单字母** `A` / `B` / `C` / `D`（`ROLE-*` 仅是 key，不是 role 值） |
| `kind` | `role`（4 条）/ `gate`（1 条，CONTRACT）/ `story`（11 条）/ `common`（2 条，ATTACH、EVENTS） |
| `depends_on` | 整体验收依赖，key 数组，只含执行子票，**不含**父票与 CONTRACT |
| `interface_depends_on` | 接口先行依赖，key 数组，只含执行子票 |
| `body` | 工单正文（Markdown，含 AC 复选框） |

- `body` 内引用其他工单时，用**双花括号包裹目标 key**（如 [#26](https://github.com/githubleelee/AIManagement/issues/26)）表示；工单创建后应替换为实际链接或编号，`Closes #` 亦在发布后填入票号。
- 建票统一加标签 `handoff`、`role:A` / `role:B` / `role:C` / `role:D`、`needs-confirmation`；**不设 assignee**、**不标 ready-for-agent**；由各执行票在确认后自行移除 `needs-confirmation`。
- 工单创建后，条目上再出现 `number` / `url` 之类的元数据字段属正常情况，不影响依赖判断与引用替换。
- **不自动关闭**任何旧工单；关闭须复核 + 证据。
- **本轮同步（2026-10-17）**：18 条的 `number` / `url` / `key` **保持不变**；仅更新 ROLE-B、CONTRACT 及受影响的 D 相关正文口径（公共文件授权、AI 外部范围、通知时区等），并保留变更来源引用。本地任务编号（`docs/tasks/role-b-development.md` 的 #01 起）**不新增为 GitHub 依赖、不建票**。

---

## 13. 验证证据要求（不每任务强制全套）

> **4 类证据分开**：桩（本地 mock / 可替换接口）、模块测试、真实 API、真实生产方联调分别留证，**任一不得冒充另一类**。mock 可用于开发与模块验证，但**不得冒充真实 AI 验收或六类通知端到端送达**。

| 类型 | 最低证据 |
|---|---|
| 后端票 | 本模块 `*.test.ts`（覆盖角色 + 敏感用例）+ `npm run typecheck` |
| 界面票 | 浏览器端到端走查（截图 / 录屏）：主链路 + 越权 + 敏感 |
| AI / 附件 / 事件 | 除模块测试外，附「无外发 / 幂等 / 依赖方向」证据 |
| 通知 / 事件 | 六类通知**最终送达**需真实生产方（[#26](https://github.com/githubleelee/AIManagement/issues/26) / [#28](https://github.com/githubleelee/AIManagement/issues/28) / [#29](https://github.com/githubleelee/AIManagement/issues/29) / [#30](https://github.com/githubleelee/AIManagement/issues/30)）联动证据；模块内模拟事件测试**不替代**端到端 |
| 候选验收前 | 多视图一致性回归：按**同一账号、同一授权视角**比较（地图 / 看板 / 甘特 / 工作台 / 仪表盘口径一致） |

**不要求每个任务都跑全套测试**；但每个 PR 至少要过本模块测试与类型检查。

---

## 14. 可复制给 AI agent 的开工提示词

先由人工选定角色并在角色父票留言，再把下面内容交给本地 AI；同一份提示词不要让多个编码 agent 同时认领同一文件。

```text
我负责 AIManagement 的角色 <A/B/C/D>，本次只处理 GitHub Issue <完整链接>。
先读取 docs/team-handoff.md、该 Issue 及其引用的适用契约，再检查当前 main 的实际代码。
第一轮只报告：本票范围与不做项、依赖/未决事项、计划修改的文件、逐条验收方案。
若需成员授权、公共契约或旧模块修改许可，先列出申请，等人工确认；不要自行拍定规则。
确认后从最新 main 建立独立短分支，只实现本票，不顺手扩展其他故事。
遵守同模块单写者与公共文件归属（已授权公共文件由 B 单写，旧业务文件须具体授权），不读取或提交真实密钥、私有报告、数据库文件。
未实现功能不得用 mock 冒充通过验收；完成后附针对性测试、类型检查和界面走查证据。
不要自行关闭旧 Issue、合并 PR、扩大权限或调用外部公有云模型处理真实项目数据。
```

人工确认第一轮方案后再启动编码。第二个 agent 只有在文件边界明确且获准后才能编码；只读审查 agent 可以并行。

---

## 附录 A · 通用接单 / 阻塞 comment 模板

```
接单确认：我是 <姓名 / GitHub 账号>，认领 <KEY>（<标题>）。角色 <A/B/C/D>。
- 已读 docs/team-handoff.md 与三份 sprint1 既有规则文档，已核对当前公共文件授权归属与未授权边界。
- 我适用的契约：<枚举 / 字段 / 端点 / 接口>；文件边界：仅本票目录 + 已授权公共文件由 B 单写 / 旧业务文件具体授权。
- 验收口径：<逐条 AC 摘要>；我确认后自行移除 needs-confirmation。
- 我的分支 / worktree：<feat/KEY-...>，从最新 main 起。
```

```
阻塞：<KEY> 的 <具体部分> 被 <依赖> 阻塞。
- 已先行完成：<界面 / 测试设计 / 接口占位>
- 需要的放行条件：<...>
- 预计解除：<时间>
```

## 附录 B · 风险提示

| 风险 | 说明 | 应对 |
|---|---|---|
| R1 schema 单写者瓶颈 | 附件 / 通知 / 风险 / AI / 事件 / UML / 里程碑都要改 `schema.prisma` | 各票按能力提交字段提案，由 B 单写并小批次顺序合入迁移，不要求所有模型一次齐备 |
| R2 枚举扩展未定 | `BLOCKED/SUSPENDED/CLOSED` 仅规划位 | 在 [#24](https://github.com/githubleelee/AIManagement/issues/24) 先定，再由唯一修改人落地 |
| R3 AI 接口放置未定 | I-9 禁止跨模块 service | 先出类型 / 接口设计，[#24](https://github.com/githubleelee/AIManagement/issues/24) 确认注入方式 |
| R4 阈值口径未定 | 健康度、FS 放行、时区、汇总权限 | 登记 C1–C10，未决前只做结构 |
| R5 旧工单状态不确定 | #4–#18 open 但代码可能已合 | 开工复核实际实现，不重复造、不自动关闭 |
| R6 伪串行 | 父票 / CONTRACT 被当依赖 | 依赖只看执行子票；接口先行优先于整体验收 |
