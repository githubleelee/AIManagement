/**
 * US-06 甘特图（GitHub #26，写侧前端）—— 里程碑新建 / 行内编辑表单。
 *
 * 权限口径（服务端为准，这里只是体验层）：本组件只在 `GanttMilestones` 判定
 * `canWrite`（`project.myRole === 'PM'`）后挂载；服务端 `gantt.write` 仍会拒绝非 PM。
 *
 * 契约（后端 #12 已冻结）：
 *   - 新建 `POST /projects/:projectId/milestones` → 201 `MilestoneWriteView`；
 *   - 编辑 `PATCH /milestones/:milestoneId` **只提交改动过的字段**：未改 `taskIds`
 *     就不带它，避免无谓的整体替换（`taskIds` 出现即整体替换，含 `[]` = 清空）。
 *
 * 关联任务选择器**只列当前甘特视图内的可见任务**（由父组件从 `GanttView` 构建），
 * 按故事标题分组，**绝不**另拉全量任务接口；视图截断时显式提示「列表可能不完整」。
 */
import { useMemo, useState, type FormEvent } from 'react'
import type { ProjectMemberView } from '../../../../src/shared/types'
import Button from '../../components/Button'
import FormField from '../../components/FormField'
import { ApiError } from '../../api'
import { fieldErrorHint } from '../requirement/terms'
import { createMilestone, ganttWriteErrorMessage, updateMilestone } from './api'
import type { GanttMilestone, GanttTaskOption, MilestonePatchInput } from './types'

/** 名称长度上限：与后端 `MILESTONE_NAME_MAX_LENGTH` 一致（超长服务端 422 `TOO_LONG`）。 */
const NAME_MAX_LENGTH = 100

/** 里程碑写侧字段名 → 界面标签（`details[].field` 翻译用，避免内部命名外露）。 */
const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  dueDate: '截止日期',
  ownerUserId: '负责人',
  taskIds: '关联任务',
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? '该字段'
}

/** 忽略顺序的 id 集合相等判定：用于「关联任务是否真的改过」。 */
function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

type Props = {
  projectId: string
  /** 负责人候选（来自 `listMembers`），失败时为空数组，仍可「不指定」。 */
  members: ProjectMemberView[]
  /** 当前甘特视图内的可见任务选项。 */
  taskOptions: GanttTaskOption[]
  /** 视图任务是否被截断（为真时选择器注明「可能不完整」，且不得反推总数）。 */
  tasksTruncated: boolean
  /** 编辑态传入既有里程碑；新建态不传。 */
  milestone?: GanttMilestone
  onSaved: (message: string) => void
  onCancel: () => void
}

export default function GanttMilestoneEditor({
  projectId,
  members,
  taskOptions,
  tasksTruncated,
  milestone,
  onSaved,
  onCancel,
}: Props) {
  const editing = milestone !== undefined
  const [name, setName] = useState(milestone?.name ?? '')
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? '')
  const [ownerUserId, setOwnerUserId] = useState(milestone?.ownerUserId ?? '')
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    () => new Set(milestone?.taskIds ?? []),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Array<{ field: string; code: string }>>([])
  const [info, setInfo] = useState<string | null>(null)

  const optionIds = useMemo(() => new Set(taskOptions.map((option) => option.id)), [taskOptions])
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; title: string; tasks: GanttTaskOption[] }>()
    for (const option of taskOptions) {
      const group = map.get(option.storyId)
      if (group) group.tasks.push(option)
      else map.set(option.storyId, { id: option.storyId, title: option.storyTitle, tasks: [option] })
    }
    return [...map.values()]
  }, [taskOptions])

  // 编辑态：已关联但**不在可见任务列表内**的任务数（视图截断 / 不可见）。
  // 它不参与本表单的勾选；一旦修改关联，服务端会以本次勾选整体替换 —— 必须提示。
  const hiddenLinkedCount = milestone
    ? (milestone.taskIds ?? []).filter((id) => !optionIds.has(id)).length
    : 0

  const toggleTask = (id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFieldErrors([])
    setInfo(null)

    const trimmedName = name.trim()
    if (trimmedName === '') {
      setFieldErrors([{ field: 'name', code: 'REQUIRED' }])
      return
    }
    if (trimmedName.length > NAME_MAX_LENGTH) {
      setFieldErrors([{ field: 'name', code: 'TOO_LONG' }])
      return
    }
    if (dueDate === '') {
      setFieldErrors([{ field: 'dueDate', code: 'REQUIRED' }])
      return
    }

    setBusy(true)
    try {
      if (milestone) {
        // 只提交改动过的字段：未改的字段不出现在 PATCH 体里。
        const patch: MilestonePatchInput = {}
        const changed: string[] = []
        if (trimmedName !== milestone.name) {
          patch.name = trimmedName
          changed.push('名称')
        }
        if (dueDate !== milestone.dueDate) {
          patch.dueDate = dueDate
          changed.push('截止日期')
        }
        const owner = ownerUserId === '' ? null : ownerUserId
        if (owner !== milestone.ownerUserId) {
          patch.ownerUserId = owner
          changed.push('负责人')
        }
        const nextTaskIds = [...selectedTaskIds]
        if (!sameIdSet(nextTaskIds, milestone.taskIds ?? [])) {
          patch.taskIds = nextTaskIds
          changed.push('关联任务')
        }

        if (changed.length === 0) {
          setInfo('没有任何改动，未提交。')
          return
        }

        await updateMilestone(milestone.id, patch)
        onSaved(`里程碑「${trimmedName}」已保存（仅提交改动字段：${changed.join('、')}）。`)
      } else {
        await createMilestone(projectId, {
          name: trimmedName,
          dueDate,
          ownerUserId: ownerUserId === '' ? null : ownerUserId,
          taskIds: [...selectedTaskIds],
        })
        onSaved(`里程碑「${trimmedName}」已创建。`)
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.details && caught.details.length > 0) {
        // 422：字段级错误贴在表单旁，按 `details[].field` 标注是哪一项。
        setFieldErrors(caught.details)
      } else {
        // 403 / 404 / 其它：用统一口径 / 服务端 message，贴在表单旁。
        setError(ganttWriteErrorMessage(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form gantt-editor" onSubmit={handleSubmit}>
      <p className="gantt-editor-title">
        {editing ? `编辑里程碑「${milestone?.name}」` : '新建里程碑'}
      </p>

      {error ? (
        <p className="error gantt-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="gantt-form-info" role="status">
          {info}
        </p>
      ) : null}
      {fieldErrors.length > 0 ? (
        <div className="error gantt-form-error" role="alert">
          <ul className="gantt-field-errors">
            {fieldErrors.map((detail, index) => (
              <li key={`${detail.field}-${index}`}>
                <b>{fieldLabel(detail.field)}</b>：{fieldErrorHint(detail.code)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="gantt-form-grid">
        <FormField label="名称（必填）">
          <input
            value={name}
            maxLength={NAME_MAX_LENGTH}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="截止日期（必填）">
          <input
            type="date"
            value={dueDate}
            required
            onChange={(event) => setDueDate(event.target.value)}
          />
        </FormField>
        <FormField label="负责人">
          <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
            <option value="">不指定</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.user.displayName}（{member.user.account}）
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <fieldset className="gantt-task-picker">
        <legend>关联任务（可选，只列当前甘特视图内的可见任务）</legend>
        {tasksTruncated ? (
          <p className="gantt-picker-note">
            视图已截断，下列任务列表可能不完整；未列出的任务无法在此勾选。
          </p>
        ) : null}
        {hiddenLinkedCount > 0 ? (
          <p className="gantt-picker-note">
            该里程碑另有 {hiddenLinkedCount} 个关联任务不在此列表内；一旦修改关联，将以本次勾选整体替换。
          </p>
        ) : null}
        {groups.length === 0 ? (
          <p className="gantt-muted">当前视图内没有可关联的可见任务。</p>
        ) : (
          groups.map((group) => (
            <div className="gantt-task-group" key={group.id}>
              <p className="gantt-task-group-title">{group.title}</p>
              <div className="gantt-task-group-items">
                {group.tasks.map((task) => (
                  <label className="gantt-task-option" key={task.id}>
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.has(task.id)}
                      onChange={() => toggleTask(task.id)}
                    />
                    <span>
                      {task.title}
                      <span className="gantt-muted">（{task.ownerDisplayName}）</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </fieldset>

      <div className="gantt-form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? '保存中…' : editing ? '保存修改' : '创建里程碑'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  )
}
