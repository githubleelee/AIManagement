/**
 * 工作台固定 5 块的定义（工单 #28，AC1：工作台含 5 块）。
 *
 * 为什么单独一个文件：主页面的卡片与"查看全部"的列表页都要用这份定义，
 * 两处各写一遍必然漂移（本仓库第二轮审查把这类"重复实现"列为问题）。
 */
export type WorkbenchBlockKey = 'todo' | 'overdue' | 'accept' | 'mention' | 'upcoming'

export type WorkbenchBlock = {
  key: WorkbenchBlockKey
  title: string
  /** 一句话说明这一块的范围，直接显示在卡片上 */
  hint: string
  /** 是否跨两行（仅「我的待办」占左列上下两格） */
  tall?: boolean
  /** 卡片列表区在"未接数据"阶段显示几条占位条 */
  placeholderRows: number
}

export const WORKBENCH_BLOCKS: readonly WorkbenchBlock[] = [
  { key: 'todo', title: '我的待办', hint: '我是负责人、还没关闭的任务', tall: true, placeholderRows: 4 },
  { key: 'overdue', title: '逾期', hint: '计划结束日期已过、还没关闭', placeholderRows: 3 },
  { key: 'accept', title: '待验收', hint: '我是验收人、等我验收', placeholderRows: 3 },
  { key: 'mention', title: '被提及', hint: '通知里 @ 到我的内容', placeholderRows: 3 },
  { key: 'upcoming', title: '近期计划', hint: '近期要开始或要结束', placeholderRows: 3 },
]

/** 按 URL 里的块标识取定义；不认识则返回 null（由页面自己决定怎么提示）。 */
export function findWorkbenchBlock(value: string | undefined): WorkbenchBlock | null {
  if (!value) return null
  return WORKBENCH_BLOCKS.find((block) => block.key === value) ?? null
}
