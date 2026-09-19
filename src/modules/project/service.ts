/**
 * M2 项目与成员 —— 数据访问（US-01 / T1.1–T1.7）
 *
 * 契约依据
 *   - 决策 I-9「模块依赖方向」：数据访问层（表与查询）所有模块都可以直接使用。
 *     本文件**只读写 Prisma 表**，不调用 M1 / M3 / M4 / M5 的任何 service。
 *   - 决策 I-7 数据层约定 4：`createdAt` / `joinedAt` 是 `DateTime`，
 *     响应里必须是 **ISO 8601 UTC 字符串**，在本文件完成序列化。
 *
 * 归属说明（决策 I-0）
 *   本文件是 `src/modules/project/` 内的新增文件，属 M2 独占，不触碰任何冻结文件。
 */
import type { PrismaClient } from '@prisma/client'
import type { Project, ProjectMemberView, ProjectRole, ProjectView } from '../../shared/types.js'

// ---------------------------------------------------------------------------
// 表 → 契约响应类型的映射（时间字段在此序列化）
// ---------------------------------------------------------------------------

type ProjectRow = {
  id: string
  name: string
  description: string | null
  ownerUserId: string
  createdAt: Date
}

type MemberRow = {
  userId: string
  role: string
  joinedAt: Date
  user: { id: string; account: string; displayName: string }
}

/** `Project` 表行 → 决策 I-2 的 `Project`。 */
export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 在 `Project` 之上附加「当前调用者在该项目中的角色」。 */
export function toProjectView(row: ProjectRow, myRole: string): ProjectView {
  return { ...toProject(row), myRole: myRole as ProjectRole }
}

/** `ProjectMember` 行（含 user）→ 决策 I-2 的 `ProjectMemberView`。 */
export function toMemberView(row: MemberRow): ProjectMemberView {
  return {
    userId: row.userId,
    role: row.role as ProjectRole,
    joinedAt: row.joinedAt.toISOString(),
    user: {
      id: row.user.id,
      account: row.user.account,
      displayName: row.user.displayName,
    },
  }
}

// ---------------------------------------------------------------------------
// 端点 3 —— 创建项目
// ---------------------------------------------------------------------------

/**
 * 创建项目，并在**同一事务内**写入创建者的 PM 成员关系（端点 3 副作用）。
 * 事务保证不会出现「项目已建但创建者不是成员」的中间状态。
 */
export async function createProjectWithOwner(
  prisma: PrismaClient,
  input: { name: string; description: string | null; ownerUserId: string },
): Promise<Project> {
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name: input.name,
        description: input.description,
        ownerUserId: input.ownerUserId,
      },
    })
    await tx.projectMember.create({
      data: { projectId: created.id, userId: input.ownerUserId, role: 'PM' },
    })
    return created
  })
  return toProject(project)
}

// ---------------------------------------------------------------------------
// 端点 4/5 —— 项目列表与详情
// ---------------------------------------------------------------------------

/** 当前用户参与的项目（端点 4），按项目创建时间升序，`myRole` 为该项目中的角色。 */
export async function listProjectsForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<ProjectView[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: { project: true },
    orderBy: { project: { createdAt: 'asc' } },
  })
  return memberships.map((m) => toProjectView(m.project, m.role))
}

/** 项目详情（端点 5）。调用方须已确认调用者是成员（经 can()）。 */
export async function getProjectView(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
): Promise<ProjectView | null> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!membership || !project) return null
  return toProjectView(project, membership.role)
}

// ---------------------------------------------------------------------------
// 端点 6–9 —— 成员
// ---------------------------------------------------------------------------

/** 按账号查用户（端点 6：账号不存在 → USER_NOT_FOUND）。 */
export async function findUserByAccount(
  prisma: PrismaClient,
  account: string,
): Promise<{ id: string; account: string; displayName: string } | null> {
  return prisma.user.findUnique({
    where: { account },
    select: { id: true, account: true, displayName: true },
  })
}

/** 读取成员关系；非成员返回 null。 */
export async function findMembership(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
): Promise<{ userId: string; role: string } | null> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { userId: true, role: true },
  })
  return membership
}

/** 统计项目内的 PM 数量（端点 8/9 的 LAST_PM 判定）。 */
export async function countProjectManagers(
  prisma: PrismaClient,
  projectId: string,
): Promise<number> {
  return prisma.projectMember.count({ where: { projectId, role: 'PM' } })
}

/** 新增成员（端点 6），返回带 user 的成员视图。 */
export async function addMember(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<ProjectMemberView> {
  const member = await prisma.projectMember.create({
    data: { projectId, userId, role },
    include: { user: true },
  })
  return toMemberView(member)
}

/** 成员列表（端点 7），按 joinedAt 升序。 */
export async function listMembers(
  prisma: PrismaClient,
  projectId: string,
): Promise<ProjectMemberView[]> {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  })
  return members.map(toMemberView)
}

/** 修改成员角色（端点 8），返回更新后的成员视图。 */
export async function updateMemberRole(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<ProjectMemberView> {
  const member = await prisma.projectMember.update({
    where: { projectId_userId: { projectId, userId } },
    data: { role },
    include: { user: true },
  })
  return toMemberView(member)
}

/** 移除成员（端点 9）。 */
export async function removeMember(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
): Promise<void> {
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId, userId } },
  })
}
