/**
 * 界面展示标签（决策 I-1：传输层用英文常量，界面层映射中文标签）。
 * 仅用于渲染，不进入任何请求体。
 */
import type { ProjectRole } from '../../src/shared/types'

export const ROLE_LABELS: Record<ProjectRole, string> = {
  PM: '项目经理',
  MEMBER: '项目成员',
  VIEWER: '管理者',
}

