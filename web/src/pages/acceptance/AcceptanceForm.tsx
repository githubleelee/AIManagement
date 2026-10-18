import { useState } from 'react'
import type { TaskView } from '../../../../src/shared/types'
import { ApiError } from '../../api'
import { submitAcceptance, type AcceptanceConclusion, type AcceptanceSubmitResult } from './api'

/**
 * 任务验收表单（US-09 / 工单 #29）。
 *
 * ===========================================================================
 * 三条刻意的设计（都来自上一票踩过的坑）
 * ===========================================================================
 *
 * 1. **不预选结论**。默认选中"通过"会让一次误点直接把任务关掉（不可回退的状态），
 *    因此这里必须显式选择，未选时提交按钮不可用。这是**体验层的刻意摩擦**。
 * 2. **驳回原因必填，界面先拦一次**；服务端再强制一次（`422 reason: REQUIRED`）——
 *    只靠界面拦是本仓库已经出过的问题（US-08 审查 B-5）。
 * 3. **只提交 `conclusion` / `reason` 两个字段**。验收端点不存在"捎带改标题 / 负责人 /
 *    计划"的通道，这里也不构造多余字段。
 *
 * ⚠️ 调用方必须传 `key={<taskId>}`：否则从任务 A 切到 B 时组件复用、`useState`
 *    初值不重跑，会把 A 的结论与原因写进 B（本仓库已出现过两次的坑）。
 */
export default function AcceptanceForm({
  task,
  onSubmitted,
  onCancel,
}: {
  task: TaskView
  onSubmitted: (result: AcceptanceSubmitResult) => void
  onCancel: () => void
}) {
  const [conclusion, setConclusion] = useState<AcceptanceConclusion | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(): Promise<void> {
    setError(null)

    if (conclusion === null) {
      setError('请先选择验收结论（通过或驳回）。')
      return
    }
    const trimmed = reason.trim()
    if (conclusion === 'REJECT' && trimmed === '') {
      setError('驳回必须填写原因，说明需要修复什么。')
      return
    }
    if (trimmed.length > 200) {
      setError('原因最多 200 字。')
      return
    }

    setBusy(true)
    try {
      const result = await submitAcceptance(task.id, {
        conclusion,
        reason: trimmed === '' ? null : trimmed,
      })
      onSubmitted(result)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '提交失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="form acc-form"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSubmit()
      }}
    >
      <p className="req-side-title">验收任务「{task.title}」</p>
      <p className="acc-hint">
        通过 → 任务进入「已验收」；驳回 → 任务回到「进行中」，执行人修复后重新提交验收。
      </p>

      <fieldset className="acc-fieldset">
        <legend>验收结论</legend>
        <label className="acc-radio">
          <input
            type="radio"
            name="conclusion"
            value="PASS"
            checked={conclusion === 'PASS'}
            onChange={() => setConclusion('PASS')}
          />
          通过（关闭任务）
        </label>
        <label className="acc-radio">
          <input
            type="radio"
            name="conclusion"
            value="REJECT"
            checked={conclusion === 'REJECT'}
            onChange={() => setConclusion('REJECT')}
          />
          驳回（退回执行）
        </label>
      </fieldset>

      <label className="form-field">
        原因{conclusion === 'REJECT' ? '（必填）' : '（选填）'}
        <textarea
          rows={3}
          value={reason}
          placeholder={
            conclusion === 'REJECT'
              ? '说明哪些验收条件没达成、需要修复什么'
              : '可留下通过时的说明（选填）'
          }
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="task-form-actions">
        <button type="submit" disabled={busy || conclusion === null}>
          {busy ? '提交中…' : conclusion === 'REJECT' ? '确认驳回' : '确认通过'}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}
