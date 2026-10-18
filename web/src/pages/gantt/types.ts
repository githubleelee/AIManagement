/**
 * US-06 甘特图（GitHub #26）—— 本页的**只读视图类型**。
 *
 * 依据：`docs/role-b-gantt-design.md` §4（FS 语义）、§5（故事汇总边界）、
 * §6（可见性与计数）、§7（接口候选）。字段名按**主代理已冻结的后端契约**书写，
 * 前端只读、不改字段名。
 *
 * ===========================================================================
 * 为什么不直接复用 `src/modules/gantt/types.ts`
 * ===========================================================================
 *
 * 基线 `src/modules/gantt/types.ts` 只有 `MilestoneView` / `TaskDependencyView` /
 * `GanttAvailability<T>` 三个**候选**投影，且 `GanttAvailability` 用 `data` 承载值；
 * 而冻结契约的响应是**整页聚合投影** `GanttView`，依赖包装用 `items` 承载值。
 * 两者形状不一致（后端并行实现中，`src/**` 本票禁止修改），故这里按冻结契约
 * 本地声明。若后端最终把类型上提到 `src/modules/gantt/types.ts`，应改为 re-export
 * 以避免"同一件事两份定义"漂移。
 *
 * 口径提醒：
 *   - 故事**无独立计划日期字段**，`planStart/planEnd` 是候选汇总口径
 *     （`aggregation: 'candidate-minmax'`，待 C10 收口），故界面必须标注
 *     「候选汇总口径（待确认）」；`progress` 恒为 `null`、
 *     `progressState === 'unconfirmed'`，**不得**显示为 0% 或任何进度。
 *   - `dependencies` 是**两态**：`ok`（有值，可能为空数组）或 `unavailable`
 *     （取不到依赖，`data` 为 `null`）。**绝不**用空数组冒充「确实没有依赖」。
 *   - `truncated` 为真时，对应集合被截断，**不得**用 `items.length` 反推总数。
 */
import type { StoryStatus } from '../../../../src/shared/types'

/** 故事状态沿用 `StoryStatus` 三态，不新造排期状态（设计 §1）。 */
export type GanttStoryStatus = StoryStatus

/** 汇总范围标签（线上值即中文，界面直接展示）。 */
export type GanttScopeLabel = '全项目' | '可见范围'

/** 甘特中的一行任务投影（**不含敏感标记**，过滤在服务端查询层完成）。 */
export type GanttTask = {
  id: string
  title: string
  /** 基线 DB 不约束枚举，故按 `string` 收，展示层做已知映射 + 兜底。 */
  status: string
  /** 'YYYY-MM-DD'，自然日，Asia/Shanghai */
  planStart: string
  planEnd: string
  ownerUserId: string
  ownerDisplayName: string
  milestoneIds: string[]
}

/** 故事行：其任务以 `tasks` 内联，展开即显示（不再单独请求故事任务端点）。 */
export type GanttStory = {
  id: string
  title: string
  status: GanttStoryStatus
  /** 候选汇总（min(planStart) ~ max(planEnd)），无有效任务日期时为 null。 */
  planStart: string | null
  planEnd: string | null
  /** 汇总口径：固定候选 min-max，未获书面收口前只是候选（设计 §5）。 */
  aggregation: 'candidate-minmax'
  /** 故事进度**未确认**：恒为 null。 */
  progress: null
  progressState: 'unconfirmed'
  tasks: GanttTask[]
}

/** 里程碑读取投影。负责人可空（里程碑可无单独负责人）。 */
export type GanttMilestone = {
  id: string
  name: string
  /** 'YYYY-MM-DD'，自然日，Asia/Shanghai */
  dueDate: string
  ownerUserId: string | null
  ownerDisplayName: string | null
  taskIds: string[]
}

/** 任务间依赖边（本期仅 FS）。 */
export type GanttDependency = {
  id: string
  predecessorTaskId: string
  successorTaskId: string
  type: 'FS'
}

/**
 * 依赖区两态包装（设计 §2、§7）：
 *   - `ok`：拿到依赖（`items` 可能为空数组 = 确实没有依赖）；
 *   - `unavailable`：**取不到**依赖数据，`data` 恒为 `null`，`note` 说明原因。
 */
export type GanttDependencies =
  | { state: 'ok'; items: GanttDependency[] }
  | { state: 'unavailable'; note: string; data: null }

/** 各集合是否被截断；为真时计数只是下界，不得当总数。 */
export type GanttTruncated = {
  tasks: boolean
  milestones: boolean
  dependencies: boolean
}

/** 随响应返回的计算口径。 */
export type GanttBasis = {
  scopeLabel: GanttScopeLabel
}

/** `GET /projects/:projectId/gantt` 的响应。 */
export type GanttView = {
  projectId: string
  basis: GanttBasis
  stories: GanttStory[]
  milestones: GanttMilestone[]
  dependencies: GanttDependencies
  truncated: GanttTruncated
}
