import PageHeader from '../../components/PageHeader'
import './workbench.css'

/**
 * 个人工作台（US-08 / 工单 #28）。
 *
 * 当前是**第 1 步：布局与配色骨架**。5 块的**条数**暂以占位符「—」呈现 ——
 * 刻意不写 `0`：在接入真实数据之前显示「0 条」，等于把"取不到"说成"没有"。
 * 第 2 步接真数据后，「—」会替换为真实条数。
 *
 * 布局（按人类要求）：2 行 3 列；左列上下两格合并给「我的待办」，其余 4 块自动填满另外 4 格。
 * 5 块是工单规定的固定集合（AC1），不由用户自定义（自定义首页属"不做项"）。
 */
type Block = {
  key: string
  title: string
  hint: string
  /** 决定配色，对应 workbench.css 里的 .wb-card--<tone> */
  tone: 'todo' | 'overdue' | 'accept' | 'mention' | 'upcoming'
  /** 是否跨两行（仅「我的待办」） */
  tall?: boolean
}

const BLOCKS: Block[] = [
  { key: 'todo', title: '我的待办', hint: '我是负责人、还没关闭的任务', tone: 'todo', tall: true },
  { key: 'overdue', title: '逾期', hint: '计划结束日期已过、还没关闭', tone: 'overdue' },
  { key: 'accept', title: '待验收', hint: '我是验收人、等我验收', tone: 'accept' },
  { key: 'mention', title: '被提及', hint: '通知里 @ 到我的内容', tone: 'mention' },
  { key: 'upcoming', title: '近期计划', hint: '近期要开始或要结束', tone: 'upcoming' },
]

export default function WorkbenchPage() {
  return (
    <div className="page">
      <PageHeader
        title="我的工作台"
        description="个人视角：我的待办、逾期、待验收、被提及、近期计划。"
      />
      <div className="wb-grid">
        {BLOCKS.map((block) => (
          <section
            className={`wb-card wb-card--${block.tone}${block.tall ? ' wb-card--tall' : ''}`}
            key={block.key}
            aria-labelledby={`wb-${block.key}`}
          >
            <h3 className="wb-card-title" id={`wb-${block.key}`}>
              {block.title}
            </h3>
            <p className="wb-card-count">
              {/* 占位符：接入数据后替换为真实条数 */}
              <span className="wb-card-number" aria-label="条数待接入">
                —
              </span>
              <span className="wb-card-unit">条</span>
            </p>
            <p className="wb-card-hint">{block.hint}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
