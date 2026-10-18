/**
 * US-04 故事看板（GitHub #25）—— 项目内三列只读故事看板（默认导出）。
 *
 * 挂载：`/projects/:projectId/board`（由公共骨架另批完成，本文件只交付组件，
 * **不改** `web/src/routes.tsx` / 布局 / `web/src/api.ts`）。
 *
 * 只读页面（本地任务 #17 的前端部分）：
 *   - 三列固定为 `DRAFT → PLANNING → DONE`，列序**取后端 `columns` 顺序**
 *     （后端已按此顺序返回）；列头用需求模块既有 `STORY_STATUS_LABEL` + 精确 `count`；
 *   - 卡片：标题 / `goalName / activityName` 路径 / 优先级标签（复用 `PRIORITY_LABEL`）；
 *   - 空列显示空态文案，**不合并、不隐藏列**；空项目另有页面级空态；
 *   - `truncated` 的列提示「仅显示前 200 条，总数以计数为准」；
 *   - 顶部显示 `basis.scopeLabel`，可见范围时提示不代表项目全量基数；
 *   - 加载态 / 错误态 / 无权限态（404/403 文案，不白屏）齐备。
 *
 * 不做：状态调整按钮、拖拽、写请求（写入属 #18）、自定义列、敏感标记、新依赖。
 * 跨视图同步（设计 §9）本批只做「重新拉取」的读取基础：状态变更后由调用方
 * 重新挂载/重新拉取本页即可，前端不做本地乐观改写。
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import EmptyState from '../../components/EmptyState'
import { ApiError } from '../../api'
import { STORY_STATUS_LABEL, STORY_STATUS_ORDER } from '../requirement/terms'
import { getBoard } from './api'
import type { BoardColumn, BoardView } from './types'
import StoryCard from './StoryCard'
import './board.css'

/** 列内明细条数上限（与后端 `BOARD_COLUMN_ROW_LIMIT` 同值；`truncated` 时 `count` 仍为精确值）。 */
const COLUMN_ITEM_LIMIT = 200

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; statusCode?: number; denied: boolean }
  | { status: 'ready'; data: BoardView }

/** 状态标签：只接受故事三态，契约外取值显式标注「未知」。 */
function statusLabel(status: string): string {
  return (STORY_STATUS_LABEL as Readonly<Record<string, string>>)[status] ?? `${status}（未知）`
}

/**
 * 保证三列都在：**保持后端 `columns` 的顺序**，仅把后端缺失的状态补成空列
 * （后端契约保证三列齐全；这里只防"整列缺失"被误当成隐藏列）。
 */
function normalizeColumns(columns: BoardColumn[] | undefined): BoardColumn[] {
  const list = columns ?? []
  const present = new Set(list.map((column) => column.status))
  const result = [...list]
  for (const status of STORY_STATUS_ORDER) {
    if (!present.has(status)) {
      result.push({ status, count: 0, truncated: false, items: [] })
    }
  }
  return result
}

export default function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!projectId) {
      setState({
        status: 'error',
        denied: false,
        message: 'URL 缺少项目编号，无法加载故事看板。',
      })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    getBoard(projectId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          // 设计 §6：非成员/项目不存在一律 404（不泄漏存在性）；403 为对象可见但操作不允许。
          setState({
            status: 'error',
            denied: true,
            statusCode: error.status,
            message:
              error.status === 404
                ? '该项目不存在，或你不是项目成员，无法查看故事看板。'
                : '你没有查看该项目故事看板的权限。',
          })
        } else if (error instanceof ApiError) {
          setState({
            status: 'error',
            denied: false,
            statusCode: error.status,
            message: error.message,
          })
        } else {
          setState({ status: 'error', denied: false, message: '加载失败，请稍后重试。' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (state.status === 'loading') {
    return (
      <div className="page board-page">
        <PageHeader title="故事看板" description="加载中…" />
        <div className="page-loading">加载中…</div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="page board-page">
        <PageHeader title="故事看板" description={state.denied ? '无法查看' : '加载失败'} />
        <p className="error">
          {state.message}
          {state.statusCode ? `（HTTP ${state.statusCode}）` : ''}
        </p>
      </div>
    )
  }

  const data = state.data
  const columns = normalizeColumns(data.columns)
  const scope = data.basis?.scopeLabel ?? '—'
  const totalCount = columns.reduce((sum, column) => sum + column.count, 0)

  const scopeNote =
    scope === '全项目'
      ? '范围：本项目全部故事。'
      : scope === '可见范围'
        ? '范围：仅展示你有权查看的故事，不代表项目全量基数。'
        : '范围：未标注。'

  return (
    <div className="page board-page">
      <PageHeader
        title="故事看板"
        description="按故事状态（待规划 / 规划中 / 已完成）分列查看需求（只读）。"
        actions={<span className="board-scope">{scope}</span>}
      />
      <p className="board-scope-note">{scopeNote}</p>

      {totalCount === 0 ? (
        <EmptyState
          level={3}
          title="本项目暂无所见故事"
          hint="故事建立后，这里会按待规划 / 规划中 / 已完成三列展示。"
        />
      ) : null}

      <div className="board-columns">
        {columns.map((column) => {
          const label = statusLabel(column.status)
          const columnStatusClass = `board-column--${column.status.toLowerCase()}`
          return (
            <section
              className={`board-column ${columnStatusClass}`}
              key={column.status}
              aria-label={`${label}列`}
            >
              <header className="board-column-head">
                <h3 className="board-column-title">{label}</h3>
                <span className="board-column-count" title="精确计数">
                  {column.count}
                </span>
              </header>

              {column.truncated ? (
                <p className="board-column-truncated">
                  仅显示前 {COLUMN_ITEM_LIMIT} 条，总数以计数为准。
                </p>
              ) : null}

              {column.items.length === 0 ? (
                <p className="board-column-empty">该状态暂无所见故事。</p>
              ) : (
                <div className="board-column-items">
                  {column.items.map((story) => (
                    <StoryCard story={story} key={story.id} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
