import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api'
import {
  dispositionInput, makeAttempt, type Attempt, type DateChangeDto, type DispositionInputDto,
  type SchedulingClient, type SchedulingDetailDto, type SchedulingPageDto, type AssessmentDto,
} from './api'
import './scheduling.css'

export type SchedulingPageProps = {
  projectId: string
  /** Mounting parent derives this from authoritative authorization, never a client role check. */
  access: 'pending' | 'allowed' | 'unauthenticated' | 'forbidden' | 'not-found'
  /** Must change on login identity changes, even within the same project. */
  sessionKey: string
  api?: SchedulingClient
  demo?: boolean
  initialDetail?: SchedulingDetailDto
  /** Parent refreshes real task/gantt/workload views after an actual APPLIED response. */
  onApplied?: () => void
}
export default function SchedulingPage(props: SchedulingPageProps) {
  if (props.access !== 'allowed') return <main className="scheduling-page"><h1>AI 排期建议</h1><p role="status">{{
    pending: '权限检查中；尚未读取排期数据', unauthenticated: '请先登录',
    forbidden: '当前账号不能访问排期建议', 'not-found': '资源不存在',
  }[props.access]}</p></main>
  return <Workspace key={`${props.projectId}:${props.sessionKey}`} {...props} />
}
function Workspace(props: SchedulingPageProps) {
  const [page, setPage] = useState<SchedulingPageDto>()
  const [detail, setDetail] = useState(props.demo ? props.initialDetail : undefined)
  const [edits, setEdits] = useState<DateChangeDto[]>()
  const [note, setNote] = useState('')
  const [attempt, setAttempt] = useState<Attempt>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState('')
  const [audit, setAudit] = useState<Awaited<ReturnType<SchedulingClient['audit']>>>()
  const [assessment, setAssessment] = useState<{ key: string; value: AssessmentDto }>()
  const [denied, setDenied] = useState(false)
  const controller = useRef(new AbortController())
  const running = useRef(false)
  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    running.current = false
    if (props.demo) { setDetail(props.initialDetail); return () => abort.abort() }
    setDetail(undefined); setPage(undefined); setEdits(undefined); setAttempt(undefined); setNote(''); setAudit(undefined); setAssessment(undefined)
    if (props.api) {
      running.current = true
      setBusy(true)
      props.api.list(abort.signal).then((value) => { if (!abort.signal.aborted) setPage(value) })
        .catch((cause: unknown) => { if (!abort.signal.aborted) fail(cause) })
        .finally(() => { if (!abort.signal.aborted) { running.current = false; setBusy(false) } })
    }
    return () => abort.abort()
  }, [props.api, props.demo, props.initialDetail])

  function fail(cause: unknown) {
    if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
      setDetail(undefined); setPage(undefined); setEdits(undefined); setAttempt(undefined); setNote(''); setAudit(undefined); setAssessment(undefined); setDenied(true)
      setError('权限已变化或资源不可见，已清除页面数据；请重新进入。')
    } else if (cause instanceof ApiError && cause.status === 409) {
      setError('来源已过期或建议已有最终处置；请刷新核对，不要认定计划已应用。')
    } else {
      setError('请求未完成或响应无效。未切换到样例；若已提交处置，请用原请求重试核对结果。')
    }
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (busy || running.current || props.demo || denied) return
    const signal = controller.current.signal
    running.current = true
    setBusy(true); setError('')
    try { await work(signal) } catch (cause) { if (!signal.aborted) fail(cause) }
    finally { if (!signal.aborted) { running.current = false; setBusy(false) } }
  }
  async function load(id: string, signal: AbortSignal) {
    if (!props.api) return
    const value = await props.api.get(id, signal)
    if (signal.aborted) return
    setDetail(value); setEdits(undefined); setNote(''); setAudit(undefined); setAssessment(undefined)
    // A PENDING refresh does not prove an earlier in-flight request cannot still commit.
    if (value.status !== 'PENDING') setAttempt(undefined)
  }
  const changes = edits ?? detail?.changes ?? []
  const changed = !!edits && JSON.stringify(edits) !== JSON.stringify(detail?.changes)
  const pending = detail?.status === 'PENDING' && detail.disposition === 'PENDING'
  const active = !!props.api && !props.demo && !busy && !denied && pending && !attempt
  const validDates = dispositionInput.safeParse({ status: 'MODIFIED', note: 'validation only', changes }).success
  const assessmentKey = `${detail?.id}:${JSON.stringify(changes)}`
  const checked = assessment?.key === assessmentKey ? assessment.value : undefined
  const canApply = active && detail?.sourceState === 'current' && validDates
    && checked?.state === 'ok' && checked.assessment?.canApplyDates === true
  async function submit(input: DispositionInputDto, signal: AbortSignal, retry?: Attempt) {
    if (!props.api || !detail) return
    const next = retry ?? makeAttempt(detail.id, input, () => crypto.randomUUID())
    setAttempt(next)
    const result = await props.api.dispose(next, signal)
    if (signal.aborted) return
    setAttempt(undefined); setEdits(undefined); setNote('')
    setOutcome(result.application === 'APPLIED' ? '正式计划已应用；正在刷新建议，请核对任务、甘特、负载与审计。'
      : result.disposition === 'REJECTED' ? '已拒绝，未修改正式计划。' : '处置尚未完成应用，请核对记录。')
    setDetail((current) => current ? { ...current, ...result } : current)
    if (result.application === 'APPLIED') props.onApplied?.()
    await load(detail.id, signal)
    const latest = await props.api.list(signal)
    if (!signal.aborted) setPage(latest)
  }
  return <main className="scheduling-page">
    <header><span className="scheduling-eyebrow">US-12 · 人工确认</span><h1>AI 排期建议</h1>
      <p>仅有权 PM 可生成、查看、处置和审计。生成建议不修改正式计划。</p></header>
    <aside className="scheduling-banner" role="status">{props.demo
      ? '开发预览：普通虚构 fixture，不调用 API、不保存、不允许正式处置。'
      : !props.api ? '正式装配未就绪；当前没有 API，不会伪生成或伪采纳。' : '模型模式和结果以服务端记录为准；禁止失败后静默回桩。'}</aside>
    {error && <p className="scheduling-error" role="alert">{error}</p>}
    {busy && <p role="status">请求处理中…</p>}
    {outcome && <p role="status">{outcome}</p>}
    {!denied && <>
      <section><h2>建议记录</h2>
        <button disabled={!props.api || props.demo || busy || !!attempt} onClick={() => void run(async (signal) => {
          if (!props.api) return
          const value = await props.api.generate(crypto.randomUUID(), signal)
          if (signal.aborted) return
          setOutcome(value.generation.status === 'SUCCEEDED' ? '建议已保存，尚未应用。' : '模型生成失败，已保存失败记录；未生成可应用建议。')
          await load(value.id, signal)
          const latest = await props.api.list(signal)
          if (!signal.aborted) setPage(latest)
        })}>生成建议</button>
        <button disabled={!props.api || props.demo || busy} onClick={() => void run(async (signal) => {
          if (!props.api) return
          if (detail) await load(detail.id, signal)
          const latest = await props.api.list(signal)
          if (!signal.aborted) setPage(latest)
        })}>刷新核对</button>
        {page && <p>共 {page.total} 条，当前显示 {page.items.length} 条，上限 {page.limit}。{page.truncated && '列表已截断，不代表只有这些建议。'}</p>}
        <ul>{page?.items.map((item) => <li key={item.id}><button disabled={busy || !!attempt} onClick={() => void run((signal) => load(item.id, signal))}>{item.id} · {item.status}</button></li>)}</ul>
      </section>
      {detail && <>
        <section><h2>建议与追溯</h2><dl>
          <dt>建议编号</dt><dd>{detail.id}</dd><dt>状态</dt><dd>{detail.status} / {detail.application}</dd>
          <dt>模式</dt><dd>{detail.model.mode} · {detail.model.execution}</dd>
          <dt>模型 / 版本</dt><dd>{detail.model.model} / {detail.model.version}</dd>
          <dt>生成请求</dt><dd>{detail.generation.requestId}</dd><dt>生成时间</dt><dd>{detail.generation.generatedAt}</dd>
        </dl>
        <p>仅展示已授权的非敏感参与任务，不代表 PM 全项目基数。自然日含起止日，Asia/Shanghai。</p>
        {detail.generation.error && <p role="alert">生成状态：{detail.generation.status}（{detail.generation.error.code}）；没有可应用建议。</p>}
        {detail.sourceState !== 'current' && <p className="scheduling-error" role="alert">{detail.sourceState === 'stale' ? '来源已变化，禁止采纳，请重新生成；仍可填写理由拒绝。' : '来源不可用，不能采纳；拒绝仍由服务端实时鉴权。'}</p>}
        <div className="scheduling-table-wrap"><table><thead><tr><th>任务</th><th>原计划</th><th>新开始</th><th>新结束</th></tr></thead><tbody>
          {changes.map((change, index) => {
            const task = detail.tasks.find((task) => task.id === change.taskId)
            return <tr key={change.taskId}><th scope="row">{task?.title ?? '不可用任务'}</th><td>{task ? `${task.planStart} — ${task.planEnd}` : '不可用'}</td>
              {(['planStart', 'planEnd'] as const).map((field) => <td key={field}><input type="date" value={change[field]}
                aria-label={`${index + 1}-${field === 'planStart' ? '开始' : '结束'}`}
                disabled={!active || detail.sourceState !== 'current' || !task}
                onChange={(event) => setEdits(changes.map((row, i) => i === index ? { ...row, [field]: event.target.value } : { ...row }))} /></td>)}
            </tr>
          })}
        </tbody></table></div>
        <p>客户端日期检查不构成应用授权；TODO、成员、真实 FS、里程碑及整份来源由服务端事务内复核。</p>
        <button disabled={!active || !validDates || detail.sourceState !== 'current'} onClick={() => void run(async (signal) => {
          if (!props.api) return
          const value = await props.api.assess(detail.id, changes, signal)
          if (!signal.aborted) setAssessment({ key: assessmentKey, value })
        })}>校验当前日期</button>
        {!checked && pending && <p>采纳前请校验当前日期；编辑后须重新校验。</p>}
        {checked?.state !== undefined && checked.state !== 'ok' && <p role="alert" className="scheduling-error">日期评估未通过（{checked.state}）；请刷新或重新生成。</p>}
        {checked?.assessment && <div aria-live="polite">
          {checked.assessment.blockers.map((row, i) => <p className="scheduling-error" key={`b${i}`}>阻断：{row.message}</p>)}
          {checked.assessment.warnings.map((row, i) => <p className="scheduling-warning" key={`w${i}`}>提示：{row.message}</p>)}
          <p>{checked.assessment.scope.label}：{checked.assessment.scope.taskCount} 项任务；负载含 DONE、不含 CLOSED，不设过载阈值。</p>
          <ul>{checked.assessment.workload.map((row) => <li key={row.userId}>{row.userId}：{row.openTaskCount} 项未关闭任务</li>)}</ul>
          <p>此评估不是锁；正式应用仍会在同一事务再次鉴权和复核。</p>
        </div>}
        {detail.finalChanges && <p>最终应用内容：{detail.finalChanges.map((c) => `${c.taskId}: ${c.planStart} — ${c.planEnd}`).join('；')}</p>}
        </section>
        <section><h2>人工处置</h2><label htmlFor="scheduling-reason">修改／拒绝理由（必填）或采纳说明</label>
          <textarea id="scheduling-reason" value={note} maxLength={2000} disabled={!active} onChange={(e) => setNote(e.target.value)} />
          <div className="scheduling-actions">
            <button disabled={!canApply || changed} onClick={() => void run((signal) => submit({ status: 'ACCEPTED', ...(note.trim() ? { note: note.trim() } : {}) }, signal))}>采纳</button>
            <button disabled={!canApply || !changed || !note.trim()} onClick={() => void run((signal) => submit({ status: 'MODIFIED', note, changes }, signal))}>修改后采纳</button>
            <button disabled={!active || !note.trim()} onClick={() => void run((signal) => submit({ status: 'REJECTED', note }, signal))}>拒绝</button>
            {attempt && <button disabled={busy} onClick={() => void run((signal) => submit(attempt.input, signal, attempt))}>重试同一请求</button>}
          </div>
          {attempt && <p role="status">上次处置结果尚未确认，已锁定内容和请求标识；重试不创建新请求。</p>}
          {detail.reason && <p>已记录理由：{detail.reason}</p>}
        </section>
        <section><h2>审计</h2><button disabled={!props.api || props.demo || busy} onClick={() => void run(async (signal) => {
          if (!props.api) return
          const entries = await props.api.audit(detail.id, signal)
          if (!signal.aborted) setAudit(entries)
        })}>读取审计</button>
          {audit && (audit.length ? <ul>{audit.map((row) => <li key={row.requestId}>{row.at} · {row.status} · {row.reason ?? '无说明'}</li>)}</ul> : <p>当前授权范围内没有审计记录。</p>)}
        </section>
      </>}
    </>}
  </main>
}
