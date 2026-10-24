/** Unregistered component-test harness. Synthetic transport only; NOT formal API acceptance. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError } from '../../api'
import SchedulingPage from './SchedulingPage'
import { createSchedulingClient, type SchedulingDetailDto } from './api'

declare global {
  interface Window { schedulingProbe: { requests: string[]; applicationCount: number; readDenied: boolean; sourceStale: boolean } }
}
const probe: Window['schedulingProbe'] = window.schedulingProbe = { requests: [], applicationCount: 0, readDenied: false, sourceStale: false }
const detail: SchedulingDetailDto = {
  id: 'synthetic-suggestion', projectId: 'synthetic-project', status: 'PENDING', disposition: 'PENDING', application: 'PENDING_DISPOSITION', sourceState: 'current',
  model: { provider: 'component-test-only', model: 'no-model-call', version: '未提供', mode: 'STUB', execution: 'LOCAL' },
  generation: { requestId: 'synthetic-generation', status: 'SUCCEEDED', generatedAt: '2026-10-23T02:00:00Z', error: null },
  changes: [{ taskId: 'synthetic-task', planStart: '2026-10-24', planEnd: '2026-10-25' }],
  tasks: [{ id: 'synthetic-task', title: 'SYNTHETIC-COMPONENT-TASK', planStart: '2026-10-23', planEnd: '2026-10-25' }], reason: null, finalChanges: null,
}
let lostResponse = true
let finalRequest: string | undefined
const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  if (probe.readDenied) throw new ApiError(403, 'FORBIDDEN', 'Synthetic revocation')
  if (path.endsWith('/disposition')) {
    const body = JSON.parse(init!.body as string)
    probe.requests.push(body.requestId)
    if (!finalRequest) {
      finalRequest = body.requestId
      detail.disposition = body.status
      detail.status = body.status === 'REJECTED' ? 'DISPOSED' : 'APPLIED'
      detail.application = body.status === 'REJECTED' ? 'NOT_APPLICABLE' : 'APPLIED'
      if (body.status !== 'REJECTED') probe.applicationCount++
      detail.reason = body.note ?? null
      if (lostResponse) { lostResponse = false; throw new Error('Synthetic lost response after server commit') }
    }
    if (finalRequest !== body.requestId) throw new ApiError(409, 'CONFLICT', 'Synthetic conflict')
    return { id: detail.id, status: detail.status, disposition: detail.disposition, application: detail.application } as T
  }
  if (path.endsWith('/assessment')) return { state: probe.sourceStale ? 'stale' : 'ok', assessment: probe.sourceStale ? null : {
    canApplyDates: true, blockers: [], warnings: [{ code: 'SYNTHETIC_WARNING', taskIds: ['synthetic-task'], message: 'Synthetic advisory warning' }],
    workload: [{ userId: 'synthetic-user', openTaskCount: 1 }],
    scope: { label: 'Synthetic component subset', participatingTaskIds: ['synthetic-task'], taskCount: 1 },
  } } as T
  if (path.endsWith('/audit')) return { items: [] } as T
  const current = { ...detail, sourceState: probe.sourceStale ? 'stale' : detail.sourceState }
  if (path.endsWith(detail.id)) return current as T
  const { changes: _c, tasks: _t, reason: _r, finalChanges: _f, sourceState: _s, ...summary } = current
  return { items: [summary], total: 1, limit: 200, truncated: false } as T
}
const api = createSchedulingClient('synthetic-project', request)
function Harness() {
  const [allowed, setAllowed] = useState(true)
  return <>
    <p>COMPONENT TEST ONLY — synthetic transport, no real project/model/API</p>
    <button id="revoke-parent" onClick={() => setAllowed(false)}>Revoke mounting access</button>
    <SchedulingPage projectId="synthetic-project" sessionKey="synthetic-user" access={allowed ? 'allowed' : 'forbidden'} api={api} />
  </>
}
createRoot(document.getElementById('root')!).render(<Harness />)
