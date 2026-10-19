/**
 * US-04 故事看板（GitHub #25）—— 本页的**只读视图类型**。
 *
 * 依据：`docs/role-b-board-design.md` §3（列与卡片字段）、§7（页面方案）。
 * 字段名按**主代理已冻结的后端契约**书写，前端只读、不改字段名：
 *
 *   GET /projects/:projectId/board →
 *     { projectId, basis: { scopeLabel }, columns: [{ status, count, truncated, items[] }] }
 *
 * ===========================================================================
 * 为什么这里**复用后端类型**而不是各写一份
 * ===========================================================================
 *
 * 后端已落地 `src/modules/board/types.ts`（与冻结契约同形）。"同一件事两份定义就会
 * 漂移"是本仓库登记过的问题；验收页（US-09）曾为此专门写编译期形状断言。本票直接
 * 把后端类型**按前端习惯重命名后 re-export**（全部 `import type`，构建时擦除、
 * 不进 Vite 产物），于是前后端形状**在类型层面就是同一个**，天然不会漂移。
 * 范式与 `pages/workload/types.ts` 一致。
 *
 * 口径提醒（设计 §3 / §4 / §6）：
 *   - 故事状态**只有三态** `DRAFT / PLANNING / DONE`（`src/shared/types.ts:32`），
 *     与任务六态（TODO/DOING/...）**不得混用**；列序与标签复用需求模块 `terms.ts`。
 *   - `count` 是**精确值**；`items` 可能被截断（`truncated === true`，上限见后端
 *     `BOARD_COLUMN_ROW_LIMIT`），**不得**用 `items.length` 反推总数。
 *   - `basis.scopeLabel` 为「可见范围」时，列表与计数都只含当前账号有权查看的对象，
 *     **不代表项目全量基数**。
 *   - 卡片为最小投影，**不含敏感标记**：敏感过滤在服务端查询层完成。
 */
import type {
  BoardBasis as ServerBoardBasis,
  BoardCardItem as ServerBoardCardItem,
  BoardColumn as ServerBoardColumn,
  BoardScopeLabel as ServerBoardScopeLabel,
  BoardView as ServerBoardView,
} from '../../../../src/modules/board/types'
import type { StoryStatus } from '../../../../src/shared/types'

/** 看板计算范围标签（线上值即中文，界面直接展示）。 */
export type BoardScopeLabel = ServerBoardScopeLabel

/** 服务端随响应返回的计算口径。最小实现只需要范围标签。 */
export type BoardBasis = ServerBoardBasis

/** 看板卡片：故事最小投影（**不含敏感标记**，过滤在服务端查询层完成）。 */
export type BoardStoryCard = ServerBoardCardItem

/** 看板一列（一个故事状态）。`items` 最多前 N 条，`count` 为精确总数。 */
export type BoardColumn = ServerBoardColumn

/** `GET /projects/:projectId/board` 的响应。 */
export type BoardView = ServerBoardView

/**
 * 故事三态（本页状态选择的取值域）。
 *
 * 直接复用 `src/shared/types.ts` 的 `StoryStatus`：它与 `GoalStatus`（ACTIVE/DONE）、
 * `TaskStatus`（六态）**不可互换**（决策 I-1 的三 DONE 陷阱）。写入口只提交这三个值。
 */
export type StoryStatusValue = StoryStatus
