/**
 * US-06 甘特图（GitHub #26）—— 本模块自有类型。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（技术负责人单写）。
 * 本模块只新增、不改共享契约；等接口正式并入契约时再由技术负责人决定是否上提。
 *
 * 依据：`docs/role-b-gantt-design.md` §7（接口候选：`MilestoneView` / `TaskDependencyView` /
 * 两态 `Availability<T>`）。**本节只登记类型候选，不代表任何路由已注册或已冻结**。
 */
import type { UserBrief } from '../../shared/types.js'

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
