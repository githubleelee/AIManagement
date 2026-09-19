/**
 * 【临时桩】T0-03（数据工厂）与 T0-04（requireAuth / Actor 注入）合入后由
 * `test/factories.ts` 与 `test/helpers.ts` 替换。本文件不得进入 main，rebase 时删除。
 *
 * 为什么需要它：本工单不得创建或修改 `test/factories.ts` / `test/helpers.ts`
 * （属 T0-03 队员的文件），但接口测试需要「独立 app 实例 + 临时 SQLite + 造数」。
 * 因此把测试装置放在任务模块目录内。
 *
 * 关键点：业务模块通过 `src/db/client.ts` 的单例访问数据库，所以必须在**导入 app
 * 之前**设置 `process.env.DATABASE_URL`，再动态 `import()`，避免污染其它测试文件。
 */
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { createTempDatabase, resetDatabase, type TestDatabase } from '../../db/test-support.js'
import type { ProjectRole, TaskStatus } from '../../shared/types.js'

export type TaskTestContext = {
  /** 独立 Fastify 实例，已注册错误处理器、任务路由与临时 Actor 注入 */
  app: FastifyInstance
  /** 指向临时 SQLite 文件的 Prisma client（与业务模块共用同一单例） */
  prisma: PrismaClient
  /** 建库 / 删库句柄 */
  db: TestDatabase
}

/**
 * 启动任务模块测试装置。
 *
 * 顺序很重要：先建临时库并设置 `DATABASE_URL`，再动态导入 app / 路由 / 桩，
 * 这样单例 PrismaClient 才会绑定到本测试文件的临时库。
 */
export async function setupTaskTestApp(): Promise<TaskTestContext> {
  const db = createTempDatabase()
  process.env.DATABASE_URL = db.databaseUrl
  // 清除开发热重载缓存的单例，确保按新的连接串重建
  delete (globalThis as { __prisma__?: unknown }).__prisma__

  const { buildApp } = await import('../../app.js')
  const { taskRoutes } = await import('./routes.js')
  const { installStubActor } = await import('./_t0-stubs.js')
  const { prisma } = await import('../../db/client.js')

  const app = buildApp({ logger: false })
  installStubActor(app)
  await app.register(taskRoutes)
  await app.ready()

  return { app, prisma, db }
}

/** 清空临时库全部表（按外键逆序，见 src/db/test-support.ts）。 */
export async function resetTaskTestDatabase(ctx: TaskTestContext): Promise<void> {
  await resetDatabase(ctx.prisma)
}

// ---------------------------------------------------------------------------
// 数据工厂（T0-03 落地前的最小替身）
// ---------------------------------------------------------------------------

/** 创建一个用户（密码哈希为测试占位值）。 */
export async function createUser(prisma: PrismaClient, account: string, displayName = account) {
  return prisma.user.create({
    data: { account, displayName, passwordHash: 'test-password-hash' },
  })
}

/** 把用户加入项目并指定角色。 */
export async function addMember(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  await prisma.projectMember.create({ data: { projectId, userId, role } })
}

/**
 * 创建「项目 + PM 成员 + 目标 + 活动 + 用户故事」的最小可挂载结构。
 * 返回 projectId 与 storyId，供任务端点使用。
 */
export async function createProjectWithStory(
  prisma: PrismaClient,
  ownerUserId: string,
  options: { projectName?: string; storyTitle?: string } = {},
): Promise<{ projectId: string; storyId: string }> {
  const project = await prisma.project.create({
    data: { name: options.projectName ?? '测试项目', ownerUserId },
  })
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: ownerUserId, role: 'PM' },
  })
  const goal = await prisma.businessGoal.create({
    data: { projectId: project.id, name: '测试目标', sortOrder: 0 },
  })
  const activity = await prisma.userActivity.create({
    data: { projectId: project.id, goalId: goal.id, name: '测试活动', sortOrder: 0 },
  })
  const story = await prisma.userStory.create({
    data: {
      projectId: project.id,
      activityId: activity.id,
      title: options.storyTitle ?? '测试用户故事',
      roleText: '项目经理',
      capabilityText: '拆任务',
      valueText: '推进交付',
      businessValue: '高',
      priority: 'P0',
    },
  })
  return { projectId: project.id, storyId: story.id }
}

/** 直接插入一条任务；createdAt 可显式指定，便于验证排序。 */
export async function createTaskRow(
  prisma: PrismaClient,
  params: {
    projectId: string
    storyId: string
    ownerUserId: string
    acceptorUserId: string
    title?: string
    description?: string | null
    planStart?: string
    planEnd?: string
    status?: TaskStatus
    isSensitive?: boolean
    createdAt?: Date
  },
) {
  return prisma.task.create({
    data: {
      projectId: params.projectId,
      storyId: params.storyId,
      title: params.title ?? '任务',
      description: params.description ?? null,
      ownerUserId: params.ownerUserId,
      acceptorUserId: params.acceptorUserId,
      planStart: params.planStart ?? '2026-01-01',
      planEnd: params.planEnd ?? '2026-01-31',
      status: params.status ?? 'TODO',
      isSensitive: params.isSensitive ?? false,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  })
}
