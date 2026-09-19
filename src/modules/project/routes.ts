import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/client'
import { requireAuth } from '../../auth/actor'
import { can } from '../authz/can'
import { AppError } from '../../shared/errors'
import { projectRoleSchema } from '../../shared/validation'
import type { Project, ProjectMemberView, ProjectRole, ProjectView } from '../../shared/types'

// M2 项目与成员。当前实现端点 3（建项目）、端点 4/5（我的项目列表与项目详情）、端点 6（加成员）。

// 单字段形状由 Zod 负责（决策 I-2b）：name 必填、去空白后非空、最长 50。
// 业务规则（如 LAST_PM）需要查库，由处理器抛 AppError，不塞进 schema。
const createProjectBody = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().optional(),
})

const addMemberBody = z.object({
  account: z.string().trim().min(1),
  role: projectRoleSchema,
})

const updateMemberRoleBody = z.object({ role: projectRoleSchema })

const projectParams = z.object({ projectId: z.string().min(1) })
const memberParams = z.object({ projectId: z.string().min(1), userId: z.string().min(1) })

// 响应序列化：createdAt 由 Date 转 ISO 8601 UTC 字符串（决策 I-7 第 4 条）。
function toProject(project: {
  id: string
  name: string
  description: string | null
  ownerUserId: string
  createdAt: Date
}): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    ownerUserId: project.ownerUserId,
    createdAt: project.createdAt.toISOString(),
  }
}

function toProjectView(
  project: {
    id: string
    name: string
    description: string | null
    ownerUserId: string
    createdAt: Date
  },
  myRole: string,
): ProjectView {
  return { ...toProject(project), myRole: myRole as ProjectRole }
}

function toMemberView(member: {
  userId: string
  role: string
  joinedAt: Date
  user: { id: string; account: string; displayName: string }
}): ProjectMemberView {
  return {
    userId: member.userId,
    role: member.role as ProjectRole,
    joinedAt: member.joinedAt.toISOString(),
    user: {
      id: member.user.id,
      account: member.user.account,
      displayName: member.user.displayName,
    },
  }
}

export function registerProjectRoutes(app: FastifyInstance): void {
  // 端点 3：POST /projects —— 权限：已登录
  // 副作用：同一事务内写入 ProjectMember(projectId, 当前用户, 'PM')
  app.post('/projects', { preHandler: requireAuth }, async (request, reply) => {
    const body = createProjectBody.parse(request.body)
    const actorUserId = request.actorUserId as string
    const description =
      body.description && body.description.trim() !== '' ? body.description.trim() : null

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: { name: body.name, description, ownerUserId: actorUserId },
      })
      await tx.projectMember.create({
        data: { projectId: created.id, userId: actorUserId, role: 'PM' },
      })
      return created
    })

    return reply.status(201).send(toProject(project))
  })

  // 端点 4：GET /projects —— 权限：已登录
  // 只返回当前用户参与的项目，myRole 为该项目中的角色
  app.get('/projects', { preHandler: requireAuth }, async (request) => {
    const actorUserId = request.actorUserId as string
    const memberships = await prisma.projectMember.findMany({
      where: { userId: actorUserId },
      include: { project: true },
      orderBy: { project: { createdAt: 'asc' } },
    })
    return { items: memberships.map((m) => toProjectView(m.project, m.role)) }
  })

  // 端点 5：GET /projects/:projectId —— 权限：project.read
  // 非项目成员与项目不存在返回完全一致的 404，响应体不含项目任何字段（决策 I-3）
  app.get('/projects/:projectId', { preHandler: requireAuth }, async (request) => {
    const { projectId } = projectParams.parse(request.params)
    const actorUserId = request.actorUserId as string

    const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
    if (!decision.allow) throw new AppError(decision.status, decision.code, '项目不存在')

    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actorUserId } },
    })
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!membership || !project) throw new AppError(404, 'NOT_FOUND', '项目不存在')

    return toProjectView(project, membership.role)
  })

  // 端点 6：POST /projects/:projectId/members —— 权限：project.manage_members
  // 账号查询、角色校验、重复添加拦截。非成员 → 404，MEMBER/VIEWER → 403（由 can() 统一给出）
  app.post('/projects/:projectId/members', { preHandler: requireAuth }, async (request, reply) => {
    const { projectId } = projectParams.parse(request.params)
    const actorUserId = request.actorUserId as string

    // 先鉴权再校验请求体，避免向无权者暴露字段级信息
    const decision = await can(actorUserId, 'project.manage_members', {
      kind: 'project',
      projectId,
    })
    if (!decision.allow) {
      throw new AppError(
        decision.status,
        decision.code,
        decision.status === 404 ? '项目不存在' : '该操作需要项目经理权限',
      )
    }

    const body = addMemberBody.parse(request.body)

    const target = await prisma.user.findUnique({ where: { account: body.account } })
    if (!target) {
      throw new AppError(422, 'VALIDATION_FAILED', '账号对应的用户不存在', [
        { field: 'account', code: 'USER_NOT_FOUND' },
      ])
    }

    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: target.id } },
    })
    if (existing) {
      throw new AppError(409, 'CONFLICT', '该用户已是项目成员', [
        { field: 'account', code: 'DUPLICATE' },
      ])
    }

    const member = await prisma.projectMember.create({
      data: { projectId, userId: target.id, role: body.role },
      include: { user: true },
    })

    return reply.status(201).send(toMemberView(member))
  })

  // 端点 7：GET /projects/:projectId/members —— 权限：project.read
  // 成员列表按 joinedAt 升序；非成员统一 404
  app.get('/projects/:projectId/members', { preHandler: requireAuth }, async (request) => {
    const { projectId } = projectParams.parse(request.params)
    const actorUserId = request.actorUserId as string

    const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
    if (!decision.allow) throw new AppError(decision.status, decision.code, '项目不存在')

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    })
    return { items: members.map(toMemberView) }
  })

  // 端点 8：PATCH /projects/:projectId/members/:userId —— 权限：project.manage_members
  // 修改成员角色；不能把最后一个 PM 降级（LAST_PM）
  app.patch('/projects/:projectId/members/:userId', { preHandler: requireAuth }, async (request) => {
    const { projectId, userId } = memberParams.parse(request.params)
    const actorUserId = request.actorUserId as string

    const decision = await can(actorUserId, 'project.manage_members', {
      kind: 'project',
      projectId,
    })
    if (!decision.allow) {
      throw new AppError(
        decision.status,
        decision.code,
        decision.status === 404 ? '项目不存在' : '该操作需要项目经理权限',
      )
    }

    const body = updateMemberRoleBody.parse(request.body)

    const target = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    })
    if (!target) throw new AppError(404, 'NOT_FOUND', '该成员不存在')

    // 把 PM 降级前确认项目仍有其他 PM，避免项目失去唯一管理者
    if (target.role === 'PM' && body.role !== 'PM') {
      const pmCount = await prisma.projectMember.count({ where: { projectId, role: 'PM' } })
      if (pmCount <= 1) {
        throw new AppError(422, 'VALIDATION_FAILED', '不能把最后一个项目经理降级', [
          { field: 'userId', code: 'LAST_PM' },
        ])
      }
    }

    const updated = await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { role: body.role },
      include: { user: true },
    })
    return toMemberView(updated)
  })
}
