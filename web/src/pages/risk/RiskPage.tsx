import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ProjectView, ProjectRole } from '../../../../src/shared/types'
import { ApiError, listMembers } from '../../api'
import PageHeader from '../../components/PageHeader'
import EmptyState from '../../components/EmptyState'
import { TaskStatusBadge } from '../task/TaskStatusBadge'
import './risk.css'
import {
  BLOCKING_STATUSES,
  NEEDS_RESOLUTION,
  RISK_LEVELS,
  RISK_LEVEL_LABEL,
  RISK_STATUSES,
  RISK_STATUS_LABEL,
  closeProject,
  createRisk,
  formatTime,
  getClosureCheck,
  listRisks,
  patchRisk,
  reopenProject,
  type ClosureCheckView,
  type RiskLevel,
  type RiskStatus,
  type RiskView,
} from './api'

/**
 * 风险台账 + 项目关闭（US-10 / 工单 #30，AC3 / AC4 / AC5 / AC7）。
 *
 * 三条界面纪律：
 * 1. **风险写权限 PM 与 MEMBER 都有**（批复）：只在 VIEWER 时隐藏编辑入口；
 *    服务端仍强制，前端隐藏只是体验层。
 * 2. **「已解决 / 已关闭」必须填解决说明**：界面先拦一次，服务端再强制
 *    （不给"点了必报错"的入口）。
 * 3. **关闭前的阻断清单在页面上直接可见**：关闭被拒时 409 的响应体不含清单
 *    （契约的错误信封装不下对象），所以本页先拉 `closure-check` 自己展示。
 */
const EDITOR_ROLES: readonly ProjectRole[] = ['PM', 'MEMBER']

export default function RiskPage() {
  const project = useOutletContext<ProjectView>()
  const canWrite = EDITOR_ROLES.includes(project.myRole)
  const isPm = project.myRole === 'PM'

  const [risks, setRisks] = useState<RiskView[] | null>(null)
  const [closure, setClosure] = useState<ClosureCheckView | null>(null)
  const [members, setMembers] = useState<Array<{ id: string; displayName: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 新建表单
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState<RiskLevel>('MEDIUM')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [creating, setCreating] = useState(false)

  // 行内改状态：只有一个"编辑中"的行，避免多行表单互相干扰
  const [draft, setDraft] = useState<{ id: string; status: RiskStatus; resolution: string } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)
  /**
   * 行内改状态的错误 —— **贴在那一行**，不放页面顶部。
   * （2026-10-18 走查第 4 项反馈：红字在页面顶部、按钮在下面，中间隔了一整屏。）
   */
  const [draftError, setDraftError] = useState<string | null>(null)
  /** 登记表单的错误 —— 同样贴表单，不放页面顶部 */
  const [formError, setFormError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const [nextRisks, nextClosure] = await Promise.all([
        listRisks(project.id),
        getClosureCheck(project.id),
      ])
      setRisks(nextRisks)
      setClosure(nextClosure)
    } catch (caught) {
      setRisks(null)
      setClosure(null)
      setError(caught instanceof ApiError ? caught.message : '加载风险台账失败')
    }
  }, [project.id])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let cancelled = false
    listMembers(project.id)
      .then((payload) => {
        if (cancelled) return
        setMembers(payload.items.map((m) => ({ id: m.user.id, displayName: m.user.displayName })))
      })
      .catch(() => {
        // 成员列表失败不阻塞主流程：负责人选择框留空即可
        if (!cancelled) setMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  /** 切项目时清空表单与提示，避免残留（本仓库出现过"组件复用残留旧值"的坑） */
  useEffect(() => {
    setTitle('')
    setLevel('MEDIUM')
    setOwnerUserId('')
    setDraft(null)
    setNotice(null)
  }, [project.id])

  async function handleCreate(): Promise<void> {
    if (title.trim() === '') {
      setFormError('请填写风险标题。')
      return
    }
    if (ownerUserId === '') {
      setFormError('请选择风险负责人。')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      await createRisk(project.id, { title: title.trim(), level, ownerUserId })
      setTitle('')
      setNotice('风险已登记。')
      await reload()
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : '登记风险失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveStatus(): Promise<void> {
    if (!draft) return
    const needs = NEEDS_RESOLUTION.includes(draft.status)
    if (needs && draft.resolution.trim() === '') {
      setDraftError('状态改为「已解决」或「已关闭」时必须填写解决说明。')
      return
    }
    setSaving(true)
    setDraftError(null)
    try {
      await patchRisk(draft.id, {
        status: draft.status,
        ...(needs ? { resolution: draft.resolution.trim() } : {}),
      })
      setDraft(null)
      setDraftError(null)
      setNotice('风险状态已更新。')
      await reload()
    } catch (caught) {
      setDraftError(caught instanceof ApiError ? caught.message : '更新风险失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleClose(): Promise<void> {
    setError(null)
    try {
      await closeProject(project.id)
      setNotice('项目已关闭。')
      await reload()
    } catch (caught) {
      // 409 时页面已经把阻断清单展示在上方，这里只显示一句话
      setError(caught instanceof ApiError ? caught.message : '关闭项目失败')
    }
  }

  async function handleReopen(): Promise<void> {
    setError(null)
    try {
      await reopenProject(project.id)
      setNotice('项目已重开。')
      await reload()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '重开项目失败')
    }
  }

  if (!risks || !closure) {
    return (
      <div className="page">
        <PageHeader title="风险台账" description="加载中…" />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <div className="page-loading">加载中…</div>
        )}
      </div>
    )
  }

  const { verdict, blockingTasks, blockingRisks, basis } = closure
  const blockingCount =
    (blockingTasks.total ?? 0) + (blockingRisks.total ?? 0)

  return (
    <div className="page">
      <PageHeader
        title="风险台账"
        description="登记风险、更新到「已解决 / 已关闭」；项目只有在没有未关闭任务、也没有未处理风险时才能关闭。"
      />

      {notice ? (
        <p className="risk-notice">
          {notice}
          <button type="button" className="risk-link" onClick={() => setNotice(null)}>
            知道了
          </button>
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {/* ---------------- 关闭区 ---------------- */}
      <section className={`risk-closure risk-closure--${verdict.state}`}>
        <div className="risk-closure-head">
          <strong>
            {verdict.state === 'clear'
              ? '可以关闭项目'
              : verdict.state === 'blocked'
                ? '暂时不能关闭项目'
                : '无法判断能否关闭'}
          </strong>
          <span className="risk-closure-count">阻断项合计 {blockingCount}</span>
        </div>
        <p className="risk-closure-note">{verdict.note}</p>
        <p className="risk-closure-note risk-muted">{basis.closeActionNote}</p>

        {verdict.state === 'blocked' ? (
          <details className="risk-blockers" open>
            <summary>查看阻断清单</summary>
            {blockingTasks.total ? (
              <>
                <p className="risk-blockers-title">
                  未关闭任务（{blockingTasks.total}）
                </p>
                <ul className="risk-blockers-list">
                  {blockingTasks.rows.map((task) => (
                    <li key={task.id}>
                      <span className="risk-blocker-name">{task.title}</span>
                      <TaskStatusBadge status={task.status} />
                      <span className="risk-muted">
                        {task.owner?.displayName ?? task.ownerUserId}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {blockingRisks.total ? (
              <>
                <p className="risk-blockers-title">未处理 / 处理中的风险（{blockingRisks.total}）</p>
                <ul className="risk-blockers-list">
                  {blockingRisks.rows.map((risk) => (
                    <li key={risk.id}>
                      <span className="risk-blocker-name">{risk.title}</span>
                      <span className="risk-tag risk-tag--level">{RISK_LEVEL_LABEL[risk.level]}</span>
                      <span className="risk-tag">{RISK_STATUS_LABEL[risk.status]}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {blockingCount > (blockingTasks.rows.length + blockingRisks.rows.length) ? (
              <p className="risk-muted">清单只显示前若干条，合计以数字为准。</p>
            ) : null}
          </details>
        ) : null}

        {isPm ? (
          <div className="risk-closure-actions">
            <button
              type="button"
              className="risk-button"
              disabled={verdict.state !== 'clear'}
              onClick={() => void handleClose()}
            >
              关闭项目
            </button>
            <button type="button" className="risk-button-plain" onClick={() => void handleReopen()}>
              重开项目
            </button>
          </div>
        ) : (
          <p className="risk-muted">关闭 / 重开项目仅项目经理可操作。</p>
        )}
      </section>

      {/* ---------------- 新建风险 ---------------- */}
      {canWrite ? (
        <section className="risk-form">
          <h2 className="risk-section-title">登记新风险</h2>
          {formError ? (
            <p className="risk-edit-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="risk-form-row">
            <label className="risk-field risk-field--grow">
              标题
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="risk-field">
              等级
              <select value={level} onChange={(event) => setLevel(event.target.value as RiskLevel)}>
                {RISK_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {RISK_LEVEL_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="risk-field">
              负责人
              <select
                value={ownerUserId}
                onChange={(event) => setOwnerUserId(event.target.value)}
              >
                <option value="">请选择</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="risk-button" disabled={creating} onClick={() => void handleCreate()}>
              {creating ? '登记中…' : '登记'}
            </button>
          </div>
        </section>
      ) : (
        <p className="risk-muted">你是本项目的阅览者（只读），可以查看风险但不能新增或修改。</p>
      )}

      {/* ---------------- 风险清单 ---------------- */}
      <h2 className="risk-section-title">风险清单（{risks.length}）</h2>
      {risks.length === 0 ? (
        <EmptyState level={3} title="还没有登记风险" hint="出现影响交付的问题时，在这里登记并跟踪到解决。" />
      ) : (
        <div className="table-scroll">
          <table className="risk-table">
            <thead>
              <tr>
                <th>风险</th>
                <th className="risk-nowrap">等级</th>
                <th className="risk-nowrap">状态</th>
                <th>负责人</th>
                <th className="risk-nowrap">更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((risk) => {
                const editing = draft?.id === risk.id
                return (
                  <tr key={risk.id}>
                    <td>
                      <span className="risk-title">{risk.title}</span>
                      {BLOCKING_STATUSES.includes(risk.status) ? (
                        <span className="risk-tag risk-tag--blocking">阻断关闭</span>
                      ) : null}
                      {risk.resolution ? (
                        <p className="risk-resolution">解决说明：{risk.resolution}</p>
                      ) : null}
                    </td>
                    <td className="risk-nowrap">
                      <span className={`risk-tag risk-tag--${risk.level.toLowerCase()}`}>
                        {RISK_LEVEL_LABEL[risk.level]}
                      </span>
                    </td>
                    <td className="risk-nowrap">{RISK_STATUS_LABEL[risk.status]}</td>
                    <td>{risk.owner?.displayName ?? risk.ownerUserId}</td>
                    <td className="risk-nowrap risk-mono">{formatTime(risk.updatedAt)}</td>
                    <td className="risk-nowrap">
                      {canWrite ? (
                        editing ? (
                          <div className="risk-edit">
                            <select
                              value={draft.status}
                              onChange={(event) =>
                                setDraft({ ...draft, status: event.target.value as RiskStatus })
                              }
                            >
                              {RISK_STATUSES.map((value) => (
                                <option key={value} value={value}>
                                  {RISK_STATUS_LABEL[value]}
                                </option>
                              ))}
                            </select>
                            {NEEDS_RESOLUTION.includes(draft.status) ? (
                              <input
                                className="risk-edit-reason"
                                placeholder="解决说明（必填）"
                                value={draft.resolution}
                                onChange={(event) =>
                                  setDraft({ ...draft, resolution: event.target.value })
                                }
                              />
                            ) : null}
                            <button
                              type="button"
                              className="risk-button"
                              disabled={saving}
                              onClick={() => void handleSaveStatus()}
                            >
                              {saving ? '保存中…' : '保存'}
                            </button>
                            <button
                              type="button"
                              className="risk-button-plain"
                              onClick={() => {
                                setDraft(null)
                                setDraftError(null)
                              }}
                            >
                              取消
                            </button>
                            {/* 错误贴在这一行下面，不放到页面顶部（走查反馈） */}
                            {draftError ? (
                              <p className="risk-edit-error" role="alert">
                                {draftError}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="risk-button-plain"
                            onClick={() => {
                              setDraft({ id: risk.id, status: risk.status, resolution: '' })
                              setDraftError(null)
                            }}
                          >
                            改状态
                          </button>
                        )
                      ) : (
                        <span className="risk-muted">只读</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="risk-basis">
        <summary>口径与可见范围</summary>
        <dl className="risk-basis-list">
          <dt>阻断条件</dt>
          <dd>{basis.blockingMeans}</dd>
          <dt>敏感风险</dt>
          <dd>{basis.riskSideNote}</dd>
          <dt>统计范围</dt>
          <dd>{basis.scope === 'global' ? '全项目（项目经理视角）' : '仅你可看到的部分（可见范围）'}</dd>
        </dl>
      </details>
    </div>
  )
}
