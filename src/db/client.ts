/**
 * Prisma client 单例（冻结区，决策 I-0）
 *
 * 全进程共享一个 `PrismaClient`，避免开发热重载（tsx watch）时反复创建连接池。
 * 数据库位置由 `DATABASE_URL` 决定（见 `.env.example`，默认 `file:./dev.db`）。
 *
 * 测试不应使用本单例：每个测试文件需要指向自己的临时 SQLite 文件，
 * 请改用 `src/db/test-support.ts` 的 `createTempDatabase()`。
 */
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { __prisma__?: PrismaClient }

export const prisma: PrismaClient = globalForPrisma.__prisma__ ?? new PrismaClient()

// 开发环境缓存到 globalThis，热重载时复用同一实例，避免连接泄漏。
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma__ = prisma
}
