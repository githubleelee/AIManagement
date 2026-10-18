/**
 * US-08 个人工作台（工单 #28）—— 本模块自有类型。
 *
 * 为什么不放进 `src/shared/types.ts`：那是冻结文件（技术负责人单写）。
 * 本模块只新增、不改共享契约；等接口正式并入契约时再由技术负责人决定是否上提。
 * 明细行**复用共享类型 `TaskView`**，这样前端可以直接用既有的任务展示组件。
 */
import type { TaskView } from '../../shared/types.js'

/** 工作台固定 5 块的标识（工单 AC1）。 */
export type WorkbenchBlockKey = 'todo' | 'overdue' | 'accept' | 'mention' | 'upcoming'

/**
 * 一块的数据状态。
 *
 * `unavailable` 是刻意存在的第三态：数据源还没交付时**不能**用 `0` 冒充"没有"——
 * 那会把"取不到"说成"没有数据"（本仓库前端审查已把这类混淆列为问题）。
 */
export type WorkbenchBlockState = 'ok' | 'unavailable'

export type WorkbenchBlock = {
  key: WorkbenchBlockKey
  state: WorkbenchBlockState
  /** `state='ok'` 时为精确总条数；`unavailable` 时为 `null`。 */
  total: number | null
  /** 明细（最多 `ROWS_PER_BLOCK` 条）；`unavailable` 时为空数组。 */
  rows: TaskView[]
  /** `state='unavailable'` 时说明原因，面向界面直接显示。 */
  note?: string
}

/**
 * 计算口径的**显式声明**：随响应一起返回，避免界面、审查、测试对
 * "未关闭""逾期""近期"各说各话。
 */
export type WorkbenchBasis = {
  /** 计算时使用的"今天"（按口径时区 **Asia/Shanghai** 的 `YYYY-MM-DD`） */
  asOf: string
  /** 「我的待办」的含义 */
  todoMeans: string
  /** 「逾期」的判定口径 */
  overdueMeans: string
  /** 「近期计划」的窗口天数 */
  upcomingWindowDays: number
  /** 与六状态相关的说明（本票最终验收的前置条件） */
  sixStatesNote: string
}

export type WorkbenchView = {
  blocks: WorkbenchBlock[]
  basis: WorkbenchBasis
}
