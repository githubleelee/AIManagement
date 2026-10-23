/**
 * #36 任务附件 —— 数据库仓储 + 权限适配器（ROLE-B 单写）
 *
 * 实现 `src/shared/attachments.ts` 的 `AttachmentRepositoryPort` /
 * `AttachmentAuthorizationPort`，把附件元数据落到 `Attachment` 表
 * （迁移 `20261023050228_add_attachment`）。
 *
 * 依据：
 *   - `docs/role-d/ROLE-D-ATTACH-interface-protocol.md` §3 / §5 / §6；
 *   - `docs/role-d/ROLE-D-ATTACH-public-integration-request.md` 第 1–3 项；
 *   - `DECISIONS.md` `attachments.policy` / `attachments.storage-and-cleanup` /
 *     `arch.shared-ports-and-assembly`；
 *   - 先例 `src/db/ai-repository.ts`（tx 形参、查询层可见性、404 同一条）、
 *     `src/db/event-repository.ts`（窄 `Pick` 事务形状）。
 *
 * ===========================================================================
 * 三个必须点
 * ===========================================================================
 *
 * 1. **事务（裁定 1）**：写方法接受调用方事务上下文（`transaction?`），传入时**不自行提交**；
 *    任务删除联动在**同一事务**内标记 `DELETING`（见 `attachment-cleanup.ts`）。
 * 2. **查询层可见性 / 404 同一条（裁定 2）**：单对象鉴权交给统一入口 `can()` 现查任务、
 *    项目成员、角色与 `objectVisibility` 白名单，**不做全量读取后内存过滤**；不可见与不存在
 *    返回逐字一致的 404。列表直接 `WHERE taskId = ? AND state = 'ACTIVE'`，计数与列表同源。
 * 3. **只读 ACTIVE**：所有对外读取只取 `state = 'ACTIVE'`；`DELETING` / `CLEANUP_FAILED`
 *    对用户不可见（经 B 的清理存储单独访问）。
 *
 * ===========================================================================
 * `taskId` 可空与「清理中」行
 * ===========================================================================
 *
 * `Attachment.taskId` 外键为 `onDelete: SetNull`（裁定 1）：任务删除后该列变 NULL，
 * 但清理状态保留在 `state` 列。这类「清理中」行**不**经本 `AttachmentRepositoryPort`
 * 对外暴露 —— 只经 `AttachmentCleanupStore`（`listCleanupCandidates`）访问，因此
 * 端口记录始终带 `taskId`。`toRecord` 对 NULL 做 `?? ''` 兜底仅用于保持适配器整体性，
 * 不会被 D 的 `service.ts` 用于业务路径（非 `ACTIVE` 行在 service 里先被判成 404）。
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { createAuthorization } from '../modules/authz/permissions.js'
import type {
  AttachmentCleanupCandidate,
  AttachmentCleanupStore,
} from './attachment-cleanup.js'
import {
  ATTACHMENT_LIST_LIMIT,
  type AttachmentAccessMetadata,
  type AttachmentAccessOperation,
  type AttachmentAuthorizationPort,
  type AttachmentExtension,
  type AttachmentMime,
  type AttachmentRecord,
  type AttachmentRepositoryPort,
  type AttachmentState,
} from '../shared/attachments.js'
import type { Action } from '../shared/types.js'

/**
 * 仓储实际用到的 Prisma 形状（窄 `Pick`）。
 *
 * 与 `permissions.ts` 的 `AuthzDb` / `event-repository.ts` 的 `EventDb` 同款理由：
 * `Prisma.TransactionClient` 不满足完整 `PrismaClient`，但结构上满足这个窄 `Pick`，
 * 因此仓储方法可在调用方事务内复用。
 */
export type AttachmentDb = Pick<PrismaClient, 'attachment'>

type AttachmentRow = {
  id: string
  projectId: string
  taskId: string | null
  uploaderUserId: string
  originalName: string
  extension: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  state: string
  createdAt: Date
  deleteRequestedAt: Date | null
  cleanupAttempts: number
  cleanupLastError: string | null
  deletedAt: Date | null
}

/** 行 → 域记录（`storagePath` ⇄ `storageKey`、`cleanupLastError` ⇄ `cleanupError`、时间 → ISO）。 */
function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    // 见文件头：NULL 只出现在「清理中」行，不经端口对外暴露。
    taskId: row.taskId ?? '',
    projectId: row.projectId,
    originalName: row.originalName,
    extension: row.extension as AttachmentExtension,
    mimeType: row.mimeType as AttachmentMime,
    sizeBytes: row.sizeBytes,
    storageKey: row.storagePath,
    uploaderUserId: row.uploaderUserId,
    uploadedAt: row.createdAt.toISOString(),
    state: row.state as AttachmentState,
    cleanupAttempts: row.cleanupAttempts,
    cleanupError: row.cleanupLastError,
  }
}

/** 域记录 → 插入数据（原始文件名只作元数据，绝不用来拼接磁盘路径）。 */
function toCreateData(record: AttachmentRecord): Prisma.AttachmentUncheckedCreateInput {
  return {
    id: record.id,
    projectId: record.projectId,
    taskId: record.taskId,
    uploaderUserId: record.uploaderUserId,
    originalName: record.originalName,
    extension: record.extension,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    storagePath: record.storageKey,
    state: record.state,
    createdAt: new Date(record.uploadedAt),
    cleanupAttempts: record.cleanupAttempts,
    cleanupLastError: record.cleanupError,
  }
}

export class PrismaAttachmentRepository implements AttachmentRepositoryPort, AttachmentCleanupStore {
  constructor(private readonly prisma: PrismaClient) {}

  private client(transaction?: AttachmentDb): AttachmentDb {
    return transaction ?? this.prisma
  }

  async insert(record: AttachmentRecord, transaction?: AttachmentDb): Promise<AttachmentRecord> {
    const row = await this.client(transaction).attachment.create({ data: toCreateData(record) })
    return toRecord(row)
  }

  /**
   * 查询层过滤：`WHERE taskId = ? AND state = 'ACTIVE'`。
   * D 的 `service.list` 以返回条数作为 `total`，故对结果加行数上限（`ATTACHMENT_LIST_LIMIT`）。
   */
  async listActiveByTask(taskId: string, transaction?: AttachmentDb): Promise<AttachmentRecord[]> {
    const rows = await this.client(transaction).attachment.findMany({
      where: { taskId, state: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: ATTACHMENT_LIST_LIMIT,
    })
    return rows.map(toRecord)
  }

  /** 全状态（含清理中）：仅供任务删除后的批量清理 / 内部核对，**不**用于对外列表。 */
  async listAllByTask(taskId: string, transaction?: AttachmentDb): Promise<AttachmentRecord[]> {
    const rows = await this.client(transaction).attachment.findMany({
      where: { taskId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toRecord)
  }

  async findAccessMetadata(
    id: string,
    transaction?: AttachmentDb,
  ): Promise<AttachmentAccessMetadata | null> {
    const row = await this.client(transaction).attachment.findUnique({
      where: { id },
      select: { id: true, taskId: true, state: true },
    })
    if (!row) return null
    return { id: row.id, taskId: row.taskId ?? '', state: row.state as AttachmentState }
  }

  async findById(id: string, transaction?: AttachmentDb): Promise<AttachmentRecord | null> {
    const row = await this.client(transaction).attachment.findUnique({ where: { id } })
    return row ? toRecord(row) : null
  }

  /** `ACTIVE → DELETING`，累加尝试次数并清空错误（与 D 的内存桩语义一致）。 */
  async markDeleting(id: string, transaction?: AttachmentDb): Promise<AttachmentRecord | null> {
    const client = this.client(transaction)
    const updated = await client.attachment.updateMany({
      where: { id },
      data: {
        state: 'DELETING',
        deleteRequestedAt: new Date(),
        cleanupAttempts: { increment: 1 },
        cleanupLastError: null,
      },
    })
    if (updated.count === 0) return null
    const row = await client.attachment.findUnique({ where: { id } })
    return row ? toRecord(row) : null
  }

  /** 置 `CLEANUP_FAILED` + 安全错误码，保留可重试证据。 */
  async markCleanupFailed(
    id: string,
    safeReason: string,
    transaction?: AttachmentDb,
  ): Promise<AttachmentRecord | null> {
    const client = this.client(transaction)
    const updated = await client.attachment.updateMany({
      where: { id },
      data: { state: 'CLEANUP_FAILED', cleanupLastError: safeReason },
    })
    if (updated.count === 0) return null
    const row = await client.attachment.findUnique({ where: { id } })
    return row ? toRecord(row) : null
  }

  /** 物理文件删除成功后删行；返回是否真的删掉一行。 */
  async remove(id: string, transaction?: AttachmentDb): Promise<boolean> {
    const result = await this.client(transaction).attachment.deleteMany({ where: { id } })
    return result.count > 0
  }

  /**
   * 清理执行器：按 `state`（`DELETING` / `CLEANUP_FAILED`）列待清理候选。
   * 用 `state` 而非 `taskId`：任务行删除后 `taskId` 已被 SetNull（见文件头说明）。
   */
  async listCleanupCandidates(
    limit: number,
    transaction?: AttachmentDb,
  ): Promise<AttachmentCleanupCandidate[]> {
    const rows = await this.client(transaction).attachment.findMany({
      where: { state: { in: ['DELETING', 'CLEANUP_FAILED'] } },
      orderBy: [{ deleteRequestedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, storagePath: true, state: true },
    })
    return rows.map((row) => ({
      id: row.id,
      storageKey: row.storagePath,
      state: row.state as AttachmentCleanupCandidate['state'],
    }))
  }
}

// ---------------------------------------------------------------------------
// 权限适配器
// ---------------------------------------------------------------------------

/**
 * 附件操作 → 既有统一 `Action` 映射（**不新增 Action**）。
 *
 *   - `READ`（列表 / 下载）→ `project.read`（项目成员可见即允许；敏感规则由 `can()` 第 4 条处理）；
 *   - `WRITE`（上传 / 删除）→ `task.progress`（既有「任务级成员可写」动作；PM 放行，
 *     VIEWER 403，其它 MEMBER 仅任务负责人放行）。
 *
 * 两个动作都走**既有** `can()`，业务层零角色名字面判断。敏感任务的隔离在第 4 条
 * （`objectVisibility` 现查）完成，因此非授权成员读 / 写 / 下载都得到逐字一致的 404。
 */
const OPERATION_ACTION: Record<AttachmentAccessOperation, Action> = {
  READ: 'project.read',
  WRITE: 'task.progress',
}

/**
 * 附件权限适配器（`AttachmentAuthorizationPort`）。
 *
 * 每次请求**现查**任务真实 `projectId`（不信任调用方），再走统一 `can()`：
 * 任务不存在 → 404；非成员 / 敏感未授权 → 404；VIEWER 写 → 403；其余按矩阵放行。
 */
export function createAttachmentAuthorizationPort(prisma: PrismaClient): AttachmentAuthorizationPort {
  const { can } = createAuthorization(prisma)
  return {
    async decide(actorUserId: string, taskId: string, operation: AttachmentAccessOperation) {
      // 现查真实归属项目（`can()` 的 task 分支也会自己现查，这里只为返回 projectId）。
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { projectId: true },
      })
      if (!task) return { allow: false as const, status: 404 as const, code: 'NOT_FOUND' as const }

      const decision = await can(actorUserId, OPERATION_ACTION[operation], {
        kind: 'task',
        projectId: task.projectId,
        objectId: taskId,
      })
      return decision.allow
        ? { allow: true as const, projectId: task.projectId }
        : { allow: false as const, status: decision.status, code: decision.code }
    },
  }
}
