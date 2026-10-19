/**
 * US-06 甘特图（GitHub #26，只读 + 写侧前端）—— 依赖区（本期仅 FS）。
 *
 * 两态语义（设计 §2、§7）**必须**保留：
 *   - `state === 'ok'`：`items` 为空才是「确实没有依赖」；
 *   - `state === 'unavailable'`：明确提示「依赖数据暂不可用」并带上原因，
 *     **绝不**退化成「没有依赖」。
 *
 * 任务标题解析：用页面构建的 `taskId → title` 映射；解析不到就显示 id 前 8 位，
 * 不显示空白、也不猜标题。
 *
 * 写能力（体验层，**服务端才是权威**）：仅当 `canWrite`（PM）时渲染新建 / 删除；
 * 写成功后由父组件的 `onChanged` 触发 `GET /projects/:projectId/gantt` 重新拉取，
 * **不做乐观本地改写**；写失败只在对应表单 / 行旁展示错误。
 */
import { useState } from 'react'
import Button from '../../components/Button'
import ConfirmDialog from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import { deleteDependency, ganttWriteErrorMessage } from './api'
import GanttDependencyEditor from './GanttDependencyEditor'
import type { GanttDependencies, GanttDependency, GanttTaskOption } from './types'

type Props = {
  dependencies: GanttDependencies
  taskTitleById: Map<string, string>
  /** 是否渲染写控件（PM）。服务端仍会独立校验，前端隐藏只是体验层。 */
  canWrite: boolean
  projectId: string
  taskOptions: GanttTaskOption[]
  tasksTruncated: boolean
  /** 写成功回调：由页面重新拉取甘特视图并展示成功提示。 */
  onChanged: (message: string) => void
}

export default function GanttDependencies({
  dependencies,
  taskTitleById,
  canWrite,
  projectId,
  taskOptions,
  tasksTruncated,
  onChanged,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<GanttDependency | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  const labelOf = (taskId: string): string => taskTitleById.get(taskId) ?? taskId.slice(0, 8)

  async function handleDelete(dependency: GanttDependency) {
    setBusyId(dependency.id)
    setRowError(null)
    try {
      await deleteDependency(dependency.id)
      onChanged('依赖已删除。')
    } catch (error) {
      setRowError({ id: dependency.id, message: ganttWriteErrorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  const toolbar = canWrite ? (
    <div className="gantt-write-toolbar">
      <Button type="button" aria-expanded={creating} onClick={() => setCreating((value) => !value)}>
        {creating ? '取消新建' : '＋ 新建依赖'}
      </Button>
    </div>
  ) : null

  const editor =
    canWrite && creating ? (
      <GanttDependencyEditor
        projectId={projectId}
        taskOptions={taskOptions}
        tasksTruncated={tasksTruncated}
        onSaved={(message) => {
          setCreating(false)
          onChanged(message)
        }}
        onCancel={() => setCreating(false)}
      />
    ) : null

  if (dependencies.state === 'unavailable') {
    return (
      <div className="gantt-write">
        {toolbar}
        {editor}
        <div className="gantt-unavailable" role="status">
          <p className="gantt-unavailable-title">依赖数据暂不可用</p>
          <p className="gantt-unavailable-note">{dependencies.note}</p>
          <p className="gantt-unavailable-hint">
            这不代表「没有依赖」，只是当前取不到依赖数据，请以任务详情为准。
          </p>
        </div>
      </div>
    )
  }

  const items = dependencies.items ?? []

  return (
    <div className="gantt-write">
      {toolbar}
      {editor}

      {items.length === 0 ? (
        <EmptyState
          level={3}
          title="本项目暂无依赖关系"
          hint={
            canWrite
              ? '点击「新建依赖」建立「前驱 → 后继」的 FS 依赖。'
              : '建立「前驱 → 后继」依赖后，这里会按 FS 语义列出。'
          }
        />
      ) : (
        <ul className="gantt-deps">
          {items.map((dependency) => (
            <li className="gantt-dep" key={dependency.id}>
              <span className="gantt-dep-task">{labelOf(dependency.predecessorTaskId)}</span>
              <span className="gantt-dep-arrow" aria-label="前驱到后继">
                →
              </span>
              <span className="gantt-dep-task">{labelOf(dependency.successorTaskId)}</span>
              <span className="gantt-dep-type">（{dependency.type}）</span>
              {canWrite ? (
                <span className="gantt-dep-actions">
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busyId === dependency.id}
                    onClick={() => setPendingDelete(dependency)}
                  >
                    {busyId === dependency.id ? '删除中…' : '删除'}
                  </Button>
                </span>
              ) : null}
              {rowError?.id === dependency.id ? (
                <p className="error gantt-row-error" role="alert">
                  {rowError.message}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          title="确认删除该依赖？"
          confirmText="确认删除"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete
            setPendingDelete(null)
            void handleDelete(target)
          }}
        >
          <p className="req-hint">
            将从「{labelOf(pendingDelete.predecessorTaskId)}」到「
            {labelOf(pendingDelete.successorTaskId)}」的 FS 依赖移除。
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
