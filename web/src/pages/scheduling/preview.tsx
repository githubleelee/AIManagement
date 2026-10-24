/** Development-only standalone fixture entry. No backend imports or project API calls. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import SchedulingPage, { type SchedulingPageProps } from './SchedulingPage'
import type { SchedulingDetailDto } from './api'

const fixture: SchedulingDetailDto = {
  id: 'fixture-suggestion', projectId: 'fixture-project', status: 'PENDING',
  disposition: 'PENDING', application: 'PENDING_DISPOSITION', sourceState: 'current',
  model: { provider: 'fixture-only', model: 'no-model-call', version: '未提供', mode: 'STUB', execution: 'LOCAL' },
  generation: { requestId: 'fixture-request', status: 'SUCCEEDED', generatedAt: '2026-10-23T02:00:00Z', error: null },
  changes: [{ taskId: 'fixture-task', planStart: '2026-10-25', planEnd: '2026-10-26' }],
  tasks: [{ id: 'fixture-task', title: '虚构：页面联调', planStart: '2026-10-24', planEnd: '2026-10-25' }],
  reason: null, finalChanges: null,
}
function Preview() {
  const [sample, setSample] = useState(false)
  const [stale, setStale] = useState(false)
  const [access, setAccess] = useState<SchedulingPageProps['access']>('allowed')
  return <>
    <nav style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }} aria-label="仅开发场景切换">
      <button onClick={() => { setSample(true); setStale(false) }}>载入虚构联调样例</button>
      <button disabled={!sample} onClick={() => setStale(true)}>模拟来源变化</button>
      <label>模拟页面授权结果 <select aria-label="模拟页面授权结果" value={access} onChange={(e) => setAccess(e.target.value as SchedulingPageProps['access'])}>
        <option value="allowed">允许（仅 UI 预览）</option><option value="forbidden">403</option><option value="not-found">404</option>
        <option value="unauthenticated">401</option><option value="pending">待鉴权</option>
      </select></label>
    </nav>
    <SchedulingPage projectId="fixture-project" sessionKey="fixture" access={access} demo
      initialDetail={sample ? { ...fixture, sourceState: stale ? 'stale' : 'current' } : undefined} />
  </>
}
createRoot(document.getElementById('root')!).render(<Preview />)
