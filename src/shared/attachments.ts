/**
 * 任务附件域公共契约（#36 公共接入，ROLE-B 单写）
 *
 * 权威来源：
 *   - `src/modules/attachment/contracts.ts`（ROLE-D 的模块内契约 —— 本文件是**唯一权威定义**，
 *     该文件改为只 `export *`，不留第二份会漂移的定义）；
 *   - `docs/role-d/ROLE-D-ATTACH-interface-protocol.md`（D 的接口协议）；
 *   - `docs/role-d/ROLE-D-ATTACH-public-integration-request.md`（D 的公共接入申请）；
 *   - `DECISIONS.md` `attachments.policy`（白名单 / 10MB / 扩展名+MIME 联合校验 / var/uploads /
 *     任务删除联动可追踪重试）、`arch.shared-ports-and-assembly`（公共类型与端口放 `src/shared/`）、
 *     `attachments.storage-and-cleanup`（B 的删除语义裁定）。
 *
 * 依赖方向：`src/shared/` **不** import 任何业务模块；业务域（A/C/D）只依赖本文件的端口，
 * 不 import D 的 `service.ts`（契约 I-9「不跨模块调 service」）。
 *
 * ===========================================================================
 * 本批（B 的公共接入批次）冻结的语义 —— 引用方必须遵守
 * ===========================================================================
 *
 * 1. **只读 ACTIVE**：列表 / 详情只返回 `state === 'ACTIVE'` 的附件；`DELETING` /
 *    `CLEANUP_FAILED` 对用户不可见。
 * 2. **删除语义（裁定 1）**：`Attachment.taskId` 可空 + 外键 `onDelete: SetNull`。
 *    任务删除在**同一事务**内把该任务 `ACTIVE` 附件标为 `DELETING`（记录
 *    `deleteRequestedAt`）；事务提交后由清理执行器删除物理文件。**绝不允许先删实体**；
 *    失败置 `CLEANUP_FAILED` + 累加 `cleanupAttempts` + `cleanupLastError`，可重试。
 *    明确**不用** `Cascade`（会丢失清理状态、无法重试）。
 * 3. **敏感隔离**：附件归属任务 `isSensitive` 时，非授权成员读 / 写 / 下载一律 404，
 *    且与「不存在」响应体逐字一致；判定必须在**查询层**（`can()` 现查 `objectVisibility`），
 *    不得先取全量再内存剔除。
 * 4. **权限**：读 / 下载复用 `project.read`，写复用 `task.progress`（均为**既有** `Action`，
 *    不新增 Action、不写角色名字面判断）。下载响应必须带
 *    `Content-Disposition: attachment`，**不得**把 `var/uploads/` 注册为静态目录。
 * 5. **存储路径安全**：物理路径必须校验解析后仍在存储根内；原始文件名只作元数据，
 *    不参与磁盘路径拼接（磁盘名 = 服务端 UUID + 已验证扩展名）。
 * 6. **组装**：`src/app.ts` 显式注入（prisma 仓储 + 本地存储 + 权限适配器 + service），
 *    `src/routes.ts` 注册 `registerAttachmentRoutes`。
 */

/** 单文件严格 SI 上限：恰好等于上限允许，超过 1 字节即拒绝。 */
export const MAX_ATTACHMENT_BYTES = 10_000_000

/** 扩展名 → 唯一允许的 MIME（服务端联合校验；前端校验只用于即时提示）。 */
export const ATTACHMENT_MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
} as const

export type AttachmentExtension = keyof typeof ATTACHMENT_MIME_BY_EXTENSION
export type AttachmentMime = (typeof ATTACHMENT_MIME_BY_EXTENSION)[AttachmentExtension]

/**
 * 附件生命周期。
 *   - `ACTIVE`：唯一对用户可见的状态；
 *   - `DELETING`：已请求清理，物理文件待删除（任务删除联动 / 单附件删除中途）；
 *   - `CLEANUP_FAILED`：物理文件删除失败，保留 `cleanupAttempts` / `cleanupLastError` 供重试。
 */
export type AttachmentState = 'ACTIVE' | 'DELETING' | 'CLEANUP_FAILED'

/**
 * 附件记录（域内 / DB 适配器共用的**持久化形状**）。
 *
 * `taskId` 为业务归属任务 id。注意：`Attachment` 表的外键为 `onDelete: SetNull`，任务删除后
 * 数据库中该列会变为 NULL；此类「清理中」行**不**经本端口对外暴露（只经 B 的清理存储访问）。
 * 因此本记录类型保持 `taskId: string`（对外可见的行必然有归属任务）。
 */
export type AttachmentRecord = {
  id: string
  taskId: string
  projectId: string
  originalName: string
  extension: AttachmentExtension
  mimeType: AttachmentMime
  sizeBytes: number
  /** 磁盘存储键（服务端 UUID + 扩展名）；API 视图不返回。 */
  storageKey: string
  uploaderUserId: string
  uploadedAt: string
  state: AttachmentState
  cleanupAttempts: number
  cleanupError: string | null
}

/** 对外 API 视图：**不**返回 `storageKey` / `cleanupAttempts` / `cleanupError`。 */
export type AttachmentView = Omit<
  AttachmentRecord,
  'storageKey' | 'cleanupAttempts' | 'cleanupError'
>

export type AttachmentAccessOperation = 'READ' | 'WRITE'

export type AttachmentAccessDecision =
  | { allow: true; projectId: string }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

/**
 * 权限端口。正式适配器必须**每次请求现查**任务、项目成员、角色与敏感白名单（统一 `can()`）。
 * WRITE 复用 `task.progress`，READ 复用 `project.read`；不可见对象 / outsider 返回 404，
 * 敏感未授权成员返回 404（与不存在逐字一致）。
 */
export interface AttachmentAuthorizationPort {
  decide(
    actorUserId: string,
    taskId: string,
    operation: AttachmentAccessOperation,
  ): Promise<AttachmentAccessDecision>
}

/** 下载 / 删除前定位归属任务所需的最小元数据；**不含**存储键与清理细节。 */
export type AttachmentAccessMetadata = {
  id: string
  taskId: string
  state: AttachmentState
}

/**
 * 共享附件仓储端口（DB 适配器实现）。
 *
 * - **查询层过滤**：`listActiveByTask` 直接使用 `WHERE taskId = ? AND state = 'ACTIVE'`，
 *   返回**全部** ACTIVE 行（D 的列表契约为完整数组，**不做截断、不建分页 API**）。
 * - 全部写方法接受可选调用方事务上下文（`transaction`），传入时**不自行提交**。
 */
export interface AttachmentRepositoryPort {
  insert(record: AttachmentRecord): Promise<AttachmentRecord>
  /** 数据库适配器必须直接使用 `WHERE taskId/state`，不得取全量后内存过滤。 */
  listActiveByTask(taskId: string): Promise<AttachmentRecord[]>
  listAllByTask(taskId: string): Promise<AttachmentRecord[]>
  /** 鉴权前使用的最小元数据读取；**不含**存储键。 */
  findAccessMetadata(id: string): Promise<AttachmentAccessMetadata | null>
  findById(id: string): Promise<AttachmentRecord | null>
  markDeleting(id: string): Promise<AttachmentRecord | null>
  markCleanupFailed(id: string, safeReason: string): Promise<AttachmentRecord | null>
  remove(id: string): Promise<boolean>
}

/** 物理存储端口（路径安全由实现保证：解析后必须仍在存储根内）。 */
export interface AttachmentStoragePort {
  write(storageKey: string, content: Buffer): Promise<void>
  read(storageKey: string): Promise<Buffer>
  delete(storageKey: string): Promise<void>
}

export type UploadAttachmentInput = {
  actorUserId: string
  taskId: string
  originalName: string
  mimeType: string
  content: Buffer
}

export type AttachmentDownload = {
  attachment: AttachmentView
  content: Buffer
}

/** 清理结果汇总（按任务汇总的清理视图；D 已删除旧 `cleanupAfterTaskDeleted` API，B 的全局清理用 `AttachmentCleanupBatchResult`）。 */
export type TaskAttachmentCleanupResult = {
  taskId: string
  removed: number
  failed: Array<{ attachmentId: string; reason: string }>
}

/**
 * B 的全局清理批次结果（不绑定单一 `taskId`）：
 * 任务行删除后 `taskId` 已被 SetNull，候选按 `state` 跨任务扫描，故绝不用 `taskId: ''` 造假。
 */
export type AttachmentCleanupBatchResult = {
  removed: number
  failed: Array<{ attachmentId: string; reason: string }>
}

/**
 * 窄生命周期端口（业务域删除路径接入附件的唯一入口）。
 *
 * - `markForTaskDeletion(transaction, taskId)`：在**调用方事务**内把该任务 `ACTIVE` 附件标为
 *   `DELETING`（不自行提交；调用方回滚时标记一并回滚）—— **绝不允许先删实体**；
 * - `run()`：在任务删除事务**提交后**清理待清理行（删除实体文件 → 删行；失败保留 `CLEANUP_FAILED`）。
 *
 * `TTransaction` 刻意泛型：`src/shared/**` **不得** import 业务模块 / Prisma；业务域传自己的事务上下文。
 * 组装与实现由 `src/app.ts` 用同一个 prisma 仓储 + 本地存储显式注入，业务域只调端口。
 */
export interface TaskAttachmentLifecyclePort<TTransaction = unknown> {
  markForTaskDeletion(transaction: TTransaction, taskId: string): Promise<number>
  run(): Promise<AttachmentCleanupBatchResult>
}
