/**
 * US-10 风险台账（工单 #30）—— **风险清单排序**。
 *
 * ===========================================================================
 * 为什么单独一个文件（2026-10-19 独立评审 ④）
 * ===========================================================================
 *
 * 原实现把排序交给数据库：`orderBy: [{ status: 'asc' }, { level: 'asc' }]`，
 * 而注释声称「未处理排前、高危优先」。实际拿到的是**字典序**：
 *
 *   status: CLOSED → IN_PROGRESS → OPEN → RESOLVED   （不是 未处理 → … → 已关闭）
 *   level:  HIGH   → LOW         → MEDIUM            （不是 高 → 中 → 低）
 *
 * 两处都用到了这个排序，且 `closure-check` 还带 `take: 50` —— 先按错序截断，
 * 结果是**高危风险可能被挤出阻断清单**（先返回 LOW，再 MEDIUM）。这不是显示问题，
 * 是"该看到的没看到"。
 *
 * SQLite / Prisma 都不支持按自定义权重 `ORDER BY`（无 `CASE WHEN` 排序），
 * 因此统一改为：**取回后按显式 rank 排序**，再由调用方施加行数上限。
 *
 * 放在本文件的理由：`service.ts` 与 `closure.ts` 都要用，而 `service.ts` 已经
 * import `closure.ts`（反向 import 会成环），故下沉到一个无依赖的小文件。
 *
 * ⚠️ 排序只改**顺序**，不改集合：`total` 仍由 `count` 出，与清单同一个 `where`。
 */
import type { RiskLevel, RiskStatus } from './types.js'

/**
 * 状态优先级：未处理 → 处理中 → 已解决 → 已关闭。
 *
 * 与「越需要人管越靠前」一致：`OPEN` 最靠前，`CLOSED` 最靠后。
 */
export const RISK_STATUS_RANK: Record<RiskStatus, number> = {
  OPEN: 0,
  IN_PROGRESS: 1,
  RESOLVED: 2,
  CLOSED: 3,
}

/** 等级优先级：高 → 中 → 低（**不是**字典序 HIGH / LOW / MEDIUM）。 */
export const RISK_LEVEL_RANK: Record<RiskLevel, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
}

/** 库中取到的未知取值排到最后（不抛错：排序不该让整个端点 500；取值合法性由写入层保证）。 */
const UNKNOWN_RANK = 99

function statusRank(status: string): number {
  return RISK_STATUS_RANK[status as RiskStatus] ?? UNKNOWN_RANK
}

function levelRank(level: string): number {
  return RISK_LEVEL_RANK[level as RiskLevel] ?? UNKNOWN_RANK
}

/** 排序所需的最小字段集（任务/风险行只要带这三列即可比较）。 */
export type RiskOrderable = { status: string; level: string; createdAt: Date }

/**
 * 风险优先级比较：状态 → 等级 → 越早发现越前。
 *
 * 末级用 `createdAt` 升序（而不是 uuid）保证**顺序稳定可复现**：同一批数据两次调用
 * 得到同一顺序，用例才钉得住。
 */
export function compareRisksByPriority(a: RiskOrderable, b: RiskOrderable): number {
  const statusDiff = statusRank(a.status) - statusRank(b.status)
  if (statusDiff !== 0) return statusDiff

  const levelDiff = levelRank(a.level) - levelRank(b.level)
  if (levelDiff !== 0) return levelDiff

  return a.createdAt.getTime() - b.createdAt.getTime()
}

/** 不改入参：返回排好序的新数组（调用方随后可自行 `slice` 出行数上限）。 */
export function sortRisksByPriority<T extends RiskOrderable>(rows: readonly T[]): T[] {
  return [...rows].sort(compareRisksByPriority)
}
