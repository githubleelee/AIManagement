import { useState } from 'react'
import type { DateChange, SchedulingSnapshot } from '../../../../src/modules/ai-scheduling/schemas'
import { dateChangesSchema } from '../../../../src/modules/ai-scheduling/schemas'
import { assessSchedulingDates, sameSchedulingBaseline } from '../../../../src/modules/ai-scheduling/policy'
import './scheduling.css'

/** Local UI proposal, NOT the frozen AI port or a registered API response. */
export type SchedulingProposal = {
  id: string
  baseline: SchedulingSnapshot
  changes: DateChange[]
  reasons: string[]
  model: string
  modelVersion: string | null
  mode: 'stub' | 'api'
  generatedAt: string
}
export type SchedulingPageProps = {
  // Parent must derive this from unified server authorization. No role logic here.
  access: 'pending' | 'allowed' | 'unauthenticated' | 'forbidden' | 'not-found'
  snapshot?: SchedulingSnapshot
  proposal?: SchedulingProposal
  demo?: boolean
  now?: Date
  onGenerate?: () => Promise<SchedulingProposal>
  onDecide?: (input: { proposalId: string; conclusion: 'accept' | 'modify' | 'reject'; changes: DateChange[]; reason: string }) => Promise<void>
}

export default function SchedulingPage(props: SchedulingPageProps) {
  if (props.access !== 'allowed') {
    const message = {
      pending: '权限检查中；尚未读取排期数据',
      unauthenticated: '请先登录', forbidden: '当前账号不能访问排期建议', 'not-found': '资源不存在',
    }[props.access]
    return <main className="scheduling-page"><h1>AI 排期建议</h1><p role="status">{message}</p></main>
  }
  // Unmount local state on revocation or project switch; do not reuse another project's draft.
  return <SchedulingWorkspace key={props.snapshot?.projectId ?? 'unbound'} {...props} />
}

function SchedulingWorkspace(props: SchedulingPageProps) {
  const [generated, setGenerated] = useState<SchedulingProposal>()
  const [edits, setEdits] = useState<{ id: string; changes: DateChange[] }>()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState(false)
  const candidate = generated ?? props.proposal
  const proposal = candidate?.baseline.projectId === props.snapshot?.projectId ? candidate : undefined
  const changes = proposal && edits?.id === proposal.id ? edits.changes : proposal?.changes ?? []
  const parsed = dateChangesSchema.safeParse(changes)
  const stale = !!proposal && !!props.snapshot && !sameSchedulingBaseline(proposal.baseline, props.snapshot)
  const result = props.snapshot && parsed.success ? assessSchedulingDates(props.snapshot, parsed.data, props.now ?? new Date()) : undefined
  const writable = !!props.onDecide && !!proposal && !!props.snapshot && !props.demo && !stale && !busy && !outcome
  const canApply = writable && !!result?.canApplyDates

  async function generate() {
    if (!props.onGenerate || busy || props.demo) return
    setBusy(true); setError('')
    try {
      const next = await props.onGenerate()
      setGenerated(next); setEdits(undefined); setReason(''); setOutcome(false)
    } catch {
      setError('生成失败或超时，未生成新的有效建议；请稍后重试。')
    } finally { setBusy(false) }
  }

  async function decide(conclusion: 'accept' | 'modify' | 'reject') {
    if (!writable || !props.onDecide || !proposal || (conclusion !== 'reject' && !canApply)) return
    setBusy(true); setError('')
    try {
      await props.onDecide({ proposalId: proposal.id, conclusion, changes: conclusion === 'reject' ? [] : changes, reason })
      setOutcome(true)
    } catch {
      setError('处置未完成，请刷新核对最新状态；不能据此认定计划已应用。')
    } finally { setBusy(false) }
  }

  return <main className="scheduling-page">
    <header><span className="scheduling-eyebrow">ROLE-C · US-12</span><h1>AI 排期建议</h1>
      <p>只生成建议；有权 PM 人工确认后才能修改正式计划。</p></header>
    <aside className="scheduling-banner" role="status">
      {props.demo ? '开发预览：仅普通虚构 fixture，非真实 AI、非正式计划；不会发请求或保存数据。' : '接入准备：公共端口、持久化、统一权限及页面挂载须由 B/D 交付。'}
    </aside>
    <section aria-labelledby="scheduling-scope"><h2 id="scheduling-scope">输入范围与运行方式</h2>
      <p>敏感对象默认排除；AI 子集不等于 PM 全项目基数。自然日含起止日，时区 Asia/Shanghai。</p>
      <dl><dt>数据快照</dt><dd>{props.snapshot?.revision ?? '待接入 #26/#27'}</dd>
        <dt>建议模式</dt><dd>{proposal ? `${proposal.mode === 'stub' ? 'STUB · 本地桩/虚构样例' : 'API · 待核对真实调用证据'}` : '未接入'}</dd>
        <dt>模型 / 版本</dt><dd>{proposal ? `${proposal.model} / ${proposal.modelVersion ?? '未提供'}` : '未提供'}</dd>
        <dt>生成时间</dt><dd>{proposal?.generatedAt ?? '未生成'}</dd>
        <dt>建议编号</dt><dd>{proposal?.id ?? '无'}</dd></dl>
      <button type="button" disabled={!props.onGenerate || props.demo || busy} onClick={() => void generate()}>生成建议</button>
      {!props.onGenerate && <p>生成入口待公共 AI 接入，不以固定返回冒充模型成功。</p>}
    </section>
    {error && <p className="scheduling-error" role="alert">{error}</p>}
    {outcome && <p role="status">处置请求已完成，请在正式计划与审计中核对结果。</p>}
    {stale && <p className="scheduling-error" role="alert">相关基线已变化，整份建议过期；请重新生成。</p>}
    {!proposal ? <section><h2>暂无建议</h2><p>公共链路未就绪时不会自动生成或修改计划。</p></section> : <>
      <section><h2>日期调整预览</h2><p>仅 TODO 可改计划开始/结束；其他状态只能提示。不改负责人、状态、依赖或里程碑。</p>
        <div className="scheduling-table-wrap"><table><thead><tr><th>任务</th><th>原计划</th><th>建议开始</th><th>建议结束</th></tr></thead><tbody>
          {changes.map((change, index) => {
            const task = props.snapshot?.tasks.find((item) => item.id === change.taskId && !item.isSensitive && item.projectId === props.snapshot?.projectId)
            return <tr key={`${change.taskId}-${index}`}><th scope="row">{task?.title ?? '不可用任务'}</th>
              <td>{task ? `${task.planStart} — ${task.planEnd}` : '不可用'}</td>
              {(['planStart', 'planEnd'] as const).map((field) => <td key={field}><input
                type="date" aria-label={`${index + 1}-${field === 'planStart' ? '开始' : '结束'}`} value={change[field]}
                disabled={busy || outcome || stale || !task} onChange={(event) => {
                  setEdits({ id: proposal.id, changes: changes.map((item, i) => i === index ? { ...item, [field]: event.target.value } : { ...item }) })
                }} /></td>)}
            </tr>
          })}
        </tbody></table></div>
        {!parsed.success && <p role="alert" className="scheduling-error">请输入有效自然日；至少一项调整且只能包含任务 ID 与计划日期。</p>}
      </section>
      <section aria-live="polite"><h2>校验与理由</h2>
        <p>{result ? `${result.scope.label}：${result.scope.taskCount} 项任务` : '等待有效日期和数据快照'}</p>
        {result?.blockers.map((item, i) => <p className="scheduling-error" key={`b${i}`}>阻断：{item.message}</p>)}
        {result?.warnings.map((item, i) => <p className="scheduling-warning" key={`w${i}`}>提示：{item.message}</p>)}
        {result?.canApplyDates && <p>本地日期校验通过，仅供预览；不代表已鉴权或已应用。</p>}
        <h3>建议理由（由实际生成记录提供）</h3><ul>{proposal.reasons.map((item, i) => <li key={i}>{item}</li>)}</ul>
        <h3>参与范围负载</h3><ul>{result?.workload.map((item) => <li key={item.userId}>{item.userId}：{item.openTaskCount} 项未关闭任务（含 DONE）</li>)}</ul>
      </section>
      <section><h2>人工处置</h2><label htmlFor="scheduling-reason">审核说明 / 修改理由</label>
        <textarea id="scheduling-reason" value={reason} disabled={busy || outcome} onChange={(event) => setReason(event.target.value)} />
        <div className="scheduling-actions">
          <button type="button" disabled={!canApply || !!edits} onClick={() => void decide('accept')}>采纳</button>
          <button type="button" disabled={!canApply || !edits} onClick={() => void decide('modify')}>修改后采纳</button>
          <button type="button" disabled={!writable} onClick={() => void decide('reject')}>拒绝</button>
        </div>
        {!props.onDecide && <p>确认/审计适配器和 task 独占窗口尚未就绪；此处不提供伪造写入。</p>}
        {props.demo && <p>预览中的所有正式处置按钮均禁用。刷新会丢失本地编辑。</p>}
      </section>
    </>}
  </main>
}
