import { useId } from 'react'
import type { UmlDocument, UseCaseDocument, SequenceDocument } from '../../../../src/modules/uml/document'

/** Render only SVG elements owned by React. User text never becomes markup/URLs. */
export default function UmlPreview({ document }: { document: UmlDocument }) {
  const markerId = `uml-arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <div className="uml-preview" tabIndex={0} aria-label="图预览滚动区域">
      {document.kind === 'USE_CASE'
        ? <UseCasePreview document={document} markerId={markerId} />
        : <SequencePreview document={document} markerId={markerId} />}
    </div>
  )
}

function ArrowDefs({ id }: { id: string }) {
  return <defs>
    <marker id={`${id}-open`} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </marker>
    <marker id={`${id}-filled`} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M1 1 L9 5 L1 9 Z" fill="currentColor" />
    </marker>
  </defs>
}

const short = (text: string, max = 20) => {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text
}

function UseCasePreview({ document: doc, markerId }: { document: UseCaseDocument; markerId: string }) {
  const height = Math.max(260, Math.max(doc.actors.length, doc.useCases.length) * 115 + 90)
  const actors = new Map(doc.actors.map((n, i) => [n.id, { ...n, y: 85 + i * 115 }]))
  const cases = new Map(doc.useCases.map((n, i) => [n.id, { ...n, y: 85 + i * 115 }]))
  return <svg role="img" aria-label="用例图预览" viewBox={`0 0 760 ${height}`} width="760" height={height}>
    <title>用例图：{doc.actors.length} 个参与者，{doc.useCases.length} 个用例</title>
    <ArrowDefs id={markerId} />
    <rect x="285" y="20" width="450" height={height - 40} rx="8" className="uml-boundary" />
    {doc.relations.map(relation => {
      const from = relation.type === 'ASSOCIATION' ? actors.get(relation.fromId) : cases.get(relation.fromId)
      const to = cases.get(relation.toId)
      if (!from || !to) return null
      if (relation.type === 'ASSOCIATION') return <g key={relation.id}>
        <line x1="165" y1={from.y} x2="335" y2={to.y} className="uml-edge" />
        <title>{relation.label ?? 'ASSOCIATION'}</title>
        {relation.label && <text x="250" y={(from.y + to.y) / 2 - 8} textAnchor="middle" className="uml-edge-label">{short(relation.label, 12)}</text>}
      </g>
      const middle = (from.y + to.y) / 2
      return <g key={relation.id}>
        <title>{relation.type}{relation.label ? `: ${relation.label}` : ''}</title>
        <path d={`M575 ${from.y} C700 ${from.y} 700 ${to.y} 575 ${to.y}`} className="uml-edge uml-dashed" markerEnd={`url(#${markerId}-open)`} />
        <text x="665" y={middle} textAnchor="middle" className="uml-edge-label">«{relation.type.toLowerCase()}»</text>
        {relation.label && <text x="665" y={middle + 18} textAnchor="middle" className="uml-edge-label">{short(relation.label, 12)}</text>}
      </g>
    })}
    {[...actors.values()].map(actor => <g key={actor.id}>
      <title>{actor.name}</title>
      <circle cx="130" cy={actor.y - 25} r="12" className="uml-actor" />
      <path d={`M130 ${actor.y - 13} v35 M105 ${actor.y} h50 M130 ${actor.y + 22} l-20 25 M130 ${actor.y + 22} l20 25`} className="uml-edge" />
      <text x="130" y={actor.y + 67} textAnchor="middle">{short(actor.name, 16)}</text>
    </g>)}
    {[...cases.values()].map(useCase => <g key={useCase.id}>
      <title>{useCase.name}</title>
      <ellipse cx="455" cy={useCase.y} rx="120" ry="35" className="uml-node" />
      <text x="455" y={useCase.y + 5} textAnchor="middle">{short(useCase.name, 16)}</text>
    </g>)}
    {!doc.actors.length && !doc.useCases.length && <text x="380" y="130" textAnchor="middle">添加参与者和用例后在此预览</text>}
  </svg>
}

function SequencePreview({ document: doc, markerId }: { document: SequenceDocument; markerId: string }) {
  const width = Math.max(760, doc.lifelines.length * 230 + 160)
  const height = Math.max(280, doc.messages.length * 85 + 150)
  const lines = new Map(doc.lifelines.map((line, i) => [line.id, { ...line, x: 100 + i * 230 }]))
  return <svg role="img" aria-label="时序图预览" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
    <title>时序图：{doc.lifelines.length} 条生命线，{doc.messages.length} 条消息</title>
    <ArrowDefs id={markerId} />
    {[...lines.values()].map(line => <g key={line.id}>
      <title>{line.name}</title>
      <rect x={line.x - 90} y="20" width="180" height="45" rx="5" className="uml-node" />
      <text x={line.x} y="48" textAnchor="middle">{short(line.name, 12)}</text>
      <line x1={line.x} y1="65" x2={line.x} y2={height - 20} className="uml-lifeline" />
    </g>)}
    {doc.messages.map((message, i) => {
      const from = lines.get(message.fromId)
      const to = lines.get(message.toId)
      if (!from || !to) return null
      const y = 115 + i * 85
      const self = from.x === to.x
      const dash = message.kind === 'return' ? 'uml-dashed' : ''
      const marker = `url(#${markerId}-${message.kind === 'sync' ? 'filled' : 'open'})`
      return <g key={message.id}>
        <title>{message.seq}. {message.label} ({message.kind})</title>
        {self
          ? <path d={`M${from.x} ${y} h75 v30 h-75`} className={`uml-edge ${dash}`} markerEnd={marker} />
          : <line x1={from.x} y1={y} x2={to.x} y2={y} className={`uml-edge ${dash}`} markerEnd={marker} />}
        <text x={self ? from.x + 10 : (from.x + to.x) / 2} y={y - 12} textAnchor={self ? 'start' : 'middle'} className="uml-edge-label">
          {message.seq}. {short(message.label ?? '', 22)} [{message.kind}]
        </text>
      </g>
    })}
    {!doc.lifelines.length && <text x="380" y="140" textAnchor="middle">添加生命线和消息后在此预览</text>}
  </svg>
}
