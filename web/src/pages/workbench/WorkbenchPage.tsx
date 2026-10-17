import PageHeader from '../../components/PageHeader'
import './workbench.css'

/**
 * 个人工作台（US-08 / 工单 #28）。
 *
 * 当前是**第 1 步：布局 / 配色 / 列表节奏骨架**。三处刻意留白，等第 2 步接真数据：
 *   1. 条数显示「—」（不写 `0`：没接数据就说 0，等于把"取不到"说成"没有"）；
 *   2. 列表区用灰色占位条展示行高与节奏，**不是假数据**（`aria-hidden`，且 `rows` 为空）；
 *   3. 接上真实 `rows` 后，删掉 `placeholderRows` 字段即可，其余结构不用动。
 *
 * 布局（按人类要求）：2 行 3 列；左列上下两格合并给「我的待办」，其余 4 块自动填满另外 4 格。
 * 每块内容（按人类要求）：标题 → 条数 → 前 2~3 条小列表 → 说明。
 * 5 块是工单规定的固定集合（AC1），不由用户自定义（自定义首页属"不做项"）。
 */
type Row = {
  id: string
  title: string
  /** 右侧小标记，例如负责人或到期日 */
  meta?: string
}

type Block = {
  key: string
  title: string
  hint: string
  /** 决定配色，对应 workbench.css 里的 .wb-card--<tone> */
  tone: 'todo' | 'overdue' | 'accept' | 'mention' | 'upcoming'
  /** 是否跨两行（仅「我的待办」） */
  tall?: boolean
  /** 真实的前若干条（第 2 步接入；为空时显示占位条） */
  rows: Row[]
  /** 接数据前用来展示列表区节奏；第 2 步有了真实 rows 后删除本字段 */
  placeholderRows?: number
}

const BLOCKS: Block[] = [
  {
    key: 'todo',
    title: '我的待办',
    hint: '我是负责人、还没关闭的任务',
    tone: 'todo',
    tall: true,
    rows: [],
    placeholderRows: 4,
  },
  { key: 'overdue', title: '逾期', hint: '计划结束日期已过、还没关闭', tone: 'overdue', rows: [], placeholderRows: 3 },
  { key: 'accept', title: '待验收', hint: '我是验收人、等我验收', tone: 'accept', rows: [], placeholderRows: 3 },
  { key: 'mention', title: '被提及', hint: '通知里 @ 到我的内容', tone: 'mention', rows: [], placeholderRows: 3 },
  { key: 'upcoming', title: '近期计划', hint: '近期要开始或要结束', tone: 'upcoming', rows: [], placeholderRows: 3 },
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

            <ul className="wb-list">
              {block.rows.map((row) => (
                <li className="wb-row" key={row.id}>
                  <span className="wb-row-title">{row.title}</span>
                  {row.meta ? <span className="wb-row-meta">{row.meta}</span> : null}
                </li>
              ))}
              {/* 占位条：仅用于展示列表区行高与节奏，不是数据 */}
              {block.rows.length === 0
                ? Array.from({ length: block.placeholderRows ?? 0 }, (_, index) => (
                    <li className="wb-row wb-row--ph" key={`ph-${index}`} aria-hidden="true">
                      <span />
                    </li>
                  ))
                : null}
            </ul>

            <p className="wb-card-hint">{block.hint}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
