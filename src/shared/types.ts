// 共享类型与枚举（接口契约决策 I-1、I-2，冻结）
//
// 传输层使用英文常量，界面层映射为中文标签；前后端引用同一份定义。

// ---------- 枚举（见决策 I-1） ----------
export type ProjectRole = 'PM' | 'MEMBER' | 'VIEWER'
export type GoalStatus = 'ACTIVE' | 'DONE'
export type StoryStatus = 'DRAFT' | 'PLANNING' | 'DONE'
export type Priority = 'P0' | 'P1' | 'P2'
export type TaskStatus = 'TODO' | 'DOING' | 'DONE'
export type VisibilityObjectType = 'story' | 'task'

// GoalStatus / StoryStatus / TaskStatus 三者都存在取值 DONE，
// 但语义不同且互相不可赋值，故必须是三个独立类型。

// 界面层中文标签映射（仅用于展示，不进入传输层）
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  PM: '项目经理',
  MEMBER: '项目成员',
  VIEWER: '管理者',
}
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  ACTIVE: '进行中',
  DONE: '已完成',
}
export const STORY_STATUS_LABELS: Record<StoryStatus, string> = {
  DRAFT: '待规划',
  PLANNING: '规划中',
  DONE: '已完成',
}
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: '未开始',
  DOING: '进行中',
  DONE: '已完成',
}

// ---------- 基础形状 ----------
export type UserBrief = { id: string; account: string; displayName: string }

// 所有 id 为 string；所有 createdAt 为 ISO 8601 UTC 字符串
// 所有 planStart / planEnd 为 'YYYY-MM-DD' 字符串

export type Project = {
  id: string
  name: string
  description: string | null
  ownerUserId: string
  createdAt: string
}
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
export type TaskView = Task & { owner: UserBrief; acceptor: UserBrief }

// 层级树节点（GET /projects/:id/goals 的响应元素）
export type StoryNode = UserStory
export type ActivityNode = UserActivity & { stories: StoryNode[] }
export type GoalNode = BusinessGoal & { activities: ActivityNode[] }

// 敏感可见性（PUT .../sensitivity 的请求与响应）
export type SensitivityInput = { isSensitive: boolean; visibleMemberIds: string[] }
export type SensitivityView = {
  objectType: VisibilityObjectType
  objectId: string
  isSensitive: boolean
  visibleMemberIds: string[]
}

// ---------- 统一响应信封（决策 I-3） ----------
export type ListResponse<T> = { items: T[] }
