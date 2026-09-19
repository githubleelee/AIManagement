/**
 * 演示数据 seed（US-01 浏览器演示用）
 *
 * 没有注册端点，浏览器登录必须先有账号。本脚本创建一组演示账号，
 * 以及一个带 4 名成员的演示项目，使「登录 → 我的项目 → 成员管理」可走通。
 *
 * 运行（Prisma CLI 会自动加载 .env 的 DATABASE_URL）：
 *   npm run db:migrate   # 首次：把迁移应用到 dev.db
 *   npm run db:seed
 *
 * 幂等：按 account upsert，重复执行不会产生重复数据。
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PrismaClient } from '@prisma/client'
import { hashPassword } from '../auth/password.js'

export const SEED_PASSWORD = 'Passw0rd!'

export const SEED_ACCOUNTS = [
  { account: 'pm', displayName: '王经理' },
  { account: 'member1', displayName: '李工' },
  { account: 'member2', displayName: '张工' },
  { account: 'viewer1', displayName: '刘总' },
] as const

export type SeedResult = {
  accounts: ReadonlyArray<{ account: string; displayName: string }>
  projectId: string
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  const passwordHash = await hashPassword(SEED_PASSWORD)

  const users = new Map<string, { id: string }>()
  for (const entry of SEED_ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { account: entry.account },
      update: { displayName: entry.displayName, passwordHash },
      create: { account: entry.account, displayName: entry.displayName, passwordHash },
      select: { id: true },
    })
    users.set(entry.account, user)
  }

  const pm = users.get('pm')
  const member1 = users.get('member1')
  const member2 = users.get('member2')
  const viewer1 = users.get('viewer1')
  if (!pm || !member1 || !member2 || !viewer1) {
    throw new Error('seed 账号创建不完整')
  }

  // 幂等：PM 已有项目就复用，不重复建
  const existing = await prisma.project.findFirst({
    where: { ownerUserId: pm.id },
    select: { id: true },
  })

  let projectId = existing?.id
  if (!projectId) {
    const project = await prisma.project.create({
      data: {
        name: '演示项目：爱管理',
        description: 'Sprint 1 演示用项目（seed 生成）',
        ownerUserId: pm.id,
        members: {
          create: [
            { userId: pm.id, role: 'PM' },
            { userId: member1.id, role: 'MEMBER' },
            { userId: member2.id, role: 'MEMBER' },
            { userId: viewer1.id, role: 'VIEWER' },
          ],
        },
      },
      select: { id: true },
    })
    projectId = project.id
  }

  return { accounts: SEED_ACCOUNTS, projectId }
}

async function runCli(): Promise<void> {
  const { prisma } = await import('./client.js')
  try {
    const result = await seedDatabase(prisma)
    console.log('seed 完成：')
    for (const account of result.accounts) {
      console.log(`  ${account.account.padEnd(8)} ${account.displayName}  密码：${SEED_PASSWORD}`)
    }
    console.log(`  演示项目 id：${result.projectId}`)
  } finally {
    await prisma.$disconnect()
  }
}

// 直接执行（npm run db:seed / tsx src/db/seed.ts）时运行；被测试 import 时不产生副作用。
const entry = process.argv[1]
const isDirectRun = entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url

if (isDirectRun) {
  runCli().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
