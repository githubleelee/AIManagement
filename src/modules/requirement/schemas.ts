/**
 * 需求层级模块 —— 请求校验（M4 / US-03）
 *
 * 契约依据
 *   - 决策 I-2b「职责边界」：**单字段形状**（必填 / 长度 / 格式 / 枚举取值）由本文件的
 *     Zod schema 负责，产出 REQUIRED / TOO_LONG / INVALID_FORMAT / INVALID_VALUE。
 *   - 决策 I-4「字段级错误码」：字段级错误码只出现在 `ErrorResponse.error.details[].code`。
 *   - 决策 I-8 端点 11：`{ name: string, description?: string }`，错误为
 *     `422 VALIDATION_FAILED（name: REQUIRED | TOO_LONG）`。
 *
 * 归属说明（决策 I-0）
 *   本文件是 `src/modules/requirement/` 内的新增文件，属 M4 独占，不触碰任何冻结文件。
 *
 * ⚠️ 长度上限的出处
 *   契约与基线只规定了**错误码** `TOO_LONG`，**没有规定任何字段的长度上限数值**
 *   （决策 I-2b 表里仅以「name（50）」举例）。因此这里的 50 是**按契约举例取值实现**，
 *   不是从文档推导出的硬性要求。若技术负责人确认其它数值，只需改本文件的常量。
 *   该歧义已在表五记录，留 Sprint 2 澄清。
 */
import * as z from 'zod'
import {
  goalStatusSchema,
  prioritySchema,
  storyStatusSchema,
  toFieldErrors,
} from '../../shared/validation.js'
import { AppError } from '../../shared/errors.js'
import type { FieldError } from '../../shared/types.js'

// ---------------------------------------------------------------------------
// 长度上限（见文件头「长度上限的出处」）
// ---------------------------------------------------------------------------

/** 业务目标名称上限。契约未规定数值，按决策 I-2b 的举例「name（50）」取 50。 */
export const GOAL_NAME_MAX_LENGTH = 50

/**
 * 用户活动名称上限（端点 15，T3.4）。
 *
 * 与 `GOAL_NAME_MAX_LENGTH` **同源**：契约对端点 15 同样只规定了错误码
 * `TOO_LONG`、**不给数值**（决策 I-8 端点 15；决策 I-4 的字段级错误码表
 * 仅以「name（50）」举例）。取 50 使「目标名」与「活动名」两个 `name` 字段口径一致。
 *
 * 刻意不合并成一个共用常量：两者是契约里两个独立端点的字段，将来若只调整其中
 * 一个，独立常量不会牵连另一端点。该空白同样记入表五，留 Sprint 2 澄清。
 */
export const ACTIVITY_NAME_MAX_LENGTH = 50

// ---------------------------------------------------------------------------
// 端点 11 —— POST /projects/:projectId/goals
// ---------------------------------------------------------------------------

/**
 * 创建业务目标请求体。
 *
 * 关于 `.min(1)` 与处理器里 `trim() === ''` 检查的分工：
 *   - Zod 的 `.min(1)` 拦住**空字符串**，产出 `too_small` → 契约要求的 `REQUIRED`。
 *   - 纯空白（如 `"   "`）长度不为 0，会通过 Zod，必须由处理器 `trim()` 后判空。
 *     决策 I-4 对 `REQUIRED` 的定义明确包含「必填缺失或**纯空白**」，两者缺一不可。
 *
 * `z.object` 默认**剥除**未声明字段（非 strict）：请求体里多余的未知字段被忽略，
 * 不会触发校验失败，符合「部分更新以合并结果为准」之外的宽松输入约定。
 */
export const createBusinessGoalSchema = z.object({
  name: z.string().min(1).max(GOAL_NAME_MAX_LENGTH),
  description: z.string().optional(),
})

export type CreateBusinessGoalInput = z.infer<typeof createBusinessGoalSchema>

// ---------------------------------------------------------------------------
// 端点 15 —— POST /goals/:goalId/activities
// ---------------------------------------------------------------------------

/**
 * 创建用户活动请求体。
 *
 * 与端点 11 的请求体同形（`{ name, description? }`），但**刻意不复用同一个 schema 对象**：
 * 两者是契约里两个独立端点的字段，长度上限将来可能分开调整，共用一个对象会让
 * 「为了端点 11 的调整顺手改掉端点 15 的校验」变成可能。
 *
 * `z.object` 默认**剥除**未声明字段（非 strict），因此请求体里塞入的
 * `projectId` / `goalId` / `status` / `sortOrder` 会被静默丢弃。这正是端点 15
 * 「不接受请求体传入 `projectId`」的结构性保证（决策 I-10「`projectId` 的推导」）：
 * 请求体**没有**能表达归属的字段，而不是靠校验去拦。
 */
export const createUserActivitySchema = z.object({
  name: z.string().min(1).max(ACTIVITY_NAME_MAX_LENGTH),
  description: z.string().optional(),
})

export type CreateUserActivityInput = z.infer<typeof createUserActivitySchema>

// ---------------------------------------------------------------------------
// 端点 12 —— PATCH /goals/:goalId
// ---------------------------------------------------------------------------

/**
 * 更新业务目标请求体（**部分更新**，决策 I-10）。
 *
 * 三个字段**全部可选**：未出现的字段保持原值。因此这里**不能**复用
 * `createBusinessGoalSchema` —— 那个 schema 的 `name` 是必填的，用它会让
 * 「只改 status」的合法请求被判 422。
 *
 * `status` 用共享层的 `goalStatusSchema`（决策 I-1/I-2b 的唯一取值来源），
 * 非法取值产出 `invalid_enum_value` → 契约要求的字段级错误码 `INVALID_VALUE`。
 * 这里刻意**不**用 `z.string()` 自己写枚举：取值约束必须只有一处定义，
 * 否则将来 `GoalStatus` 增删取值时会出现两处不一致。
 *
 * `description` 的类型是 `z.string()`（可选），**不含 `null`** —— 契约 I-8 端点 12
 * 的请求形状是 `description?: string`。因此传 `null` 会得到 422 而非把描述清空。
 * 「如何清空 description」在契约里**没有入口**，属契约空白，已记入表五；
 * 本实现按契约字面执行，不自行发明 `null` 语义。
 */
export const updateBusinessGoalSchema = z.object({
  name: z.string().min(1).max(GOAL_NAME_MAX_LENGTH).optional(),
  description: z.string().optional(),
  status: goalStatusSchema.optional(),
})

export type UpdateBusinessGoalInput = z.infer<typeof updateBusinessGoalSchema>

// ---------------------------------------------------------------------------
// 端点 16 —— PATCH /activities/:activityId
// ---------------------------------------------------------------------------

/**
 * 更新用户活动请求体（**部分更新**，决策 I-10）。
 *
 * 契约 I-8 端点 16 的「错误 同端点 12」意味着字段级错误码也同端点 12：
 * `name: REQUIRED | TOO_LONG`、`status: INVALID_VALUE`。
 *
 * `status` 同样引共享层的 `goalStatusSchema` —— 用户活动的状态在契约里就是
 * `GoalStatus`（决策 I-2 的 `UserActivity.status: GoalStatus`，不是独立枚举），
 * 所以这里必须复用同一个 schema，而不是另写一份 `z.enum(['ACTIVE','DONE'])`。
 *
 * `goalId` 与 `projectId` 刻意不在形状内：前者是父级归属，后者从父级推导（决策 I-10），
 * 都不接受请求体传入。`sortOrder` 也不在其中 —— 活动排序只能走端点 18 的全量替换。
 */
export const updateUserActivitySchema = z.object({
  name: z.string().min(1).max(ACTIVITY_NAME_MAX_LENGTH).optional(),
  description: z.string().optional(),
  status: goalStatusSchema.optional(),
})

export type UpdateUserActivityInput = z.infer<typeof updateUserActivitySchema>

// ---------------------------------------------------------------------------
// 端点 18 —— PUT /goals/:goalId/activities/order
// ---------------------------------------------------------------------------

/**
 * 用户活动排序请求体（全量替换，契约 I-8 端点 18「同端点 14」）。
 *
 * 这里只校验**形状**（必须是字符串数组）。「集合是否与该目标下现有活动集合一致」
 * 是**业务规则**（需查库），按决策 I-2b 的职责边界不塞进 Zod —— 塞进去会让
 * schema 依赖数据库，破坏测试的独立性。该规则由 service 在事务内判定，
 * 由 handler 转成契约要求的 `422 VALIDATION_FAILED（orderedIds: INVALID_VALUE）`。
 */
export const reorderActivitiesSchema = z.object({
  orderedIds: z.array(z.string()),
})

export type ReorderActivitiesInput = z.infer<typeof reorderActivitiesSchema>

// ---------------------------------------------------------------------------
// 端点 14 —— PUT /projects/:projectId/goals/order
// ---------------------------------------------------------------------------

/**
 * 业务目标排序请求体（全量替换，契约 I-8 端点 14）。
 *
 * 形状与端点 18 的 `reorderActivitiesSchema` 相同，但**刻意独立命名**：
 * 两者是契约里两个独立端点（作用域分别是「项目内所有目标」与「目标下所有活动」），
 * 将来若其中一个增加了额外字段（例如排序前的乐观校验），独立命名不会牵连另一个。
 * 理由与端点 11/16 各自持有独立 schema 一致。
 *
 * 与端点 18 一样，这里只校验**形状**；「集合是否与本项目现有目标集合一致」
 * 是需查库的业务规则，按决策 I-2b 由 service 在事务内判定。
 */
export const reorderGoalsSchema = z.object({
  orderedIds: z.array(z.string()),
})

export type ReorderGoalsInput = z.infer<typeof reorderGoalsSchema>

// ---------------------------------------------------------------------------
// 端点 19 —— POST /activities/:activityId/stories
// ---------------------------------------------------------------------------

/**
 * 用户故事五个文本字段的长度上限。
 *
 * 【契约空白】契约 I-8 端点 19 对 `title` / `roleText` / `capabilityText` / `valueText` /
 * `businessValue` 五个字段**都**要求产出 `REQUIRED | TOO_LONG`，但**同样没有给任何数值**。
 * 唯一的数值线索仍是决策 I-4 的字段级错误码表里「name（50）」这个**举例**。
 *
 * 本实现取 50、并让五个字段**共用一个**上限，而不是给每个字段各编一个数：
 * 各编一个数会让「上限」变成五处无从追溯的猜测，而共用一个数至少口径单一、
 * 将来只需改这一个常量。若契约澄清为别的数值（或分字段不同），改这里即可。
 *
 * `acceptanceCriteria` **不在**上限之列：契约对它的写法只有 `acceptanceCriteria?: string`，
 * 未列 `TOO_LONG`；这与 `description` 在端点 11/12/15/16 的待遇一致（可选且无上限）。
 */
export const STORY_TEXT_MAX_LENGTH = 50

/** 端点 19 的单个必填文本字段：非空 + 有上限（Zod 层先拦空串与超长）。 */
const storyTextField = z.string().min(1).max(STORY_TEXT_MAX_LENGTH)

/**
 * 创建用户故事请求体。
 *
 * 三段式按契约**分字段存储**（「作为〈角色〉，我要〈能力〉，以便〈价值〉」对应
 * `roleText` / `capabilityText` / `valueText`），不是拼成一个字符串 —— 契约 I-2 的
 * `UserStory` 类型就是三个独立字段，页面要能独立检索与展示。
 *
 * `priority` 引共享层的 `prioritySchema`（决策 I-1/I-2b 的唯一取值来源），
 * 非法取值产出 `invalid_enum_value` → 契约要求的 `INVALID_VALUE`。
 *
 * `status` / `isSensitive` / `projectId` / `activityId` **刻意不在形状内**：
 * 前两者由表默认值决定（端点 19 的副作用是「status 默认 'DRAFT'；isSensitive 默认 false」），
 * 后两者由 URL 父级推导（决策 I-10）。`z.object` 默认剥除未声明字段，
 * 因此请求体里塞入这些字段会被静默丢弃 —— 这是结构性保证，不是靠校验去拦。
 *
 * 纯空白（如 `'   '`）长度不为 0，会通过 Zod 的 `.min(1)`，必须由处理器 trim 后判空
 * （决策 I-4：REQUIRED 含**纯空白**）。五个字段都要判，且一次报全部。
 */
export const createUserStorySchema = z.object({
  title: storyTextField,
  roleText: storyTextField,
  capabilityText: storyTextField,
  valueText: storyTextField,
  businessValue: storyTextField,
  priority: prioritySchema,
  acceptanceCriteria: z.string().optional(),
})

export type CreateUserStoryInput = z.infer<typeof createUserStorySchema>

// ---------------------------------------------------------------------------
// 端点 21 —— PATCH /stories/:storyId
// ---------------------------------------------------------------------------

/**
 * 更新用户故事请求体（**部分更新**，决策 I-10）。
 *
 * ⚠️ **`status` 必须用 `storyStatusSchema`（DRAFT / PLANNING / DONE），不能用
 * `goalStatusSchema`（ACTIVE / DONE）。** 决策 I-1 专门警告过这个陷阱：
 * `GoalStatus`、`StoryStatus`、`TaskStatus` 三者都存在取值 `DONE`，语义不同且互相
 * 不可赋值，禁止共用同一个类型别名、也禁止把三者的状态值互相传递。
 * 端点 12/16 用的是 `goalStatusSchema`，本端点**不一样** —— 这是端点 21 最容易
 * 顺手抄错的一处。
 *
 * ⚠️ **不含 `isSensitive`**：契约 I-8 端点 21 明写「不含 isSensitive —— 该字段只能通过
 * 端点 23 修改」。因此本 schema 里没有它，`UserStoryPatch` 里也没有 —— 敏感标记的
 * 写入路径只有 `PUT /stories/:storyId/sensitivity` 一条。
 *
 * 八个字段全部可选；未出现的字段保持原值（部分更新）。
 */
export const updateUserStorySchema = z.object({
  title: z.string().min(1).max(STORY_TEXT_MAX_LENGTH).optional(),
  roleText: z.string().min(1).max(STORY_TEXT_MAX_LENGTH).optional(),
  capabilityText: z.string().min(1).max(STORY_TEXT_MAX_LENGTH).optional(),
  valueText: z.string().min(1).max(STORY_TEXT_MAX_LENGTH).optional(),
  businessValue: z.string().min(1).max(STORY_TEXT_MAX_LENGTH).optional(),
  priority: prioritySchema.optional(),
  status: storyStatusSchema.optional(),
  acceptanceCriteria: z.string().optional(),
})

export type UpdateUserStoryInput = z.infer<typeof updateUserStorySchema>

// ---------------------------------------------------------------------------
// 校验助手
// ---------------------------------------------------------------------------

/**
 * 把 Zod 校验失败转成契约决策 I-4 的 `422 VALIDATION_FAILED`。
 *
 * 契约决策 I-2b「唯一错误出口」：端点不得自行拼装 `ErrorResponse`，
 * 一律通过抛 `AppError`（由统一错误处理器转成信封）或由 Zod 失败自动转换。
 * 本函数正是后者的落地：Zod issue → `details[]`，再抛 `AppError`。
 */
export function validationFailed(issues: z.ZodIssue[], message = '字段校验失败'): never {
  throw new AppError(422, 'VALIDATION_FAILED', message, toFieldErrors(issues))
}

/**
 * 解析请求体；失败即抛 `422 VALIDATION_FAILED` 并带上字段级错误码。
 *
 * 之所以用 `.safeParse()` 而不是 Zod 的 `parse()`：`parse()` 抛的是 `ZodError`，
 * 会被统一错误处理器当作「未抛 AppError 的未知异常」转成 500，
 * 违反契约要求的 422 语义。
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    validationFailed(result.error.issues)
  }
  return result.data
}

/** 构造单条字段级错误，供处理器主动抛出业务规则错误时使用（决策 I-2b）。 */
export function fieldError(field: string, code: FieldError['code']): FieldError {
  return { field, code }
}

/**
 * 用**已给定的**字段级错误抛出 422 VALIDATION_FAILED。
 *
 * 用途：当「字段形状」无法由 Zod schema 表达、但错误码仍属于 Zod 那一类时使用。
 * 典型场景是**纯空白**：`.min(1)` 只拦长度为 0 的字符串，`'   '` 长度不为 0 会通过；
 * 而它的正确错误码与「缺失」同为 `REQUIRED`（决策 I-4：必填缺失**或纯空白**）。
 * 若改用 Zod 的 `.refine()`，issue.code 会变成 `custom`，被 `toFieldErrors`
 * 兜底映射成 `INVALID_VALUE` —— 与契约要求的 `REQUIRED` 不符，故不走 refine。
 */
export function validationFailedWith(details: FieldError[], message = '字段校验失败'): never {
  throw new AppError(422, 'VALIDATION_FAILED', message, details)
}
