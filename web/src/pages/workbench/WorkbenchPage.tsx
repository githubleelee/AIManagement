import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { ApiError } from '../../api'
import { WORKBENCH_BLOCKS, rowMeta } from './blocks'
import { getWorkbench, taskTargetHref, type WorkbenchResponse } from './api'
import './workbench.css'

/**
 * 个人工作台（US-08 / 工单 #28）—— 主页面：5 块总览。
 *
 * 数据来自 `GET /me/workbench`（本票新增的只读聚合端点）。要点：
 *   - 卡片只列前几条，完整的在「查看全部」里；
 *   - 点条目跳到该任务所属需求的需求详情页（任务列表与编辑在那里，答案 B）；
 *   - 某块 `state='unavailable'`（数据源还没交付）时显示「—」+ 原因，**不显示 0 条**：
 *     把"还没接上"显示成"没有"是本仓库已登记过的问题。
 */
const CARD_ROWS = 3
/**
 * 「我的待办」这块跨左列两行、空间最大。US-10 走查（2026-10-18）反馈：
 * 从顶栏「我的工作台」进来后**没有回到「我的项目」的入口**——顶栏那个「工作台」
 * 面包屑跳的是项目列表、旁边「我的工作台」跳的是这里，用户会以为是同一个东西。
 * 因此在本卡片底部加一个「我的项目」入口，空间**从待办列表里挖**（4 行 → 3 行），
 * 不增加整页高度。
 */
const CARD_ROWS_TALL = 3

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; status_code?: number }
  | { status: 'ready'; data: WorkbenchResponse }

export default function WorkbenchPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
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
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="page">
        <PageHeader title="我的工作台" description="加载中…" />
        <div className="page-loading">加载中…</div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="page">
        <PageHeader title="我的工作台" description="加载失败" />
        <p className="error">
          {state.message}
          {state.status_code ? `（HTTP ${state.status_code}）` : ''}
        </p>
      </div>
    )
  }

  const { blocks, basis } = state.data

  return (
    <div className="page">
      <PageHeader
        title="我的工作台"
        description="个人视角：我的待办、逾期、待验收、被提及、近期计划。"
      />
      <div className="wb-grid">
        {WORKBENCH_BLOCKS.map((block) => {
          const data = blocks.find((item) => item.key === block.key)
          const unavailable = data?.state === 'unavailable'
          const rows = data?.rows ?? []
          const limit = block.tall ? CARD_ROWS_TALL : CARD_ROWS

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
                {unavailable ? (
                  <span className="wb-card-number" aria-label="暂无数据源">
                    —
                  </span>
                ) : (
                  <span className="wb-card-number">{data?.total ?? 0}</span>
                )}
                <span className="wb-card-unit">条</span>
              </p>

              <ul className="wb-list">
                {rows.slice(0, limit).map((row) => (
                  <li className="wb-row" key={row.id}>
                    <Link className="wb-row-link" to={taskTargetHref(row)}>
                      <span className="wb-row-title">{row.title}</span>
                      <span className="wb-row-meta">{rowMeta(block.key, row, basis.asOf)}</span>
                    </Link>
                  </li>
                ))}
                {!unavailable && rows.length === 0 ? (
                  <li className="wb-row wb-row--empty">
                    <span className="wb-row-title">这一块暂时没有内容。</span>
                  </li>
                ) : null}
              </ul>

              <p className="wb-card-hint">{unavailable ? (data?.note ?? block.hint) : block.hint}</p>

              {/* 「我的待办」卡片底部：回到我的项目列表的入口（US-10 走查补充） */}
              {block.key === 'todo' ? (
                <Link className="wb-projects-entry" to="/projects">
                  <span className="wb-projects-entry-label">我的项目</span>
                  <span className="wb-projects-entry-hint">去项目列表 · 选一个项目继续 →</span>
                </Link>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
