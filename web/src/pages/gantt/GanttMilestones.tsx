/**
 * US-06 甘特图（GitHub #26，只读 + 写侧前端）—— 里程碑区。
 *
 * 只读展示：名称、`dueDate`、负责人（可空 → 「无单独负责人」）、关联任务数。
 * 后端已按可见性在查询层过滤 `taskIds`，前端不自行剔除、也不反推隐藏任务。
 *
 * 写能力（体验层，**服务端才是权威**）：仅当 `canWrite`（PM）时渲染新建 / 编辑 / 删除；
 * 任何写成功后由父组件的 `onChanged` 触发 `GET /projects/:projectId/gantt` 重新拉取，
 * **不做乐观本地改写**；写失败只在对应表单 / 行旁展示错误，不改本地数据。
 */
import { useState } from 'react'
import type { ProjectMemberView } from '../../../../src/shared/types'
import Button from '../../components/Button'
import ConfirmDialog from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import { deleteMilestone, ganttWriteErrorMessage } from './api'
import GanttMilestoneEditor from './GanttMilestoneEditor'
import type { GanttMilestone, GanttTaskOption } from './types'

type Props = {
  milestones: GanttMilestone[]
  /** 是否渲染写控件（PM）。服务端仍会独立校验，前端隐藏只是体验层。 */
  canWrite: boolean
  projectId: string
  members: ProjectMemberView[]
  taskOptions: GanttTaskOption[]
  tasksTruncated: boolean
  /** 写成功回调：由页面重新拉取甘特视图并展示成功提示。 */
  onChanged: (message: string) => void
}

export default function GanttMilestones({
  milestones,
  canWrite,
  projectId,
  members,
  taskOptions,
  tasksTruncated,
  onChanged,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GanttMilestone | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  function handleSaved(message: string) {
    setCreating(false)
    setEditingId(null)
    onChanged(message)
  }

  async function handleDelete(milestone: GanttMilestone) {
    setBusyId(milestone.id)
    setRowError(null)
    try {
      await deleteMilestone(milestone.id)
      onChanged(`里程碑「${milestone.name}」已删除。`)
    } catch (error) {
      setRowError({ id: milestone.id, message: ganttWriteErrorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="gantt-write">
      {canWrite ? (
        <div className="gantt-write-toolbar">
          <Button
            type="button"
            aria-expanded={creating}
            onClick={() => {
              setEditingId(null)
              setCreating((value) => !value)
            }}
          >
            {creating ? '取消新建' : '＋ 新建里程碑'}
          </Button>
        </div>
      ) : null}

      {canWrite && creating ? (
        <GanttMilestoneEditor
          projectId={projectId}
          members={members}
          taskOptions={taskOptions}
          tasksTruncated={tasksTruncated}
          onSaved={handleSaved}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {milestones.length === 0 ? (
        <EmptyState
          level={3}
          title="本项目暂无里程碑"
          hint={
            canWrite
              ? '点击「新建里程碑」建立第一个里程碑。'
              : '里程碑建立后，这里会显示名称、截止日期、负责人与关联任务。'
          }
        />
      ) : (
        <ul className="gantt-milestones">
          {milestones.map((milestone) => (
            <li className="gantt-milestone" key={milestone.id}>
              {canWrite && editingId === milestone.id ? (
                <GanttMilestoneEditor
                  projectId={projectId}
                  members={members}
                  taskOptions={taskOptions}
                  tasksTruncated={tasksTruncated}
                  milestone={milestone}
                  onSaved={handleSaved}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="gantt-milestone-main">
                    <span className="gantt-milestone-name">{milestone.name}</span>
                    <span className="gantt-milestone-date">截止 {milestone.dueDate}</span>
                  </div>
                  <div className="gantt-milestone-meta">
                    <span>
                      负责人：
                      {milestone.ownerDisplayName ?? (
                        <span className="gantt-muted">无单独负责人</span>
                      )}
                    </span>
                    <span>关联任务 {milestone.taskIds?.length ?? 0} 个</span>
                  </div>
                  {canWrite ? (
                    <div className="gantt-row-actions">
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busyId === milestone.id}
                        onClick={() => {
                          setCreating(false)
                          setEditingId(milestone.id)
                          setRowError(null)
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busyId === milestone.id}
                        onClick={() => setPendingDelete(milestone)}
                      >
                        {busyId === milestone.id ? '删除中…' : '删除'}
                      </Button>
                    </div>
                  ) : null}
                  {rowError?.id === milestone.id ? (
                    <p className="error gantt-row-error" role="alert">
                      {rowError.message}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          title="确认删除该里程碑？"
          confirmText="确认删除"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete
            setPendingDelete(null)
            void handleDelete(target)
          }}
        >
          <dl className="req-fields">
            <dt>名称</dt>
            <dd>{pendingDelete.name}</dd>
            <dt>截止日期</dt>
            <dd>{pendingDelete.dueDate}</dd>
          </dl>
          <p className="req-hint">删除后会同时解除该里程碑与任务的关联。</p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
