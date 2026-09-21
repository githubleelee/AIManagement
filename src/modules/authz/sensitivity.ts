/** 对象级敏感设置：名单替换、成员验证、状态切换及审计必须同事务提交。 */
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { AppError } from '../../shared/errors.js'
import type { SensitivityInput, SensitivityView, VisibilityObjectType } from '../../shared/types.js'

const inputSchema = z.object({
  isSensitive: z.boolean(),
  visibleMemberIds: z.array(z.string().min(1)),
})

export function parseSensitivityInput(body: unknown): SensitivityInput {
  const parsed = inputSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_FAILED', '敏感设置字段无效',
      parsed.error.issues.map(issue => ({
        field: String(issue.path[0] ?? 'body'),
        code: issue.path[0] === 'isSensitive' || issue.code === 'invalid_type' ? 'REQUIRED' : 'INVALID_VALUE',
      })))
  }
  return parsed.data
}

export function objectNotFound(type: VisibilityObjectType): AppError {
  return new AppError(404, 'NOT_FOUND', type === 'story' ? '用户故事不存在' : '任务不存在')
}

/** 返回值和 AuditLog 中的 before/after 均采用 SensitivityView 契约。 */
export async function setSensitivity(
  prisma: PrismaClient,
  actorUserId: string,
  objectType: VisibilityObjectType,
  objectId: string,
  input: SensitivityInput,
): Promise<SensitivityView> {
  return prisma.$transaction(async tx => {
    const object = objectType === 'story'
      ? await tx.userStory.findUnique({ where: { id: objectId }, select: { projectId: true, isSensitive: true } })
      : await tx.task.findUnique({ where: { id: objectId }, select: { projectId: true, isSensitive: true } })
    if (!object) throw objectNotFound(objectType)

    // 在事务内复核当前角色；角色撤销后不可沿用请求开始时的判定。
    const actor = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: object.projectId, userId: actorUserId } },
      select: { role: true },
    })
    if (!actor) throw objectNotFound(objectType)
    if (actor.role !== 'PM') throw new AppError(403, 'FORBIDDEN', '无权修改敏感设置')

    const where = { projectId: object.projectId, objectType, objectId }
    const previous = await tx.objectVisibility.findMany({ where, select: { userId: true } })
    const oldIds = previous.map(row => row.userId).sort()
    const before: SensitivityView = {
      objectType, objectId, isSensitive: object.isSensitive, visibleMemberIds: oldIds,
    }
    let nextIds = oldIds
    if (input.isSensitive) {
      nextIds = [...new Set(input.visibleMemberIds)].sort()
      const count = await tx.projectMember.count({
        where: { projectId: object.projectId, userId: { in: nextIds } },
      })
      if (count !== nextIds.length) {
        throw new AppError(422, 'VALIDATION_FAILED', '可见成员必须属于本项目', [
          { field: 'visibleMemberIds', code: 'NOT_PROJECT_MEMBER' },
        ])
      }
      await tx.objectVisibility.deleteMany({ where })
      if (nextIds.length > 0) {
        await tx.objectVisibility.createMany({
          data: nextIds.map(userId => ({ ...where, userId })),
        })
      }
    }
    // 关闭敏感时忽略传入的名单，并保留旧名单供再次开启。
    if (objectType === 'story') {
      await tx.userStory.update({ where: { id: objectId }, data: { isSensitive: input.isSensitive } })
    } else {
      await tx.task.update({ where: { id: objectId }, data: { isSensitive: input.isSensitive } })
    }
    const after: SensitivityView = {
      objectType, objectId, isSensitive: input.isSensitive, visibleMemberIds: nextIds,
    }
    await tx.auditLog.create({ data: {
      projectId: object.projectId, actorUserId, action: 'sensitivity.update', objectType, objectId,
      before: JSON.stringify(before), after: JSON.stringify(after),
    } })
    return after
  })
}
