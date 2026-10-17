import { Link, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { findWorkbenchBlock } from './blocks'
import { USE_PREVIEW_DATA, previewFor, type WorkbenchRow } from './preview-data'
import './workbench.css'

/**
 * 工作台某一块的「查看全部」列表页（US-08 / 工单 #28）。
 *
 * 数据来源与主页面同一个开关（`preview-data.ts` 的 `USE_PREVIEW_DATA`）：
 * `true` 显示预览数据、`false` 显示真实条目；接后端时不改本文件。
 *
 * 不认识的块标识（人手改 URL）→ 给出中文提示 + 回工作台的入口，不显示空白页。
 */
const PLACEHOLDER_ROWS = 8

export default function WorkbenchListPage() {
  const { blockKey } = useParams()
  const block = findWorkbenchBlock(blockKey)

  if (!block) {
    return (
      <div className="page">
        <PageHeader title="没有这一块" description="工作台只有 5 块：我的待办、逾期、待验收、被提及、近期计划。" />
        <ul className="wb-backlist">
          <li>
            <Link className="link" to="/workbench">
              返回我的工作台
            </Link>
          </li>
        </ul>
      </div>
    )
  }

  const preview = USE_PREVIEW_DATA ? previewFor(block.key) : null
  const rows: WorkbenchRow[] = preview ? preview.rows : []
  const placeholderCount = preview ? 0 : PLACEHOLDER_ROWS

  return (
    <div className="page">
      <p className="wb-crumb">
        <Link className="link" to="/workbench">
          ← 我的工作台
        </Link>
      </p>

      <div className={`wb-panel wb-panel--${block.key}`}>
        <PageHeader
          title={block.title}
          description={block.hint}
          actions={
            <span className="wb-panel-count">
              {preview ? (
                <>
                  <span className="wb-card-number">{preview.total}</span>
                  <span className="wb-card-unit">条</span>
                </>
              ) : (
                <>
                  <span className="wb-card-number" aria-label="条数待接入">
                    —
                  </span>
                  <span className="wb-card-unit">条</span>
                </>
              )}
            </span>
          }
        />

        <ul className="wb-list wb-list--full">
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
      </div>
    </div>
  )
}
