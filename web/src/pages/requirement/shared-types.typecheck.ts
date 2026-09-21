/**
 * US-03 前端侧的**编译期断言**（M4）
 *
 * ===========================================================================
 * 这个文件为什么存在
 * ===========================================================================
 *
 * ① 契约 I-2 要求前后端**共用同一份**类型定义。本文件从 `src/shared/types.ts`
 *    直接 import，因此它同时充当一条**证据**：只要 `npm run typecheck` 会因为这个
 *    文件报错，就证明 web 侧的 program 确实把 `src/shared/types.ts` 纳入了检查。
 *    用法：把 `src/shared/types.ts` 里任一枚举改一个取值，本文件必然报错。
 *
 * ② 契约决策 I-1 的「接口陷阱」在**前端**同样会发生：`GoalStatus` / `StoryStatus` /
 *    `TaskStatus` 三者都有 `DONE`，语义不同且互相不可赋值。本文件把它钉成编译期失败。
 *
 * ③ 界面文案与线上常量的分离（决策 I-1）也会退化：只要有人把中文标签当成
 *    `<option value>` / 请求体字段用，或给标签表漏掉一个枚举取值，本文件报错。
 *
 * ④ 本模块 HTTP 函数返回的类型必须与契约一致（见第五节）。
 *
 * 文件名不以 `.test.ts` 结尾，也不被任何模块 import，因此不进 Vitest、
 * 也不进 Vite 构建产物，只由 `npm run typecheck` 检查。
 */
import type {
  GoalStatus,
  Priority,
  StoryStatus,
  VisibilityObjectType,
} from '../../../../src/shared/types'
import type { getGoalTree, getStory } from './api'
import {
  FIELD_ERROR_HINT,
  GOAL_STATUS_LABEL,
  GOAL_STATUS_ORDER,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STORY_STATUS_LABEL,
  STORY_STATUS_ORDER,
  fieldErrorHint,
} from './terms'

// ---------------------------------------------------------------------------
// 一、线上常量的正例：契约 I-1 规定的取值必须被接受
// ---------------------------------------------------------------------------

const goalActive: GoalStatus = 'ACTIVE'
const goalDone: GoalStatus = 'DONE'
const storyDraft: StoryStatus = 'DRAFT'
const storyPlanning: StoryStatus = 'PLANNING'
const p0: Priority = 'P0'

// 三者的 `DONE` 来自同一个字面量，因此「字面量本身」可以分别赋给两个独立类型
// （契约 I-1 的已知残余边界：类型别名是结构类型，不是 nominal brand）。
const doneLiteral: 'DONE' = 'DONE'
const goalDoneFromLiteral: GoalStatus = doneLiteral
const storyDoneFromLiteral: StoryStatus = doneLiteral

// ---------------------------------------------------------------------------
// 二、目标状态与需求状态**互不可赋值**（决策 I-1 的接口陷阱）
//
// 每条 `@ts-expect-error` 都是护栏：若这些错误哪天消失了（例如有人把两个类型
// 合并成一个别名），`tsc` 会以 TS2578「未使用的 @ts-expect-error」让 typecheck 失败。
// ---------------------------------------------------------------------------

declare const asGoal: GoalStatus
declare const asStory: StoryStatus
declare const asPriority: Priority

// @ts-expect-error GoalStatus 不可赋给 StoryStatus（'ACTIVE' 不属于 StoryStatus）
const goalToStory: StoryStatus = asGoal
// @ts-expect-error StoryStatus 不可赋给 GoalStatus（'DRAFT' 不属于 GoalStatus）
const storyToGoal: GoalStatus = asStory
// @ts-expect-error 需求状态绝不能是 'ACTIVE' —— 端点 21 传 'ACTIVE' 会被后端判 422
const activeToStory: StoryStatus = goalActive
// @ts-expect-error 目标状态绝不能是 'DRAFT' —— 端点 12/16 只接受 ACTIVE / DONE
const draftToGoal: GoalStatus = storyDraft
// @ts-expect-error Priority 与 GoalStatus 取值集合不同，不可互相传递
const priorityToGoal: GoalStatus = asPriority
// @ts-expect-error VisibilityObjectType 只有 story / task，不接受 'goal'
const wrongVisibility: VisibilityObjectType = 'goal'

// ---------------------------------------------------------------------------
// 三、线上常量数组不可跨枚举混用（决策 I-1：一律用常量、不用中文标签提交）
// ---------------------------------------------------------------------------

// @ts-expect-error GoalStatus 数组不可当 StoryStatus 数组用（两者的 'DONE' 不是一个东西）
const goalOrderAsStory: readonly StoryStatus[] = GOAL_STATUS_ORDER
// @ts-expect-error StoryStatus 数组不可当 GoalStatus 数组用
const storyOrderAsGoal: readonly GoalStatus[] = STORY_STATUS_ORDER
// @ts-expect-error Priority 数组不可当 GoalStatus 数组用
const priorityOrderAsGoal: readonly GoalStatus[] = PRIORITY_ORDER

// ---------------------------------------------------------------------------
// 四、标签表的键必须是**线上常量**，中文标签不得当键使用
//
// `Record<GoalStatus, string>` 这类标注使「契约新增取值而界面漏配」变成编译期失败；
// 下面几条则钉住「键是线上常量、不是显示文案」。
// ---------------------------------------------------------------------------

const goalLabelForActive: string = GOAL_STATUS_LABEL['ACTIVE']
const goalLabelForActiveByVar: string = GOAL_STATUS_LABEL[goalActive]
const storyLabelForDraft: string = STORY_STATUS_LABEL['DRAFT']
const priorityLabelForP0: string = PRIORITY_LABEL['P0']

// @ts-expect-error 中文标签不是线上常量，不能作为索引键（文案不得当契约值）
const goalLabelByChinese: string = GOAL_STATUS_LABEL['进行中']
// @ts-expect-error StoryStatus 里没有 'ACTIVE' —— 需求状态表的键不含 ACTIVE（三 DONE 陷阱）
const storyLabelForActive: string = STORY_STATUS_LABEL['ACTIVE']
// @ts-expect-error GoalStatus 里没有 'DRAFT' —— 目标状态表的键不含 DRAFT
const goalLabelForDraft: string = GOAL_STATUS_LABEL['DRAFT']
// @ts-expect-error Priority 里没有 'HIGH' —— 优先级只有 P0 / P1 / P2
const priorityLabelForHigh: string = PRIORITY_LABEL['HIGH']

// ---------------------------------------------------------------------------
// 五、本模块 HTTP 函数返回的类型必须与契约一致
//
// 端点 10 的树是三层嵌套，最容易在某次重构中被写成错误的枚举类型；
// 端点 20 的 `status` 必须是 `StoryStatus` 而**不是** `GoalStatus`。
// ---------------------------------------------------------------------------

declare const tree: Awaited<ReturnType<typeof getGoalTree>>
declare const singleStory: Awaited<ReturnType<typeof getStory>>

const goalNodeStatus: GoalStatus = tree[0].status
const activityNodeStatus: GoalStatus = tree[0].activities[0].status
const nestedStoryStatus: StoryStatus = tree[0].activities[0].stories[0].status
const nestedStoryPriority: Priority = tree[0].activities[0].stories[0].priority
const singleStoryStatus: StoryStatus = singleStory.status
const singleStoryPriority: Priority = singleStory.priority

// @ts-expect-error 需求状态不可当目标状态用（StoryStatus 不能赋给 GoalStatus）
const storyStatusAsGoal: GoalStatus = singleStory.status

// ---------------------------------------------------------------------------
// 六、错误码提示表的可用性（决策 I-4）
// ---------------------------------------------------------------------------

const hasChildrenHint: string = fieldErrorHint('HAS_CHILDREN')
const unknownHint: string = fieldErrorHint('NOT_A_CONTRACT_CODE')
const fieldHints: typeof FIELD_ERROR_HINT = FIELD_ERROR_HINT

// ---------------------------------------------------------------------------
// 显式引用全部声明，避免 `noUnusedLocals`（web/tsconfig.json 已开启）报错。
// 这些导出不会被任何模块 import，因此不进 Vite 产物。
// ---------------------------------------------------------------------------

export const __web_typecheck_used = {
  goalActive,
  goalDone,
  storyDraft,
  storyPlanning,
  p0,
  goalDoneFromLiteral,
  storyDoneFromLiteral,
  goalToStory,
  storyToGoal,
  activeToStory,
  draftToGoal,
  priorityToGoal,
  wrongVisibility,
  goalOrderAsStory,
  storyOrderAsGoal,
  priorityOrderAsGoal,
  goalLabelForActive,
  goalLabelForActiveByVar,
  storyLabelForDraft,
  priorityLabelForP0,
  goalLabelByChinese,
  storyLabelForActive,
  goalLabelForDraft,
  priorityLabelForHigh,
  goalNodeStatus,
  activityNodeStatus,
  nestedStoryStatus,
  nestedStoryPriority,
  singleStoryStatus,
  singleStoryPriority,
  storyStatusAsGoal,
  hasChildrenHint,
  unknownHint,
  fieldHints,
}

