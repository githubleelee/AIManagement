import type { FastifyInstance } from 'fastify'
import { cleanupTestDatabase, ensureTestDatabase } from './setup'

// 测试辅助：app 单例、清库、关闭。
// seam 只有 HTTP 接口层（决策 7），测试不 mock 内部模块。

let appPromise: Promise<FastifyInstance> | null = null

export async function getApp(): Promise<FastifyInstance> {
  ensureTestDatabase()
  if (!appPromise) {
    appPromise = import('../src/app').then(async ({ buildApp }) => {
      const app = buildApp()
      await app.ready()
      return app
    })
  }
  return appPromise
}

export async function getPrisma() {
  ensureTestDatabase()
  const { prisma } = await import('../src/db/client')
  return prisma
}

// 按外键逆序清空全部表（决策 4 的 9 张表）
export async function resetDatabase(): Promise<void> {
  const prisma = await getPrisma()
  await prisma.auditLog.deleteMany()
  await prisma.objectVisibility.deleteMany()
  await prisma.task.deleteMany()
  await prisma.userStory.deleteMany()
  await prisma.userActivity.deleteMany()
  await prisma.businessGoal.deleteMany()
  await prisma.projectMember.deleteMany()
  await prisma.project.deleteMany()
  await prisma.user.deleteMany()

  const { clearSessions } = await import('../src/auth/session')
  clearSessions()
}

export async function closeTestApp(): Promise<void> {
  if (appPromise) {
    const app = await appPromise
    await app.close()
    appPromise = null
  }
  // 先断开 Prisma 连接再删文件，否则 Windows 会因文件锁报 EBUSY
  const { prisma } = await import('../src/db/client')
  await prisma.$disconnect()
  cleanupTestDatabase()
}
