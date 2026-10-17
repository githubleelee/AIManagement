import { Link, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { findWorkbenchBlock } from './blocks'
import './workbench.css'

/**
 * 工作台某一块的「查看全部」列表页（US-08 / 工单 #28）。
 *
 * 当前阶段：**只做界面与跳转**（后端未接）。列表区用同色系占位条表达行高，
 * 条数显示「—」；接数据后把占位条换成真实条目即可，结构不用动。
 *
 * 不认识的块标识（人手改 URL）→ 给出中文提示 + 回工作台的入口，不显示空白页。
 */
export default function WorkbenchListPage() {
  const { blockKey } = useParams()
  const block = findWorkbenchBlock(blockKey)

  if (!block) {
    return (
      <div className="page">
        <PageHeader title="没有这一块" description="工作台只有下面这 5 块。" />
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
              <span className="wb-card-number" aria-label="条数待接入">
                —
              </span>
              <span className="wb-card-unit">条</span>
            </span>
          }
        />

        <ul className="wb-list wb-list--full">
          {/* 占位条：仅表达"这里将来是列表"，不是数据 */}
          {Array.from({ length: 8 }, (_, index) => (
            <li className="wb-row wb-row--ph" key={`ph-${index}`} aria-hidden="true">
              <span />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
