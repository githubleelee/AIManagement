/**
 * 测试数据库基础设施（T0-02）
 *
 * 契约「Testing Decisions → 测试基础设施」规定：
 *   - 每个测试文件使用**临时 SQLite 文件**，不要用 `:memory:`。
 *     原因：SQLite 内存库是每连接一个，Prisma 连接池会产生多个连接，导致
 *     「建表在一个连接、查询在另一个连接」，表现为偶发的「表不存在」。
 *   - `beforeEach` 按外键逆序清空全部表，测试之间互不污染。
 *
 * 本模块供后续所有测试共用：创建临时库、应用迁移、清空全表。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCHEMA_PATH = join(REPO_ROOT, 'src', 'db', 'schema.prisma')
const PRISMA_CLI = join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js')

/**
 * 对外键逆序清空全表。
 *
 * 顺序原则：先删「引用方」（子表），再删「被引用方」（父表）。
 *   AuditLog / ObjectVisibility → Task → UserStory → UserActivity → BusinessGoal
 *   → ProjectMember → Project → User
 *
 * 注意：`ObjectVisibility.objectId` 是多态列、没有真实外键，无法依赖数据库级联；
 * 这里只能按表整体清空，与业务代码「删除故事/任务时手动清理可见性记录」是两回事。
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // 多态表 / 审计表：引用 Project 与 User，最先删除
  await prisma.auditLog.deleteMany()
  await prisma.objectVisibility.deleteMany()
  // 任务：引用 Project / UserStory / User
  await prisma.task.deleteMany()
  // 用户故事：引用 Project / UserActivity
  await prisma.userStory.deleteMany()
  // 用户活动：引用 BusinessGoal（另有冗余 projectId 列，无外键）
  await prisma.userActivity.deleteMany()
  // 业务目标：引用 Project
  await prisma.businessGoal.deleteMany()
  // 成员关系：引用 Project 与 User
  await prisma.projectMember.deleteMany()
  // 项目：引用 User（owner）
  await prisma.project.deleteMany()
  // 用户：被以上所有表引用，最后删除
  await prisma.user.deleteMany()
}

/**
 * 用 `prisma migrate deploy` 把迁移应用到指定 SQLite 库。
 *
 * 使用 `deploy` 而非 `db push`：前者只执行已提交的迁移，能验证迁移文件本身可用；
 * 重复调用同一迁移目录是幂等的（Prisma 会跳过已应用的迁移），不会报错。
 */
export function applyMigrations(databaseUrl: string): void {
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy', '--schema', SCHEMA_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  })
}

export type TestDatabase = {
  /** 临时 SQLite 文件的绝对路径（调试用） */
  file: string
  /** 形如 `file:/tmp/.../test.db` 的连接串 */
  databaseUrl: string
  /** 指向该临时库的独立 client，与全局单例隔离 */
  prisma: PrismaClient
  /** 断开连接并删除临时目录 */
  dispose: () => Promise<void>
}

/**
 * 创建临时 SQLite 文件库并应用全部迁移。
 *
 * 不污染 `DATABASE_URL` 环境变量：通过 `datasourceUrl` 显式覆盖连接串，
 * 因此同一进程内多个测试文件可各用各的库。
 */
export function createTempDatabase(): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'aim-t0-02-db-'))
  const file = join(dir, 'test.db')
  const databaseUrl = `file:${file}`

  applyMigrations(databaseUrl)

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

  return {
    file,
    databaseUrl,
    prisma,
    dispose: async () => {
      await prisma.$disconnect()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
