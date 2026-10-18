/**
 * US-09 任务验收（工单 #29）—— 本页的 HTTP 调用。
 *
 * 与 `pages/workbench/api.ts` / `pages/task/api.ts` 同构：本模块**只新增**自己的 api
 * 文件，复用骨架的 `apiFetch`（`web/src/api.ts`，归 M2 维护），不重复实现
 * Authorization 与信封解析。
 *
 * 端点（本票新增，服务端说明见 `docs/us-09-acceptance-api.md`）：
 *   POST /tasks/:taskId/acceptance          执行验收（通过 / 驳回）
 *   GET  /tasks/:taskId/acceptances         某任务的验收历史（旧 → 新）
 *   GET  /projects/:projectId/acceptance-queue   待我验收的任务
 *
 * 类型口径与服务端 `src/modules/acceptance/types.ts` 一一对应；两份定义是否漂移由
 * 同目录的 `shared-types.typecheck.ts` 在**编译期**钉住（本票新增的护栏）。
 */
import type { TaskStatus, TaskView, UserBrief } from '../../../../src/shared/types'
import { apiFetch } from '../../api'

/** 验收结论。只有"通过 / 驳回"两种；**"重验"不是第三种结论**，是同任务上再来一次。 */
export type AcceptanceConclusion = 'PASS' | 'REJECT'

/** 结论的界面文案（线上常量与展示标签分离，契约决策 I-1）。 */
export const ACCEPTANCE_CONCLUSION_LABEL: Record<AcceptanceConclusion, string> = {
  PASS: '通过',
  REJECT: '驳回',
}

/** 一条验收记录：who / when / 结论 / 原因（工单 AC5）。 */
export type AcceptanceRecordView = {
  id: string
  projectId: string
  taskId: string
  actorUserId: string
  actor: UserBrief
  conclusion: AcceptanceConclusion
  reason: string | null
  statusBefore: TaskStatus
  statusAfter: TaskStatus
  /** ISO 8601 UTC */
  createdAt: string
}

export type AcceptanceSubmitInput = {
  conclusion: AcceptanceConclusion
  /** 驳回时**必填**（服务端强制，界面只是先拦一次） */
  reason?: string | null
}

export type AcceptanceSubmitResult = {
  task: TaskView
  record: AcceptanceRecordView
}

/** 执行验收。返回改后的任务与本次记录。 */
export function submitAcceptance(
  taskId: string,
  input: AcceptanceSubmitInput,
): Promise<AcceptanceSubmitResult> {
  return apiFetch<AcceptanceSubmitResult>(`/tasks/${encodeURIComponent(taskId)}/acceptance`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** 某任务的验收历史（旧 → 新）。空历史返回空数组，不是 404。 */
export function listAcceptanceHistory(taskId: string): Promise<AcceptanceRecordView[]> {
  return apiFetch<{ items: AcceptanceRecordView[] }>(
    `/tasks/${encodeURIComponent(taskId)}/acceptances`,
  ).then((payload) => payload.items)
}

/** 验收清单的两种视角：我是验收人（待我验收）/ 我是负责人（被驳回待我整改）。 */
export type AcceptanceQueueScope = 'acceptor' | 'owner'

/**
 * 清单的一行 = 任务 + 该任务**最近一次**验收结论。
 *
 * 为什么带上 `latestAcceptance`：执行人必须能看到"为什么被驳回"（`reason`）。
 * 走查（2026-10-18）发现驳回理由原本只在验收人那侧可见 —— AC4 要求驳回必填原因，
 * 而原因传不到执行人就等于没传达。
 */
export type AcceptanceQueueItem = TaskView & {
  latestAcceptance: AcceptanceRecordView | null
}

/**
 * 验收清单。筛选在**服务端**完成（两种视角各自一个 where 条件），前端不做内存过滤。
 * 始终显式传 `scope`（而不是省略走默认），便于在浏览器网络面板里直接看出请求的是哪个视角。
 */
export function listAcceptanceQueue(
  projectId: string,
  scope: AcceptanceQueueScope = 'acceptor',
): Promise<AcceptanceQueueItem[]> {
  return apiFetch<{ items: AcceptanceQueueItem[] }>(
    `/projects/${encodeURIComponent(projectId)}/acceptance-queue?scope=${encodeURIComponent(scope)}`,
  ).then((payload) => payload.items)
}

/** 该任务所属需求的需求详情页（任务区在那里，可看全貌）。 */
export function taskRequirementHref(row: TaskView): string {
  return `/projects/${encodeURIComponent(row.projectId)}/requirements/${encodeURIComponent(row.storyId)}`
}

/** ISO 8601 UTC → 本地可读时间（`YYYY-MM-DD HH:mm`），用于验收历史。 */
export function formatOccurredAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
