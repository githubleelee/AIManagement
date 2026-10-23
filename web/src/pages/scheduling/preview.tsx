/** Development-only HTML entry, not imported by the app or registered in its routes. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import SchedulingPage from './SchedulingPage'
import type { SchedulingProposal, SchedulingPageProps } from './SchedulingPage'
import type { SchedulingSnapshot } from '../../../../src/modules/ai-scheduling/schemas'

// Ordinary invented fixture only; never loads DB, localStorage, cookies, or project APIs.
const snapshot: SchedulingSnapshot = {
  projectId: 'fixture-project', revision: 'fixture-revision-1', capturedAt: '2026-10-18T02:00:00Z',
  memberIds: ['fixture-owner', 'fixture-reviewer'],
  tasks: [
    { id: 'fixture-1', projectId: 'fixture-project', title: '虚构：接口整理', ownerUserId: 'fixture-owner', acceptorUserId: 'fixture-reviewer', status: 'CLOSED', planStart: '2026-10-18', planEnd: '2026-10-19', isSensitive: false },
    { id: 'fixture-2', projectId: 'fixture-project', title: '虚构：页面联调', ownerUserId: 'fixture-owner', acceptorUserId: 'fixture-reviewer', status: 'TODO', planStart: '2026-10-20', planEnd: '2026-10-21', isSensitive: false },
    { id: 'fixture-3', projectId: 'fixture-project', title: '虚构：回归整理', ownerUserId: 'fixture-owner', acceptorUserId: 'fixture-reviewer', status: 'DONE', planStart: '2026-10-21', planEnd: '2026-10-22', isSensitive: false },
  ],
  dependencies: [{ predecessorId: 'fixture-1', successorId: 'fixture-2' }],
  milestones: [{ id: 'fixture-milestone', taskIds: ['fixture-2'], date: '2026-10-21' }],
}
const proposal: SchedulingProposal = {
  id: 'fixture-proposal-1', baseline: snapshot, mode: 'stub', model: 'fixture-only-no-model', modelVersion: null,
  generatedAt: '2026-10-18T02:01:00Z',
  changes: [{ taskId: 'fixture-2', planStart: '2026-10-20', planEnd: '2026-10-22' }],
  reasons: ['虚构样例：用于观察重叠、延期和里程碑提示；并非 AI 推理结果。'],
}
function Preview() {
  const [sample, setSample] = useState(false)
  const [stale, setStale] = useState(false)
  const [access, setAccess] = useState<SchedulingPageProps['access']>('allowed')
  return <>
    <nav style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }} aria-label="仅开发场景切换">
      <button onClick={() => { setSample(true); setStale(false) }}>载入虚构联调样例</button>
      <button disabled={!sample} onClick={() => setStale(true)}>模拟快照变化</button>
      <label>模拟页面授权结果 <select aria-label="模拟页面授权结果" value={access} onChange={(event) => setAccess(event.target.value as SchedulingPageProps['access'])}>
        <option value="allowed">允许（仅 UI 预览）</option><option value="forbidden">403</option>
        <option value="not-found">404</option><option value="unauthenticated">401</option><option value="pending">待鉴权</option>
      </select></label>
    </nav>
    <SchedulingPage access={access} snapshot={sample ? { ...snapshot, revision: stale ? 'fixture-revision-2' : snapshot.revision } : undefined}
      proposal={sample ? proposal : undefined} demo now={new Date('2026-10-18T02:00:00Z')} />
  </>
}
createRoot(document.getElementById('root')!).render(<Preview />)
