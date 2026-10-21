import type { PrismaClient } from '@prisma/client'
import type { AiStorySourcePort } from './contracts.js'

/** 只读 Prisma 数据，不调用 requirement service，遵守 I-9 的模块边界。 */
export function createPrismaAiStorySource(prisma: PrismaClient): AiStorySourcePort {
  return {
    async find(projectId, storyId) {
      const story = await prisma.userStory.findFirst({
        where: { id: storyId, projectId },
        select: {
          id: true,
          projectId: true,
          title: true,
          roleText: true,
          capabilityText: true,
          valueText: true,
          businessValue: true,
          acceptanceCriteria: true,
          isSensitive: true,
        },
      })
      if (!story) return null
      return {
        projectId: story.projectId,
        storyId: story.id,
        title: story.title,
        roleText: story.roleText,
        capabilityText: story.capabilityText,
        valueText: story.valueText,
        businessValue: story.businessValue,
        acceptanceCriteria: story.acceptanceCriteria,
        isSensitive: story.isSensitive,
        // Persisted project rows are not presumed to be synthetic demo data.
        // A dedicated demo adapter must opt in explicitly before an external API is allowed.
        dataClassification: 'PROJECT_DATA',
      }
    },
  }
}
