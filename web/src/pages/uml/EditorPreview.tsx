import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  emptyUmlDocument, umlDocumentSchema,
} from '../../../../src/modules/uml/document'
import type { UmlDocument } from '../../../../src/modules/uml/document'
import UmlEditor from './UmlEditor'

/** Isolated development fixture, not mounted in the platform route registry.
 * No API mock and no project data: actual editor code runs against local memory.
 */
function EditorPreview() {
  const [kind, setKind] = useState<UmlDocument['kind']>('USE_CASE')
  const [documents, setDocuments] = useState<Record<UmlDocument['kind'], UmlDocument>>({
    USE_CASE: emptyUmlDocument('USE_CASE'), SEQUENCE: emptyUmlDocument('SEQUENCE'),
  })
  const [readOnly, setReadOnly] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const document = documents[kind]
  const update = (next: UmlDocument) => {
    if (readOnly) return
    setDocuments(previous => ({ ...previous, [next.kind]: next }))
    setError('')
  }
  const json = JSON.stringify(document, null, 2)
  function load() {
    if (readOnly) return
    try {
      if (input.length > 1_000_000) throw new Error('本地导入内容过大')
      const parsed = umlDocumentSchema.safeParse(JSON.parse(input))
      if (!parsed.success) {
        setError(parsed.error.issues.map(issue => `${issue.path.join('.')}：${issue.message}`).join('；'))
        return
      }
      update(parsed.data)
      setKind(parsed.data.kind)
      setError('')
    } catch {
      setError('图稿 JSON 无法解析或超过本地导入安全上限；原图稿未改变。')
    }
  }
  function download() {
    const parsed = umlDocumentSchema.safeParse(document)
    if (!parsed.success) { setError('图稿校验失败，请先修正编辑内容。'); return }
    setError('')
    const url = URL.createObjectURL(new Blob([JSON.stringify(parsed.data, null, 2)], { type: 'application/json' }))
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `uml-${kind.toLowerCase()}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="uml-dev-page">
    <h1>在线 UML 编辑器 · 独立开发验证</h1>
    <p className="uml-notice">不是正式项目页面。没有数据库保存、对象关联或服务端鉴权；刷新会清空内存图稿。下载/载入 JSON 仅验证图稿往返，不代表项目持久化验收。</p>
    <div className="uml-actions">
      <button type="button" aria-pressed={kind === 'USE_CASE'} onClick={() => { setKind('USE_CASE'); setError('') }}>编辑用例图</button>
      <button type="button" aria-pressed={kind === 'SEQUENCE'} onClick={() => { setKind('SEQUENCE'); setError('') }}>编辑时序图</button>
      <label><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />只读交互检查（非权限验证）</label>
    </div>
    <UmlEditor document={document} onChange={update} readOnly={readOnly} />
    <section className="uml-transfer">
      <h2>本地图稿往返验证</h2>
      <button type="button" onClick={download}>下载本地图稿 JSON</button>
      <details><summary>当前图稿 JSON</summary><pre data-testid="document-json">{json}</pre></details>
      <label>待载入图稿 JSON<textarea aria-label="待载入图稿 JSON" value={input} maxLength={1_000_000} disabled={readOnly} onChange={event => setInput(event.target.value)} rows={6} /></label>
      <button type="button" disabled={readOnly} onClick={load}>载入图稿 JSON</button>
      {error && <p role="alert" className="uml-errors">{error}</p>}
    </section>
  </main>
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<EditorPreview />)
