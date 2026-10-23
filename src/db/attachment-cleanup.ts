/**
 * #36 任务附件 —— 清理执行器（ROLE-B 单写）
 *
 * 实现 B 的删除语义裁定（`DECISIONS.md` `attachments.storage-and-cleanup`）：
 *
 *   - `requestTaskAttachmentCleanup(tx, taskId)`：在**调用方事务**内把该任务的 `ACTIVE`
 *     附件标为 `DELETING` 并记录 `deleteRequestedAt`（**不自行提交**）。任务删除失败时事务回滚，
 *     标记一并消失 —— 因此**绝不先删实体**。
 *   - `runAttachmentCleanup({ repository, storage, taskId? })`：在任务删除事务**提交后**运行，
 *     扫描待清理行（`DELETING` / `CLEANUP_FAILED`），删除物理文件：成功 → 删行；失败 →
 *     置 `CLEANUP_FAILED` + 累加 `cleanupAttempts` + 记录 `cleanupLastError`（可重试）。
 *
 * 为什么按 `state` 扫描而不是按 `taskId`：`Attachment.taskId` 外键为 `onDelete: SetNull`，
 * 任务行删除后该列已变 NULL，无法再用 `taskId` 找回待清理行；`state` + `deleteRequestedAt`
 * 才是跨任务稳定的清理依据（这也是裁定 1 明确**不用** `Cascade` 的原因）。
 *
 * 路径安全：物理删除统一走 `AttachmentStoragePort`（`LocalAttachmentStorage` 会校验解析后
 * 仍在存储根内），因此即使某行 `storagePath` 被写入越界值，`delete` 也会抛错并落到
 * `CLEANUP_FAILED`，绝不会删除存储根以外的文件。
 */
import type { PrismaClient } from '@prisma/client'
import {
  type AttachmentRecord,
  type AttachmentState,
  type AttachmentStoragePort,
  type TaskAttachmentCleanupResult,
} from '../shared/attachments.js'

/** 清理执行器实际用到的 Prisma 形状（窄 `Pick`，可在调用方事务内复用）。 */
export type AttachmentCleanupDb = Pick<PrismaClient, 'attachment'>

/** 单次清理扫描的行数上限（避免一次拖垮请求；未清理完可再次运行）。 */
export const ATTACHMENT_CLEANUP_LIMIT = 100

/** 清理失败时落库的**安全**错误码（不写底层 errno / 路径等敏感细节）。 */
export const SAFE_CLEANUP_REASON = 'FILE_DELETE_FAILED'

/** 待清理候选：只需要删文件与定位行，不需要业务字段。 */
export type AttachmentCleanupCandidate = {
  id: string
  storageKey: string
  state: Extract<AttachmentState, 'DELETING' | 'CLEANUP_FAILED'>
}

/**
 * 清理执行器依赖的窄存储端口（由 `PrismaAttachmentRepository` 实现）。
 *
 * 刻意不直接依赖完整 `AttachmentRepositoryPort`：清理只关心「按状态列候选 + 标记 + 删行」，
 * 且要能处理 `taskId` 已被 SetNull 的「清理中」行。
 */
export interface AttachmentCleanupStore {
  listCleanupCandidates(limit: number): Promise<AttachmentCleanupCandidate[]>
  markDeleting(id: string): Promise<AttachmentRecord | null>
  markCleanupFailed(id: string, safeReason: string): Promise<AttachmentRecord | null>
  remove(id: string): Promise<boolean>
}

/**
 * 任务删除联动：在**调用方事务**内把该任务 `ACTIVE` 附件标为 `DELETING`。
 *
 * 返回被标记的行数。**不自行 `$transaction` / 不提交**；由调用方（任务删除事务）决定提交或回滚。
 */
export async function requestTaskAttachmentCleanup(
  transaction: AttachmentCleanupDb,
  taskId: string,
  now: () => Date = () => new Date(),
): Promise<number> {
  const result = await transaction.attachment.updateMany({
    where: { taskId, state: 'ACTIVE' },
    data: { state: 'DELETING', deleteRequestedAt: now() },
  })
  return result.count
}

/**
 * 运行清理：删除物理文件，成功删行，失败留 `CLEANUP_FAILED` 证据。
 *
 * `taskId` 仅用于结果归属标注（可空；缺省表示跨任务的批量清理）。
 * `limit` 缺省 `ATTACHMENT_CLEANUP_LIMIT`。
 */
export async function runAttachmentCleanup(input: {
  repository: AttachmentCleanupStore
  storage: AttachmentStoragePort
  taskId?: string
  limit?: number
}): Promise<TaskAttachmentCleanupResult> {
  const limit = input.limit ?? ATTACHMENT_CLEANUP_LIMIT
  const candidates = await input.repository.listCleanupCandidates(limit)
  const result: TaskAttachmentCleanupResult = { taskId: input.taskId ?? '', removed: 0, failed: [] }

  for (const candidate of candidates) {
    // 重新标记（累加尝试次数、刷新 deleteRequestedAt），与单附件删除路径同款语义。
    const deleting = await input.repository.markDeleting(candidate.id)
    if (!deleting) continue
    try {
      await input.storage.delete(deleting.storageKey)
      await input.repository.remove(deleting.id)
      result.removed += 1
    } catch {
      await input.repository.markCleanupFailed(deleting.id, SAFE_CLEANUP_REASON)
      result.failed.push({ attachmentId: deleting.id, reason: SAFE_CLEANUP_REASON })
    }
  }

  return result
}
