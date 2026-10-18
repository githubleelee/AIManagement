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
 * 接口先行（**未接线**，不要在实现里当成已接入）
 * ===========================================================================
 *
 * 工单 #29 的 `interface_depends_on` 是 #36（验收证据附件）与 #37（验收结果事件）。
 * 两者都尚未交付，且决策 I-9 禁止跨业务模块调 service。因此这里**只出类型**：
 * 不写运行时发布、不 import 事件模块、不在请求体里接受附件字段。
 * 等 #37 交付后再由本票接线（另开一轮，不在本票假装已通）。
 */

/** #36 验收证据附件：接口先行占位。当前**不传、不落库、不校验**。 */
export type AcceptanceEvidenceRef = {
  attachmentId: string
}

/** #37 验收结果事件的载荷形状（**未接线**：本模块目前不发布任何事件）。 */
export type AcceptanceEventPayload = {
  /** 事件名：通过 / 驳回 */
  type: 'task.accepted' | 'task.rejected'
  projectId: string
  taskId: string
  /** 执行验收的人 */
  actorUserId: string
  /** 任务的验收人（= actorUserId，冗余存一份便于订阅方不必回查任务） */
  acceptorUserId: string
  conclusion: AcceptanceConclusion
  reason: string | null
  statusBefore: TaskStatus
  statusAfter: TaskStatus
  /** ISO 8601 UTC */
  occurredAt: string
  recordId: string
}
