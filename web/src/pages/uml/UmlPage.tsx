import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import type { ProjectView } from '../../../../src/shared/types'
import { emptyUmlDocument, type UmlDocument } from '../../../../src/modules/uml/document'
import { umlCreateSchema, umlPatchSchema } from '../../../../src/modules/uml/schemas'
import { ApiError } from '../../api'
import UmlEditor from './UmlEditor'
import { createUml, deleteUml, fromWire, getUml, listUml, patchUml, saveUmlContent, toWire, type UmlList, type UmlView } from './api'
import './uml.css'

const message = (error: unknown) => error instanceof ApiError
  ? `${error.message}${error.details?.map(d => `（${d.field}: ${d.code}）`).join('') ?? ''}`
  : '操作未完成，请检查图稿格式或稍后重试。'
const denied = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status)
const ids = (text: string) => [...new Set(text.split(/[\s,，]+/).filter(Boolean))]

/** B mounts only this component at /projects/:projectId/uml, under ProjectLayout. */
export default function UmlPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = useOutletContext<ProjectView>()
  if (!projectId || !project) return <p role="alert">项目上下文不可用。</p>
  return <UmlPageContent key={projectId} projectId={projectId} project={project} />
}

/** Same production component is exercised by the isolated real-API development entry. */
export function UmlPageContent({ projectId, project }: { projectId: string; project: ProjectView }) {
  const [search, setSearch] = useSearchParams()
  const diagramId = search.get('diagram')
  const [list, setList] = useState<UmlList | null>(null)
  const [loaded, setLoaded] = useState<UmlView | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [newKind, setNewKind] = useState<'USE_CASE' | 'SEQUENCE' | null>(null)
  const [blocked, setBlocked] = useState(false)
  const deniedRef = useRef(false)
  const current = `${projectId}:${diagramId ?? ''}:${project.myRole}`
  const currentRef = useRef(current)
  currentRef.current = current
  const isPM = project.myRole === 'PM' // presentation only; server can() is authoritative
  function clearDenied(error: unknown) {
    deniedRef.current = true
    setBlocked(true); setLoaded(null); setList(null); setNewKind(null); setError(message(error))
  }
  useEffect(() => {
    const abort = new AbortController()
    deniedRef.current = false
    setLoaded(null); setList(null); setError(''); setBlocked(false)
    if (diagramId) setNewKind(null)
    void listUml(projectId, abort.signal).then(value => { if (!abort.signal.aborted && !deniedRef.current) setList(value) }).catch(e => {
      if (!abort.signal.aborted) { if (denied(e)) clearDenied(e); else setError(message(e)) }
    })
    if (diagramId) void getUml(diagramId, abort.signal).then(value => {
      if (value.projectId !== projectId) throw new ApiError(404, 'NOT_FOUND', '图不存在')
      fromWire(value) // reject malformed data before mounting editable form
      if (!abort.signal.aborted && !deniedRef.current) setLoaded(value)
    }).catch(e => { if (!abort.signal.aborted) { if (denied(e)) clearDenied(e); else setError(message(e)) } })
    // Revalidate on return to this tab. Revocation clears drafts, title and links.
    const verify = () => {
      const pending = diagramId ? getUml(diagramId, abort.signal) : listUml(projectId, abort.signal)
      void pending.catch(e => { if (!abort.signal.aborted && denied(e)) clearDenied(e) })
    }
    window.addEventListener('focus', verify)
    window.addEventListener('storage', verify)
    return () => { abort.abort(); window.removeEventListener('focus', verify); window.removeEventListener('storage', verify) }
  }, [projectId, diagramId, project.myRole, reload])
  function select(id: string | null) {
    setNewKind(null); setLoaded(null)
    setSearch(previous => { const next = new URLSearchParams(previous); if (id) next.set('diagram', id); else next.delete('diagram'); return next })
  }
  async function refreshed() {
    const key = currentRef.current
    try { const value = await listUml(projectId); if (key === currentRef.current && !deniedRef.current) setList(value) }
    catch (e) { if (key === currentRef.current) { if (denied(e)) clearDenied(e); else setError(message(e)) } }
  }
  const base = `/projects/${encodeURIComponent(projectId)}`
  return <main className="uml-project-page">
    <h1>在线 UML 图</h1>
    <p role="note">当前为集成开发版本：普通图按关联可见性只读开放；建立敏感任务或故事关联后，仅 PM 可读，解绑不会自动恢复。补充图片上传未实现。</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => { setNewKind(null); setReload(n => n + 1) }}>重新加载（放弃当前草稿）</button>
    {!blocked && <>
      <section aria-label="图清单"><h2>图清单</h2>
        {list ? <><p>可见图共 {list.total} 张{list.truncated ? '，仅显示前 200 张' : ''}</p>
          <ul>{list.items.map(item => <li key={item.id}><button type="button" onClick={() => select(item.id)}>{item.title}（{item.kind === 'USECASE' ? '用例图' : '时序图'}）</button></li>)}</ul>
        </> : <p>正在加载清单…</p>}
        {isPM && <div className="uml-actions">
          <button type="button" onClick={() => { select(null); setNewKind('USE_CASE') }}>新建用例图</button>
          <button type="button" onClick={() => { select(null); setNewKind('SEQUENCE') }}>新建时序图</button>
        </div>}
      </section>
      {diagramId && !loaded && !error && <p>正在加载图稿…</p>}
      {(loaded || newKind) && <DiagramForm key={loaded?.id ?? `new-${newKind}`}
        initial={loaded} newKind={newKind ?? 'USE_CASE'} isPM={isPM} projectId={projectId} base={base}
        onDenied={clearDenied} isCurrent={() => currentRef.current === current}
        onCreated={id => { select(id); void refreshed() }} onDeleted={() => { select(null); void refreshed() }} onSaved={() => void refreshed()} />}
    </>}
  </main>
}

type FormProps = {
  initial: UmlView | null; newKind: 'USE_CASE' | 'SEQUENCE'; isPM: boolean; projectId: string; base: string
  onDenied: (error: unknown) => void; isCurrent: () => boolean
  onCreated: (id: string) => void; onDeleted: () => void; onSaved: () => void
}
function DiagramForm({ initial, newKind, isPM, projectId, base, onDenied, isCurrent, onCreated, onDeleted, onSaved }: FormProps) {
  const [saved, setSaved] = useState(initial)
  const [document, setDocument] = useState<UmlDocument>(() => initial ? fromWire(initial) : emptyUmlDocument(newKind))
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [owner, setOwner] = useState(initial?.ownerUserId ?? '')
  const [refs, setRefs] = useState({ goalIds: initial?.goalRefs.map(x => x.id).join('\n') ?? '',
    activityIds: initial?.activityRefs.map(x => x.id).join('\n') ?? '', storyIds: initial?.storyRefs.map(x => x.id).join('\n') ?? '', taskIds: initial?.taskRefs.map(x => x.id).join('\n') ?? '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const current = () => alive.current && isCurrent()
  async function act(action: 'create' | 'metadata' | 'content' | 'delete') {
    if (busy || !isPM) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'delete' && saved) { await deleteUml(saved.id); if (current()) onDeleted(); return }
      const metadata = { title, description: description || null, ...(owner ? { ownerUserId: owner } : {}),
        goalIds: ids(refs.goalIds), activityIds: ids(refs.activityIds), storyIds: ids(refs.storyIds), taskIds: ids(refs.taskIds) }
      let result: UmlView
      if (action === 'create') result = await createUml(projectId, umlCreateSchema.parse({ ...metadata, kind: document.kind === 'USE_CASE' ? 'USECASE' : 'SEQUENCE', ...toWire(document) }))
      else if (action === 'metadata' && saved) result = await patchUml(saved.id, umlPatchSchema.parse(metadata))
      else if (saved) result = await saveUmlContent(saved.id, document)
      else return
      if (!current()) return
      if (result.projectId !== projectId) throw new ApiError(404, 'NOT_FOUND', '图不存在')
      if (action === 'create') { onCreated(result.id); return }
      setSaved(result)
      if (action === 'content') setDocument(fromWire(result)) // adopt regenerated server ids
      setNotice(action === 'metadata' ? '基本信息与关联已保存。图内容草稿未提交。' : '图内容已保存。基本信息与关联草稿未提交。')
      onSaved()
    } catch (e) { if (current()) { if (denied(e)) onDenied(e); else setError(message(e)) } }
    finally { if (current()) setBusy(false) }
  }
  return <section aria-label="UML 图详情">
    <h2>{saved ? `编辑图：${saved.title}` : '新建图稿'}</h2>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error} 草稿未被替换。</p>}
    <fieldset disabled={busy || !isPM}><legend>基本信息与关联（独立保存）</legend>
      <label>图标题<input aria-label="图标题" value={title} maxLength={100} onChange={e => setTitle(e.target.value)} /></label>
      <label>图说明<textarea aria-label="图说明" value={description} maxLength={200} onChange={e => setDescription(e.target.value)} /></label>
      <label>负责人用户 ID（新建时可留空，默认当前 PM）<input aria-label="负责人用户 ID" value={owner} onChange={e => setOwner(e.target.value)} /></label>
      <p>关联输入为真实对象 ID，每行一个或逗号分隔，每类最多 50 个。这里不是对象选择器；跨项目及不存在对象由服务端统一拒绝。清空表示解除该类全部关联。</p>
      {(['goalIds', 'activityIds', 'storyIds', 'taskIds'] as const).map((key, index) => <label key={key}>{['业务目标 ID', '用户活动 ID', '用户故事 ID', '任务 ID'][index]}
        <textarea aria-label={['业务目标 ID', '用户活动 ID', '用户故事 ID', '任务 ID'][index]} value={refs[key]} onChange={e => setRefs({ ...refs, [key]: e.target.value })} />
      </label>)}
      {saved && <button type="button" onClick={() => void act('metadata')}>保存基本信息与关联</button>}
    </fieldset>
    <UmlEditor document={document} onChange={setDocument} readOnly={!isPM || busy} />
    {isPM && <div className="uml-actions">
      <button type="button" disabled={busy} onClick={() => void act(saved ? 'content' : 'create')}>{saved ? '保存图内容' : '创建并保存全部'}</button>
      {saved && <><button type="button" disabled={busy} onClick={() => setConfirmDelete(n => !n)}>删除此图</button>
        {confirmDelete && <><span>删除图稿及全部关联？</span><button type="button" disabled={busy} onClick={() => void act('delete')}>确认删除</button></>}</>}
    </div>}
    {saved && <section aria-label="已保存的对象关联"><h3>已保存的对象关联</h3>
      <p>以下名称和链接仅来自最近一次成功的鉴权响应，不代表尚未保存的 ID 输入。</p>
      <p><Link to={base}>所属项目</Link></p>
      <ul>{saved.goalRefs.map(x => <li key={`g-${x.id}`}>业务目标：{x.name}</li>)}
        {saved.activityRefs.map(x => <li key={`a-${x.id}`}>用户活动：{x.name}</li>)}
        {saved.storyRefs.map(x => <li key={`s-${x.id}`}><Link to={`${base}/requirements/${encodeURIComponent(x.id)}`}>用户故事：{x.title}</Link></li>)}
        {saved.taskRefs.map(x => <li key={`t-${x.id}`}><Link to={`${base}/requirements/${encodeURIComponent(x.storyId)}#task-${encodeURIComponent(x.id)}`}>任务：{x.title}</Link></li>)}</ul>
      <p>任务行精确定位依赖 B 的 TaskSection 锚点补丁；本页不伪造独立任务详情路由。</p>
    </section>}
  </section>
}
