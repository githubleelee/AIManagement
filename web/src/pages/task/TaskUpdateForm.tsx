import { useState } from 'react'
import type { TaskStatus, TaskView } from '../../../../src/shared/types'
import { ApiError } from '../../api'
import { TASK_STATUS_LABEL } from './TaskStatusBadge'
import { updateTask, type UpdateTaskInput } from './api'

/**
 * 任务「状态 / 进度 / 卡住原因」的行内更新表单（US-08 / 工单 #28，AC8）。
 *
 * 为什么单独一个组件：任务区主组件已经很大，把这块独立出来便于审阅，也避免在
 * 主组件里塞一大段条件渲染。
 *
 * 权限口径（服务端为准，这里只是体验层）：
 *   - 负责人 / 验收人 / 项目经理 能看到入口（由调用方判断后挂载）；
 *   - 「已验收关闭」只有**验收人或项目经理**能选 —— 负责人不能自验自收；
 *   - 只提交 status / progress / blockedReason，服务端据此按 task.progress 或
 *     task.accept 判权，不会经由这条路径改负责人、验收人或计划。
 */
const ALL_STATUSES: readonly TaskStatus[] = [
  'TODO',
  'DOING',
  'BLOCKED',
  'SUSPENDED',
  'DONE',
  'CLOSED',
]

export default function TaskUpdateForm({
  task,
  canClose,
  onSaved,
  onCancel,
}: {
  task: TaskView
  /** 是否允许把状态设为「已验收关闭」（验收人或项目经理） */
  canClose: boolean
  onSaved: () => void
  onCancel: () => void
}) {
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [progress, setProgress] = useState(task.progress === null ? '' : String(task.progress))
  const [reason, setReason] = useState(task.blockedReason ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 负责人看不到「已验收关闭」；验收人/项目经理才能选。 */
  const options = ALL_STATUSES.filter((value) => value !== 'CLOSED' || canClose)

  async function handleSubmit(): Promise<void> {
    setError(null)

    if (status === 'BLOCKED' && reason.trim() === '') {
      setError('状态选「卡住」时必须填写原因。')
      return
    }

    const patch: UpdateTaskInput = { status }
    const progressText = progress.trim()
    if (progressText !== '') {
      const parsed = Number(progressText)
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
        setError('进度要填 0 到 100 之间的整数。')
        return
      }
      patch.progress = parsed
    }
    // 只有「卡住」才带原因；切出卡住态时清空，避免留下过期原因。
    patch.blockedReason = status === 'BLOCKED' ? reason.trim() : null

    setBusy(true)
    try {
      await updateTask(task.id, patch)
      onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '保存失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="form task-form"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSubmit()
      }}
    >
      <p className="req-side-title">更新任务「{task.title}」</p>

      <label className="form-field">
        状态
        <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
          {options.map((value) => (
            <option key={value} value={value}>
              {TASK_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="form-field">
        进度（0-100，选填）
        <input
          value={progress}
          inputMode="numeric"
          placeholder="例如 60"
          onChange={(event) => setProgress(event.target.value)}
        />
      </label>

      {status === 'BLOCKED' ? (
        <label className="form-field">
          卡住原因（必填）
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="task-form-actions">
        <button type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}
