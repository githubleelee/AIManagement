/**
 * US-06 甘特图（GitHub #26）—— 本模块自有类型。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（技术负责人单写）。
 * 本模块只新增、不改共享契约；等接口正式并入契约时再由技术负责人决定是否上提。
 *
 * 依据：`docs/role-b-gantt-design.md` §7（接口候选：`MilestoneView` / `TaskDependencyView` /
 * 两态 `Availability<T>`）。**本节只登记类型候选，不代表任何路由已注册或已冻结**。
 */
import type { Prisma } from '@prisma/client'
import type { StoryStatus, UserBrief } from '../../shared/types.js'
import type { EventActor, EventObjectRef, JsonObject } from '../../shared/events.js'
// ★ 只 import **类型**（不改 `analytics/**`）：故事进度的形状必须与仪表盘一致，
//   复制一份本地类型等于给「同一个进度」留两处定义，迟早漂移。
import type { ProjectProgress } from '../analytics/types.js'

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
// 写路径 DTO（`docs/role-b-gantt-design.md` §4.2 写入时校验 + §7 候选端点）
// ===========================================================================

/** 里程碑名称长度上限（与其它业务对象一致，超长 → Zod `TOO_LONG`）。 */
export const MILESTONE_NAME_MAX_LENGTH = 100

/**
 * 里程碑写响应：读取投影 + 关联任务 id。
 *
 * `taskIds` 按任务 `createdAt asc, id asc` 稳定排序（不依赖关联行的插入顺序）。
 */
export type MilestoneWriteView = MilestoneView & { taskIds: string[] }

/** `POST /projects/:projectId/milestones` 请求体。 */
export type MilestoneCreateInput = {
  name: string
  /** 'YYYY-MM-DD'；除格式外还须是**真实存在**的自然日（`2026-02-30` 由服务层拒绝）。 */
  dueDate: string
  /** 可选负责人；给定则必须是本项目成员。 */
  ownerUserId?: string | null
  /** 可选关联任务；每个都必须属于本项目，重复 id 去重。 */
  taskIds?: string[]
}

/**
 * `PATCH /milestones/:milestoneId` 请求体（部分更新）。
 *
 * `taskIds` **出现即整体替换**关联集（含 `[]` = 清空）；不出现则不动关联。
 */
export type MilestonePatchInput = {
  name?: string
  dueDate?: string
  ownerUserId?: string | null
  taskIds?: string[]
}

/** `POST /projects/:projectId/task-dependencies` 请求体（线上原文，`type` 由服务层收窄）。 */
export type TaskDependencyCreateInput = {
  predecessorTaskId: string
  successorTaskId: string
  /** 缺省视为 `'FS'`；其余取值由服务层拒绝（422 `VALIDATION_FAILED` / field `type` / `INVALID_VALUE`）。 */
  type?: string
}

// ===========================================================================
// 事件端口（#37 公共事件基础设施已合入，本批接线）
// ===========================================================================

/**
 * 甘特域事件名（命名规范 `<domain>.<object>.<action>`，已登记于
 * `src/shared/events.ts` 的「业务域事件目录」）。
 */
export type GanttMilestoneEventName =
  | 'gantt.milestone.created'
  | 'gantt.milestone.updated'
  | 'gantt.milestone.deleted'

export type GanttDependencyEventName =
  | 'gantt.dependency.created'
  | 'gantt.dependency.deleted'

export type GanttEventName = GanttMilestoneEventName | GanttDependencyEventName

/**
 * 域内事件草稿：**不含** `id` / `schemaVersion` / `storedAt` / `idempotencyKey`。
 *
 * 后四者由模块内适配器（`./event-port.ts`）负责补齐：`id` / `storedAt` 由适配器的
 * `newId` / `now` 注入（可被测试覆盖），`idempotencyKey` 按确定性规则计算。
 *
 * 判别联合要求：**敏感分支的载荷只能是 `references`**，不得含任务标题 / 描述 / 正文
 * （契约 I-6；否则 `src/db/event-repository.ts` 的查询层过滤看不到它）。
 * `sensitive` 的判定在写路径的**同一事务内**查 `Task.isSensitive` 得出（见 `./write.ts`）。
 */
type GanttEventDraftBase = {
  eventName: GanttEventName
  projectId: string
  object: EventObjectRef
  actor: EventActor
  /** ISO 8601 UTC（带毫秒，`…Z`）。 */
  occurredAt: string
}

export type GanttEventDraft =
  | (GanttEventDraftBase & { sensitive: false; payload: JsonObject })
  | (GanttEventDraftBase & { sensitive: true; payload: { references: EventObjectRef[] } })

/**
 * 甘特域业务事件的发布端口。
 *
 * 接线方式：由 `./plugin.ts` 从 `RouteContext.ganttEvents` 取得（`src/app.ts` 用
 * `createGanttEventPort` 显式组装），缺失即 fail-fast；**不 new no-op 实现、不静默跳过**。
 *
 * 语义：必须在业务写入的**同一个 `$transaction` 内**调用，`transaction` 即该事务的
 * `tx`；适配器把事件追加到该事务（`appendIfAbsent(event, tx)`），**不自行提交、不派发
 * 订阅者**。发布失败 = 同一事务回滚业务写入（刻意：宁可业务失败，不丢事件）。
 */
export type GanttEventPort = {
  publish(event: GanttEventDraft, transaction: Prisma.TransactionClient): Promise<void>
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

/**
 * 故事日期汇总口径：固定候选 min/max。
 *
 * ★ C10 只收口了**进度**（DECISIONS `analytics.story-progress-aggregation`），
 *   **日期**仍是候选口径，故本常量保持 `'candidate-minmax'`，不改写成「已确认」。
 */
export const GANTT_STORY_AGGREGATION = 'candidate-minmax' as const

/**
 * 故事进度状态：`'computed'` = 已按 C10 口径算出（`analytics.story-progress-aggregation`）。
 *
 * 取值不再是 `'unconfirmed'`：口径已书面批准，故状态表达「已计算」而不是「未确认」。
 * 注意「已计算」≠「一定有数」：故事下没有可见任务时 `progress` 仍为 `null`。
 */
export const GANTT_STORY_PROGRESS_STATE = 'computed' as const

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
  /**
   * 故事进度：**沿用仪表盘 `ProjectProgress` 的形状与取整规则**（`closed` / `total` /
   * `ratio`，`ratio` 保留 4 位小数），不另立第二套表达 —— 这样同一账号同一时刻、
   * 对同一任务集合，本字段与 `GET /projects/:projectId/dashboard` 的 `progress` 必然相等。
   *
   * - 统计集合 = 本故事**可见任务集合**（与上面 `planStart` / `planEnd` 的汇总同一集合）；
   * - 分子只计 `status === 'CLOSED'`，**`DONE` 不计入**；
   * - **无可见任务 → `null`**（不显示 0%，沿用「算不出来就不编数字」）。
   */
  progress: ProjectProgress | null
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
