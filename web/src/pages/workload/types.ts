/**
 * US-07 成员任务图与负载（GitHub #27）—— 本页的**只读视图类型**。
 *
 * 依据：`docs/role-b-workload-design.md` §4 的字段契约 + §7 的页面方案。
 *
 * ===========================================================================
 * 为什么这里**复用后端类型**而不是各写一份
 * ===========================================================================
 *
 * 后端已落地 `src/modules/workload/types.ts`（本模块只新增、未改共享契约）。
 * "同一件事两份定义就会漂移"是本仓库登记过的问题；验收页（US-09）为了防漂移
 * 专门写了一个 `shared-types.typecheck.ts` 做编译期形状断言。本票直接在 `types.ts`
 * 里把后端类型**按前端习惯重命名后 re-export**（全部 `import type`，构建时擦除、
 * 不进 Vite 产物），于是前后端形状**在类型层面就是同一个**，天然不会漂移，
 * 也无需再多一个断言文件。
 *
 * 口径提醒（设计 §4 / §6）：
 *   - `openTaskCount` 是**非 CLOSED 负载**（含 DONE），不是"全项目任务人口"。
 *   - `basis.scopeLabel` 按受众不同：PM = 「全项目」，MEMBER/VIEWER = 「可见范围」。
 *   - 单成员明细的 `total` 是精确条数；`items` 最多前 200 条，
 *     `truncated=true` 时**不得**用 `items.length` 反推总数。
 */
import type {
  MemberTaskItem as ServerMemberTaskItem,
  MemberWorkloadDetailView as ServerMemberWorkloadDetailView,
  MemberWorkloadRow as ServerMemberWorkloadRow,
  ProjectWorkloadView as ServerProjectWorkloadView,
  WorkloadBasis as ServerWorkloadBasis,
  WorkloadScopeLabel as ServerWorkloadScopeLabel,
} from '../../../../src/modules/workload/types'

/** 负载计算的范围标签（线上值即中文，界面直接展示）。 */
export type WorkloadScopeLabel = ServerWorkloadScopeLabel

/** 服务端随响应返回的计算口径。最小实现只需要范围标签。 */
export type WorkloadBasis = ServerWorkloadBasis

/** 项目成员负载总览的一行。成员来自 ProjectMember，角色不自造。 */
export type MemberWorkloadRow = ServerMemberWorkloadRow

/** `GET /projects/:projectId/workload` 的响应。 */
export type WorkloadView = ServerProjectWorkloadView

/** 单成员未关闭任务清单的一行（**不含敏感标记**，过滤在服务端查询层完成）。 */
export type MemberTaskItem = ServerMemberTaskItem

/** `GET /projects/:projectId/workload/:userId` 的响应。 */
export type MemberWorkloadView = ServerMemberWorkloadDetailView
