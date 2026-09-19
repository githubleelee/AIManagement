import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'

/** 需求层级占位（US-03 / T3.x 后续接入）。 */
export default function ProjectRequirementsPage() {
  return (
    <div className="page">
      <PageHeader title="需求" description="业务目标 → 用户活动 → 用户故事" />
      <EmptyState
        title="US-03 后续实现"
        hint="需求层级树与敏感可见性将在 Sprint 1 的 US-03 模块接入。"
      />
    </div>
  )
}
