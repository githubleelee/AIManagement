import { ApiError, apiFetch, getToken } from '../../api'

export const MAX_ATTACHMENT_BYTES = 10_000_000

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}

export type AttachmentView = {
  id: string
  taskId: string
  projectId: string
  originalName: string
  extension: string
  mimeType: string
  sizeBytes: number
  uploaderUserId: string
  uploadedAt: string
  state: 'ACTIVE' | 'DELETING' | 'CLEANUP_FAILED'
}

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function validateAttachmentFile(file: File): string | null {
  const expectedMime = MIME_BY_EXTENSION[extensionOf(file.name)]
  if (!expectedMime) return '仅支持 png、jpg、jpeg、webp、pdf、docx、xlsx、zip。'
  if (file.type !== expectedMime) return '文件扩展名与 MIME 类型不匹配。'
  if (file.size > MAX_ATTACHMENT_BYTES) return '单个附件不能超过 10MB（10,000,000 字节）。'
  return null
}

export function listTaskAttachments(taskId: string) {
  return apiFetch<{ total: number; items: AttachmentView[] }>(
    `/tasks/${encodeURIComponent(taskId)}/attachments`,
  )
}

export function uploadTaskAttachment(taskId: string, file: File): Promise<AttachmentView> {
  return apiFetch<AttachmentView>(`/tasks/${encodeURIComponent(taskId)}/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  })
}

export function deleteAttachment(attachmentId: string): Promise<void> {
  return apiFetch<void>(`/attachments/${encodeURIComponent(attachmentId)}`, {
    method: 'DELETE',
  })
}

export async function downloadAttachment(item: AttachmentView): Promise<void> {
  const headers = new Headers()
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(
    `/api/attachments/${encodeURIComponent(item.id)}/download`,
    { headers },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? '下载失败',
    )
  }
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = item.originalName
  anchor.click()
  URL.revokeObjectURL(url)
}
