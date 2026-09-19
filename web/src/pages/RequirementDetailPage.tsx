import { useParams } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'

/** 需求详情占位（US-03 / T3.7 后续接入）。 */
export default function RequirementDetailPage() {
  const { storyId } = useParams()

  return (
    <div className="page">
      <PageHeader title="需求详情" description={`用户故事 ${storyId ?? ''}`} />
      <EmptyState
        title="US-03 后续实现"
        hint="用户故事详情与任务列表将在此页承载（对应文档 IA 的「需求详情 → 任务列表」）。"
      />
    </div>
  )
}
