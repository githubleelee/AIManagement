import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import EmptyState from '../../components/EmptyState'
import { ApiError } from '../../api'
import { ROLE_LABELS } from '../../labels'
import { getWorkload } from './api'
import type { MemberWorkloadRow, WorkloadScopeLabel, WorkloadView } from './types'
import MemberWorkloadDetail from './MemberWorkloadDetail'
import './workload.css'

/**
 * US-07 成员任务图与负载（GitHub #27）—— 项目内成员负载总览。
 *
 * 只读页面：只列成员与「非 CLOSED 负载」计数，点成员在同一页内切到明细，
 * 不做任何写操作，也不在前端做权限判断（服务端为准）。
 *
 * 挂载由公共骨架另批完成（路由 `/projects/:projectId/workload`），本文件只交付组件。
 *
 * 口径（设计 §4 / §6）：
 *   `openTaskCount` = 该成员名下 **status != CLOSED**（含 DONE）的任务数 ——
 *   与工作台 `todo` 同口径，与"全项目任务人口"（含 CLOSED）是两回事，不得混同。
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; statusCode?: number; denied: boolean }
  | { status: 'ready'; data: WorkloadView }

/** 空值兜底：计数缺失按 0 处理，不让界面报错。 */
function countOf(row: MemberWorkloadRow): number {
  return typeof row.openTaskCount === 'number' ? row.openTaskCount : 0
}

export default function WorkloadPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [selected, setSelected] = useState<MemberWorkloadRow | null>(null)

  useEffect(() => {
    if (!projectId) {
      setState({
        status: 'error',
        denied: false,
        message: 'URL 缺少项目编号，无法加载成员负载。',
      })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    setSelected(null)
    getWorkload(projectId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          // 设计 §5：非成员/项目不存在一律 404（不泄漏存在性）；403 为对象可见但操作不允许。
          setState({
            status: 'error',
            denied: true,
            statusCode: error.status,
            message:
              error.status === 404
                ? '该项目不存在，或你不是项目成员，无法查看成员负载。'
                : '你没有查看该项目成员负载的权限。',
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
      <div className="page wl-page">
        <PageHeader title="成员任务负载" description="加载中…" />
        <div className="page-loading">加载中…</div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="page wl-page">
        <PageHeader
          title="成员任务负载"
          description={state.denied ? '无法查看' : '加载失败'}
        />
        <p className="error">
          {state.message}
          {state.statusCode ? `（HTTP ${state.statusCode}）` : ''}
        </p>
      </div>
    )
  }

  const data = state.data
  const members = data.members ?? []
  const scope: WorkloadScopeLabel | '—' = data.basis?.scopeLabel ?? '—'

  const header = (
    <PageHeader
      title="成员任务负载"
      description="按成员查看未关闭任务（含已完成待验收）的数量与清单。"
      actions={<span className="wl-scope">{scope}</span>}
    />
  )

  const scopeNote =
    scope === '全项目'
      ? '计数口径：本项目全部成员名下未关闭的任务（status ≠ CLOSED，含 DONE）。'
      : scope === '可见范围'
        ? '计数口径：仅统计你有权查看的任务（status ≠ CLOSED，含 DONE）。'
        : '计数口径：未关闭任务（status ≠ CLOSED，含 DONE）。'

  if (selected) {
    return (
      <div className="page wl-page">
        {header}
        <p className="wl-scope-note">{scopeNote}</p>
        <MemberWorkloadDetail
          projectId={data.projectId ?? projectId ?? ''}
          member={selected}
          onBack={() => setSelected(null)}
        />
      </div>
    )
  }

  return (
    <div className="page wl-page">
      {header}
      <p className="wl-scope-note">{scopeNote}</p>

      {members.length === 0 ? (
        <EmptyState
          level={3}
          title="本项目暂无成员"
          hint="成员加入后，这里会显示每个人名下的未关闭任务数。"
        />
      ) : (
        <div className="wl-panel">
          <table className="wl-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th className="wl-col-count">未关闭任务</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr className="wl-row" key={member.userId}>
                  <td>
                    <button
                      type="button"
                      className="wl-member"
                      onClick={() => setSelected(member)}
                      aria-label={`查看 ${member.displayName} 的任务清单`}
                    >
                      <span className="wl-member-name">{member.displayName}</span>
                      <span className="wl-member-account">{member.account}</span>
                    </button>
                  </td>
                  <td className="wl-col-role">{ROLE_LABELS[member.role] ?? member.role}</td>
                  <td className="wl-col-count">
                    <span className="wl-count">{countOf(member)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
