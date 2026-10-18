import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ProjectView, TaskView } from '../../../../src/shared/types'
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
  type AcceptanceRecordView,
  type AcceptanceSubmitResult,
} from './api'

/**
 * 任务验收页（US-09 / 工单 #29）—— 挂在项目空间的 `/projects/:projectId/acceptance`。
 *
 * ===========================================================================
 * 本页只做一件事：把"等我验收"的任务处理掉
 * ===========================================================================
 *
 * - 清单来自 `GET /projects/:projectId/acceptance-queue`（筛选在**服务端**完成，
 *   不在前端内存里过滤 —— 契约决策 I-6）。
 * - **验收只有一个入口**：本页的验收表单。刻意**不**在任务表格里再加一个"状态 /
 *   关闭"控件：上一票出现过"两个控件改同一件事，弱入口绕过必填校验"（审查 B-1）。
 * - 表单按 `key={task.id}` 挂载，避免切任务时把上一个任务的值写进这一个。
 *
 * ===========================================================================
 * 阅览者（VIEWER）的说明
 * ===========================================================================
 *
 * 现状口径（人工确认：沿用现状、不改任何现有约定）：验收人可选范围是"本项目成员且
 * ≠ 负责人"，**包含 VIEWER**；但 VIEWER 执行验收在服务端一律 403。
 * 因此本页对 VIEWER **不渲染验收入口**，并说明原因 —— 否则就是一个"点了必报错"的按钮。
 * 服务端侧的这条不对称已登记为跨模块遗留（见 docs/us-09-acceptance-api.md §4）。
 */
export default function AcceptancePage() {
  const project = useOutletContext<ProjectView>()

  const [tasks, setTasks] = useState<TaskView[] | null>(null)
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
      setTasks(await listAcceptanceQueue(project.id))
    } catch (caught) {
      setTasks(null)
      setError(caught instanceof ApiError ? caught.message : '加载待验收任务失败')
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
   * 做法：每次发起自增，响应回来时序号对不上就丢弃。
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

  const formTarget = formFor === null ? null : (tasks ?? []).find((item) => item.id === formFor)

  return (
    <div className="page">
      <PageHeader
        title="任务验收"
        description="我是验收人、且执行人已提交验收的任务。通过后任务进入「已验收」；驳回必须填写原因，任务回到「进行中」。"
        actions={
          <span className="acc-count">
            {tasks === null ? '…' : String(tasks.length)}
            <span className="acc-count-unit">条</span>
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

      {tasks === null ? (
        error ? (
          <button type="button" className="acc-button-plain" onClick={() => void reload()}>
            重试加载
          </button>
        ) : (
          <div className="page-loading">加载中…</div>
        )
      ) : tasks.length === 0 ? (
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
              {tasks.map((task) => (
                <Fragment key={task.id}>
                  <tr>
                    <td>
                      <span className="acc-row-title">{task.title}</span>
                      {task.isSensitive ? <span className="acc-sensitive">敏感</span> : null}
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
            // 验收后该任务离开队列（不再是 DONE），因此必须重新拉一次服务端清单。
            void reload()
          }}
          onCancel={() => setFormFor(null)}
        />
      ) : null}
    </div>
  )
}
