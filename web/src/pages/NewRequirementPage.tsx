import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { GoalNode, ProjectView } from '../../../src/shared/types'
import PageHeader from '../components/PageHeader'
import { RequirementEditor, type EditorTarget } from './requirement/Editor'
import { getGoalTree } from './requirement/api'
import './requirement/requirement.css'

type NewKind = 'goal' | 'activity' | 'story'

export default function NewRequirementPage({ kind }: { kind: NewKind }) {
  const project = useOutletContext<ProjectView>()
  const { goalId, activityId } = useParams()
  const navigate = useNavigate()
  const [goals, setGoals] = useState<GoalNode[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadParents = useCallback(async () => {
    try {
      setGoals(await getGoalTree(project.id))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '无法加载所属层级。')
    }
  }, [project.id])

  useEffect(() => { void loadParents() }, [loadParents])

  const goal = kind === 'activity'
    ? goals?.find(item => item.id === goalId)
    : kind === 'story'
      ? goals?.find(item => item.activities.some(activity => activity.id === activityId))
      : undefined
  const activity = kind === 'story'
    ? goal?.activities.find(item => item.id === activityId)
    : undefined

  let target: EditorTarget | null = null
  if (kind === 'goal') target = { kind: 'goal', mode: 'create' }
  else if (kind === 'activity' && goal) target = { kind: 'activity', mode: 'create', goal }
  else if (kind === 'story' && activity) target = { kind: 'story', mode: 'create', activity }

  const backToList = () => navigate(`/projects/${project.id}/requirements`)
  const title = kind === 'goal' ? '新建业务目标' : kind === 'activity' ? '新建用户活动' : '新建用户故事'

  return (
    <div className="page req-redesign req-create-screen">
      <PageHeader title={title} description={project.name} />
      <Link className="req-create-back link" to={`/projects/${project.id}/requirements`}>← 返回需求层级</Link>
      {project.myRole !== 'PM' ? <p className="req-error" role="alert">只有项目经理可以新建需求层级内容。</p> : null}
      {loadError ? <p className="req-error" role="alert">{loadError}</p> : null}
      {!goals && !loadError && kind !== 'goal' ? <p className="page-loading">正在加载所属层级…</p> : null}
      {goals && !target && !loadError && kind !== 'goal' ? <p className="req-error" role="alert">找不到所属的目标或活动，请返回需求层级重新选择。</p> : null}
      {target && project.myRole === 'PM' ? (
        <section className="req-create-card">
          {kind === 'activity' && goal ? <p className="req-create-parent">所属目标：{goal.name}</p> : null}
          {kind === 'story' && goal && activity ? <p className="req-create-parent">所属目标：{goal.name}　›　所属活动：{activity.name}</p> : null}
          <RequirementEditor
            key={`${kind}:${goalId ?? ''}:${activityId ?? ''}`}
            projectId={project.id}
            target={target}
            onCancel={backToList}
            onSaved={(message) => navigate(`/projects/${project.id}/requirements`, { replace: true, state: { creationNotice: message } })}
          />
        </section>
      ) : null}
    </div>
  )
}
