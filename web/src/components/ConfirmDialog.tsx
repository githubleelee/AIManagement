import { useEffect, useRef, type ReactNode } from 'react'

/**
 * 危险操作二次确认（页内模态框，不用 window.confirm）。
 *
 * 原先定义在 `pages/requirement/Editor.tsx`，需求、成员、任务三处都要用，
 * 故上移到 components 成为共享组件；`Editor.tsx` 仍再导出同名成员，
 * 以免已有引用路径失效。
 *
 * 样式类（req-modal-* / req-button-*）来自 requirement.css。
 */
export default function ConfirmDialog({
  title,
  children,
  confirmText = '确认删除',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    // 打开即把焦点移到主按钮（否则键盘用户还在背后的页面上），Esc 可关闭。
    // 刻意**不做焦点陷阱（focus trap）**：本项目模态框很浅，加 trap 的复杂度
    // 换不来多少收益；但「能关」与「初始焦点不落在背景」是必须的。
    confirmRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="req-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="req-modal-title"
    >
      <div className="req-modal" style={danger ? undefined : { borderColor: '#b45309' }}>
        <p
          id="req-modal-title"
          className="req-form-title"
          style={danger ? { color: '#fca5a5' } : { color: '#fcd34d' }}
        >
          {title}
        </p>
        {children}
        <div className="req-op-row" style={{ marginTop: '0.8rem', justifyContent: 'flex-end' }}>
          <button className="req-button req-button-plain" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            ref={confirmRef}
            className={danger ? 'req-button req-button-danger' : 'req-button'}
            type="button"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
