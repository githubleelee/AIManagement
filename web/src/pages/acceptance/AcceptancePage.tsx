import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ProjectView } from '../../../../src/shared/types'
import { ApiError } from '../../api'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
// 状态徽标与标签表复用任务模块已有的那一份：**不再抄第二张表**。
// 理由：上一票的审查 B-4 正是"项目任务页自己维护了一份三态标签表，六状态落地后它过期了"。
// 这里只 import（读），不改对方文件；若任务模块 owner 认为该上提到 web/src/components（骨架区），
// 由前端骨架唯一修改人决定。
import { TaskStatusBadge, TASK_STATUS_LABEL } from '../task/TaskStatusBadge'
import AcceptanceForm from './AcceptanceForm'
import './acceptance.css'
import {
  formatOccurredAt,
  listAcceptanceHistory,
  listAcceptanceQueue,
  taskRequirementHref,
  type AcceptanceQueueItem,
  type AcceptanceRecordView,
  type AcceptanceSubmitResult,
} from './api'

/**
 * 任务验收页（US-09 / 工单 #29）—— 挂在项目空间的 `/projects/:projectId/acceptance`。
 *
 * ===========================================================================
 * 两个视角，两块清单
 * ===========================================================================
 *
 * 1. **待我验收**（`?scope=acceptor`）：我是验收人、执行人已提交 ⇒ 我点通过 / 驳回。
 * 2. **我负责的、最近一次验收被驳回的任务**（`?scope=owner`）：我是负责人、被驳回了
 *    ⇒ 我要**看到原因**才知道改什么。
 *
 * 第 2 块是 2026-10-18 走查后补的：在这之前，驳回理由只存在于"验收人那一侧的展开历史"
 * 里，**执行人一处都看不到** —— AC4 要求"驳回必填原因"，而原因传不到执行人就等于没传达；
 * AC5 的"全过程可追溯"也应当是双向的。
 *
 * 两块清单的筛选都在**服务端**完成（不在前端内存过滤 —— 契约决策 I-6）。
 *
 * ===========================================================================
 * 几条刻意的设计（都来自踩过的坑）
 * ===========================================================================
 *
 * - **验收只有一个入口**：本页的验收表单。刻意**不**在任务表格里再加一个"状态 / 关闭"
 *   控件 —— 上一票出现过"两个控件改同一件事，弱入口绕过必填校验"（审查 B-1）。
 * - 表单按 `key={task.id}` 挂载，避免切任务时把上一个任务的值写进这一个。
 * - 验收历史的加载带**在途请求序号守卫**，避免 A 的响应渲染到 B 行（审查 S6）。
 *
 * ===========================================================================
 * 阅览者（VIEWER）的说明
 * ===========================================================================
 *
 * 现状口径（人工确认：沿用现状、不改任何现有约定）：验收人可选范围是"本项目成员且
 * ≠ 负责人"，**包含 VIEWER**；但 VIEWER 执行验收在服务端一律 403。
 * 因此本页对 VIEWER **不渲染验收入口**并说明原因 —— 否则就是一个"点了必报错"的按钮。
 * 服务端侧的这条不对称已登记为跨模块遗留（见 docs/us-09-acceptance-api.md §4）。
 */
export default function AcceptancePage() {
  const project = useOutletContext<ProjectView>()

  const [queue, setQueue] = useState<AcceptanceQueueItem[] | null>(null)
  const [rejected, setRejected] = useState<AcceptanceQueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 哪一行打开了验收表单 */
  const [formFor, setFormFor] = useState<string | null>(null)
  /** 哪一行展开了验收历史 */
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<AcceptanceRecordView[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  /** 刚刚提交成功的验收：任务通过验收后会离开队列，所以要把结果留在页面上 */
  const [lastResult, setLastResult] = useState<AcceptanceSubmitResult | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const [nextQueue, nextRejected] = await Promise.all([
        listAcceptanceQueue(project.id, 'acceptor'),
        listAcceptanceQueue(project.id, 'owner'),
      ])
      setQueue(nextQueue)
      setRejected(nextRejected)
    } catch (caught) {
      setQueue(null)
      setRejected(null)
      setError(caught instanceof ApiError ? caught.message : '加载验收清单失败')
    }
  }, [project.id])

  useEffect(() => {
    void reload()
  }, [reload])

  // 切走项目时清掉上一次的展开态与结果，避免残留（本仓库出过"组件复用残留旧值"的坑）
  useEffect(() => {
    setFormFor(null)
    setHistoryFor(null)
    setHistory(null)
    setHistoryError(null)
    setLastResult(null)
  }, [project.id])

  const isViewer = project.myRole === 'VIEWER'

  /**
   * 在途请求序号（独立审查 S6 的修复）。
   *
   * 没有它就会出**陈旧响应错位**：先点 A 行「验收历史」、再快速点 B 行，若 A 的响应后到，
   * 会把 A 的时间线渲染在 `historyFor === B` 的那一行下面 —— 把 A 的审计记录显示成 B 的。
   */
  const historySeq = useRef(0)

  async function toggleHistory(taskId: string): Promise<void> {
    if (historyFor === taskId) {
      historySeq.current += 1 // 收起时让在途响应作废
      setHistoryFor(null)
      setHistory(null)
      setHistoryError(null)
      return
    }
    const seq = ++historySeq.current
    setHistoryFor(taskId)
    setHistory(null)
    setHistoryError(null)
    try {
      const items = await listAcceptanceHistory(taskId)
      if (seq !== historySeq.current) return // 陈旧响应：丢弃
      setHistory(items)
    } catch (caught) {
      if (seq !== historySeq.current) return
      setHistoryError(caught instanceof ApiError ? caught.message : '加载验收历史失败')
    }
  }

  const formTarget = formFor === null ? null : (queue ?? []).find((item) => item.id === formFor)

  return (
    <div className="page">
      <PageHeader
        title="任务验收"
        description="我是验收人、且执行人已提交验收的任务：通过后任务进入「已验收」；驳回必须填写原因，任务回到「进行中」。被驳回的负责人可在下方看到原因。"
        actions={
          <span className="acc-count">
            {queue === null ? '…' : String(queue.length)}
            <span className="acc-count-unit">条待验收</span>
          </span>
        }
      />

      {lastResult ? (
        <div className={`acc-notice acc-notice--${lastResult.record.conclusion.toLowerCase()}`}>
          <strong>
            已{lastResult.record.conclusion === 'PASS' ? '通过' : '驳回'}「{lastResult.task.title}」
          </strong>
          <span className="acc-notice-meta">
            任务现在是「{TASK_STATUS_LABEL[lastResult.record.statusAfter]}」
            {' · '}
            {formatOccurredAt(lastResult.record.createdAt)}
          </span>
          {lastResult.record.reason ? (
            <span className="acc-notice-reason">原因：{lastResult.record.reason}</span>
          ) : null}
          <button
            type="button"
            className="acc-button-plain acc-notice-close"
            onClick={() => setLastResult(null)}
          >
            知道了
          </button>
        </div>
      ) : null}

      {isViewer ? (
        <p className="acc-viewer-note">
          你是本项目的阅览者（只读），不能执行验收。下面列出的是被指定为验收人的任务；
          如需验收权限，请联系项目经理调整你在项目中的角色。
        </p>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {/* ================= 第一块：待我验收 ================= */}
      <h2 className="acc-section-title">待我验收</h2>

      {queue === null ? (
        error ? (
          <button type="button" className="acc-button-plain" onClick={() => void reload()}>
            重试加载
          </button>
        ) : (
          <div className="page-loading">加载中…</div>
        )
      ) : queue.length === 0 ? (
        <EmptyState
          level={3}
          title="现在没有等你验收的任务"
          hint="执行人把任务提交验收（状态变成「待验收」）之后，会出现在这里。"
        />
      ) : (
        <div className="table-scroll">
          <table className="acc-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>负责人</th>
                <th className="acc-nowrap">计划</th>
                <th>进度</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((task) => (
                <Fragment key={task.id}>
                  <tr>
                    <td>
                      <span className="acc-row-title">{task.title}</span>
                      {task.isSensitive ? <span className="acc-sensitive">敏感</span> : null}
                      {/* 上一轮被驳回过的，给一个上下文提示（重验时用得上） */}
                      {task.latestAcceptance?.conclusion === 'REJECT' ? (
                        <span className="acc-retry-tag" title={task.latestAcceptance.reason ?? ''}>
                          上一轮被驳回
                        </span>
                      ) : null}
                    </td>
                    <td className="acc-mono">{task.owner?.account ?? task.ownerUserId}</td>
                    <td className="acc-mono acc-nowrap">
                      {task.planStart} → {task.planEnd}
                    </td>
                    <td className="acc-mono acc-nowrap">
                      {task.progress === null ? '—' : `${task.progress}%`}
                    </td>
                    <td>
                      <TaskStatusBadge status={task.status} />
                    </td>
                    <td className="acc-nowrap">
                      {isViewer ? null : (
                        <button
                          type="button"
                          className="acc-button"
                          onClick={() => setFormFor(formFor === task.id ? null : task.id)}
                        >
                          {formFor === task.id ? '收起' : '验收'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="acc-button-plain"
                        onClick={() => void toggleHistory(task.id)}
                      >
                        {historyFor === task.id ? '收起历史' : '验收历史'}
                      </button>
                      <Link className="link" to={taskRequirementHref(task)}>
                        查看需求
                      </Link>
                    </td>
                  </tr>

                  {historyFor === task.id ? (
                    <tr className="acc-history-row">
                      <td colSpan={6}>
                        {historyError ? (
                          <p className="error" role="alert">
                            {historyError}
                          </p>
                        ) : history === null ? (
                          <p className="muted">加载验收历史…</p>
                        ) : history.length === 0 ? (
                          <p className="muted">这个任务还没有验收记录。</p>
                        ) : (
                          <ol className="acc-timeline">
                            {history.map((record) => (
                              <li key={record.id} className="acc-timeline-item">
                                <span
                                  className={`acc-tag acc-tag--${record.conclusion.toLowerCase()}`}
                                >
                                  {record.conclusion === 'PASS' ? '通过' : '驳回'}
                                </span>
                                <span className="acc-timeline-when">
                                  {formatOccurredAt(record.createdAt)}
                                </span>
                                <span className="acc-timeline-who">
                                  {record.actor?.displayName ?? record.actorUserId}
                                </span>
                                <span className="acc-timeline-flow">
                                  {TASK_STATUS_LABEL[record.statusBefore]} →{' '}
                                  {TASK_STATUS_LABEL[record.statusAfter]}
                                </span>
                                {record.reason ? (
                                  <span className="acc-timeline-reason">{record.reason}</span>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ================= 第二块：我被驳回的任务 ================= */}
      <h2 className="acc-section-title">我负责的、被驳回的任务</h2>
      <p className="acc-section-hint">
        这些任务最近一次验收没通过，需要你先修好、再到任务页把状态改为「待验收」重新提交。
      </p>

      {rejected === null ? (
        <p className="muted">{error ? '加载失败（见上方提示）' : '加载中…'}</p>
      ) : rejected.length === 0 ? (
        <EmptyState level={3} title="没有被驳回的任务" hint="验收人驳回你的任务时，原因会显示在这里。" />
      ) : (
        <div className="table-scroll">
          <table className="acc-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>驳回人</th>
                <th className="acc-nowrap">驳回时间</th>
                <th>驳回原因（要改什么）</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((task) => (
                <tr key={task.id}>
                  <td>
                    <span className="acc-row-title">{task.title}</span>
                    {task.isSensitive ? <span className="acc-sensitive">敏感</span> : null}
                  </td>
                  <td className="acc-mono">
                    {task.latestAcceptance?.actor?.displayName ??
                      task.latestAcceptance?.actorUserId ??
                      '—'}
                  </td>
                  <td className="acc-mono acc-nowrap">
                    {task.latestAcceptance
                      ? formatOccurredAt(task.latestAcceptance.createdAt)
                      : '—'}
                  </td>
                  <td className="acc-reason-cell">
                    {task.latestAcceptance?.reason ?? <span className="muted">（未填原因）</span>}
                  </td>
                  <td>
                    <TaskStatusBadge status={task.status} />
                  </td>
                  <td className="acc-nowrap">
                    <Link className="link" to={taskRequirementHref(task)}>
                      去处理
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formTarget ? (
        <AcceptanceForm
          // ★ 必须带 key：否则从任务 A 切到 B 时组件复用、useState 初值不重跑，
          //   会把 A 的结论与原因写进 B。
          key={formTarget.id}
          task={formTarget}
          onSubmitted={(result) => {
            setLastResult(result)
            setFormFor(null)
            setHistoryFor(null)
            setHistory(null)
            // 验收后该任务离开队列（不再是 DONE），因此必须重新拉一次服务端清单
            void reload()
          }}
          onCancel={() => setFormFor(null)}
        />
      ) : null}
    </div>
  )
}
