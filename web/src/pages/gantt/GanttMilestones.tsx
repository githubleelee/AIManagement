/**
 * US-06 甘特图（GitHub #26）—— 里程碑区。
 *
 * 只读：名称、`dueDate`、负责人（可空 → 「无单独负责人」）、关联任务数。
 * 后端已按可见性在查询层过滤 `taskIds`，前端不自行剔除、也不反推隐藏任务。
 */
import EmptyState from '../../components/EmptyState'
import type { GanttMilestone } from './types'

export default function GanttMilestones({ milestones }: { milestones: GanttMilestone[] }) {
  if (milestones.length === 0) {
    return (
      <EmptyState
        level={3}
        title="本项目暂无里程碑"
        hint="里程碑建立后，这里会显示名称、截止日期、负责人与关联任务。"
      />
    )
  }

  return (
    <ul className="gantt-milestones">
      {milestones.map((milestone) => (
        <li className="gantt-milestone" key={milestone.id}>
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
        </li>
      ))}
    </ul>
  )
}
