import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api'
import { UML_LIMITS } from '../../../../src/modules/uml/schemas'
import { loadReferenceOptions } from './api'
import { referenceFields, referenceIds, referenceLabels, type ReferenceField, type ReferenceOptions } from './reference-options'

type Props = {
  projectId: string
  values: Record<ReferenceField, string>
  onChange: (field: ReferenceField, text: string) => void
  onDenied: (error: unknown) => void
}
/** Selections only edit the existing metadata draft; no writes until its explicit save. */
export default function ReferencePicker({ projectId, values, onChange, onDenied }: Props) {
  const [options, setOptions] = useState<ReferenceOptions | null>(null)
  const [error, setError] = useState('')
  const [queries, setQueries] = useState<Record<ReferenceField, string>>({ goalIds: '', activityIds: '', storyIds: '', taskIds: '' })
  const [reload, setReload] = useState(0)
  const denied = useRef(onDenied)
  denied.current = onDenied
  useEffect(() => {
    let request: AbortController | undefined
    let active = true
    function load() {
      request?.abort()
      const abort = new AbortController()
      request = abort
      // Drop old names before revalidating (including account changes on focus/storage).
      setOptions(null); setError('')
      void loadReferenceOptions(projectId, abort.signal).then(result => {
        if (active && !abort.signal.aborted) setOptions(result)
      }).catch(e => {
        if (!active || abort.signal.aborted) return
        abort.abort() // stop the sibling list request too
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) denied.current(e)
        else setError('关联候选加载失败，未更改关联草稿。请重试，或使用下方真实 ID 输入。')
      })
    }
    load()
    window.addEventListener('focus', load)
    window.addEventListener('storage', load)
    return () => {
      active = false; request?.abort()
      window.removeEventListener('focus', load); window.removeEventListener('storage', load)
    }
  }, [projectId, reload])
  return <section aria-label="关联对象选择器" className="uml-reference-picker">
    <h3>选择关联对象</h3>
    <p>候选来自当前项目的真实鉴权列表。选择只修改草稿，需点击保存才生效；每类最多 {UML_LIMITS.refs} 个。敏感对象关联可能使图永久仅 PM 可读。</p>
    <button type="button" onClick={() => setReload(n => n + 1)}>刷新关联候选</button>
    {!options && !error && <p role="status">正在加载关联候选…</p>}
    {error && <p role="alert">{error}</p>}
    {options && <div className="uml-reference-grid">{referenceFields.map(field => {
      const label = referenceLabels[field], selected = referenceIds(values[field])
      const query = queries[field].trim().toLowerCase()
      const choices = options[field].filter(item => `${item.label} ${item.id}`.toLowerCase().includes(query))
      const unavailable = selected.filter(id => !options[field].some(item => item.id === id))
      return <section key={field} aria-label={`${label}候选`}>
        <h4>{label}（已选 {selected.length}/{UML_LIMITS.refs}）</h4>
        <label>搜索{label}<input aria-label={`搜索${label}`} value={queries[field]} onChange={e => setQueries({ ...queries, [field]: e.target.value })} /></label>
        {selected.length > UML_LIMITS.refs && <p role="alert">{label}超过 {UML_LIMITS.refs} 个，请减少后再保存。</p>}
        {choices.length === 0 && <p>{options[field].length === 0 ? `暂无可选${label}` : '没有匹配的候选'}</p>}
        <ul className="uml-reference-options">{choices.map(item => <li key={item.id}>
          <label><input type="checkbox" aria-label={`选择${label}：${item.label}（${item.id}）`} checked={selected.includes(item.id)}
            disabled={!selected.includes(item.id) && selected.length >= UML_LIMITS.refs}
            onChange={e => onChange(field, (e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id)).join('\n'))} />
            <span>{item.label}<small>{item.id}</small></span></label>
        </li>)}</ul>
        {unavailable.length > 0 && <div><p>以下草稿 ID 未在当前候选中，保留待服务端校验，不自动删除：</p>
          <ul>{unavailable.map(id => <li key={id}>{id} <button type="button" aria-label={`移除${label} ID ${id}`}
            onClick={() => onChange(field, selected.filter(value => value !== id).join('\n'))}>移除</button></li>)}</ul>
        </div>}
      </section>
    })}</div>}
  </section>
}
