/**
 * 共享契约 —— 类型与枚举（冻结）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md`
 *   - 决策 I-1 线上格式与展示标签分离
 *   - 决策 I-2 共享类型定义
 *   - 决策 I-3 统一响应信封
 *   - 决策 I-4 错误码表
 *
 * 文件所有权（决策 I-0 / I-9）：`src/shared/` 为冻结区，唯一修改人是技术负责人。
 * 前后端引用同一份定义，不得各自声明。
 *
 * 阅读约定：`?` 表示可选字段；所有 id 为 string；所有时间戳为 ISO 8601 UTC 字符串；
 * 所有 `planStart` / `planEnd` 为 `'YYYY-MM-DD'` 字符串。
 */

// ---------------------------------------------------------------------------
// 枚举（决策 I-1）
//
// 接口陷阱（必须显式处理）：GoalStatus / StoryStatus / TaskStatus 三者都存在
// 取值 `DONE`，但语义不同。它们必须是三个**独立**的类型别名，禁止复用同一个
// 类型别名，也禁止把三者的状态值互相传递。
// ---------------------------------------------------------------------------

/** 项目角色。线上常量：PM / MEMBER / VIEWER；界面标签：项目经理 / 项目成员 / 管理者 */
export type ProjectRole = 'PM' | 'MEMBER' | 'VIEWER'

/** 业务目标与用户活动的状态。界面标签：进行中 / 已完成 */
export type GoalStatus = 'ACTIVE' | 'DONE'

/** 用户故事的状态。界面标签：待规划 / 规划中 / 已完成 */
export type StoryStatus = 'DRAFT' | 'PLANNING' | 'DONE'

/** 用户故事优先级。线上常量与界面标签同为 P0 / P1 / P2 */
export type Priority = 'P0' | 'P1' | 'P2'

/** 任务状态。界面标签：未开始 / 进行中 / 已完成 */
export type TaskStatus = 'TODO' | 'DOING' | 'DONE'

/** 敏感可见性作用的对象类型（多态列，无法建真实外键，见决策 I-7） */
export type VisibilityObjectType = 'story' | 'task'

// ---------------------------------------------------------------------------
// 基础形状（决策 I-2）
// ---------------------------------------------------------------------------

/** 用户简要信息，内嵌在任务响应、成员列表等处 */
export type UserBrief = { id: string; account: string; displayName: string }

export type Project = {
  id: string
  name: string
  description: string | null
  ownerUserId: string
  createdAt: string
}

/** 项目详情：在 Project 之上附加「当前调用者在该项目中的角色」 */
export type ProjectView = Project & { myRole: ProjectRole }

export type ProjectMemberView = {
  userId: string
  role: ProjectRole
  joinedAt: string
  user: UserBrief
}

export type BusinessGoal = {
  id: string
  projectId: string
  name: string
  description: string | null
  status: GoalStatus
  sortOrder: number
}

export type UserActivity = {
  id: string
  projectId: string
  goalId: string
  name: string
  description: string | null
  status: GoalStatus
  sortOrder: number
}

export type UserStory = {
  id: string
  projectId: string
  activityId: string
  title: string
  roleText: string
  capabilityText: string
  valueText: string
  businessValue: string
  priority: Priority
  status: StoryStatus
  acceptanceCriteria: string | null
  isSensitive: boolean
  createdAt: string
}

export type Task = {
  id: string
  projectId: string
  storyId: string
  title: string
  description: string | null
  ownerUserId: string
  acceptorUserId: string
  planStart: string
  planEnd: string
  status: TaskStatus
  isSensitive: boolean
  createdAt: string
}

/** 任务响应内嵌负责人与验收人的简要信息，前端无需再发一次用户查询 */
export type TaskView = Task & { owner: UserBrief; acceptor: UserBrief }

// ---------------------------------------------------------------------------
// 层级树节点（GET /projects/:id/goals 的响应元素）
// ---------------------------------------------------------------------------

export type StoryNode = UserStory
export type ActivityNode = UserActivity & { stories: StoryNode[] }
export type GoalNode = BusinessGoal & { activities: ActivityNode[] }

// ---------------------------------------------------------------------------
// 敏感可见性（PUT .../sensitivity 的请求与响应）
// ---------------------------------------------------------------------------

export type SensitivityInput = { isSensitive: boolean; visibleMemberIds: string[] }

export type SensitivityView = {
  objectType: VisibilityObjectType
  objectId: string
  isSensitive: boolean
  visibleMemberIds: string[]
}

// ---------------------------------------------------------------------------
// 响应信封（决策 I-3）
// ---------------------------------------------------------------------------

/** 单个资源：HTTP 2xx，响应体即资源本身，不额外套壳 */
export type ItemResponse<T> = T

/** 列表：统一包装为 { items: T[] } */
export type ListResponse<T> = { items: T[] }

/** 失败：HTTP 4xx / 5xx，响应体固定为 ErrorResponse */
export type ErrorResponse = {
  error: {
    code: ErrorCode
    /** 面向人的提示，可直接展示 */
    message: string
    details?: Array<{ field: string; code: FieldErrorCode }>
  }
}

// ---------------------------------------------------------------------------
// 错误码表（决策 I-4）
// ---------------------------------------------------------------------------

/**
 * 顶层错误码。
 *   - BAD_REQUEST(400) 请求体语法非法，由解析层产生、没有可归属的字段
 *   - INTERNAL_ERROR(500) 未抛 AppError 的未知异常（决策 I-2b 要求 500）
 */
export type ErrorCode =
  | 'BAD_REQUEST' // 400 请求体无法解析为 JSON
  | 'UNAUTHENTICATED' // 401 未登录或凭证失效
  | 'FORBIDDEN' // 403 对象可见，但该操作不允许
  | 'NOT_FOUND' // 404 对象不存在，或对调用者不可见
  | 'VALIDATION_FAILED' // 422 字段校验失败
  | 'CONFLICT' // 409 状态冲突
  | 'INTERNAL_ERROR' // 500 未预期的服务端异常（响应体不含堆栈）

/** 字段级错误码，位于 details[].code */
export type FieldErrorCode =
  | 'REQUIRED' // 必填缺失或纯空白
  | 'TOO_LONG' // 超出长度上限
  | 'INVALID_FORMAT' // 格式非法
  | 'INVALID_VALUE' // 枚举取值非法
  | 'DUPLICATE' // 唯一性冲突
  | 'USER_NOT_FOUND' // 账号对应的用户不存在
  | 'NOT_PROJECT_MEMBER' // 目标用户 / 被指定人不是本项目成员
  | 'ACCEPTOR_EQUALS_OWNER' // 验收人与负责人为同一人
  | 'END_BEFORE_START' // 计划结束早于计划开始
  | 'INSUFFICIENT_MEMBERS' // 项目成员不足 2 人
  | 'SELF_REMOVAL_FORBIDDEN' // 不能移除自己
  | 'LAST_PM' // 不能移除或降级最后一个项目经理
  | 'CROSS_PROJECT_REF' // 引用了其他项目的对象
  | 'HAS_CHILDREN' // 仍有下级对象，禁止删除

/** 字段级错误条目，由 Zod issue 映射而来（见 shared/validation.ts） */
export type FieldError = { field: string; code: FieldErrorCode }

// ---------------------------------------------------------------------------
// 鉴权入口类型（契约决策 I-5 / I-6）
//
// 【本次补录】契约决策 I-5 把 `Action` / `ObjectRef` / `Decision` 作为 `can()`
// 签名的组成部分**明文给出**，决策 I-6 同样给出 `Scope`；但 `shared/types.ts`
// 此前只落地了决策 I-1 / I-2 / I-3 / I-4 的类型，**遗漏这四个**。
// 后果：任何模块想按契约调用 `can()`，都会因「模块没有导出成员 Action」而编译失败，
// 即「统一鉴权入口」在类型层面无法被调用。
//
// 现按契约原文补录（字段与取值逐一对应契约，未自行增删）。这些类型属冻结件，
// 改动需走契约变更流程；本次仅为补齐契约**已定义却未被写入**的内容。
// ---------------------------------------------------------------------------

/** `can()` 的动作集合（决策 I-5）。 */
export type Action =
  | 'project.read' // 读取项目及其下需求与任务
  | 'project.manage_members' // 增删成员、改角色
  | 'requirement.write' // 业务目标 / 用户活动 / 用户故事的增删改
  | 'task.write' // 任务的增删改
  | 'sensitivity.manage' // 设置敏感标记与可见成员

/**
 * `can()` 的目标引用（决策 I-5）。
 *
 * 调用方**只传 id，不传任何权限相关字段** —— 否则越权就变成了改一个请求体字段的事。
 */
export type ObjectRef =
  | { kind: 'project'; projectId: string }
  | { kind: 'goal'; projectId: string; objectId: string }
  | { kind: 'activity'; projectId: string; objectId: string }
  | { kind: 'story'; projectId: string; objectId: string }
  | { kind: 'task'; projectId: string; objectId: string }

/**
 * `can()` 的判定结果（决策 I-5）。
 *
 * 关键：**由 `can()` 直接给出 status 与 code**，调用方不得自行判断 403 还是 404。
 * 这消除了同一越权行为在不同端点产生不同状态码的可能。
 */
export type Decision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

/**
 * 列表可见性作用域（决策 I-6）。
 *
 * `mode === 'all'` → 查询不加可见性条件；
 * `mode === 'subset'` → 查询追加 `id IN (:ids)`，ids 为空则列表返回空集合。
 */
export type Scope = { mode: 'all' } | { mode: 'subset'; ids: string[] }
