/** 空状态 / 占位：标题 + 可选提示。 */
export default function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint ? <p className="muted">{hint}</p> : null}
    </div>
  )
}

