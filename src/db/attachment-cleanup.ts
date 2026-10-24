/**
 * #36 任务附件 —— 清理执行器与生命周期端口实现（ROLE-B 单写）
 *
 * 实现 B 的删除语义裁定（`DECISIONS.md` `attachments.storage-and-cleanup`）：
 *
 *   - `requestTaskAttachmentCleanup(tx, taskId)`：在**调用方事务**内把该任务的 `ACTIVE`
 *     附件标为 `DELETING` 并记录 `deleteRequestedAt`（**不自行提交**）。任务删除失败时事务回滚，
 *     标记一并消失 —— 因此**绝不先删实体**。
 *   - `runAttachmentCleanup({ repository, storage, limit? })`：在任务删除事务**提交后**运行，
 *     扫描待清理行（`DELETING` / `CLEANUP_FAILED`），删除物理文件：成功 → 删行；失败 →
 *     置 `CLEANUP_FAILED` + 累加 `cleanupAttempts` + 记录 `cleanupLastError`（可重试）。
 *   - `createAttachmentLifecycle({ repository, storage })`：把上面两个动作包成
 *     `TaskAttachmentLifecyclePort`，由 `src/app.ts` 注入 `RouteContext.attachmentCleanup`，
 *     供任务删除路径（ROLE-C 窗口）调用，**不**让业务域 import / new 任何附件实现。
 *
 * 为什么按 `state` 扫描而不是按 `taskId`：`Attachment.taskId` 外键为 `onDelete: SetNull`，
 * 任务行删除后该列已变 NULL，无法再用 `taskId` 找回待清理行；`state` + `deleteRequestedAt`
 * 才是跨任务稳定的清理依据（这也是裁定 1 明确**不用** `Cascade` 的原因）。
 *
 * `taskId` 可空与「清理中」行：清理候选用专门的 **nullable 清理类型**
 * （`AttachmentCleanupCandidate.taskId: string | null`），**不**经业务 `AttachmentRecord`
 * （其 `taskId` 仍是 `string`）—— 用户路径遇到 NULL 行返回 `null` / 404，绝不用 `taskId: ''`
 * 伪造任务。
 *
 * 路径安全：物理删除统一走 `AttachmentStoragePort`（`LocalAttachmentStorage` 会校验解析后
 * 仍在存储根内），因此即使某行 `storagePath` 被写入越界值，`delete` 也会抛错并落到
 * `CLEANUP_FAILED`，绝不会删除存储根以外的文件。
 */
import type { PrismaClient } from '@prisma/client'
import {
  type AttachmentCleanupBatchResult,
  type AttachmentState,
  type AttachmentStoragePort,
  type TaskAttachmentLifecyclePort,
} from '../shared/attachments.js'

/** 清理执行器实际用到的 Prisma 形状（窄 `Pick`，可在调用方事务内复用）。 */
export type AttachmentCleanupDb = Pick<PrismaClient, 'attachment'>

/** 单次清理扫描的行数上限（避免一次拖垮 tick；未清理完下一 tick 继续）。 */
export const ATTACHMENT_CLEANUP_LIMIT = 100

/** 清理失败时落库的**安全**错误码（不写底层 errno / 路径等敏感细节）。 */
export const SAFE_CLEANUP_REASON = 'FILE_DELETE_FAILED'

/** 待清理候选：只需删文件与定位行；`taskId` 可空（任务行已 SetNull）。 */
export type AttachmentCleanupCandidate = {
  id: string
  storageKey: string
  taskId: string | null
  state: Extract<AttachmentState, 'DELETING' | 'CLEANUP_FAILED'>
}

/**
 * 清理执行器依赖的窄存储端口（由 `PrismaAttachmentRepository` 实现）。
 *
 * 刻意不返回业务 `AttachmentRecord`：清理要处理 `taskId` 已被 SetNull 的「清理中」行，
 * 而业务记录 `taskId` 仍是 `string`；两条路径的字段语义不同，故用专用方法与类型隔离。
 */
export interface AttachmentCleanupStore {
  listCleanupCandidates(limit: number): Promise<AttachmentCleanupCandidate[]>
  /** `ACTIVE → DELETING`（清空错误、累加尝试次数）；行不存在返回 `false`。 */
  beginCleanupAttempt(id: string): Promise<boolean>
  /** 物理文件删除成功后删行；返回是否真的删掉一行。 */
  completeCleanup(id: string): Promise<boolean>
  /** 物理文件删除失败：置 `CLEANUP_FAILED` + 安全错误码，保留可重试证据。 */
  failCleanup(id: string, safeReason: string): Promise<boolean>
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
 * 返回**独立批次结果**（无 `taskId`）；`limit` 缺省 `ATTACHMENT_CLEANUP_LIMIT`。
 */
export async function runAttachmentCleanup(input: {
  repository: AttachmentCleanupStore
  storage: AttachmentStoragePort
  limit?: number
}): Promise<AttachmentCleanupBatchResult> {
  const limit = input.limit ?? ATTACHMENT_CLEANUP_LIMIT
  const candidates = await input.repository.listCleanupCandidates(limit)
  const result: AttachmentCleanupBatchResult = { removed: 0, failed: [] }

  for (const candidate of candidates) {
    const claimed = await input.repository.beginCleanupAttempt(candidate.id)
    if (!claimed) continue
    try {
      await input.storage.delete(candidate.storageKey)
      await input.repository.completeCleanup(candidate.id)
      result.removed += 1
    } catch {
      await input.repository.failCleanup(candidate.id, SAFE_CLEANUP_REASON)
      result.failed.push({ attachmentId: candidate.id, reason: SAFE_CLEANUP_REASON })
    }
  }

  return result
}

/**
 * 组装生命周期端口（`TaskAttachmentLifecyclePort`）。
 *
 * 由 `src/app.ts` 用同一个 prisma 仓储 + 本地存储构造并注入 `RouteContext.attachmentCleanup`；
 * 业务域（任务删除路径）只调端口，不 import / new 附件实现。
 */
export function createAttachmentLifecycle(input: {
  repository: AttachmentCleanupStore
  storage: AttachmentStoragePort
  limit?: number
}): TaskAttachmentLifecyclePort<AttachmentCleanupDb> {
  return {
    markForTaskDeletion: (transaction, taskId) =>
      requestTaskAttachmentCleanup(transaction, taskId),
    run: () => runAttachmentCleanup({ repository: input.repository, storage: input.storage, limit: input.limit }),
  }
}
