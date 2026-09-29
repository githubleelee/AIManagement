import type { TaskStatus } from '../../../../src/shared/types'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: '未开始',
  DOING: '进行中',
  DONE: '已完成',
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`task-status task-status--${status.toLowerCase()}`}>{TASK_STATUS_LABEL[status]}</span>
}
