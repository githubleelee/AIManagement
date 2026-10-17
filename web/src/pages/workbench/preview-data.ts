import type { WorkbenchBlockKey } from './blocks'

/**
 * 工作台「预览数据」（US-08 / 工单 #28）—— **仅用于界面预览，不是真实数据**。
 *
 * 为什么会有这个文件：人类要求"先放假数据上去，看看内容不为空时是什么样子"。
 * 界面按最终形态做完；第 2 步接后端时把 `USE_PREVIEW_DATA` 置为 `false` 即可，
 * 页面结构一行都不用动。
 *
 * 纪律（与本仓库既有的"薄假数据层"做法一致，见实验二的 `temporary-data.ts`）：
 *   1. **界面上不显示任何"未完成 / 预览"字样** —— 人类明确否掉过这类文案；
 *      改为首次调用时在**浏览器控制台**打一行说明。
 *   2. 这份数据**不得**作为任何"通过验收"的证据：AC 一律以真实接口为准。
 *   3. 数据是按演示项目的语气编的，**不对应库里任何真实记录**。
 */
export const USE_PREVIEW_DATA = true

export type WorkbenchRow = {
  id: string
  title: string
  /** 右侧小标记：任务用到期日 / 负责人，被提及用时间 */
  meta?: string
}

export type WorkbenchPreview = {
  /** 该块的**总条数**（可以大于下面列出的条数，界面只列前几条） */
  total: number
  rows: WorkbenchRow[]
}

let warned = false
function warnOnce(): void {
  if (warned) return
  warned = true
  console.info(
    '[工作台] 当前显示的是**预览数据**（界面预览用），不是真实任务。' +
      '接入后端后请把 pages/workbench/preview-data.ts 的 USE_PREVIEW_DATA 置为 false。',
  )
}

export function previewFor(key: WorkbenchBlockKey): WorkbenchPreview {
  warnOnce()
  return PREVIEW[key]
}

const PREVIEW: Record<WorkbenchBlockKey, WorkbenchPreview> = {
  todo: {
    total: 7,
    rows: [
      { id: 'p-t1', title: '建立需求层级树', meta: '11-03 到期' },
      { id: 'p-t2', title: '三段式录入用户故事', meta: '11-05 到期' },
      { id: 'p-t3', title: '编辑需求并持久化', meta: '11-08 到期' },
      { id: 'p-t4', title: '补充验收标准', meta: '11-10 到期' },
      { id: 'p-t5', title: '整理 Sprint 1 演示脚本', meta: '11-12 到期' },
      { id: 'p-t6', title: '核对任务验收人设置', meta: '11-13 到期' },
      { id: 'p-t7', title: '回归测试：需求层级页', meta: '11-15 到期' },
    ],
  },
  overdue: {
    total: 4,
    rows: [
      { id: 'p-o1', title: '评审交付：迭代开始前确认范围', meta: '逾期 2 天' },
      { id: 'p-o2', title: '需求确认：梳理优先级', meta: '逾期 5 天' },
      { id: 'p-o3', title: '维护需求：整理存量故事', meta: '逾期 6 天' },
      { id: 'p-o4', title: '任务负责人确认', meta: '逾期 9 天' },
    ],
  },
  accept: {
    total: 3,
    rows: [
      { id: 'p-a1', title: '建立需求层级树', meta: '李工 提交' },
      { id: 'p-a2', title: '三段式录入用户故事', meta: '张工 提交' },
      { id: 'p-a3', title: '编辑需求并持久化', meta: '李工 提交' },
    ],
  },
  mention: {
    total: 5,
    rows: [
      { id: 'p-m1', title: '王经理 在「建立需求层级树」里提到了你', meta: '10 分钟前' },
      { id: 'p-m2', title: '李工 评论：范围确认请复核一下', meta: '2 小时前' },
      { id: 'p-m3', title: '张工 回复了你的验收意见', meta: '昨天' },
      { id: 'p-m4', title: '王经理 在「需求确认」里提到了你', meta: '2 天前' },
      { id: 'p-m5', title: '刘总 关注了「迭代开始前确认范围」', meta: '3 天前' },
    ],
  },
  upcoming: {
    total: 4,
    rows: [
      { id: 'p-u1', title: '迭代评审会', meta: '11-14 开始' },
      { id: 'p-u2', title: '任务验收截止', meta: '11-15 结束' },
      { id: 'p-u3', title: '需求冻结', meta: '11-18 开始' },
      { id: 'p-u4', title: 'Sprint 1 演示彩排', meta: '11-20 开始' },
    ],
  },
}
