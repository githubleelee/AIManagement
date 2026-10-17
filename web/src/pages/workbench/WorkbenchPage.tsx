import { Link } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { WORKBENCH_BLOCKS } from './blocks'
import { USE_PREVIEW_DATA, previewFor, type WorkbenchRow } from './preview-data'
import './workbench.css'

/**
 * 个人工作台（US-08 / 工单 #28）—— 主页面：5 块总览。
 *
 * 数据来源两态，由 `preview-data.ts` 的 `USE_PREVIEW_DATA` 一个开关决定：
 *   - `true`（当前）：显示**预览数据**，用来确认内容不为空时界面的样子；
 *   - `false`（第 2 步接后端后）：显示真实条数与条目。
 * 两种情况下页面结构完全一致，切开关即可，不改本文件。
 *
 * 卡片只列前几条（跨两行的「我的待办」多一条），完整列表在「查看全部」里。
 * 5 块是工单规定的固定集合（AC1），不由用户自定义（自定义首页属"不做项"）。
 */
const CARD_ROWS = 3
const CARD_ROWS_TALL = 4

export default function WorkbenchPage() {
  return (
    <div className="page">
      <PageHeader
        title="我的工作台"
        description="个人视角：我的待办、逾期、待验收、被提及、近期计划。"
      />
      <div className="wb-grid">
        {WORKBENCH_BLOCKS.map((block) => {
          const preview = USE_PREVIEW_DATA ? previewFor(block.key) : null
          const rows: WorkbenchRow[] = preview
            ? preview.rows.slice(0, block.tall ? CARD_ROWS_TALL : CARD_ROWS)
            : []
          const placeholderCount = preview ? 0 : block.placeholderRows

          return (
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
                {preview ? (
                  <>
                    <span className="wb-card-number">{preview.total}</span>
                    <span className="wb-card-unit">条</span>
                  </>
                ) : (
                  <>
                    {/* 未接数据时显示占位符，不写 0：避免把"取不到"说成"没有" */}
                    <span className="wb-card-number" aria-label="条数待接入">
                      —
                    </span>
                    <span className="wb-card-unit">条</span>
                  </>
                )}
              </p>

              <ul className="wb-list">
                {rows.map((row) => (
                  <li className="wb-row" key={row.id}>
                    <span className="wb-row-title">{row.title}</span>
                    {row.meta ? <span className="wb-row-meta">{row.meta}</span> : null}
                  </li>
                ))}
                {/* 占位条：只在未接数据时出现，仅表达"这里将来是列表"，不是数据 */}
                {Array.from({ length: placeholderCount }, (_, index) => (
                  <li className="wb-row wb-row--ph" key={`ph-${index}`} aria-hidden="true">
                    <span />
                  </li>
                ))}
              </ul>

              <p className="wb-card-hint">{block.hint}</p>
            </section>
          )
        })}
      </div>
    </div>
  )
}
