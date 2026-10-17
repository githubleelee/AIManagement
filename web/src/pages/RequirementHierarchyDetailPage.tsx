import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { GoalNode, ProjectView } from '../../../src/shared/types'
import { ApiError } from '../api'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import { RequirementEditor, type EditorTarget } from './requirement/Editor'
import { deleteActivity, deleteGoal, getGoalTree, reorderActivities, reorderGoals } from './requirement/api'
import { DetailPane, type RowAction } from './ProjectRequirementsPage'

export default function RequirementHierarchyDetailPage({ kind }: { kind: 'goal' | 'activity' }) {
  const project = useOutletContext<ProjectView>()
  const { goalId, activityId } = useParams()
  const id = kind === 'goal' ? goalId : activityId
  const navigate = useNavigate()
  const [goals, setGoals] = useState<GoalNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGoals(await getGoalTree(project.id))
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加载详情失败')
    }
  }, [project.id])

  useEffect(() => { void load() }, [load])

  const goal = goals?.find(item => item.id === id || item.activities.some(activity => activity.id === id))
  const activity = kind === 'activity' ? goal?.activities.find(item => item.id === id) : undefined
  const current = kind === 'goal' ? goal?.id === id : Boolean(activity)
  const parentList = kind === 'goal' ? goals ?? [] : goal?.activities ?? []
  const index = parentList.findIndex(item => item.id === id)
  const hasChildren = kind === 'goal' ? Boolean(goal?.activities.length) : Boolean(activity?.stories.length)

  function open(kindToOpen: 'goal' | 'activity' | 'story', targetId: string) {
    const suffix = kindToOpen === 'story' ? targetId : `${kindToOpen === 'goal' ? 'goals' : 'activities'}/${targetId}`
    navigate(`/projects/${project.id}/requirements/${suffix}`)
  }

  async function act(action: RowAction) {
    if (project.myRole !== 'PM' || !goals || !id || busy) return
    if (action.type === 'edit-goal' && goal) { setEditor({ kind: 'goal', mode: 'edit', goal }); return }
    if (action.type === 'edit-activity' && goal && activity) { setEditor({ kind: 'activity', mode: 'edit', goal, activity }); return }
    if (action.type === 'delete') { setConfirmDelete(true); return }
    if ((action.type !== 'move-goal' && action.type !== 'move-activity') || index < 0) return
    const nextIndex = index + action.delta
    if (nextIndex < 0 || nextIndex >= parentList.length) return
    const ids = parentList.map(item => item.id)
    ;[ids[index], ids[nextIndex]] = [ids[nextIndex]!, ids[index]!]
    setBusy(true)
    try {
      if (kind === 'goal') await reorderGoals(project.id, ids)
      else if (goal) await reorderActivities(goal.id, ids)
      await load()
      setNotice('顺序已保存。')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '排序失败')
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!id || hasChildren || project.myRole !== 'PM') return
    setBusy(true)
    try {
      if (kind === 'goal') await deleteGoal(id)
      else await deleteActivity(id)
      navigate(`/projects/${project.id}/requirements`, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '删除失败')
    } finally { setBusy(false); setConfirmDelete(false) }
  }

  return (
    <div className="page req-redesign req-hierarchy-detail-screen">
      <PageHeader title={kind === 'goal' ? '业务目标详情' : '用户活动详情'} description={project.name} />
      <Link className="link" to={`/projects/${project.id}/requirements`}>← 返回需求层级</Link>
      {error ? <p className="req-error" role="alert">{error}</p> : null}
      {notice ? <p className="req-ok" role="status">{notice}</p> : null}
      {!goals && !error ? <p className="page-loading">加载中…</p> : null}
      {goals && !current ? <p className="req-placeholder">找不到这项内容，或你没有查看权限。</p> : null}
      {goals && current && id ? (
        <section className="req-main">
          {editor ? (
            <RequirementEditor
              projectId={project.id}
              target={editor}
              onCancel={() => setEditor(null)}
              onSaved={(message) => { setEditor(null); setNotice(message); void load() }}
            />
          ) : (
            <DetailPane
              goals={goals}
              projectId={project.id}
              selection={{ kind, id }}
              tab="detail"
              onTab={() => {}}
              onSelect={open}
              isPM={project.myRole === 'PM'}
              busy={busy}
              onAction={(action) => { void act(action) }}
            />
          )}
        </section>
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title={hasChildren ? '请先处理下级内容' : `确认删除${kind === 'goal' ? '业务目标' : '用户活动'}？`}
          confirmText={hasChildren ? '知道了' : '确认删除'}
          danger={!hasChildren}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { if (hasChildren) setConfirmDelete(false); else void remove() }}
        >
          <p>{hasChildren ? '当前内容下仍有下级，无法删除。' : `即将删除「${kind === 'goal' ? goal?.name : activity?.name}」。`}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
