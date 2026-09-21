import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'

/** 任务列表占位（US-05 / T5.x 后续接入）。 */
export default function ProjectTasksPage() {
  return (
    <div className="page">
      <PageHeader title="任务" description="按负责人 / 计划时间组织的任务列表" />
      <EmptyState
        title="US-05 后续实现"
        hint="任务创建、负责人 / 验收人与计划时间将在 Sprint 1 的 US-05 模块接入。"
      />
    </div>
  )
}

