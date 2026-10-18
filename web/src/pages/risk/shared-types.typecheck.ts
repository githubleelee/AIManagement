/**
 * US-10 前端侧的**编译期断言**（工单 #30）—— 同时覆盖仪表盘页与风险台账页。
 *
 * 背景：web 侧按 `docs/frontend-routes.md` 的约定不直接引后端模块的运行时导出，
 * 界面类型在各自 `api.ts` 里声明一份；两份定义会漂移（本仓库已把"同一件事两份实现"
 * 列为问题）。这里用 `import type`（构建时擦除、不进产物）把两边钉成**双向可赋值**：
 * 服务端改了字段名 / 加字段 / 改可空性，本文件立刻编译失败。
 *
 * 与 US-09 的 `pages/acceptance/shared-types.typecheck.ts` 同构，只是本票两个页面
 * 合在一处（一个文件覆盖 dashboard + risk + closure 三组类型，便于一次看全）。
 *
 * 文件名不以 `.test.ts` 结尾、也不被任何模块 import ⇒ 不进 Vitest、不进 Vite 产物，
 * 只由 `npm run typecheck` 检查。
 */
import type { TaskStatus } from '../../../../src/shared/types'
import type {
  ProjectDashboardView as ServerDashboard,
  HealthState as ServerHealthState,
} from '../../../../src/modules/analytics/types'
import type {
  RiskView as ServerRiskView,
  ClosureCheckView as ServerClosureCheck,
  RiskLevel as ServerRiskLevel,
  RiskStatus as ServerRiskStatus,
} from '../../../../src/modules/risk/types'
import type { ProjectDashboardView as ClientDashboard, HealthState as ClientHealthState } from '../analytics/api'
import type {
  RiskView as ClientRiskView,
  ClosureCheckView as ClientClosureCheck,
  RiskLevel as ClientRiskLevel,
  RiskStatus as ClientRiskStatus,
} from './api'
import { HEALTH_STATE_LABEL } from '../analytics/api'
import { RISK_LEVEL_LABEL, RISK_STATUS_LABEL, NEEDS_RESOLUTION } from './api'

/** 双向可赋值 = 形状完全一致（单向会漏掉"界面侧多了一个必填字段"这类漂移）。 */
type SameShape<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// ---------------------------------------------------------------------------
// 一、三个视图与服务端逐字段一致
// ---------------------------------------------------------------------------

const dashboardIsIdentical: SameShape<ClientDashboard, ServerDashboard> = true
const riskViewIsIdentical: SameShape<ClientRiskView, ServerRiskView> = true
const closureIsIdentical: SameShape<ClientClosureCheck, ServerClosureCheck> = true

// ---------------------------------------------------------------------------
// 二、枚举取值一致（界面不得自造取值或写中文标签）
// ---------------------------------------------------------------------------

const healthStateIsIdentical: SameShape<ClientHealthState, ServerHealthState> = true
const riskLevelIsIdentical: SameShape<ClientRiskLevel, ServerRiskLevel> = true
const riskStatusIsIdentical: SameShape<ClientRiskStatus, ServerRiskStatus> = true

// @ts-expect-error 健康度只有四态 —— 没有第五种
const noFifthHealth: ClientHealthState = 'UNKNOWN'
// @ts-expect-error 风险等级只有高/中/低 —— 没有 'URGENT'
const noUrgentLevel: ClientRiskLevel = 'URGENT'
// @ts-expect-error 风险状态没有 'PENDING'（这正是后端 AC3 用例里用的非法值）
const noPendingStatus: ClientRiskStatus = 'PENDING'

// 标签表必须覆盖线上常量的全部取值（服务端加取值而界面漏配 → 这里报错）
const healthLabelCoversAll: Record<ServerHealthState, string> = HEALTH_STATE_LABEL
const levelLabelCoversAll: Record<ServerRiskLevel, string> = RISK_LEVEL_LABEL
const statusLabelCoversAll: Record<ServerRiskStatus, string> = RISK_STATUS_LABEL

// ---------------------------------------------------------------------------
// 三、界面侧的"哪些状态需要解决说明"必须与后端语义对齐
//
// 后端的规则是「改为 RESOLVED / CLOSED 必须填 resolution」，界面先拦一次；
// 若这里少配一个，就会出现"界面放过、服务端 422"的点了必错入口。
// ---------------------------------------------------------------------------

const mustAskResolutionFor = NEEDS_RESOLUTION
const resolvedNeedsResolution: boolean = mustAskResolutionFor.includes('RESOLVED')
const closedNeedsResolution: boolean = mustAskResolutionFor.includes('CLOSED')

// ---------------------------------------------------------------------------
// 四、关键字段的类型边界
// ---------------------------------------------------------------------------

declare const dashboard: ClientDashboard
const ratioIsNullable: number | null = dashboard.progress.ratio
const deviationIsNullable: number | null = dashboard.health.deviationPp
const byStatusKeys: TaskStatus[] = Object.keys(dashboard.byStatus) as TaskStatus[]

declare const closure: ClientClosureCheck
const canCloseIsNullable: boolean | null = closure.verdict.canClose

// ---------------------------------------------------------------------------
// 显式引用全部声明，避免 `noUnusedLocals`（web/tsconfig.json 已开启）报错。
// ---------------------------------------------------------------------------

export const __web_typecheck_used = {
  dashboardIsIdentical,
  riskViewIsIdentical,
  closureIsIdentical,
  healthStateIsIdentical,
  riskLevelIsIdentical,
  riskStatusIsIdentical,
  noFifthHealth,
  noUrgentLevel,
  noPendingStatus,
  healthLabelCoversAll,
  levelLabelCoversAll,
  statusLabelCoversAll,
  mustAskResolutionFor,
  resolvedNeedsResolution,
  closedNeedsResolution,
  ratioIsNullable,
  deviationIsNullable,
  byStatusKeys,
  canCloseIsNullable,
}
