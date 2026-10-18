import { useEffect, useState } from 'react'
import { ApiError } from '../../api'
import { ROLE_LABELS } from '../../labels'
import { TASK_STATUS_LABEL } from '../task/TaskStatusBadge'
import type { TaskStatus } from '../../../../src/shared/types'
import { getMemberWorkload } from './api'
import type { MemberTaskItem, MemberWorkloadRow, MemberWorkloadView } from './types'
import './workload.css'

/**
 * US-07 成员任务图与负载（GitHub #27）—— 单成员未关闭任务清单。
 *
 * 由 `WorkloadPage` 在同一路由内切换渲染（不新增路由）。只读：
 * 标题、状态标签、计划起止；计划字段可能为空，一律容错。
 *
 * 状态文案复用既有 `TASK_STATUS_LABEL`（`pages/task/TaskStatusBadge`，验收页亦复用它），
 * **不新造一套映射**。唯一覆盖：`DONE` 按设计 §7 明确标注「已提交待验收」——既有表里
 * 的「待验收」不足以承载"已提交"这一事实，而 `CLOSED` 仍沿用既有「已验收」，两者区分。
 */

type Props = {
  projectId: string
  member: MemberWorkloadRow
  onBack: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; statusCode?: number }
  | { status: 'ready'; data: MemberWorkloadView }

/** DONE 必须写「已提交待验收」，不得显示成「已完成/关闭」；其余沿用既有标签表。 */
function statusText(status: TaskStatus): string {
  return status === 'DONE' ? '已提交待验收' : TASK_STATUS_LABEL[status]
}

/** 计划起止容错：空值显示占位符，不显示 undefined / null。 */
function planRange(item: MemberTaskItem): string {
  const start = item.planStart ?? '—'
  const end = item.planEnd ?? '—'
  if (!item.planStart && !item.planEnd) return '计划未排期'
  return `计划 ${start} ~ ${end}`
}

export default function MemberWorkloadDetail({ projectId, member, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    getMemberWorkload(projectId, member.userId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          setState({
            status: 'error',
            statusCode: error.status,
            message:
              error.status === 404
                ? '找不到该成员，或你无权查看其任务清单。'
                : '你没有查看该成员任务清单的权限。',
          })
        } else if (error instanceof ApiError) {
          setState({
            status: 'error',
            statusCode: error.status,
            message: error.message,
          })
        } else {
          setState({ status: 'error', message: '加载失败，请稍后重试。' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, member.userId])

  const back = (
    <button type="button" className="wl-back link" onClick={onBack}>
      ← 返回成员负载
    </button>
  )

  return (
    <section className="wl-detail">
      {back}

      <div className="wl-detail-head">
        <div className="wl-detail-who">
          <h3 className="wl-detail-name">{member.displayName}</h3>
          <p className="wl-detail-sub">
            {member.account} · {ROLE_LABELS[member.role] ?? member.role}
            {state.status === 'ready' && state.data.basis?.scopeLabel ? (
              <span className="wl-detail-scope"> · {state.data.basis.scopeLabel}</span>
            ) : null}
          </p>
        </div>
        {state.status === 'ready' ? (
          <p className="wl-detail-total">
            <span className="wl-total-num">{state.data.total ?? 0}</span>
            <span className="wl-total-unit">条未关闭任务</span>
          </p>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <div className="page-loading">加载中…</div>
      ) : state.status === 'error' ? (
        <p className="error">
          {state.message}
          {state.statusCode ? `（HTTP ${state.statusCode}）` : ''}
        </p>
      ) : (
        <>
          {state.data.truncated === true ? (
            <p className="wl-truncated">仅显示前 200 条，总数以 total 为准。</p>
          ) : null}

          {state.data.items.length === 0 ? (
            <p className="wl-empty">该成员暂无未关闭任务</p>
          ) : (
            <ul className="wl-tasks">
              {state.data.items.map((item) => (
                <li className="wl-task" key={item.id}>
                  <div className="wl-task-main">
                    <span className="wl-task-title">{item.title}</span>
                    <span className={`wl-status wl-status--${item.status.toLowerCase()}`}>
                      {statusText(item.status)}
                    </span>
                  </div>
                  <div className="wl-task-plan">{planRange(item)}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
