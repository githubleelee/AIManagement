/**
 * M5 任务（US-05）—— 故事详情内嵌的任务区组件
 *
 * 承载：任务列表（端点 24）、新建（25）、行内编辑与状态（27/28）、删除（29）、敏感可见（30）。
 * 写操作入口仅 PM 显示（docs/frontend-routes.md：前端隐藏只为体验，服务端仍强制校验）。
 *
 * 负责人 / 验收人候选、敏感可见成员，都来自 `GET /projects/:id/members`（真实成员，非占位）。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ProjectMemberView, TaskView } from '../../../../src/shared/types'
import { ApiError, listMembers } from '../../api'
import { useAuth } from '../../auth/AuthContext'
import TaskUpdateForm from './TaskUpdateForm'
import { SensitivityEditor } from '../SensitivityEditor'
import ConfirmDialog from '../../components/ConfirmDialog'
import { TaskStatusBadge } from './TaskStatusBadge'
import './task.css'
import {
  createTask,
  deleteTask,
  listStoryTasks,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from './api'

type Props = {
  storyId: string
  projectId: string
  isPm: boolean
  /** 任务数量回传给父级（故事详情用「是否有任务」拦住删除） */
  onCountChange: (count: number) => void
}

/** 新建 / 编辑共用的表单。initial 为空是新建，非空是编辑。 */
function TaskForm(props: {
  members: ProjectMemberView[]
  initial?: TaskView
  onSubmit: (input: CreateTaskInput) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(props.initial?.title ?? '')
  const [description, setDescription] = useState(props.initial?.description ?? '')
  const [ownerUserId, setOwnerUserId] = useState(props.initial?.ownerUserId ?? '')
  const [acceptorUserId, setAcceptorUserId] = useState(props.initial?.acceptorUserId ?? '')
  const [planStart, setPlanStart] = useState(props.initial?.planStart ?? '')
  const [planEnd, setPlanEnd] = useState(props.initial?.planEnd ?? '')
  const [busy, setBusy] = useState(false)
  // 字段级校验：默认不打扰，字段失焦或提交后显示具体原因。
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const errors = {
    title: title.trim() === '' ? '请填写标题。' : null,
    ownerUserId: ownerUserId === '' ? '请选择负责人。' : null,
    acceptorUserId:
      acceptorUserId === ''
        ? '请选择验收人。'
        : ownerUserId !== '' && acceptorUserId === ownerUserId
          ? '验收人不能与负责人为同一人。'
          : null,
    planStart: planStart === '' ? '请选择计划开始日期。' : null,
    planEnd:
      planEnd === ''
        ? '请选择计划结束日期。'
        : planStart !== '' && planEnd < planStart
          ? '结束日期不能早于开始日期。'
          : null,
  }
  const hasErrors = Object.values(errors).some(Boolean)

  function markTouched(field: string) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }))
  }
  function fieldError(field: keyof typeof errors) {
    return touched[field] ? errors[field] : null
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // 提交时把所有字段标为已触碰，未通过的条件一次性显示出来。
    setTouched({
      title: true,
      ownerUserId: true,
      acceptorUserId: true,
      planStart: true,
      planEnd: true,
    })
    if (hasErrors) return
    setBusy(true)
    try {
      await props.onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        ownerUserId,
        acceptorUserId,
        planStart,
        planEnd,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form task-form" onSubmit={handleSubmit}>
      <label className="form-field">
        标题
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => markTouched('title')}
          aria-invalid={fieldError('title') ? true : undefined}
        />
        {fieldError('title') ? <span className="error field-error">{errors.title}</span> : null}
      </label>
      <label className="form-field">
        描述（选填）
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="form-field">
        负责人
        <select
          value={ownerUserId}
          onChange={(e) => setOwnerUserId(e.target.value)}
          onBlur={() => markTouched('ownerUserId')}
          aria-invalid={fieldError('ownerUserId') ? true : undefined}
        >
          <option value="">请选择</option>
          {props.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.displayName}（{m.user.account}）
            </option>
          ))}
        </select>
        {fieldError('ownerUserId') ? (
          <span className="error field-error">{errors.ownerUserId}</span>
        ) : null}
      </label>
      {props.members.length < 2 ? <p className="error">请先添加其他成员，再保存任务。</p> : null}
      <label className="form-field">
        验收人
        <select
          value={acceptorUserId}
          onChange={(e) => setAcceptorUserId(e.target.value)}
          onBlur={() => markTouched('acceptorUserId')}
          aria-invalid={fieldError('acceptorUserId') ? true : undefined}
        >
          <option value="">请选择</option>
          {props.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.displayName}（{m.user.account}）
            </option>
          ))}
        </select>
        {fieldError('acceptorUserId') ? (
          <span className="error field-error">{errors.acceptorUserId}</span>
        ) : null}
      </label>
      <label className="form-field">
        计划开始
        <input
          type="date"
          value={planStart}
          onChange={(e) => setPlanStart(e.target.value)}
          onBlur={() => markTouched('planStart')}
          aria-invalid={fieldError('planStart') ? true : undefined}
        />
        {fieldError('planStart') ? (
          <span className="error field-error">{errors.planStart}</span>
        ) : null}
      </label>
      <label className="form-field">
        计划结束
        <input
          type="date"
          value={planEnd}
          onChange={(e) => setPlanEnd(e.target.value)}
          onBlur={() => markTouched('planEnd')}
          aria-invalid={fieldError('planEnd') ? true : undefined}
        />
        {fieldError('planEnd') ? <span className="error field-error">{errors.planEnd}</span> : null}
      </label>
      <div className="task-form-actions">
        <button type="submit" disabled={busy || props.members.length < 2}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button type="button" className="ghost" onClick={props.onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}

export default function TaskSection({ storyId, projectId, isPm, onCountChange }: Props) {
  const [tasks, setTasks] = useState<TaskView[] | null>(null)
  const [members, setMembers] = useState<ProjectMemberView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TaskView | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  // US-08：哪一行打开了「更新」表单（状态 / 进度 / 卡住原因）
  const [updateFormFor, setUpdateFormFor] = useState<string | null>(null)
  const { user } = useAuth()
  const myId = user?.id ?? null

  const reload = useCallback(async () => {
    setError(null)
    try {
      const rows = await listStoryTasks(storyId)
      setTasks(rows)
      onCountChange(rows.length)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载任务失败')
    }
  }, [storyId, onCountChange])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    listMembers(projectId)
      .then((res) => setMembers(res.items))
      .catch(() => setMembers([]))
  }, [projectId])

  async function handleCreate(input: CreateTaskInput) {
    setError(null)
    try {
      await createTask(storyId, input)
      setShowCreate(false)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建任务失败')
    }
  }

  async function handleUpdate(taskId: string, patch: UpdateTaskInput) {
    setError(null)
    try {
      await updateTask(taskId, patch)
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    }
  }

  async function handleDelete(taskId: string) {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setError(null)
    try {
      await deleteTask(taskId)
      setPendingDelete(null)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  /** 当前用户能否更新这一行（体验层；服务端仍按 task.progress / task.accept 判权）。 */
  function canUpdateRow(task: TaskView): boolean {
    if (isPm) return true
    if (myId === null) return false
    return task.ownerUserId === myId || task.acceptorUserId === myId
  }

  /** 是否允许把这一行设为「已验收关闭」：验收人或项目经理。 */
  function canCloseRow(task: TaskView): boolean {
    if (isPm) return true
    return myId !== null && task.acceptorUserId === myId
  }

  const memberOptions = members.map((m) => ({ id: m.userId, displayName: m.user.displayName }))

  return (
    <div className="req-op-block task-section">
      <p className="req-side-title">
        关联任务（{tasks === null ? '…' : tasks.length}）
      </p>

      {isPm ? (
        <button
          type="button"
          className="req-button-small req-button-plain"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? '收起新建' : '新建任务'}
        </button>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}

      {showCreate && isPm ? (
        <TaskForm
          members={members}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      ) : null}

      {error && tasks === null ? (
        <button type="button" className="req-button-small req-button-plain" onClick={() => void reload()}>重试加载任务</button>
      ) : tasks === null ? (
        <p className="req-placeholder">正在加载任务…</p>
      ) : tasks.length === 0 ? (
        <p className="req-placeholder">这条需求下还没有任务。</p>
      ) : (
        <div className="table-scroll">
        <table className="req-table">
          <thead>
            <tr>
              <th>任务</th>
              <th>负责人</th>
              <th>验收人</th>
              <th className="nowrap">计划</th>
              <th>状态</th>
              <th>进度</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><span className="task-row-title">{t.title}</span></td>
                <td className="req-mono">{t.owner?.account ?? t.ownerUserId}</td>
                <td className="req-mono">{t.acceptor?.account ?? t.acceptorUserId}</td>
                <td className="req-mono nowrap">
                  {t.planStart} → {t.planEnd}
                </td>
                <td>
                  <TaskStatusBadge status={t.status} />
                </td>
                <td className="req-mono nowrap">{t.progress === null ? '—' : String(t.progress) + '%'}</td>
                <td className="nowrap">
                  {canUpdateRow(t) ? (
                    <button
                      type="button"
                      className="req-button-small req-button-plain"
                      onClick={() => setUpdateFormFor(updateFormFor === t.id ? null : t.id)}
                    >
                      {updateFormFor === t.id ? '收起更新' : '更新'}
                    </button>
                  ) : null}
                  {isPm ? (
                    <>
                      <button
                        type="button"
                        className="req-button-small req-button-plain"
                        onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                      >
                        {editingId === t.id ? '收起' : '编辑'}
                      </button>
                      <button
                        type="button"
                        className="req-button-small req-button-danger"
                        onClick={() => setPendingDelete(t)}
                      >
                        删除
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {updateFormFor && (() => {
        const target = tasks?.find((item) => item.id === updateFormFor)
        if (!target) return null
        return (
          <TaskUpdateForm
            // ★ 必须带 key：否则从任务 A 切到 B 时组件复用、useState 初值不重跑，
            //   表单残留 A 的状态/进度/原因，保存会把 A 的值写进 B。
            key={target.id}
            task={target}
            canProgress={isPm || (myId !== null && target.ownerUserId === myId)}
            canClose={canCloseRow(target)}
            onSaved={() => {
              setUpdateFormFor(null)
              void reload()
            }}
            onCancel={() => setUpdateFormFor(null)}
          />
        )
      })()}

      {editingId && isPm
        ? (() => {
            const target = tasks?.find((t) => t.id === editingId)
            if (!target) return null
            return (
              <div className="task-edit">
                <TaskForm
                  members={members}
                  initial={target}
                  onSubmit={(input) =>
                    handleUpdate(target.id, {
                      title: input.title,
                      description: input.description,
                      ownerUserId: input.ownerUserId,
                      acceptorUserId: input.acceptorUserId,
                      planStart: input.planStart,
                      planEnd: input.planEnd,
                    })
                  }
                  onCancel={() => setEditingId(null)}
                />
                <SensitivityEditor
                  kind="task"
                  objectId={target.id}
                  members={memberOptions}
                  initialIsSensitive={target.isSensitive}
                />
              </div>
            )
          })()
        : null}

      {pendingDelete ? (
        <div className={deleting ? 'task-delete-busy' : undefined} aria-busy={deleting}>
        <ConfirmDialog
          title="确认删除这个任务？"
          confirmText={deleting ? '删除中…' : '确认删除'}
          onCancel={() => { if (!deletingRef.current) setPendingDelete(null) }}
          onConfirm={() => {
            void handleDelete(pendingDelete.id)
          }}
        >
          <dl className="req-fields">
            <dt>任务</dt>
            <dd>{pendingDelete.title}</dd>
            <dt>负责人</dt>
            <dd>{pendingDelete.owner?.account ?? pendingDelete.ownerUserId}</dd>
            <dt>计划</dt>
            <dd>
              {pendingDelete.planStart} → {pendingDelete.planEnd}
            </dd>
          </dl>
          <p className="req-hint" style={{ color: '#fecaca' }}>
            删除后无法恢复。
          </p>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </ConfirmDialog>
        </div>
      ) : null}
    </div>
  )
}
