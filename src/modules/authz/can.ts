import { prisma } from '../../db/client'

// M3 唯一鉴权入口 can()（接口契约决策 I-5）。
// 业务代码禁止自己写角色判断；越权状态码由本函数直接返回，调用方不再自行判断 403/404。
//
// T1.2 只落地 US-01 需要的 `project` 类型（project.read / project.manage_members）。
// goal / activity / story / task 的对象加载与敏感判定在 T1.7、T2.x 按需补全。

export type Action =
  | 'project.read'
  | 'project.manage_members'
  | 'requirement.write'
  | 'task.write'
  | 'sensitivity.manage'

export type ObjectRef =
  | { kind: 'project'; projectId: string }
  | { kind: 'goal'; projectId: string; objectId: string }
  | { kind: 'activity'; projectId: string; objectId: string }
  | { kind: 'story'; projectId: string; objectId: string }
  | { kind: 'task'; projectId: string; objectId: string }

export type Decision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

const WRITE_ACTIONS: Action[] = [
  'project.manage_members',
  'requirement.write',
  'task.write',
  'sensitivity.manage',
]

export async function can(
  actorUserId: string,
  action: Action,
  ref: ObjectRef,
): Promise<Decision> {
  const projectId = resolveProjectId(ref)
  if (!projectId) return deny()

  // 权限每次请求都从数据库读取，不做进程内缓存（决策 I-10，变更即时生效）
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: actorUserId } },
  })

  // 规则 1：非项目成员 → 404（与「对象不存在」完全一致，不泄漏存在性）
  if (!membership) return deny()

  // 规则 2：PM → 放行（含敏感对象）
  if (membership.role === 'PM') return { allow: true }

  // 规则 3/4：对象为 story / task 时的敏感白名单判定，待对象类型实现时补全

  // 规则 5：写类动作对 MEMBER / VIEWER → 403（对象可见，只是不允许该操作）
  if (WRITE_ACTIONS.includes(action) && (membership.role === 'MEMBER' || membership.role === 'VIEWER')) {
    return { allow: false, status: 403, code: 'FORBIDDEN' }
  }

  // 规则 6：其余放行
  return { allow: true }
}

// can() 自己按 id 解析目标所属项目，调用方无法通过传入权限字段影响判定（决策 I-5 约束 1）。
function resolveProjectId(ref: ObjectRef): string | null {
  if (ref.kind === 'project') return ref.projectId
  return null // 其余对象类型在对应模块任务中补全
}

function deny(): Decision {
  return { allow: false, status: 404, code: 'NOT_FOUND' }
}
