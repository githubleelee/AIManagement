import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ProjectView } from '../../../src/shared/types'
import { listMembers } from '../api'
import PageHeader from '../components/PageHeader'
import { ROLE_LABELS } from '../labels'

/** 项目概览（T1.2 详情）+ 未来模块占位。 */
export default function ProjectOverviewPage() {
  const project = useOutletContext<ProjectView>()
  const [memberCount, setMemberCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    listMembers(project.id)
      .then((res) => {
        if (!cancelled) setMemberCount(res.items.length)
      })
      .catch(() => {
        if (!cancelled) setMemberCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  return (
    <div className="page">
      <PageHeader title="项目概览" description={project.description ?? '无描述'} />

      <dl className="meta-grid">
        <div>
          <dt>项目名称</dt>
          <dd>{project.name}</dd>
        </div>
        <div>
          <dt>我的角色</dt>
          <dd>{ROLE_LABELS[project.myRole]}</dd>
        </div>
        <div>
          <dt>成员数</dt>
          <dd>{memberCount ?? '—'}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{new Date(project.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      <div className="placeholder-grid">
        <section className="placeholder-card">
          <h3>需求概览</h3>
          <p className="muted">业务目标 / 用户活动 / 用户故事将在 US-03（Sprint 后续）接入。</p>
        </section>
        <section className="placeholder-card">
          <h3>任务概览</h3>
          <p className="muted">任务与负责人 / 验收人将在 US-05（Sprint 后续）接入。</p>
        </section>
      </div>
    </div>
  )
}

