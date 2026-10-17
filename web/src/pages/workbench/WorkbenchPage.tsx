import PageHeader from '../../components/PageHeader'
import './workbench.css'

/**
 * 个人工作台（US-08 / 工单 #28）。
 *
 * 第 1 步（本文件当前形态）：**只搭架子** —— 把固定的 5 块摆出来、入口能走到，
 * 先不接数据。每块只显示"这一块是什么"，**不对数据做任何断言**
 * （不写"暂无任务"这类话：在没接数据之前说"没有"，等于把"取不到"说成"没有"）。
 *
 * 5 块是工单规定的固定集合（AC1），不由用户自定义（自定义首页属"不做项"）。
 * 数据接入见第 2 步；状态/进度写入见第 3 步。
 */
const BLOCKS = [
  { key: 'todo', title: '我的待办', hint: '我是负责人、还没关闭的任务' },
  { key: 'overdue', title: '逾期', hint: '计划结束日期已过、还没关闭的任务' },
  { key: 'accept', title: '待验收', hint: '我是验收人、等我验收的任务' },
  { key: 'mention', title: '被提及', hint: '别人在通知里 @ 到我的内容' },
  { key: 'upcoming', title: '近期计划', hint: '近期要开始或要结束的任务' },
] as const

export default function WorkbenchPage() {
  return (
    <div className="page">
      <PageHeader
        title="我的工作台"
        description="个人视角：我的待办、逾期、待验收、被提及、近期计划。"
      />
      <div className="wb-grid">
        {BLOCKS.map((block) => (
          <section className="wb-card" key={block.key} aria-labelledby={`wb-${block.key}`}>
            <h3 className="wb-card-title" id={`wb-${block.key}`}>
              {block.title}
            </h3>
            <p className="wb-card-hint">{block.hint}</p>
            <p className="wb-card-body muted" aria-hidden="true">
              —
            </p>
          </section>
        ))}
      </div>
    </div>
  )
}
