/**
 * US-09 前端侧的**编译期断言**（工单 #29）
 *
 * ===========================================================================
 * 这个文件解决什么问题
 * ===========================================================================
 *
 * `docs/frontend-routes.md` 冻结了前端骨架，web 侧只从 `src/shared/types.ts` 引类型；
 * 而本票的验收类型按 US-08 的既有做法放在服务端模块内
 * （`src/modules/acceptance/types.ts`），界面侧在 `api.ts` 里各自声明一份。
 *
 * **两份定义 = 漂移风险**（本仓库已把"同一件事两份实现"列为问题）。US-08 当时是
 * 两份定义、**没有护栏**。本票补上这道护栏：
 *
 *   只要服务端改了字段名、加了字段、改了可空性，或界面侧漏配/多配，这里立刻编译失败。
 *   用法：把 `AcceptanceRecordView` 任一字段改名，`npm run typecheck` 必然报到本文件。
 *
 * 文件名不以 `.test.ts` 结尾、也不被任何模块 import ⇒ 不进 Vitest、不进 Vite 产物，
 * 只由 `npm run typecheck` 检查（与 `pages/requirement/shared-types.typecheck.ts` 同构）。
 *
 * **全部用 `import type`**：构建时被完全擦除，前端产物里不含后端模块的任何代码。
 */
import type { TaskStatus, TaskView } from '../../../../src/shared/types'
import type {
  AcceptanceConclusion as ServerConclusion,
  AcceptanceRecordView as ServerRecordView,
  AcceptanceSubmitInput as ServerSubmitInput,
  AcceptanceSubmitResult as ServerSubmitResult,
  AcceptanceHistoryResult as ServerHistoryResult,
  AcceptanceQueueResult as ServerQueueResult,
} from '../../../../src/modules/acceptance/types'
import type {
  AcceptanceConclusion,
  AcceptanceRecordView,
  AcceptanceSubmitInput,
  AcceptanceSubmitResult,
} from './api'
import { ACCEPTANCE_CONCLUSION_LABEL, listAcceptanceHistory, listAcceptanceQueue } from './api'

/**
 * 双向可赋值 = 形状完全一致。单向可赋值会漏掉"界面侧多了一个必填字段"这类漂移，
 * 所以两个方向都要判。
 */
type SameShape<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// ---------------------------------------------------------------------------
// 一、结论枚举：只有两种取值，且与服务端一致
// ---------------------------------------------------------------------------

const conclusionIsIdentical: SameShape<AcceptanceConclusion, ServerConclusion> = true

// @ts-expect-error 结论只有 PASS / REJECT —— 没有第三种（"重验"不是结论，是同任务再来一次）
const noThirdConclusion: AcceptanceConclusion = 'REWORK'
// @ts-expect-error 结论不得写成中文标签（线上常量与展示标签分离，契约 I-1）
const conclusionIsNotLabel: AcceptanceConclusion = '通过'

/** 标签表必须恰好覆盖线上常量的取值集合（服务端新增取值而界面漏配 → 这里报错）。 */
const labelCoversEveryServerConclusion: Record<ServerConclusion, string> = ACCEPTANCE_CONCLUSION_LABEL

// ---------------------------------------------------------------------------
// 二、三个响应/请求形状与服务端逐字段一致
// ---------------------------------------------------------------------------

const recordViewIsIdentical: SameShape<AcceptanceRecordView, ServerRecordView> = true
const submitInputIsIdentical: SameShape<AcceptanceSubmitInput, ServerSubmitInput> = true
const submitResultIsIdentical: SameShape<AcceptanceSubmitResult, ServerSubmitResult> = true

// ---------------------------------------------------------------------------
// 三、状态字段必须是共享契约的 `TaskStatus`
//
// `GoalStatus` / `StoryStatus` / `TaskStatus` 三者都有 `DONE` 但语义不同（决策 I-1）。
// 验收记录的 statusBefore / statusAfter 只可能是任务状态，这里把它钉死。
// ---------------------------------------------------------------------------

declare const record: AcceptanceRecordView
const beforeIsTaskStatus: TaskStatus = record.statusBefore
const afterIsTaskStatus: TaskStatus = record.statusAfter
const actorIsBrief: { id: string; account: string; displayName: string } = record.actor

// ---------------------------------------------------------------------------
// 四、HTTP 函数的返回类型必须与服务端的响应形状一致
//
// 界面只用这两个读接口的 `items`，所以按元素类型对齐即可。
// ---------------------------------------------------------------------------

declare const history: Awaited<ReturnType<typeof listAcceptanceHistory>>
declare const queue: Awaited<ReturnType<typeof listAcceptanceQueue>>

const historyItems: ServerHistoryResult['items'] = history
const queueItems: ServerQueueResult['items'] = queue
const queueIsTasks: TaskView[] = queue

// ---------------------------------------------------------------------------
// 显式引用全部声明，避免 `noUnusedLocals`（web/tsconfig.json 已开启）报错。
// 这些导出不会被任何模块 import，因此不进 Vite 产物。
// ---------------------------------------------------------------------------

export const __web_typecheck_used = {
  conclusionIsIdentical,
  noThirdConclusion,
  conclusionIsNotLabel,
  labelCoversEveryServerConclusion,
  recordViewIsIdentical,
  submitInputIsIdentical,
  submitResultIsIdentical,
  beforeIsTaskStatus,
  afterIsTaskStatus,
  actorIsBrief,
  historyItems,
  queueItems,
  queueIsTasks,
}
