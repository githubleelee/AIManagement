/**
 * US-06 甘特图（GitHub #26，写侧前端）—— FS 依赖新建表单。
 *
 * 权限口径（服务端为准，这里只是体验层）：本组件只在 `GanttDependencies` 判定
 * `canWrite`（`project.myRole === 'PM'`）后挂载；服务端 `gantt.write` 仍会拒绝非 PM。
 *
 * 契约（后端 #12 已冻结）：`POST /projects/:projectId/task-dependencies`
 *   - 请求 `{ predecessorTaskId, successorTaskId, type? }`，`type` 缺省即 FS；
 *   - 成功 201 `TaskDependencyView`；
 *   - 422：自依赖 / 跨项目 / 类型非 FS，`details[0].field` 指明字段 → 定位到对应控件旁；
 *   - **409 `CONFLICT`**：重复边（`message`「该依赖已存在」）或 FS 环（`message`「加入该依赖会形成 FS 环」）
 *     → 把服务端 `message` 原样贴在本表单旁，两者靠 message 区分。
 *
 * 本期类型固定 FS：「类型」只作展示（不可选），旁注「本期仅支持 FS」。
 * 两端任务下拉**只列当前甘特视图内的可见任务**，文案含故事标题与负责人。
 */
import { useState, type FormEvent } from 'react'
import Button from '../../components/Button'
import { ApiError } from '../../api'
import { fieldErrorHint } from '../requirement/terms'
import { createDependency, ganttWriteErrorMessage } from './api'
import type { GanttTaskOption } from './types'

type Props = {
  projectId: string
  /** 当前甘特视图内的可见任务选项（两端下拉共用）。 */
  taskOptions: GanttTaskOption[]
  /** 视图任务是否被截断（为真时注明「可能不完整」）。 */
  tasksTruncated: boolean
  onSaved: (message: string) => void
  onCancel: () => void
}

/** 选项文案：含故事标题与负责人，避免只看到同名任务。 */
function taskLabel(option: GanttTaskOption): string {
  return `${option.storyTitle} / ${option.title}（${option.ownerDisplayName}）`
}

export default function GanttDependencyEditor({
  projectId,
  taskOptions,
  tasksTruncated,
  onSaved,
  onCancel,
}: Props) {
  const [predecessorTaskId, setPredecessorTaskId] = useState('')
  const [successorTaskId, setSuccessorTaskId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Array<{ field: string; code: string }>>([])

  const errorFor = (field: string) => fieldErrors.find((detail) => detail.field === field)
  // 已内联定位的三个字段之外的 details 兜底展示（保持「错误必有其处」）。
  const otherFieldErrors = fieldErrors.filter(
    (detail) => !['predecessorTaskId', 'successorTaskId', 'type'].includes(detail.field),
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFieldErrors([])

    if (predecessorTaskId === '' || successorTaskId === '') {
      setError('请先选择前驱任务与后继任务。')
      return
    }

    setBusy(true)
    try {
      const created = await createDependency(projectId, {
        predecessorTaskId,
        successorTaskId,
        type: 'FS',
      })
      const predecessor = taskOptions.find((option) => option.id === created.predecessorTaskId)
      const successor = taskOptions.find((option) => option.id === created.successorTaskId)
      const from = predecessor?.title ?? created.predecessorTaskId.slice(0, 8)
      const to = successor?.title ?? created.successorTaskId.slice(0, 8)
      onSaved(`依赖已创建：${from} → ${to}（FS）。`)
    } catch (caught) {
      if (!(caught instanceof ApiError)) {
        setError('创建依赖失败，请稍后重试。')
      } else if (caught.status === 409) {
        // 重复边 / FS 环：服务端 message 已能区分（「该依赖已存在」/「…会形成 FS 环」）。
        setError(caught.message)
        setFieldErrors(caught.details ?? [])
      } else if (caught.details && caught.details.length > 0) {
        // 422：按 `details[].field` 定位到前驱 / 后继控件旁显示。
        setFieldErrors(caught.details)
      } else {
        setError(ganttWriteErrorMessage(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form gantt-editor" onSubmit={handleSubmit}>
      <p className="gantt-editor-title">新建任务依赖</p>

      {error ? (
        <p className="error gantt-form-error" role="alert">
          {error}
        </p>
      ) : null}

      {otherFieldErrors.length > 0 ? (
        <div className="error gantt-form-error" role="alert">
          <ul className="gantt-field-errors">
            {otherFieldErrors.map((detail, index) => (
              <li key={`${detail.field}-${index}`}>
                <b>{detail.field}</b>：{fieldErrorHint(detail.code)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="gantt-form-grid">
        <label className="form-field">
          <span>前驱任务</span>
          <select
            value={predecessorTaskId}
            required
            onChange={(event) => setPredecessorTaskId(event.target.value)}
          >
            <option value="">请选择</option>
            {taskOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {taskLabel(option)}
              </option>
            ))}
          </select>
          {errorFor('predecessorTaskId') ? (
            <span className="gantt-field-error" role="alert">
              前驱任务：{fieldErrorHint(errorFor('predecessorTaskId')!.code)}
            </span>
          ) : null}
        </label>

        <label className="form-field">
          <span>后继任务</span>
          <select
            value={successorTaskId}
            required
            onChange={(event) => setSuccessorTaskId(event.target.value)}
          >
            <option value="">请选择</option>
            {taskOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {taskLabel(option)}
              </option>
            ))}
          </select>
          {errorFor('successorTaskId') ? (
            <span className="gantt-field-error" role="alert">
              后继任务：{fieldErrorHint(errorFor('successorTaskId')!.code)}
            </span>
          ) : null}
        </label>

        <div className="gantt-field-static">
          <span className="gantt-field-static-label">类型</span>
          <span className="gantt-type-fixed">FS（完成—开始）</span>
          <span className="gantt-muted">本期仅支持 FS</span>
          {errorFor('type') ? (
            <span className="gantt-field-error" role="alert">
              依赖类型：{fieldErrorHint(errorFor('type')!.code)}
            </span>
          ) : null}
        </div>
      </div>

      {tasksTruncated ? (
        <p className="gantt-picker-note">
          视图已截断，下列任务列表可能不完整；未列出的任务无法在此选择。
        </p>
      ) : null}
      {taskOptions.length < 2 ? (
        <p className="gantt-picker-note">当前可见任务不足两个，无法建立依赖。</p>
      ) : null}

      <div className="gantt-form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? '提交中…' : '创建依赖'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  )
}
