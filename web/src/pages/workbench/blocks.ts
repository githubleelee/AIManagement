/**
 * 工作台固定 5 块的定义（工单 #28，AC1：工作台含 5 块）。
 *
 * 为什么单独一个文件：主页面的卡片与"查看全部"的列表页都要用这份定义，
 * 两处各写一遍必然漂移（本仓库第二轮审查把这类"重复实现"列为问题）。
 *
 * 这里只管**界面侧**的东西（标题 / 说明 / 卡片布局 / 右侧小标记的写法）；
 * 数据一律来自服务端 `GET /me/workbench`。
 */
import type { TaskView } from '../../../../src/shared/types'
import type { WorkbenchBlockKey } from './api'

export type WorkbenchBlock = {
  key: WorkbenchBlockKey
  title: string
  /** 一句话说明这一块的范围，直接显示在卡片上 */
  hint: string
  /** 是否跨两行（仅「我的待办」占左列上下两格） */
  tall?: boolean
}

export const WORKBENCH_BLOCKS: readonly WorkbenchBlock[] = [
  { key: 'todo', title: '我的待办', hint: '我是负责人、还没提交验收的任务', tall: true },
  { key: 'overdue', title: '逾期', hint: '计划结束日期已过、还没提交验收' },
  { key: 'accept', title: '待验收', hint: '我是验收人、等我验收' },
  { key: 'mention', title: '被提及', hint: '通知里 @ 到我的内容' },
  { key: 'upcoming', title: '近期计划', hint: '近期要开始或要结束' },
]

/** 按 URL 里的块标识取定义；不认识则返回 null（由页面自己决定怎么提示）。 */
export function findWorkbenchBlock(value: string | undefined): WorkbenchBlock | null {
  if (!value) return null
  return WORKBENCH_BLOCKS.find((block) => block.key === value) ?? null
}

/** 两个 ISO 日期（YYYY-MM-DD）之间相差几天，`to - from`。 */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`)
  const b = Date.parse(`${to}T00:00:00.000Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * 明细行右侧的小标记。口径随块不同：
 *   - 逾期：还算得出天数就写"逾期 N 天"；
 *   - 待验收：写是谁提交的（验收人是我，所以要显示对方）；
 *   - 其余：写计划日期。
 * 日期全部按服务端给的 `asOf`（"今天"）计算，避免前端各用各的本地时间。
 */
export function rowMeta(key: WorkbenchBlockKey, row: TaskView, asOf: string): string {
  if (key === 'overdue') {
    const overdueDays = daysBetween(row.planEnd, asOf)
    return overdueDays > 0 ? `逾期 ${overdueDays} 天` : `到期 ${row.planEnd}`
  }
  if (key === 'accept') return `${row.owner.displayName} 提交`
  if (key === 'upcoming') return `开始 ${row.planStart}`
  return `到期 ${row.planEnd}`
}
