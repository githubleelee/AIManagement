# Sprint 3 · ROLE-B 接续执行记录

- 基线：`origin/main@8018c6407a7dd2041e3ba8c56f55c69b88e30228`。
- 分支：`feat/sprint3-role-b-remaining`；隔离 worktree：`/home/lee/aim-wt/b-sprint3-remaining`。
- 开始：2026-10-24，Asia/Shanghai。原工作区历史未提交材料保持不变。
- 范围依据：`product-backlog.md`、`role-c/issue-32-public-interface-handoff.md`、`DECISIONS.md` 最新适用条目。历史 `tasks/role-b-development.md` 不作为当前缺口判断依据。
- 用户要求：A 作为 PM/SM 管控，B 开发剩余内容；阻塞和未对齐事项向 A 留言，不代替 A/C/D 确认或实现其业务。

## 执行拆分

| 项 | 当前状态 | 范围 / 交付条件 |
|---|---|---|
| S3-B-01 | 已交 PR #123，待 A 复核 | PB-01：tx-aware 授权、SCHEDULING 专项 PM-only 读/审计、统一日期写端口、成功审计和事务外最小失败证据。不得改变通用 AI 读取/审计权限，不新增未经确认的 Action。 |
| S3-B-02 | 已交 PR #123，待 A 复核 | PB-01：C 工厂后端正式注册、依赖注入；前端 SchedulingPage 的正式路由/导航与身份切换隔离。保留服务端逐请求鉴权，不用 demo 入口。 |
| S3-B-03 | 依赖已进 main | PB-01：D 的 SCHEDULING 模型端口已独立评审（无高危/阻断项）及定向验证（61例、两端typecheck）；PM 已合 `33e03ca`，当前 main `4dbd1ba`。B 接续注入，不再等D交付；真实供应商/凭据未选仍显式不可用，不声称真实大模型验收。 |
| S3-B-04 | B 范围验证通过，C 最终门禁另行接续 | B 装配的真实 HTTP/SQLite、PM/MEMBER/VIEWER/outsider、撤权重试、事务回滚和前端正式入口。C 的 12 个最终门禁仍由 C 收口，不用 fixture 代签。 |
| S3-B-05 | 等交接 / 裁定 | PB-06 任务锚点由 C 提交、B 最小挂载；PB-09 里程碑可见性维持现有 fail-closed，变更先由负责人裁定。 |

## 沟通与阻塞

| 时间（Asia/Shanghai） | 对象 | 记录 / 下一步 |
|---|---|---|
| 2026-10-24 | A（PM/SM） | [#20 开工登记与阻塞确认](https://github.com/githubleelee/AIManagement/issues/20#issuecomment-6382514462)：核对 Sprint3 额外范围、公共文件在途写锁、模型归属、锚点和里程碑口径。尚未取得回复，不冒充已放行。 |
| 2026-10-24 | D 交付 | 发现 [PR #122](https://github.com/githubleelee/AIManagement/pull/122)，从 `8018c64` 起，尚在独立评审/验证。先前“D 没有排期端口”的描述仅适用于 main，不适用于该新候选。[已同步 A](https://github.com/githubleelee/AIManagement/issues/20#issuecomment-6382546577)。 |
| 2026-10-24 | A（前端 URL） | 现有材料明确 URL 未冻结；[请求确认唯一候选 `/projects/:projectId/scheduling`](https://github.com/githubleelee/AIManagement/issues/20#issuecomment-6382556649)。wrapper 可先做，路由/导航/文档待回复；不能把后端路由已交付当作前端 URL 已批准。 |
| 2026-10-24 | C（#32） | [接续回执与装配矩阵](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6382552813)，尚无新 SHA，不宣称可联调。 |
| 2026-10-24 | C / A（#120） | [剩余事项与文件窗口矩阵](https://github.com/githubleelee/AIManagement/issues/120#issuecomment-6382561495)：UML/FS 已进 main，不重复等待；附件两处消费和任务锚点由 C 在 task/TaskSection 窗口推进，B 本批不占这两个文件。 |

## 边界

- `PB-02` 是 C 的正式装配后 API/浏览器门禁；`PB-03` 是 A 的分析业务；`PB-04/PB-05` 的任务生产点和附件消费接线属于 C，B 不接管。
- **本轮纠正**：附件公共层已由 PM 合入 `6d4cfbc`（最新 main `4dbd1ba`），此前 `f516b20`“仅候选未合”的状态已过期。C 两处真实消费接线仍未完成，但它们**不阻塞 B 的 #32 装配**。B 不重复开发已交付公共层或 workload/gantt/board/UML。
- 不自动合并 PR、关闭工单或修改标签；不跑全仓测试。定向测试、真实生产装配、合成模型传输、外部真实模型证据分别登记。
- 当前记录只表示开工和依赖事实，不代表任何 AC/DoD 已通过。

## 解除 #32 / #36 循环等待（用户转达 PM 诊断后，2026-10-24）

已 fetch 核对 `origin/main@4dbd1ba`：D 模型 `33e03ca`、附件公共层 `6d4cfbc` 均已合入。开工基线仍保留上方原始 SHA，本地在途代码尚未宣称已整合新 main。

| 执行道 | 负责人 / 文件窗口 | 现在可做 | 唯一真实等待关系 |
|---|---|---|---|
| #36 附件消费 | C：`src/modules/task/routes.ts`、必要本域测试、`web/src/pages/task/TaskSection.tsx`；B 本批不占用，也不修改 task/rules.ts | DELETE 原事务内标记、提交后清理及可观测失败；正式面板挂载 | 消费 main 已有生命周期端口；**不等 #32**。如有现写者冲突只报具体文件，不重新等待整票。 |
| #32 四项装配 | B：app/routes、公共授权/日期/审计适配、前端骨架与路由文档；不接管 C 文件 | 后端端口、七条正式路由、专项授权与审计、正式页面 | **不等 #36**。前端 URL 确认仅限制路由/导航命名，不限制后端或 C 附件。 |
| #32 正式闭环 / 12 门禁 | C | B 交真实装配 SHA 后取证 | 只等待该装配 SHA/配置，**不要求附件整票完成**。 |
| 各道独立复核 | A（PM/SM、DRI） | 任一道先交付即独立收口 | 不以另一票完成为验收前置；不降低原 AC/DoD。 |

回执：
- [#120 双道拆分、窗口与依赖更正](https://github.com/githubleelee/AIManagement/issues/120#issuecomment-6382741186)。
- [#20 向 A 登记 DRI 执行计划](https://github.com/githubleelee/AIManagement/issues/20#issuecomment-6382744246)。
- [#36 向 C 明确消费窗口无需等待排期](https://github.com/githubleelee/AIManagement/issues/36#issuecomment-6382747647)。

B 已解除自己施加的跨票等待，继续自己文件内的实现；**尚未取得 A/C 本轮回执，不将发消息冒充对方已开工或问题全链路已关闭**。

## 本轮收尾（2026-10-24 18:46 Asia/Shanghai）

- 隔离分支已实际快进 `4dbd1ba` 并保留 PM 已合的附件公共层和 D 模型，不是仅描述计划；B 未修改 task/routes、task/rules、TaskSection。
- 用户通过单题确认正式 URL；路由/导航已挂，见 `DECISIONS.md` `scheduling.frontend-route`，[已同步 A](https://github.com/githubleelee/AIManagement/issues/20#issuecomment-6382918475)。
- 用户另行授权只修 `src/modules/ai-scheduling/workflow.db.test.ts` 测试装配的双注册，原 24 条断言保留；[已同步 A/C 窗口](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6383157225)。未扩到 C 业务或 test helper。
- 最终独立定向验证：B 生产装配 **12/12**，共享仓储 **20/20**，C 排期模块 **173 passed / 12 TODO**；server/web typecheck exit 0，`build:web` exit 0。中间两轮失败的原 stdout 保留；不跑全仓、不代 C 勾 12 门禁。
- 主控真实浏览器完成 PM 正式入口/无配置失败态、MEMBER/VIEWER 不加载排期、outsider 项目隔离；[证据](ai-records/B/issue-32/evidence/B-I32-20261024-s3-browser.md)。成功日期处置的证据是独立 HTTP/SQLite + 明确合成模型，未冒充浏览器或真实外部 AI。
- 用户已明确授权提交、推送独立分支并创建 PR；**不合 main、不关票、不改 C 验收状态**。实际 SHA/PR 发布后追加。
- 详细装配端口、配置、边界与交接见 [生产装配交接](role-b-scheduling-production-handoff.md)。

### 追加实际交付（2026-10-24 18:59 Asia/Shanghai）

- 源提交 `039d0ede39f8a8e3930ea6e7bb42501de9673da7` 已实际推送，GitHub API 回读 ref 一致；[PR #123](https://github.com/githubleelee/AIManagement/pull/123) 已创建，未合 main。
- [向 C 交确切 SHA/端口/配置](https://github.com/githubleelee/AIManagement/issues/32#issuecomment-6383376476)、[向 A 交 DRI 复核入口](https://github.com/githubleelee/AIManagement/issues/20#issuecomment-6383379885)、[#120 双道执行回执](https://github.com/githubleelee/AIManagement/issues/120#issuecomment-6383383774)。不再是“B 只有本地代码/无 SHA”；C 可基于分支接续，不等附件整票。
- B 的 `workflow.db.test.ts` 单文件修正窗口结束并交回 C；task/TaskSection 窗口仍不占用。A/C 尚未回本轮最终验收，不冒充对方已通过。
- 推送出现 Windows 凭据助手对 Linux worktree 路径的警告，但命令 exit 0；独立 API 确认远端提交成功，未把该警告隐去，也未误记为推送失败。
- D 模型非阻断跟进已[回交原 owner](https://github.com/githubleelee/AIManagement/pull/122#issuecomment-6383299717)，不占其业务文件、不成为附件前置。
- 后续提交只补发布回执文档，不改变上述已验证源代码。
