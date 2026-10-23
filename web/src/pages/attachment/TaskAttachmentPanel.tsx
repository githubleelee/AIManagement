import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ApiError } from '../../api'
import {
  deleteAttachment,
  downloadAttachment,
  listTaskAttachments,
  uploadTaskAttachment,
  validateAttachmentFile,
  type AttachmentView,
} from './api'
import './attachment.css'

type Props = {
  taskId: string
  /** PM/MEMBER=true，VIEWER=false；这里只控制体验，服务端仍重新鉴权。 */
  canWrite: boolean
}

function sizeLabel(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export default function TaskAttachmentPanel({ taskId, canWrite }: Props) {
  const [items, setItems] = useState<AttachmentView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    try {
      setItems((await listTaskAttachments(taskId)).items)
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '附件加载失败')
    }
  }, [taskId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function onSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validation = validateAttachmentFile(file)
    if (validation) {
      setError(validation)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await uploadTaskAttachment(taskId, file)
      await reload()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: AttachmentView) {
    setBusy(true)
    setError(null)
    try {
      await deleteAttachment(item.id)
      await reload()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  async function download(item: AttachmentView) {
    try {
      await downloadAttachment(item)
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '下载失败')
    }
  }

  return (
    <section className="task-attachments" aria-label="任务附件">
      <div className="task-attachments-heading">
        <strong>附件（{items === null ? '…' : items.length}）</strong>
        {canWrite ? (
          <>
            <input
              ref={inputRef}
              className="attachment-file-input"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.zip"
              onChange={(event) => void onSelect(event)}
            />
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? '处理中…' : '上传附件'}
            </button>
          </>
        ) : null}
      </div>

      <p className="attachment-help">单文件不超过 10MB；支持图片、PDF、DOCX、XLSX、ZIP。</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {items === null ? <p className="muted">正在加载…</p> : null}
      {items?.length === 0 ? <p className="muted">暂无附件</p> : null}
      {items && items.length > 0 ? (
        <ul className="attachment-list">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.originalName}</strong>
                <small>{sizeLabel(item.sizeBytes)}</small>
              </span>
              <span className="attachment-actions">
                <button type="button" className="ghost" onClick={() => void download(item)}>
                  下载
                </button>
                {canWrite ? (
                  <button type="button" className="danger" disabled={busy} onClick={() => void remove(item)}>
                    删除
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
