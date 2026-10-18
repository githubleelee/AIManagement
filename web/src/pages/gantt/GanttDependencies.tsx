/**
 * US-06 甘特图（GitHub #26）—— 依赖区（本期仅 FS）。
 *
 * 两态语义（设计 §2、§7）**必须**保留：
 *   - `state === 'ok'`：`items` 为空才是「确实没有依赖」；
 *   - `state === 'unavailable'`：明确提示「依赖数据暂不可用」并带上原因，
 *     **绝不**退化成「没有依赖」。
 *
 * 任务标题解析：用页面构建的 `taskId → title` 映射；解析不到就显示 id 前 8 位，
 * 不显示空白、也不猜标题。
 */
import EmptyState from '../../components/EmptyState'
import type { GanttDependencies } from './types'

type Props = {
  dependencies: GanttDependencies
  taskTitleById: Map<string, string>
}

export default function GanttDependencies({ dependencies, taskTitleById }: Props) {
  if (dependencies.state === 'unavailable') {
    return (
      <div className="gantt-unavailable" role="status">
        <p className="gantt-unavailable-title">依赖数据暂不可用</p>
        <p className="gantt-unavailable-note">{dependencies.note}</p>
        <p className="gantt-unavailable-hint">
          这不代表「没有依赖」，只是当前取不到依赖数据，请以任务详情为准。
        </p>
      </div>
    )
  }

  const items = dependencies.items ?? []
  if (items.length === 0) {
    return (
      <EmptyState
        level={3}
        title="本项目暂无依赖关系"
        hint="建立「前驱 → 后继」依赖后，这里会按 FS 语义列出。"
      />
    )
  }

  const labelOf = (taskId: string): string => taskTitleById.get(taskId) ?? taskId.slice(0, 8)

  return (
    <ul className="gantt-deps">
      {items.map((dependency) => (
        <li className="gantt-dep" key={dependency.id}>
          <span className="gantt-dep-task">{labelOf(dependency.predecessorTaskId)}</span>
          <span className="gantt-dep-arrow" aria-label="前驱到后继">
            →
          </span>
          <span className="gantt-dep-task">{labelOf(dependency.successorTaskId)}</span>
          <span className="gantt-dep-type">（{dependency.type}）</span>
        </li>
      ))}
    </ul>
  )
}
