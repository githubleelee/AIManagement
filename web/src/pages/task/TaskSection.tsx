/**
 * M5 任务（US-05）—— 故事详情内嵌的任务区组件
 *
 * 承载：任务列表（端点 24）、新建（25）、行内编辑与状态（27/28）、删除（29）、敏感可见（30）。
 * 写操作入口仅 PM 显示（docs/frontend-routes.md：前端隐藏只为体验，服务端仍强制校验）。
 *
 * 负责人 / 验收人候选、敏感可见成员，都来自 `GET /projects/:id/members`（真实成员，非占位）。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ProjectMemberView, TaskStatus, TaskView } from '../../../../src/shared/types'
import { ApiError, listMembers } from '../../api'
import { SensitivityEditor } from '../SensitivityEditor'
import {
  createTask,
  deleteTask,
  listStoryTasks,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from './api'

const TASK_STATUS_OPTIONS: TaskStatus[] = ['TODO', 'DOING', 'DONE']
const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: '未开始',
  DOING: '进行中',
  DONE: '已完成',
}

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
  const [hint, setHint] = useState<string | null>(null)

  const canSubmit =
    title.trim() !== '' &&
    ownerUserId !== '' &&
    acceptorUserId !== '' &&
    planStart !== '' &&
    planEnd !== '' &&
    ownerUserId !== acceptorUserId &&
    planEnd >= planStart

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setHint(null)
    if (!canSubmit) {
      setHint('请填写标题、负责人、验收人与计划起止；验收人不能与负责人为同一人，结束不能早于开始。')
      return
    }
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
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="form-field">
        描述（选填）
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="form-field">
        负责人
        <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
          <option value="">请选择</option>
          {props.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.displayName}（{m.user.account}）
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        验收人
        <select value={acceptorUserId} onChange={(e) => setAcceptorUserId(e.target.value)}>
          <option value="">请选择</option>
          {props.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.displayName}（{m.user.account}）
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        计划开始
        <input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
      </label>
      <label className="form-field">
        计划结束
        <input type="date" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} />
      </label>
      {hint ? <p className="error">{hint}</p> : null}
      <div className="task-form-actions">
        <button type="submit" disabled={busy || !canSubmit}>
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

  const reload = useCallback(async () => {
    try {
      const rows = await listStoryTasks(storyId)
      setTasks(rows)
      onCountChange(rows.length)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载任务失败')
      setTasks([])
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
    setError(null)
    try {
      await deleteTask(taskId)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  async function handleStatus(taskId: string, status: TaskStatus) {
    setError(null)
    try {
      await updateTask(taskId, { status })
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '更新状态失败')
    }
  }

  const memberOptions = members.map((m) => ({ id: m.userId, displayName: m.user.displayName }))

  return (
    <div className="req-op-block">
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

      {error ? <p className="error">{error}</p> : null}

      {showCreate && isPm ? (
        <TaskForm
          members={members}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      ) : null}

      {tasks === null ? (
        <p className="req-placeholder">正在加载任务…</p>
      ) : tasks.length === 0 ? (
        <p className="req-placeholder">这条需求下还没有任务。</p>
      ) : (
        <table className="req-table">
          <thead>
            <tr>
              <th>任务</th>
              <th>负责人</th>
              <th>验收人</th>
              <th className="nowrap">计划</th>
              <th>状态</th>
              {isPm ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td className="req-mono">{t.owner?.account ?? t.ownerUserId}</td>
                <td className="req-mono">{t.acceptor?.account ?? t.acceptorUserId}</td>
                <td className="req-mono nowrap">
                  {t.planStart} → {t.planEnd}
                </td>
                <td>
                  {isPm ? (
                    <select
                      value={t.status}
                      onChange={(e) => void handleStatus(t.id, e.target.value as TaskStatus)}
                    >
                      {TASK_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    TASK_STATUS_LABEL[t.status]
                  )}
                </td>
                {isPm ? (
                  <td className="nowrap">
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
                      onClick={() => void handleDelete(t.id)}
                    >
                      删除
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
                  initial={{ isSensitive: target.isSensitive, visibleMemberIds: [] }}
                />
              </div>
            )
          })()
        : null}
    </div>
  )
}
