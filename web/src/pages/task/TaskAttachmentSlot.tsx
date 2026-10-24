import { useEffect, useState } from 'react'
import type { ProjectView, TaskView } from '../../../../src/shared/types'
import { apiFetch, ApiError } from '../../api'
import TaskAttachmentPanel from '../attachment/TaskAttachmentPanel'

/** Fresh project/task projections gate the lazy panel. Presentation only; attachment HTTP reauthorizes. */
export default function TaskAttachmentSlot({ projectId, taskId, actorId }: { projectId: string; taskId: string; actorId: string | null }) {
  const [access, setAccess] = useState<{ canWrite: boolean } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setAccess(null); setError('')
    void Promise.all([
      apiFetch<ProjectView>(`/projects/${encodeURIComponent(projectId)}`, { signal: abort.signal }),
      apiFetch<TaskView>(`/tasks/${encodeURIComponent(taskId)}`, { signal: abort.signal }),
    ]).then(([project, task]) => {
      if (abort.signal.aborted) return
      if (project.id !== projectId || task.id !== taskId || task.projectId !== projectId) throw new Error('对象归属不一致')
      setAccess({ canWrite: project.myRole === 'PM' || (project.myRole === 'MEMBER' && actorId !== null && task.ownerUserId === actorId) })
    }).catch(cause => {
      if (abort.signal.aborted) return
      setAccess(null)
      setError(cause instanceof ApiError && [401, 403, 404].includes(cause.status)
        ? '任务不可见或权限已变化，未加载附件。' : '附件入口加载失败，请关闭后重试。')
      abort.abort()
    })
    return () => abort.abort()
  }, [projectId, taskId, actorId])
  return <section aria-label="附件访问检查">
    {error ? <p role="alert">{error}</p> : access ? <TaskAttachmentPanel taskId={taskId} canWrite={access.canWrite} /> : <p role="status">正在检查附件访问权限…</p>}
  </section>
}
