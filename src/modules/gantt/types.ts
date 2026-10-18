/**
 * US-06 甘特图（GitHub #26）—— 本模块自有类型。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（技术负责人单写）。
 * 本模块只新增、不改共享契约；等接口正式并入契约时再由技术负责人决定是否上提。
 *
 * 依据：`docs/role-b-gantt-design.md` §7（接口候选：`MilestoneView` / `TaskDependencyView` /
 * 两态 `Availability<T>`）。**本节只登记类型候选，不代表任何路由已注册或已冻结**。
 */
import type { StoryStatus, UserBrief } from '../../shared/types.js'

/**
 * 依赖 / 里程碑读取的两态包装（设计 §2、§7）。
 *
 * 只有两态：**有值**（`ok`）或**不可用**（`unavailable`）。绝不使用空数组冒充「确实没有」——
 * 依赖模型 / 运行时未接线前，`dependencies: []` 会被误读为「确实没有前置」。
 * 故 `unavailable` 分支的 `data` 固定为 `null`，并强制带上 `note` 说明原因。
 */
export type GanttAvailability<T> =
  | { state: 'ok'; data: T }
  | { state: 'unavailable'; note: string; data: null }

/** 本期依赖类型：仅 `'FS'`（设计 §4；其余取值由写入层拒绝，DB 不约束枚举）。 */
export type TaskDependencyType = 'FS'

/** 里程碑读取投影。字段与 `Milestone` 模型对齐，另附负责人简讯。 */
export type MilestoneView = {
  id: string
  projectId: string
  name: string
  /** 'YYYY-MM-DD'，自然日，Asia/Shanghai */
  dueDate: string
  /** 可选负责人；里程碑可无单独负责人 */
  ownerUserId: string | null
  owner: UserBrief | null
  createdAt: string
}

/** 任务间依赖边读取投影（本期仅 FS）。 */
export type TaskDependencyView = {
  id: string
  projectId: string
  predecessorTaskId: string
  successorTaskId: string
  type: TaskDependencyType
  createdAt: string
}

// ===========================================================================
// `GET /projects/:projectId/gantt` 聚合响应（主代理已冻结字段名，前后端并行按此实现）
// ===========================================================================

/** 汇总范围标签：PM = 全项目，MEMBER / VIEWER = 可见范围。 */
export type GanttScopeLabel = '全项目' | '可见范围'

/** 随响应返回的计算口径，避免消费方自行猜测范围。 */
export type GanttBasis = {
  scopeLabel: GanttScopeLabel
}

/** 故事日期汇总口径：固定候选 min/max（C10 未书面收口前只是候选，不是批准公式）。 */
export const GANTT_STORY_AGGREGATION = 'candidate-minmax' as const

/** 故事进度状态：C10 未确认 —— 本批不编造故事进度。 */
export const GANTT_STORY_PROGRESS_STATE = 'unconfirmed' as const

/** 甘特中的一行任务投影（**不含 `isSensitive`**：过滤已在查询层完成）。 */
export type GanttTaskItem = {
  id: string
  title: string
  /** DB 不约束枚举，按 `string` 收（TaskStatus 六态由写路径保证）。 */
  status: string
  planStart: string
  planEnd: string
  ownerUserId: string
  ownerDisplayName: string
  /** 该 actor 可见、且被本视图纳入的里程碑 id。 */
  milestoneIds: string[]
}

/** 故事行：任务以内联 `tasks` 展开。 */
export type GanttStoryItem = {
  id: string
  title: string
  status: StoryStatus
  /** 候选汇总：该 actor 可见任务的 min(planStart)；无可见任务时为 null。 */
  planStart: string | null
  /** 候选汇总：该 actor 可见任务的 max(planEnd)；无可见任务时为 null。 */
  planEnd: string | null
  aggregation: typeof GANTT_STORY_AGGREGATION
  /** C10 未确认 → 恒为 null，不编造故事进度。 */
  progress: null
  progressState: typeof GANTT_STORY_PROGRESS_STATE
  tasks: GanttTaskItem[]
}

/** 里程碑读取投影。负责人可空（里程碑可无单独负责人）。 */
export type GanttMilestoneItem = {
  id: string
  name: string
  /** 'YYYY-MM-DD'，自然日，Asia/Shanghai */
  dueDate: string
  ownerUserId: string | null
  ownerDisplayName: string | null
  /** 仅含该 actor 可见的任务 id。 */
  taskIds: string[]
}

/** 任务间依赖边（本期仅 FS）。 */
export type GanttDependencyItem = {
  id: string
  predecessorTaskId: string
  successorTaskId: string
  type: TaskDependencyType
}

/**
 * 依赖区两态包装：`ok`（`items` 可为空数组 = 确实没有依赖）/ `unavailable`
 * （取不到依赖，`data` 恒为 `null` 且带 `note`）。
 *
 * 本批数据源（`TaskDependency` 表）始终可用，故**一律返回 `ok`**，不造假 `unavailable`。
 */
export type GanttDependencies =
  | { state: 'ok'; items: GanttDependencyItem[] }
  | { state: 'unavailable'; note: string; data: null }

/** 各集合是否因达到上限被截断；为真时不得用行数反推总数。 */
export type GanttTruncated = {
  tasks: boolean
  milestones: boolean
  dependencies: boolean
}

/** `GET /projects/:projectId/gantt` 的响应体。 */
export type GanttView = {
  projectId: string
  basis: GanttBasis
  stories: GanttStoryItem[]
  milestones: GanttMilestoneItem[]
  dependencies: GanttDependencies
  truncated: GanttTruncated
}
