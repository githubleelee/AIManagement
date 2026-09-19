import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/client'
import { requireAuth } from '../../auth/actor'
import type { Project } from '../../shared/types'

// M2 项目与成员。T1.1 只实现端点 3：POST /projects。

// 单字段形状由 Zod 负责（决策 I-2b）：name 必填、去空白后非空、最长 50。
// 业务规则（如 LAST_PM）需要查库，由处理器抛 AppError，不塞进 schema。
const createProjectBody = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().optional(),
})

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
}
