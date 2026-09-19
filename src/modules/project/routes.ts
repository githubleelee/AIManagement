import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/client'
import { requireAuth } from '../../auth/actor'
import { can } from '../authz/can'
import { AppError } from '../../shared/errors'
import type { Project, ProjectRole, ProjectView } from '../../shared/types'

// M2 项目与成员。当前实现端点 3（建项目）、端点 4/5（我的项目列表与项目详情）。

// 单字段形状由 Zod 负责（决策 I-2b）：name 必填、去空白后非空、最长 50。
// 业务规则（如 LAST_PM）需要查库，由处理器抛 AppError，不塞进 schema。
const createProjectBody = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().optional(),
})

const projectParams = z.object({ projectId: z.string().min(1) })

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
}
