import { Link } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { WORKBENCH_BLOCKS } from './blocks'
import './workbench.css'

/**
 * 个人工作台（US-08 / 工单 #28）—— 主页面：5 块总览。
 *
 * 当前阶段：**只做界面与跳转**（后端未接）。三处刻意留白，接数据时替换：
 *   1. 条数显示「—」（不写 `0`：没接数据就说 0，等于把"取不到"说成"没有"）；
 *   2. 列表区用**同色系的**灰色占位条表达行高与节奏，不是假数据（`aria-hidden`）；
 *   3. 每块标题与「查看全部」都跳到 `/workbench/<块>`，列表页与这里共用同一份块定义。
 */
export default function WorkbenchPage() {
  return (
    <div className="page">
      <PageHeader
        title="我的工作台"
        description="个人视角：我的待办、逾期、待验收、被提及、近期计划。"
      />
      <div className="wb-grid">
        {WORKBENCH_BLOCKS.map((block) => (
          <section
            className={`wb-card wb-card--${block.key}${block.tall ? ' wb-card--tall' : ''}`}
            key={block.key}
          >
            <div className="wb-card-head">
              <h3 className="wb-card-title">
                <Link className="wb-card-link" to={`/workbench/${block.key}`}>
                  {block.title}
                </Link>
              </h3>
              <Link className="wb-card-more" to={`/workbench/${block.key}`}>
                查看全部
              </Link>
            </div>

            <p className="wb-card-count">
              {/* 占位符：接入数据后替换为真实条数 */}
              <span className="wb-card-number" aria-label="条数待接入">
                —
              </span>
              <span className="wb-card-unit">条</span>
            </p>

            <ul className="wb-list">
              {/* 占位条：仅表达"这里将来是列表"，不是数据 */}
              {Array.from({ length: block.placeholderRows }, (_, index) => (
                <li className="wb-row wb-row--ph" key={`ph-${index}`} aria-hidden="true">
                  <span />
                </li>
              ))}
            </ul>

            <p className="wb-card-hint">{block.hint}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
