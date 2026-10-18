/**
 * US-04 故事看板（GitHub #25，本地 #17）—— 本模块自有类型（只读批次）。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（技术负责人单写）。
 * 本模块只新增、不改共享契约；等接口正式并入契约时再由技术负责人决定是否上提。
 *
 * 依据：`docs/role-b-board-design.md` §3（列与卡片字段）、§4（读路径）、§6（权限矩阵）。
 * 响应字段由主代理冻结（前端并行按此实现，不得改字段名）。
 *
 * 口径声明：
 *   - 三列**固定**为 `DRAFT / PLANNING / DONE`（`STORY_STATUS_ORDER`），
 *     不新增自造列、不与任务六态混用；
 *   - 卡片为最小投影，**不含 `isSensitive`**：敏感过滤已在查询层完成（决策 I-6），
 *     不再向调用方回传敏感标记；
 *   - `count` 与 `items` 使用**同一 `where`** 的精确计数，超出上限只置 `truncated`。
 */
import type { StoryStatus } from '../../shared/types.js'

/** 计算基数标签：PM（`all`）→ `'全项目'`；MEMBER / VIEWER（`subset`）→ `'可见范围'`。 */
export type BoardScopeLabel = '全项目' | '可见范围'

/** 计算口径的显式声明：随响应一起返回，避免消费方自行猜测范围。 */
export type BoardBasis = {
  scopeLabel: BoardScopeLabel
}

/**
 * 看板列的**固定顺序**（列序即此数组顺序，前端不重排）。
 *
 * 与 `web/src/pages/requirement/terms.ts` 的 `STORY_STATUS_ORDER` 同值；
 * 本模块不 import 前端文件，故在此以字面量固定，供服务端组装列。
 */
export const BOARD_STATUS_ORDER: readonly StoryStatus[] = ['DRAFT', 'PLANNING', 'DONE']

/** 单列明细最多返回行数；超出只置 `truncated=true`，**不得**用 `items.length` 冒充 `count`。 */
export const BOARD_COLUMN_ROW_LIMIT = 200

/**
 * 看板卡片投影（**不含 `isSensitive`**）。
 *
 * `activityName` / `goalName` 供卡片副标题展示，经 Prisma include 直接取库
 * （不 import 其他模块 service，契约决策 I-9）。
 */
export type BoardCardItem = {
  id: string
  title: string
  priority: string
  status: StoryStatus
  /** 所在用户活动名（卡片副标题）。 */
  activityName: string
  /** 所在业务目标名（卡片副标题）。 */
  goalName: string
}

/** 单列：状态、精确计数、截断标记与明细。 */
export type BoardColumn = {
  status: StoryStatus
  /** 与 `items` 使用**同一 `where`** 的精确计数，不受上限影响。 */
  count: number
  /** 明细是否因达到 `BOARD_COLUMN_ROW_LIMIT` 被截断。 */
  truncated: boolean
  items: BoardCardItem[]
}

/** `GET /projects/:projectId/board` 的响应体（单资源，不套 `{ items }`）。 */
export type BoardView = {
  projectId: string
  basis: BoardBasis
  /** 固定三列，顺序恒为 `DRAFT, PLANNING, DONE`；空列也返回（`count=0, items=[]`）。 */
  columns: BoardColumn[]
}
