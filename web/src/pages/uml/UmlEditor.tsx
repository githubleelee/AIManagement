import { useMemo } from 'react'
import {
  moveSequenceMessage, removeUmlNode, umlDocumentSchema, UML_EDITOR_LIMITS,
  useCaseRelationTypes, sequenceMessageTypes,
} from '../../../../src/modules/uml/document'
import type {
  UmlDocument, UseCaseDocument, SequenceDocument, UseCaseRelation, SequenceMessage,
} from '../../../../src/modules/uml/document'
import UmlPreview from './UmlPreview'
import './uml.css'

type Props = {
  document: UmlDocument
  onChange: (document: UmlDocument) => void
  /** Presentation only, never a replacement for server-side can()/visibilityScope(). */
  readOnly?: boolean
}
const newId = () => crypto.randomUUID()

/** Controlled editor, no API calls, project data, persistent cache or fake save action. */
export default function UmlEditor({ document: doc, onChange, readOnly = false }: Props) {
  const validation = useMemo(() => umlDocumentSchema.safeParse(doc), [doc])
  const update = (next: UmlDocument) => { if (!readOnly) onChange(next) }
  return <section className="uml-editor" aria-label={doc.kind === 'USE_CASE' ? '用例图编辑器' : '时序图编辑器'}>
    <p className="uml-notice">{readOnly ? '只读预览：不可修改图稿。' : '此编辑器不自动保存；修改后请使用页面提供的保存操作。'}</p>
    <div className="uml-workspace">
      <div className="uml-controls">
        <fieldset disabled={readOnly} className="uml-fieldset">
          <legend>{doc.kind === 'USE_CASE' ? '用例图结构' : '时序图结构'}</legend>
          {doc.kind === 'USE_CASE'
            ? <UseCaseControls document={doc} onChange={update} />
            : <SequenceControls document={doc} onChange={update} />}
        </fieldset>
        {!validation.success && <div role="alert" className="uml-errors">
          <strong>图稿尚未通过校验</strong>
          <ul>{validation.error.issues.map((issue, i) => <li key={i}>{issue.path.join('.') || 'document'}：{issue.message}</li>)}</ul>
        </div>}
      </div>
      <UmlPreview document={doc} />
    </div>
  </section>
}

function NodeRows({ nodes, label, onName, onRemove, onMove }: {
  nodes: { id: string; name: string }[]; label: string
  onName: (id: string, name: string) => void; onRemove: (id: string) => void
  onMove?: (id: string, offset: -1 | 1) => void
}) {
  return <div className="uml-node-rows">{nodes.map((node, index) => <div className="uml-node-row" key={node.id}>
    <label>{label} {index + 1}
      <input value={node.name} maxLength={UML_EDITOR_LIMITS.text} onChange={event => onName(node.id, event.target.value)} />
    </label>
    <div className="uml-node-actions">
      {onMove && <>
        <button type="button" aria-label={`前移${label} ${index + 1}`} disabled={index === 0} onClick={() => onMove(node.id, -1)}>前移</button>
        <button type="button" aria-label={`后移${label} ${index + 1}`} disabled={index === nodes.length - 1} onClick={() => onMove(node.id, 1)}>后移</button>
      </>}
      <button type="button" aria-label={`删除${label} ${index + 1}`} onClick={() => onRemove(node.id)}>删除</button>
    </div>
  </div>)}</div>
}

function Endpoint({ label, value, options, onChange }: {
  label: string; value: string; options: { id: string; name: string }[]; onChange: (id: string) => void
}) {
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    <option value="" disabled>请选择</option>
    {options.map(node => <option key={node.id} value={node.id}>{node.name || '（未命名）'}</option>)}
  </select></label>
}

function UseCaseControls({ document: doc, onChange }: { document: UseCaseDocument; onChange: (doc: UmlDocument) => void }) {
  const updateNode = (group: 'actors' | 'useCases', id: string, name: string) => onChange({
    ...doc, [group]: doc[group].map(node => node.id === id ? { ...node, name } : node),
  })
  const patchRelation = (id: string, patch: Partial<UseCaseRelation>) => onChange({
    ...doc, relations: doc.relations.map(relation => relation.id === id ? { ...relation, ...patch } : relation),
  })
  function addRelation() {
    if (!doc.actors[0] || !doc.useCases[0]) return
    onChange({ ...doc, relations: [...doc.relations, {
      id: newId(), type: 'ASSOCIATION', fromId: doc.actors[0].id, toId: doc.useCases[0].id,
    }] })
  }
  return <>
    <h3>参与者</h3>
    <NodeRows nodes={doc.actors} label="参与者" onName={(id, name) => updateNode('actors', id, name)} onRemove={id => onChange(removeUmlNode(doc, id))} />
    <button type="button" disabled={doc.actors.length + doc.useCases.length >= UML_EDITOR_LIMITS.nodes} onClick={() => onChange({ ...doc, actors: [...doc.actors, { id: newId(), name: '新参与者' }] })}>添加参与者</button>
    <h3>用例</h3>
    <NodeRows nodes={doc.useCases} label="用例" onName={(id, name) => updateNode('useCases', id, name)} onRemove={id => onChange(removeUmlNode(doc, id))} />
    <button type="button" disabled={doc.actors.length + doc.useCases.length >= UML_EDITOR_LIMITS.nodes} onClick={() => onChange({ ...doc, useCases: [...doc.useCases, { id: newId(), name: '新用例' }] })}>添加用例</button>
    <h3>关系</h3>
    {doc.relations.map((relation, index) => <div className="uml-relation" key={relation.id}>
      <label>关系 {index + 1} 类型<select aria-label={`关系 ${index + 1} 类型`} value={relation.type} onChange={event => {
        const type = event.target.value as UseCaseRelation['type']
        const fromId = type === 'ASSOCIATION' ? doc.actors[0]?.id ?? '' : doc.useCases[0]?.id ?? ''
        const toId = type === 'ASSOCIATION' ? doc.useCases[0]?.id ?? '' : doc.useCases[1]?.id ?? ''
        patchRelation(relation.id, { type, fromId, toId, associationReversed: false })
      }}>{useCaseRelationTypes.map(type => <option key={type}>{type}</option>)}</select></label>
      <Endpoint label={`关系 ${index + 1} 起点`} value={relation.fromId} options={relation.type === 'ASSOCIATION' ? doc.actors : doc.useCases} onChange={fromId => patchRelation(relation.id, { fromId })} />
      <Endpoint label={`关系 ${index + 1} 终点`} value={relation.toId} options={doc.useCases} onChange={toId => patchRelation(relation.id, { toId })} />
      <label>关系 {index + 1} 说明<input aria-label={`关系 ${index + 1} 说明`} value={relation.label ?? ''} maxLength={UML_EDITOR_LIMITS.text} onChange={event => patchRelation(relation.id, { label: event.target.value })} /></label>
      <button type="button" aria-label={`删除关系 ${index + 1}`}  onClick={() => onChange({ ...doc, relations: doc.relations.filter(r => r.id !== relation.id) })}>删除关系</button>
    </div>)}
    <button type="button" disabled={(!doc.actors.length && doc.useCases.length < 2) || !doc.useCases.length || doc.relations.length >= UML_EDITOR_LIMITS.edges} onClick={() => {
      // Two use cases can be related without an actor.
      if (!doc.actors.length && doc.useCases[0] && doc.useCases[1]) {
        onChange({ ...doc, relations: [...doc.relations, { id: newId(), type: 'INCLUDE', fromId: doc.useCases[0].id, toId: doc.useCases[1].id }] })
      } else addRelation()
    }}>添加关系</button>
    <p className="uml-help">ASSOCIATION：参与者 → 用例；INCLUDE / EXTEND：用例 → 另一用例。</p>
  </>
}

function SequenceControls({ document: doc, onChange }: { document: SequenceDocument; onChange: (doc: UmlDocument) => void }) {
  const patch = (id: string, change: Partial<SequenceMessage>) => onChange({
    ...doc, messages: doc.messages.map(message => message.id === id ? { ...message, ...change } : message),
  })
  return <>
    <h3>生命线</h3>
    <NodeRows nodes={doc.lifelines} label="生命线" onName={(id, name) => onChange({ ...doc, lifelines: doc.lifelines.map(line => line.id === id ? { ...line, name } : line) })} onRemove={id => onChange(removeUmlNode(doc, id))} onMove={(id, offset) => {
      const index = doc.lifelines.findIndex(line => line.id === id)
      const destination = index + offset
      if (index < 0 || destination < 0 || destination >= doc.lifelines.length) return
      const lifelines = [...doc.lifelines]
      const current = lifelines[index]
      lifelines[index] = lifelines[destination]
      lifelines[destination] = current
      onChange({ ...doc, lifelines })
    }} />
    <button type="button" disabled={doc.lifelines.length >= UML_EDITOR_LIMITS.nodes} onClick={() => onChange({ ...doc, lifelines: [...doc.lifelines, { id: newId(), name: '新生命线' }] })}>添加生命线</button>
    <h3>有序消息</h3>
    {doc.messages.map((message, index) => <div className="uml-relation" key={message.id}>
      <label>消息 {index + 1} 内容<input value={message.label ?? ''} maxLength={UML_EDITOR_LIMITS.text} onChange={event => patch(message.id, { label: event.target.value })} /></label>
      <label>消息 {index + 1} 类型<select aria-label={`消息 ${index + 1} 类型`} value={message.kind} onChange={event => patch(message.id, { kind: event.target.value as SequenceMessage['kind'] })}>
        {sequenceMessageTypes.map(type => <option key={type}>{type}</option>)}
      </select></label>
      <Endpoint label={`消息 ${index + 1} 发送方`} value={message.fromId} options={doc.lifelines} onChange={fromId => patch(message.id, { fromId })} />
      <Endpoint label={`消息 ${index + 1} 接收方`} value={message.toId} options={doc.lifelines} onChange={toId => patch(message.id, { toId })} />
      <div className="uml-actions">
        <button type="button" aria-label={`上移消息 ${index + 1}`} disabled={index === 0} onClick={() => onChange(moveSequenceMessage(doc, message.id, -1))}>上移</button>
        <button type="button" aria-label={`下移消息 ${index + 1}`} disabled={index === doc.messages.length - 1} onClick={() => onChange(moveSequenceMessage(doc, message.id, 1))}>下移</button>
        <button type="button" aria-label={`删除消息 ${index + 1}`} onClick={() => onChange({ ...doc, messages: doc.messages.filter(m => m.id !== message.id).map((m, i) => ({ ...m, seq: i + 1 })) })}>删除</button>
      </div>
    </div>)}
    <button type="button" disabled={!doc.lifelines.length || doc.messages.length >= UML_EDITOR_LIMITS.edges} onClick={() => {
      const from = doc.lifelines[0]
      if (!from) return
      onChange({ ...doc, messages: [...doc.messages, { id: newId(), fromId: from.id, toId: doc.lifelines[1]?.id ?? from.id, label: '新消息', kind: 'sync', seq: (doc.messages[doc.messages.length - 1]?.seq ?? 0) + 1 }] })
    }}>添加消息</button>
    <p className="uml-help">消息按当前顺序从上到下展示；上移/下移会同步调整递增序号。</p>
  </>
}
