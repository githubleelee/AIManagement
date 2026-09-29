/** 空状态 / 占位：标题 + 可选提示。
 *
 * `level` 用于语义化标题：页面级空状态传 1（渲染 <h1>），列表级空状态可传 2/3；
 * 不传则沿用原来的 <strong>（纯视觉强调，不进入标题层级）。
 */
export default function EmptyState({
  title,
  hint,
  level,
}: {
  title: string
  hint?: string
  level?: 1 | 2 | 3
}) {
  return (
    <div className="empty">
      {level === 1 ? (
        <h1 className="empty-title">{title}</h1>
      ) : level === 2 ? (
        <h2 className="empty-title">{title}</h2>
      ) : level === 3 ? (
        <h3 className="empty-title">{title}</h3>
      ) : (
        <strong>{title}</strong>
      )}
      {hint ? <p className="muted">{hint}</p> : null}
    </div>
  )
}
