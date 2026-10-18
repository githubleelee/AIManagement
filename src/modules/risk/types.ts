/**
 * US-10 风险与项目关闭阻断（工单 #30）—— 类型。
 *
 * 本文件分两部分：
 *   ① **已实现**：关闭阻断校验视图（`closure.ts` 用它）—— 任务侧已可算，风险侧待 `Risk` 表落地。
 *   ② **仅设计**：`Risk` 的枚举与视图（三级 / 四态）。它们目前**没有对应的表**，
 *      落地需 `schema.prisma` 授权（申请见 #24）。**不要**在实现里当成已接通。
 *
 * 为什么不放进 `src/shared/types.ts`：冻结文件（技术负责人单写），本模块只新增。
 */
import type { TaskView, UserBrief } from '../../shared/types.js'

/* ===========================================================================
 * ① 关闭阻断（已实现部分）
 * =========================================================================== */

/**
 * 关闭判定。
 *
 * **三态是刻意的**（沿用本仓库"不用 0 冒充没有"的纪律）：
 *   - `blocked`：**确定不能关**（已有未关闭任务 —— 阻断条件是"或"，任务侧成立就成立）；
 *   - `clear`：**确定能关**（两侧都判过、都没阻断）；
 *   - `unavailable`：**判不了**（任务侧没阻断，但风险侧还没接上 ⇒ 不敢说"能关"）。
 *
 * 现状只会出现 `blocked` 与 `unavailable` 两种：`Risk` 表尚未落地。
 * 若将来有人把它一律返回 `clear`，就等于"在缺一半数据的情况下给项目放行"。
 */
export type ClosureVerdictState = 'blocked' | 'clear' | 'unavailable'

export type ClosureVerdict = {
  state: ClosureVerdictState
  /** `blocked` → false；`clear` → true；`unavailable` → null（不是 false，也不是 true） */
  canClose: boolean | null
  /** 面向界面直接显示的说明 */
  note: string
}

/**
 * 阻断清单的一侧。
 *
 * `unavailable` 表示"这一侧还没接上"，此时 `total` 为 `null` —— **不是 0**。
 */
export type BlockingSide<T> = {
  state: 'ok' | 'unavailable'
  total: number | null
  rows: T[]
  note?: string
}

export type ClosureCheckView = {
  project: { id: string; name: string }
  verdict: ClosureVerdict
  /** 未关闭的任务（`status != CLOSED`）；已按可见性作用域过滤 */
  blockingTasks: BlockingSide<TaskView>
  /** 未处理 / 处理中 的风险；`Risk` 表落地前恒为 `unavailable` */
  blockingRisks: BlockingSide<RiskView>
  basis: ClosureBasis
}

export type ClosureBasis = {
  asOf: string
  /** 基数口径（C6）：PM = global，其余 = visible */
  scope: 'global' | 'visible'
  blockingMeans: string
  /** 风险侧现状的显式声明，避免界面把"没接上"读成"没有风险" */
  riskSideNote: string
  /** 关闭动作本身的授权现状（不在这里判，只如实说明） */
  closeActionNote: string
}

/* ===========================================================================
 * ② 风险台账（**仅设计，未接线** —— 需 schema 授权后落地）
 * =========================================================================== */

/** 风险等级：高 / 中 / 低（handoff §9）。 */
export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export const RISK_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
}

/**
 * 风险状态：未处理 / 处理中 / 已解决 / 已关闭（handoff §9）。
 *
 * 流转口径（人工 2026-10-18 拍板）：**PM 可任意流转（含重开），member 只读，
 * 每次变更写 AuditLog**。即不强制"只能前进"，因此不建模成单向状态机。
 */
export type RiskStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export const RISK_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  OPEN: '未处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
}

/**
 * **会阻断项目关闭**的风险状态。
 *
 * 依据 handoff §9：「存在未关闭任务或**未处理 / 处理中**风险时阻止项目关闭」
 * —— 因此 `RESOLVED` 与 `CLOSED` 不阻断。
 */
export const BLOCKING_RISK_STATUSES: readonly RiskStatus[] = ['OPEN', 'IN_PROGRESS']

/** 风险视图（**设计稿**：`Risk` 表落地后由 `src/modules/risk/` 返回这种形状）。 */
export type RiskView = {
  id: string
  projectId: string
  title: string
  description: string | null
  level: RiskLevel
  status: RiskStatus
  ownerUserId: string
  /** 负责人展示信息（避免界面再查一次用户） */
  owner: UserBrief
  /** 可选：关联任务。用于**继承该任务的敏感可见性**（批复第 6 项，不新建 risk 敏感类型） */
  taskId: string | null
  /** 解决说明；状态为 `RESOLVED` / `CLOSED` 时必填 */
  resolution: string | null
  createdAt: string
  updatedAt: string
}
