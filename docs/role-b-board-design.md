# ROLE-B → GitHub #25：故事看板 · 单票设计与旧文件授权细化（DRAFT）

> **状态：DRAFT · 可交用户审阅 · 未冻结。** 本文只写 `#25` 的三列、读/写路径、权限/审计边界、具体旧文件授权范围与页面/文件清单；
> **不代表接口已注册、授权已到、代码已实施或 AC 已通过**。设计不以「后端接口真正交付」为前提，但也不据此宣称任何实现完成。
> 依据：`docs/role-b-baseline-review.md`（#01）、`docs/role-b-contract-register.md`（#02）、`docs/tasks/role-b-development.md` #16、
> `DECISIONS.md` 当前适用条目、`docs/role-c-issue-32-confirmation.md`（C 确认稿）。
> 代码基线：只读快照 `/tmp/role-b-main-398aa76.GvfwFS`（commit `398aa76`）；工作区 HEAD `fb5cee2` 较老，**不采用其状态/权限结论**。

## 1. 范围、非目标与已确认前提

- 范围：`src/modules/board/`（必要聚合读后端）+ `web/src/pages/board/`（三列页面）+ 本域测试；公共挂载由 B 单写、**另批**。
- **不做**：自造看板状态/列、拖拽排序、自定义列、看板私有写入口、跨业务 `service` 调用、地图/详情业务修改、事件运行时自建设。
- 已确认（源码 + 契约台账）：
  - 故事状态**只有三态** `DRAFT / PLANNING / DONE`（`src/shared/types.ts:32`），界面标签与列序已存在：`DRAFT=待规划 / PLANNING=规划中 / DONE=已完成`（`web/src/pages/requirement/terms.ts:54/61`）。
  - **不得与任务六态混用**：`TODO/DOING/BLOCKED/SUSPENDED/DONE/CLOSED` 是 Task 的状态（`src/shared/types.ts:38`），本票不引入、不映射。
  - 故事写路径**唯一**：端点 21 `PATCH /stories/:storyId`（`src/modules/requirement/plugin.ts:854-917`）+ `updateUserStory`（`src/modules/requirement/service.ts:860-884`）；本票**不新建镜像入口、不复制 requirement service**。
  - 该写路径当前**确无审计、无领域事件**（#01 §2 结论），须在 C13 具体文件授权后补齐。

## 2. #25 AC 与本设计的对应（AC 均未运行）

| AC（GitHub #25 原义） | 设计落点 | 状态 |
|---|---|---|
| AC1 看板列与正式需求状态一致，无自造状态 | 三列直接取 `STORY_STATUS_ORDER`；卡片/列头用 `STORY_STATUS_LABEL` | 设计 |
| AC2 调整后重拉，地图/详情状态同步 | 写后同账号重拉看板；地图（`ProjectRequirementsPage`）与详情（`RequirementDetailPage`）读同一 `UserStory` 行（§9） | 设计 |
| AC3 写 who/when/before/after 审计 | 在既有 PATCH 写路径内同事务写 `AuditLog`（§7） | 待授权 |
| AC4 无权限/跨项目拒绝，非成员 404 | 复用 `can()` / `visibilityScope()`（§6） | 设计 |
| AC5 敏感不展示，计数与列表一致 | 可见性条件**进查询层**，列表与 count 同 `where`（§4） | 设计 |
| AC6 不绕过 requirement.write | 前端只调既有 PATCH；服务端仍由 `requirement.write` 判定（§5） | 设计 |

## 3. 列与卡片字段

- 三列**正式名称**：`DRAFT`（待规划）/ `PLANNING`（规划中）/ `DONE`（已完成）；列序用既有 `STORY_STATUS_ORDER`，不前端重排、不新增「未开始」「进行中」等自造列。
- 卡片最小字段（只读）：`id`、`title`、`priority`、`status`；可选展示所在活动/目标路径。本域可做**最小投影、不含 `isSensitive`**；但这不是既有契约的字段级脱敏规则——已授权可见对象的既有端点字段（如端点 10/20 的 `UserStory` 含 `isSensitive`，`service.ts:745-759`）**不由本票一刀切改变**，复用端点 10 时仍按其原契约返回。关键约束是**未授权对象不出现、不计数**（§4）。
- 列内排序：沿用端点 10 既有源码口径 `[{ createdAt:'asc' }, { id:'asc' }]`（`service.ts:965`），**不新造排序键**；该次级键是已实现代码，不是候选提案。
- 空列：显示空态文案（该状态暂无所见故事），**不合并/隐藏列**。

## 4. 读路径候选（**均未注册 · 待批准 · 未冻结**）

后端既有契约**无 `/api` 前缀**；前端 `apiFetch` 统一代理 `/api`（`web/src/api.ts:54-64`）。

| 候选 | 语义 | 复用/新增 | 备注 |
|---|---|---|---|
| `GET /projects/:projectId/board` | 聚合：三列 `{ status, items[], count }` | **新增**，B 在 `src/routes.ts` 注册（参照工作台注册 `:44`） | 推荐：计数与列表可共用同一 `where` |
| `GET /projects/:projectId/goals`（端点 10，已实现） | 层级树内嵌 `stories[]` | 复用，零后端改动 | 无计数、响应较重；若采用则列计数只能前端按已过滤集合聚合 |

- **推荐新增最小聚合读**：`src/modules/board/` 直接读库（`ctx.prisma.userStory.findMany/count`），不 import `requirement`/`task`/`project` 的 service。
- **可见性进查询层**：`visibilityScope(actor, projectId, 'story')`（`permissions.ts:182`）并入 `where`；列表与 count **必须同一 `where`**（范式：`workbench/service.ts:109-131`），禁止「取出全量再内存过滤/算计数」（会泄漏存在性）。
- 入口校验：`can(actor, 'project.read', { kind:'project', projectId })`；故事级读/写另用合法 `ObjectRef`：`{ kind:'story', projectId: storedProjectId, objectId: storyId }`（storedProjectId 来自存储故事记录，不信任客户端自报）（`types.ts:231-236`），**不得传不完整的 `{kind:'story'}`**；判定入口见 `permissions.ts:123`。非成员/项目不存在 → 404。
- 空数据与截断：计数为精确值；若对列做条数上限，须另给精确 `total`，不得用截断明细长度冒充计数。

## 5. 写路径（复用既有 PATCH，不新建入口）

- 前端**只调用端点 21**：复用已导出的 `updateStory(storyId, { status })`（`web/src/pages/requirement/api.ts:203-221`），或经 `apiFetch` 发同路径/同形状请求；**不改他人页面**。
- 服务端行为保持：窄读 `id+projectId` → `can(actor,'requirement.write',{kind:'story',projectId:storedProjectId,objectId:storyId})` → schema 校验（`schemas.ts:260-267`，`status` 必须是 `storyStatusSchema`）→ `updateUserStory`。
- **不新增** `/board/...` 写端点、不复制状态更新逻辑、不在看板里判断角色。
- 看板只提交 `{ status }` 单字段；后端部分更新语义不变（未出现字段不动）。

## 6. 权限矩阵（服务端为准，前端隐藏不算拒绝）

| 角色 | 看板读 | 状态写（`requirement.write`） | 敏感故事 |
|---|---|---|---|
| 未登录 | 401 | 401 | 不适用 |
| PM | 允许 | 允许 | 可见（全项目） |
| MEMBER | 允许（只读） | **403**（`WRITE_ACTIONS`，`permissions.ts:33-38/163`） | 仅非敏感 + 被指名白名单 |
| VIEWER | 允许（只读） | **403** | 同上 |
| outsider / 非本项目 | 404（与项目不存在逐字一致） | 404 | 不泄漏存在性 |
| 跨项目 `projectId` | 按目标项目成员关系判定；非成员 404 | 同上 | 不混入他项目故事 |

- 前端按角色/权限隐藏操作按钮**仅为体验**；AC6 的拒绝必须由服务端给出，验证时直接用 HTTP 越权请求。
- **C11 待决范围仅 MEMBER**：`#25` 已知 VIEWER 为只读，VIEWER 继续现行只读、**不列入待决**；MEMBER 是否可按新增规则操作故事状态待 C11 书面确认，现有 main 行为是 PM-only 写。C 的 `#32` PM-only 例外只覆盖 authz 最小改动，**不覆盖 C11**，其他票的 C11 结论也不外推；除另获明确变更，VIEWER 保持只读。若 C11 批准 MEMBER 写，落点见 `#18`。
- 既有 `task.progress` / `task.accept` 的成员条件动作（`permissions.ts:146-163`）**不等于**成员获得故事写权，不外推。

## 7. 审计与事件（一致性策略待确认）

- 审计模型已存在：`AuditLog(projectId, actorUserId, action, objectType, objectId, before, after, createdAt)`（`src/db/schema.prisma:191-203`）；已有同事务审计先例：`setSensitivity`（`src/modules/authz/sensitivity.ts:36-85`）。
- 目标：AC3 的 **who = 会话 `currentUserId(req)`、when = 库写入时间、before/after = 服务端读取的既有值与新值**，全部服务端可信，不接受客户端自报。
- 待确认：
  1. **最小审计方案**：仅对**真实发生的 `status` 变化**写 who/when/before/after，建议与业务写同一 `$transaction`（先例 `sensitivity.ts`）。`updateUserStory` 需新增 `actorUserId` 入参与 before 读取；**若该参数改动影响本设计未列出的调用点/测试，先登记追加授权范围**（§8），不擅改。
  2. **可能扩项（不阻塞最小方案）**：是否把该 PATCH 的其余 8 字段变更一并审计、以及 `action` 命名（候选 `story.status.update`），须另经审计/契约负责人确认；**不得以全字段策略阻塞本票最小方案**。
  3. **事件提交语义**：D 公共事件端口**未交付**，**不默认 outbox / exactly-once，也不静默失败**；事件失败是否回滚业务写、是否可重试、是否需幂等键，均列待确认。
  4. **生产者归属**：本域故事状态事件由**本域**生产者发布，**D 只提供传输/存储/订阅端口，不代本域生产事件**。
- 审计行与事件**不得**写入敏感正文；卸载 payload 边界按已确认口径。

## 8. 具体旧文件授权细化（C13，未获授权前不改）

沿用 `role-b-contract-register.md` §4.2 草稿，精确到函数/行（快照 `398aa76`）：

| 文件 | 申请范围 | 目的 |
|---|---|---|
| `src/modules/requirement/service.ts` | 仅 `updateUserStory`（`:860-884`）及其同函数内新增的审计写入 | 在既有写路径内补 `actorUserId`/before + 同事务 `AuditLog` |
| `src/modules/requirement/plugin.ts` | 仅端点 21 handler（`:854-917`，含 `:873` 既有 `can('requirement.write')`） | 传递操作者与审计所需的既有值；**不新增路由** |
| `src/modules/requirement/requirement.story-read-update.test.ts` | 仅端点 21 的审计、越权、状态变更回归用例 | 复用既有 HTTP seam 测试范式；本票新测试放 `src/modules/board/` |

- 保留 `requirement.write` / `can` / `visibilityScope` / 原字段校验；不借看板扩成员写权限；不抽取公共 helper、不改 `permissions.ts` 签名。
- **C 的 `#32` task 写窗口例外不覆盖 requirement**；须单独取得原 owner 的具体文件/函数范围授权与实际写窗口确认（不假定写锁空闲）。未获授权前旧文件**零改动**。
- 实施顺序建议：先只读看板（`#17`，不触碰旧文件）→ 获授权后再做写+审计（`#18`）。

## 9. 跨视图同步方案（AC2）

- 看板写状态成功后**重新拉取本页**（`GET /projects/:projectId/board` 或端点 10）；不做本地乐观改写冒充同步。
- 地图 = `ProjectRequirementsPage`（已有「状态」列，`:390`；视图 `tree|stories|terms`，`:66`）；详情 = `RequirementDetailPage`（状态展示/编辑，`:451/:677/:184`）。两者读同一 `UserStory` 行，写后应随存储一致。
- 验收方式：**同账号、同授权视角**打开看板改状态 → 回到地图/详情复核；**不得用 mock 或假响应宣称跨视图同步**。
- **不顺手修改地图/详情业务**（含 `ProjectRequirementsPage.tsx`、`RequirementDetailPage.tsx`）；确有需要时**另提具体授权**（超范围）。

## 10. 文件清单、最小开工条件与短 PR 建议

- 后端：`src/modules/board/{plugin,service,types}.ts`；公共注册 `src/routes.ts`（B 单写）。
- 前端：`web/src/pages/board/{BoardPage,StoryCard,api,types}.tsx|ts`、`board.css`；公共挂载 `web/src/routes.tsx`、`docs/frontend-routes.md`（B 单写，**候选 URL 未注册**）。
- 测试：`src/modules/board/*.test.ts`（本域）；`requirement.story-read-update.test.ts` 仅授权范围内的回归补充。
- 最小开工条件（**按批次软门，不整模块等所有题**）：
  1. **只读批次（`#17`）**：最小方案/范围获批即可先做，不依赖 C13/C11/事件端口。
  2. **写+审计批次（`#18`）**：需 C13 具体旧文件授权与写窗口、适用权限结论（仅 MEMBER 待 C11；VIEWER 保持只读）、审计一致性策略。
  3. **事件批次**：等对应公共事件端口就绪后接入；未接入的验收项明确未完成，不默认 outbox/exactly-once，也不静默失败。
  4. **挂载批次（`#19`）**：公共挂载排期（B 单写）。
- 短 PR 建议（**非新 hard dependency**，仅为交付纪律）：
  1. `board-read`：目录 + 聚合读 + 页面只读三列（不含旧文件）。
  2. `board-write-audit`：端点 21 审计扩展 + 看板写交互（须 §8 授权）。与第 1 批**无硬前置**：授权补丁可独立准备，UI 交互需页面就绪。
  3. `board-mount`：`routes.tsx` + `frontend-routes.md` 挂载（B 单写）。
  以上仅为 PR 拆分建议，**不新增任务依赖边**；排期按现有任务图（`docs/tasks/role-b-development.md`），不由 PR 顺序造边。
- 运行命令（获批后）：`npm run typecheck`、本模块测试；**本轮不装依赖、不跑 app**。

## 11. AC1–6 验证矩阵（**均未运行**）

| 场景 | 期望 | AC |
|---|---|---|
| 三列渲染 | 仅 DRAFT/PLANNING/DONE 三列，标签与列序与需求模块一致 | AC1 |
| 改状态后重拉 | 同账号看板重拉显示新状态；地图/详情复核一致 | AC2 |
| 审计 | 真实 HTTP 改状态后 `AuditLog` 有 who/when/before/after | AC3 |
| PM 写 | 200，状态落库 | AC3/AC6 |
| MEMBER/VIEWER 写 | 现状 403；仅 MEMBER 若另获 C11 批准再回归，VIEWER 继续只读 | AC4/AC6 |
| outsider / 外项目 | 404，与项目不存在一致 | AC4 |
| 敏感未授权 | 不出现、不加计数；列表计数一致 | AC5 |
| 敏感被指名 | 仅该成员可见并计数 | AC5 |
| 前端隐藏按钮 + 直接 HTTP | 服务端仍拒绝（前端隐藏不算通过） | AC6 |
| 事件（本票接口依赖/范围要求） | 接入后须为真实生产者事件、失败策略按确认结论；**未接入即明确未完成**，不得视为可永久省略，也不得据此判 AC3 审计已通过 | AC3 |

以上为**测试设计**，不是本轮执行；AC 通过须在编码、挂载与真实链路就绪后另行留证。

## 12. 来源行号（快照 `398aa76`）

- `src/shared/types.ts:32`（故事三态）/`:38`（任务六态）/`:87-100`（`UserStory`）
- `src/modules/requirement/service.ts:822`（`getUserStory`）/`:860-884`（`updateUserStory`）
- `src/modules/requirement/plugin.ts:142`（注册）/`:854-917`（端点 21，`:873` 鉴权）
- `src/modules/requirement/schemas.ts:260-267`（`updateUserStorySchema`，`:267` `storyStatusSchema`）
- `src/modules/authz/permissions.ts:33-38`（`WRITE_ACTIONS`）/`:123`（`can`）/`:146-163`（任务条件动作/写 403）/`:182`（`visibilityScope`）
- `src/db/schema.prisma:191-203`（`AuditLog`）；`src/modules/authz/sensitivity.ts:36-85`（同事务审计先例）
- `src/modules/workbench/service.ts:109-131`（查询层 `where` + count）
- `src/routes.ts:44`（工作台注册示例，新模块注册落点）；`web/src/api.ts:54-64`（`/api` 前缀）
- `web/src/pages/requirement/api.ts:203-221`（`updateStory` 端点 21）；`web/src/pages/requirement/terms.ts:54/61`（标签/列序）
- `web/src/pages/ProjectRequirementsPage.tsx:66`（视图）/`:390`（状态列）；`web/src/pages/RequirementDetailPage.tsx:184/451/677`
- `web/src/routes.tsx:40`（需求页挂载示例）/`:44`（详情挂载示例）

## 13. 未决点（不阻塞设计交付，阻塞编码/验收）

1. **C13 具体文件授权与写窗口**（§8）：未授权前不改旧文件。
2. **C11（仅 MEMBER）**：MEMBER 能否按新增规则操作故事状态、是否扩展 `Action`（现 PM-only）；**VIEWER 维持现行只读，不列入待决**；其他票 C11 不外推。
3. **审计范围与事件一致性**（§7）：最小方案为仅真实 `status` 变化 + who/when/before/after；全字段审计/`action` 命名为可能扩项；写+审计原子性；事件端口未交付时的提交/失败策略（未接入 = 未完成，不作永久省略）。
4. **读路径选择**：新增 `board` 聚合读 vs 复用端点 10；候选 URL 与页面归属待公共骨架确认。
5. **地图/详情是否需要改动**：默认零改动；如需改动另提授权（超范围）。
6. **列内排序/条数上限**与精确计数展示细节。
7. **C12 协作人**仍待技术负责人/项目负责人确认；本票最小故事三列不引入任务协作人模型或据此扩大成员写权，C12 未定不阻塞最小只读方案。后续若卡片增加任务协作信息，须另确认字段、可见性与范围。

## 14. 估算与声明

- 估算**只归原 #25 的 4 人日**（`docs/plans/role-b-development.md:31`），**不额外重复 C/D 预算**；本设计文档不新增估算。
- 编码、公共挂载、旧文件写、运行验证**均需另行授权**（本地 `#17/#18/#19/#20`）。
- 本文为 **ROLE-B 单方 DRAFT**：**未宣称 C11/C13 已批准、接口已冻结或 AC 已通过**；未改其他文件/代码/任务清单/契约/`DECISIONS.md`，未 git 或远端写；可交用户审阅。

---

## 写路径实现状态（2026-10-19 追加；上文候选保留为历史）

- **唯一写路径**：端点 21 `PATCH /stories/:storyId`（`requirement.write`，**仅 PM**）—— 与设计一致，**未新建看板镜像写路径**；决策见 `DECISIONS.md` `permissions.story-status-write`（C11 裁定**不扩权**）。
- **审计**：状态**真实变化**时同事务写 `AuditLog`（`action='story.status'`、`objectType='story'`、`before`/`after` 为 `{"status":"…"}` JSON）；非状态字段编辑与空补丁不写审计（授权范围仅状态变更，见 `legacy.requirement-status-audit-authorization`）。
- **前端**：卡片三态下拉仅对 PM 渲染；写成功后重拉 `GET /projects/:projectId/board`；失败就近显示且不改本地状态。
- **跨视图一致**：写后故事地图 / 详情 / 看板读数一致（已实测）。
- **事件**：**未接线**（D 的 `#37` 未交付）—— 仅 `RequirementEventPort` 类型占位与写点事件名注释；因此「实时同步」当前靠各视图自然刷新。
- **仍未做**：拖拽交互；`web/src/routes.tsx` 的 board 注释已在本次更新；其余 8 个字段的审计属待确认扩项。
