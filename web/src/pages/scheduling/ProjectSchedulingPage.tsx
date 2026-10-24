import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ProjectView } from '../../../../src/shared/types'
import { ApiError, getProject } from '../../api'
import { useAuth } from '../../auth/AuthContext'
import SchedulingPage, { type SchedulingPageProps } from './SchedulingPage'
import { createSchedulingClient } from './api'

/** Server-reported project membership, for navigation UX only; APIs always reauthorize. */
export function canAccessScheduling(project: Pick<ProjectView, 'myRole'> | null | undefined): boolean {
  return project?.myRole === 'PM'
}

type Access = SchedulingPageProps['access']
type Grant = { sessionKey: string; projectId: string; access: Access; error?: boolean }

/** B's production wrapper: no demo data and no stale grant carried across identities. */
export default function ProjectSchedulingPage() {
  const project = useOutletContext<ProjectView>()
  const { user } = useAuth()
  const projectId = project.id
  const sessionKey = user?.id ?? ''
  const [grant, setGrant] = useState<Grant>()
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    if (!user) return
    // ProjectLayout's earlier response may belong to a previous identity. Recheck a grant
    // bound to BOTH project and current session before constructing a scheduling client.
    getProject(projectId).then((current) => {
      if (!cancelled) setGrant({ sessionKey, projectId,
        access: canAccessScheduling(current) ? 'allowed' : 'forbidden' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const status = error instanceof ApiError ? error.status : undefined
      setGrant({ sessionKey, projectId, access: status === 401 ? 'unauthenticated'
        : status === 404 ? 'not-found' : status === 403 ? 'forbidden' : 'pending',
      error: ![401, 403, 404].includes(status ?? 0) })
    })
    return () => { cancelled = true }
  }, [projectId, sessionKey, user, reload])
  const current = grant?.sessionKey === sessionKey && grant.projectId === projectId ? grant : undefined
  const access: Access = !user ? 'unauthenticated' : current?.access ?? 'pending'
  const api = useMemo(() => access === 'allowed' ? createSchedulingClient(projectId) : undefined,
    [projectId, sessionKey, access])

  return <>
    {current?.error && <div role="alert">权限检查失败，尚未读取排期数据。
      <button onClick={() => { setGrant(undefined); setReload((value) => value + 1) }}>重试</button>
    </div>}
    <SchedulingPage projectId={projectId} sessionKey={sessionKey} access={access} api={api} />
    {access === 'allowed' && <nav aria-label="核对正式计划">
      {/* These views fetch authoritative data on mount; no copied scheduling-side cache. */}
      <Link to={`/projects/${projectId}/tasks`}>核对任务计划</Link>{' · '}
      <Link to={`/projects/${projectId}/gantt`}>核对甘特图</Link>{' · '}
      <Link to={`/projects/${projectId}/workload`}>核对成员负载</Link>
    </nav>}
  </>
}
