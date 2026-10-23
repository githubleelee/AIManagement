/**
 * US-09 任务验收（工单 #29）—— 本模块自有类型。
 *
 * ===========================================================================
 * 口径来源（不是我自造的规则）
 * ===========================================================================
 *
 * 契约门 #24 的 ROLE-A 书面结论（comment 6233430993，2026-10-17）：
 *   「执行人 DOING→DONE（提交验收）；**验收人 DONE→CLOSED 或驳回回 DOING**；
 *     负责人可改自己任务的状态/进度、验收人可 CLOSED 或驳回、PM 保留全部权限。」
 *
 * 工单 #29：`DONE != 验收关闭`；验收人是**任务字段**，不新增项目角色。
 *
 * ===========================================================================
 * 为什么不放进 `src/shared/types.ts`
 * ===========================================================================
 *
 * 那是冻结文件（技术负责人单写）。本模块只**新增**、不改共享契约；等接口正式
 * 并入契约时再由技术负责人决定是否上提。与 US-08 的
 * `src/modules/workbench/types.ts` 同一处理方式。
 *
 * 前端 `web/src/pages/acceptance/api.ts` 按仓库既有做法各自声明界面侧类型
 * （frontend-routes.md 冻结约定：web 只从 `src/shared/types.ts` 引类型）。
 * 两份定义是否漂移，由 `web/src/pages/acceptance/shared-types.typecheck.ts`
 * 在**编译期**钉住 —— 这是本票相对 US-08 的改进（那次是两份定义、没有护栏）。
 */
import type { Prisma } from '@prisma/client'
import type { EventActor, EventObjectRef, JsonObject } from '../../shared/events.js'
import type { TaskStatus, TaskView, UserBrief } from '../../shared/types.js'

/**
 * 验收结论。
 *
 * 只有两种：通过 / 驳回。**"重验"不是第三种结论** —— 它是同一个任务上
 * 再次执行验收（AC5），因此表现为同一 `taskId` 下多出一条记录，而不是新枚举值。
 */
export type AcceptanceConclusion = 'PASS' | 'REJECT'

/** 线上常量数组：校验器与本模块共用，避免中文标签当契约值（契约 I-1）。 */
export const ACCEPTANCE_CONCLUSIONS = ['PASS', 'REJECT'] as const

/** 驳回原因的长度上限（与任务标题同一量级；契约未冻结具体数字，取 200）。 */
export const ACCEPTANCE_REASON_MAX_LENGTH = 200

/**
 * 一条验收记录（AC5「全过程可追溯：who / when / 结论 / 原因」的唯一可验证形式）。
 *
 * 对应新表 `AcceptanceRecord`（冻结区申请见 #24）：
 *   id / projectId / taskId / actorUserId / conclusion / reason /
 *   statusBefore / statusAfter / createdAt
 */
export type AcceptanceRecordView = {
  id: string
  projectId: string
  taskId: string
  /** who：执行验收的人（会话身份，不接受请求体传入） */
  actorUserId: string
  /** who 的展示信息，避免界面再发一次用户查询 */
  actor: UserBrief
  /** 结论：通过 / 驳回 */
  conclusion: AcceptanceConclusion
  /** 原因：驳回时**必填**；通过时选填（留痕用） */
  reason: string | null
  /** 记录下"这次验收把任务从哪个状态改到了哪个状态"，便于脱离任务表读审计 */
  statusBefore: TaskStatus
  statusAfter: TaskStatus
  /** when：ISO 8601 UTC */
  createdAt: string
}

/** `POST /tasks/:taskId/acceptance` 的请求体。 */
export type AcceptanceSubmitInput = {
  conclusion: AcceptanceConclusion
  /**
   * 原因。`conclusion = 'REJECT'` 时**服务端强制必填**（空白串一律按缺失处理，
   * 返回 422 `VALIDATION_FAILED` / `details[{field:'reason', code:'REQUIRED'}]`）。
   */
  reason?: string | null
}

/** `POST /tasks/:taskId/acceptance` 的成功响应：改后的任务 + 本次记录。 */
export type AcceptanceSubmitResult = {
  task: TaskView
  record: AcceptanceRecordView
}

/** `GET /projects/:projectId/acceptance-queue` 的响应。 */
export type AcceptanceQueueResult = {
  items: AcceptanceQueueItem[]
}

/**
 * 验收清单的两种视角。
 *
 * - `acceptor`（默认）：**我是验收人**、且执行人已提交（`status = 'DONE'`）⇒ 轮到我验收。
 * - `owner`：**我是负责人**、且**最近一次验收结论是驳回** ⇒ 轮到我整改。
 *
 * 为什么要第二种：走查（2026-10-18）发现执行人在界面上**看不到自己的任务为什么被驳回** ——
 * 验收记录原本只有验收人那侧的清单能展开。AC4 要求"驳回必填原因"，而原因传不到执行人
 * 就等于没传达；AC5 的"全过程可追溯"也应当是双向的。
 */
export type AcceptanceQueueScope = 'acceptor' | 'owner'

/** 线上常量数组（契约 I-1：不使用中文标签作为取值）。 */
export const ACCEPTANCE_QUEUE_SCOPES = ['acceptor', 'owner'] as const

/**
 * 清单的一行 = 任务 + 该任务**最近一次**验收结论。
 *
 * 带上 `latestAcceptance` 是为了让两个视角都能就近看到结论与原因：
 *   - 验收人视角：看到"上一轮为什么被驳回"（重验时的上下文）；
 *   - 负责人视角：看到"这次要改什么"（`reason`）。
 * 采用"内嵌最近一条"而非让前端逐行再发请求，是为了避免 N+1 请求。
 */
export type AcceptanceQueueItem = TaskView & {
  /** 该任务最近一次验收记录；从未验收过为 `null` */
  latestAcceptance: AcceptanceRecordView | null
}

/** `GET /tasks/:taskId/acceptances` 的响应：该任务的验收历史（旧→新）。 */
export type AcceptanceHistoryResult = {
  items: AcceptanceRecordView[]
}

/* ===========================================================================
 * 验收结果事件（#37 公共事件基础设施已合入，本票接线）
 * ===========================================================================
 *
 * ★ 事件名以 `DECISIONS.md` 的 `notifications.event-catalog-exact-names` 为准：
 *   **`acceptance.approved` / `acceptance.rejected`**。
 *
 *   本文件此前登记的占位形状用的是 `task.accepted` / `task.rejected`，与上述已冻结的
 *   精确名单不一致；占位当时明确标注「未接线 / 不发布任何事件」，没有任何运行时依赖，
 *   故按决策改正为正式名字（`src/modules/acceptance/event-port.ts` 负责落地）。
 *
 * ★ 收件人**不进载荷**（技术负责人 GitHub #20 评论 6358121473）：通知的接收者由权威
 *   适配器读 `Task.ownerUserId` / `Task.acceptorUserId` 解析并做可见性筛选；事件载荷里
 *   写收件人等于给伪造与越权留通道。
 *
 * ★ 敏感任务（契约 I-6）：任务 `isSensitive` 为真时，载荷**只能**是 `{references}`。
 */

/**
 * 验收域事件名。
 *
 * ★ 幂等键必须按**更新类**计算（键里带 `occurredAt`）：同一任务可以被
 *   驳回 → 重新提交 → 再通过，`<eventName>:<taskId>` 式的创建类键会让**第二次**同结论
 *   验收被永久去重（与 `risk.level-raised` 是同一个坑）。
 */
export type AcceptanceEventName = 'acceptance.approved' | 'acceptance.rejected'

/**
 * 域内事件草稿：**不含** `id` / `schemaVersion` / `storedAt` / `idempotencyKey`，
 * 后四者由模块内适配器（`./event-port.ts`）补齐。
 */
type AcceptanceEventDraftBase = {
  eventName: AcceptanceEventName
  projectId: string
  object: EventObjectRef
  actor: EventActor
  /** ISO 8601 UTC（带毫秒，`…Z`）。 */
  occurredAt: string
}

export type AcceptanceEventDraft =
  | (AcceptanceEventDraftBase & { sensitive: false; payload: JsonObject })
  | (AcceptanceEventDraftBase & {
      sensitive: true
      payload: { references: EventObjectRef[] }
    })

/**
 * 验收域业务事件的发布端口。
 *
 * 接线方式：由 `./plugin.ts` 从 `RouteContext.acceptanceEvents` 取得
 * （`src/app.ts` 用 `createAcceptanceEventPort` 显式组装），缺失即 fail-fast。
 *
 * 语义：必须在**验收写入的同一个 `$transaction` 内**调用（`transaction` 即该事务的 `tx`）；
 * 适配器把事件追加到该事务，**不自行提交、不派发订阅者**。
 * 发布失败 = 状态流转与验收记录一并回滚（刻意：宁可业务失败，不丢事件）。
 */
export type AcceptanceEventPort = {
  publish(
    event: AcceptanceEventDraft,
    transaction: Prisma.TransactionClient,
  ): Promise<void>
}

/* ===========================================================================
 * 接口先行（**仍未接线**，不要在实现里当成已接入）
 * ===========================================================================
 *
 * 工单 #29 的 `interface_depends_on` 另一项是 #36（验收证据附件），尚未交付，
 * 因此这里**只出类型**：不在请求体里接受附件字段、不落库、不校验。
 */

/** #36 验收证据附件：接口先行占位。当前**不传、不落库、不校验**。 */
export type AcceptanceEvidenceRef = {
  attachmentId: string
}
