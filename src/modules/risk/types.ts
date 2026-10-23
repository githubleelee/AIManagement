/**
 * US-10 风险与项目关闭阻断（工单 #30）—— 类型。
 *
 * 本文件两部分**都已实现**（2026-10-19 更正：原文写「风险侧待 `Risk` 表落地 / 仅设计」，
 * 而 `Risk` 表与 `Project.status` 已随迁移 `20261018033000_add_risk_and_project_status`
 * 落地，实现见 `src/modules/risk/service.ts` 与 `closure.ts`）：
 *   ① 关闭阻断校验视图（`closure.ts` 用它）；
 *   ② `Risk` 的枚举与视图（三级 / 四态）。
 *
 * 为什么不放进 `src/shared/types.ts`：冻结文件（技术负责人单写），本模块只新增。
 */
import type { Prisma } from '@prisma/client'
import type { EventActor, EventObjectRef, JsonObject } from '../../shared/events.js'
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
 * ② 风险台账（**已接线**：`Risk` 表与 `Project.status` 已落地，实现见 `service.ts`）
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
 * 流转口径（批复：`risk.write` = **PM + MEMBER**，VIEWER 403；四态细节由本票定义）：
 * **PM 与 MEMBER 都能改状态（含回退 / 重开），VIEWER 只读，每次变更写 AuditLog**。
 * 不强制"只能前进"，因此不建模成单向状态机。
 *
 * ★ 独立审查 S3：此处原写「PM 可任意流转、**member 只读**」，与本票实现相反
 *   （实现走 `risk.write`，公共层只拦 VIEWER）。已按批复更正 —— 这类"注释说 A、
 *   代码做 B"的错误注释会让后来者按错误口径推断权限，属必须修的一类。
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

/* ===========================================================================
 * ③ 域事件端口（#37 公共事件基础设施已合入，本批接线）
 * =========================================================================== */

/**
 * 风险域事件名（命名规范 `<domain>.<object>.<action>`）。
 *
 * ★ 为什么只有两个：风险的写路径只有「创建」与「修改」两条
 *   （见 `./plugin.ts` 的端点清单 —— **没有 DELETE 端点**）。
 *   「已解决 / 已关闭」是 `RiskStatus` 的两个取值、经 `PATCH` 流转，
 *   所以它们落在 `risk.updated` 里（载荷带 `status` 与 `changedFields`），
 *   不需要另立事件名，也不存在 `risk.deleted`。
 *
 * ★ 事件目录的登记（`src/shared/events.ts` 的事件表）由技术负责人单写，
 *   本票**不修改**该文件；接线方按本文件的两个事件名消费。
 */
export type RiskEventName = 'risk.created' | 'risk.updated'

/**
 * 域内事件草稿：**不含** `id` / `schemaVersion` / `storedAt` / `idempotencyKey`。
 *
 * 后四者由模块内适配器（`./event-port.ts`）补齐：`id` / `storedAt` 由适配器的
 * `newId` / `now` 注入（可被测试覆盖），`idempotencyKey` 按确定性规则计算。
 *
 * 判别联合要求：**敏感分支的载荷只能是 `references`**，不得含风险标题 / 描述正文
 * （契约 I-6）。`sensitive` 的判定在写路径的**同一事务内**查关联任务 `isSensitive`
 * 得出（见 `./service.ts`）。
 */
type RiskEventDraftBase = {
  eventName: RiskEventName
  projectId: string
  object: EventObjectRef
  actor: EventActor
  /** ISO 8601 UTC（带毫秒，`…Z`）。 */
  occurredAt: string
}

export type RiskEventDraft =
  | (RiskEventDraftBase & { sensitive: false; payload: JsonObject })
  | (RiskEventDraftBase & { sensitive: true; payload: { references: EventObjectRef[] } })

/**
 * 风险域业务事件的发布端口。
 *
 * 接线方式：由 `./plugin.ts` 从 `RouteContext.riskEvents` 取得（`src/app.ts` 用
 * `createRiskEventPort` 显式组装），缺失即 fail-fast；**不 new no-op 实现、不静默跳过**。
 *
 * 语义：必须在业务写入的**同一个 `$transaction` 内**调用，`transaction` 即该事务的
 * `tx`；适配器把事件追加到该事务（`appendIfAbsent(event, tx)`），**不自行提交、不派发
 * 订阅者**。发布失败 = 同一事务回滚业务写入（刻意：宁可业务失败，不丢事件）。
 */
export type RiskEventPort = {
  publish(event: RiskEventDraft, transaction: Prisma.TransactionClient): Promise<void>
}
