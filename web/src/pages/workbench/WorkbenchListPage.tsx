import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { ApiError } from '../../api'
import { findWorkbenchBlock, rowMeta } from './blocks'
import { getWorkbench, taskTargetHref, type WorkbenchResponse } from './api'
import './workbench.css'

/**
 * 工作台某一块的「查看全部」列表页（US-08 / 工单 #28）。
 *
 * 数据同样来自 `GET /me/workbench`（一次取回 5 块，这里只用当前这块），
 * 因此主页面与列表页的条数、口径必然一致，不会出现两处对不上。
 *
 * 不认识的块标识（人手改 URL）→ 中文提示 + 回工作台的入口，不显示空白页。
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; status_code?: number }
  | { status: 'ready'; data: WorkbenchResponse }

export default function WorkbenchListPage() {
  const { blockKey } = useParams()
  const block = findWorkbenchBlock(blockKey)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!block) return
    let cancelled = false
    setState({ status: 'loading' })
    getWorkbench()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError) {
          setState({ status: 'error', message: error.message, status_code: error.status })
        } else {
          setState({ status: 'error', message: '加载失败，请稍后重试。' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [block])

  if (!block) {
    return (
      <div className="page">
        <PageHeader
          title="没有这一块"
          description="工作台只有 5 块：我的待办、逾期、待验收、被提及、近期计划。"
        />
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

  const crumb = (
    <p className="wb-crumb">
      <Link className="link" to="/workbench">
        ← 我的工作台
      </Link>
    </p>
  )

  if (state.status === 'loading') {
    return (
      <div className="page">
        {crumb}
        <PageHeader title={block.title} description="加载中…" />
        <div className="page-loading">加载中…</div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="page">
        {crumb}
        <PageHeader title={block.title} description="加载失败" />
        <p className="error">
          {state.message}
          {state.status_code ? `（HTTP ${state.status_code}）` : ''}
        </p>
      </div>
    )
  }

  const data = state.data.blocks.find((item) => item.key === block.key)
  const unavailable = data?.state === 'unavailable'
  const rows = data?.rows ?? []

  return (
    <div className="page">
      {crumb}

      <div className={`wb-panel wb-panel--${block.key}`}>
        <PageHeader
          title={block.title}
          description={unavailable ? (data?.note ?? block.hint) : block.hint}
          actions={
            <span className="wb-panel-count">
              {unavailable ? (
                <span className="wb-card-number" aria-label="暂无数据源">
                  —
                </span>
              ) : (
                <span className="wb-card-number">{data?.total ?? 0}</span>
              )}
              <span className="wb-card-unit">条</span>
            </span>
          }
        />

        {unavailable ? null : rows.length === 0 ? (
          <p className="wb-placeholder">这一块暂时没有内容。</p>
        ) : (
          <ul className="wb-list wb-list--full">
            {rows.map((row) => (
              <li className="wb-row" key={row.id}>
                <Link className="wb-row-link" to={taskTargetHref(row)}>
                  <span className="wb-row-title">{row.title}</span>
                  <span className="wb-row-meta">{rowMeta(block.key, row, state.data.basis.asOf)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
