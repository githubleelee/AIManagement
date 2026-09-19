/**
 * 状态枚举的类型独立性 —— 编译期断言（T0-01，探针 6）
 *
 * 权威来源：决策 I-1 的「接口陷阱」。
 *   GoalStatus / StoryStatus / TaskStatus 三者都存在取值 `DONE`，但语义不同，
 *   必须是三个**独立**类型别名，禁止互相赋值。
 *
 * 本文件不含运行期断言，因此 **不被 Vitest 收集**（文件名不以 .test.ts 结尾），
 * 只由 `npm run typecheck`（tsc -p tsconfig.json）检查。
 * `@ts-expect-error` 在类型错误消失时会被 tsc 报 TS2578，从而把「契约退化」
 * 变成一次 typecheck 失败。
 */
import type {
  GoalStatus,
  Priority,
  ProjectRole,
  StoryStatus,
  TaskStatus,
  VisibilityObjectType,
} from '../src/shared/types.js'

// ---- 正例：各类型接受契约规定的线上常量 --------------------------------
const pm: ProjectRole = 'PM'
const active: GoalStatus = 'ACTIVE'
const draft: StoryStatus = 'DRAFT'
const p0: Priority = 'P0'
const todo: TaskStatus = 'TODO'
const storyObject: VisibilityObjectType = 'story'

// 三者都含 'DONE'，同一字面量分别赋给三个独立类型是允许的（来自字面量本身）。
const done: 'DONE' = 'DONE'
const goalDone: GoalStatus = done
const storyDone: StoryStatus = done
const taskDone: TaskStatus = done

// 同类型内部赋值允许。
declare const someGoal: GoalStatus
const sameGoal: GoalStatus = someGoal

// ---- 反例：三个状态类型互不可赋值（编译期保证） -------------------------
declare const asGoal: GoalStatus
declare const asStory: StoryStatus
declare const asTask: TaskStatus
declare const asPriority: Priority

// @ts-expect-error GoalStatus 不可赋给 StoryStatus（'ACTIVE' 不属于 StoryStatus）
const goalToStory: StoryStatus = asGoal
// @ts-expect-error GoalStatus 不可赋给 TaskStatus（'ACTIVE' 不属于 TaskStatus）
const goalToTask: TaskStatus = asGoal
// @ts-expect-error StoryStatus 不可赋给 GoalStatus（'DRAFT' 不属于 GoalStatus）
const storyToGoal: GoalStatus = asStory
// @ts-expect-error StoryStatus 不可赋给 TaskStatus（'DRAFT' 不属于 TaskStatus）
const storyToTask: TaskStatus = asStory
// @ts-expect-error TaskStatus 不可赋给 GoalStatus（'TODO' 不属于 GoalStatus）
const taskToGoal: GoalStatus = asTask
// @ts-expect-error TaskStatus 不可赋给 StoryStatus（'DOING' 不属于 StoryStatus）
const taskToStory: StoryStatus = asTask
// @ts-expect-error Priority 与 TaskStatus 的取值集合不同，不可互相赋值
const priorityToTask: TaskStatus = asPriority
// @ts-expect-error VisibilityObjectType 只有 story / task，不接受 'goal'
const wrongVisibility: VisibilityObjectType = 'goal'

// ---- 已知残余边界（记录，非缺陷） ---------------------------------------
// 当变量被**收窄到公共字面量 'DONE'** 时，它可赋给任意含 'DONE' 的状态类型。
// 契约 I-1/I-2 要求的是三个独立类型别名（结构类型），并非 nominal brand；
// 若需彻底禁止，应在 I-2 引入 brand，但那是契约变更，超出 T0-01 范围。
declare const narrowedGoalDone: 'DONE'
const narrowedToStory: StoryStatus = narrowedGoalDone
const narrowedToTask: TaskStatus = narrowedGoalDone

// 显式引用，避免「声明未使用」在任何 lint 规则下产生噪声（tsconfig 未开 noUnusedLocals）。
export const __typecheck_used = {
  pm,
  active,
  draft,
  p0,
  todo,
  storyObject,
  goalDone,
  storyDone,
  taskDone,
  sameGoal,
  goalToStory,
  goalToTask,
  storyToGoal,
  storyToTask,
  taskToGoal,
  taskToStory,
  priorityToTask,
  wrongVisibility,
  narrowedToStory,
  narrowedToTask,
}
