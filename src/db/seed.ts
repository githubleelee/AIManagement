/**
 * 演示数据 seed（US-01 浏览器演示用）
 *
 * 没有注册端点，浏览器登录必须先有账号。本脚本创建演示账号与演示项目：
 *   - pm / member1 / member2 / viewer1：同一个「演示项目」的四名成员
 *   - outsider：不属于演示项目，另有自己的项目，用于演示非成员 404 与列表隔离
 *
 * 运行（Prisma CLI 会自动加载 .env 的 DATABASE_URL）：
 *   npm run db:migrate   # 首次：把迁移应用到 dev.db
 *   npm run db:seed
 *
 * 幂等：按 account upsert，项目按 owner 复用，重复执行不产生重复数据。
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
  { account: 'outsider', displayName: '外部用户' },
] as const

export type SeedResult = {
  accounts: ReadonlyArray<{ account: string; displayName: string }>
  /** 演示项目（pm 为 PM，另有 3 名成员） */
  projectId: string
  /** outsider 自己的项目（不属于演示项目，用于列表隔离演示） */
  outsiderProjectId: string
}

async function ensureProject(
  prisma: PrismaClient,
  ownerUserId: string,
  name: string,
  description: string,
  memberUserIds: string[],
): Promise<string> {
  const existing = await prisma.project.findFirst({
    where: { ownerUserId },
    select: { id: true },
  })
  if (existing) return existing.id

  const project = await prisma.project.create({
    data: {
      name,
      description,
      ownerUserId,
      members: {
        create: memberUserIds.map((userId, index) => ({
          userId,
          role: index === 0 ? 'PM' : 'MEMBER',
        })),
      },
    },
    select: { id: true },
  })
  return project.id
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
  const outsider = users.get('outsider')
  if (!pm || !member1 || !member2 || !viewer1 || !outsider) {
    throw new Error('seed 账号创建不完整')
  }

  const demoMembers = [
    { userId: pm.id, role: 'PM' },
    { userId: member1.id, role: 'MEMBER' },
    { userId: member2.id, role: 'MEMBER' },
    { userId: viewer1.id, role: 'VIEWER' },
  ]

  const existingDemo = await prisma.project.findFirst({
    where: { ownerUserId: pm.id },
    select: { id: true },
  })
  const projectId =
    existingDemo?.id ??
    (
      await prisma.project.create({
        data: {
          name: '演示项目：爱管理',
          description: 'Sprint 1 演示用项目（seed 生成）',
          ownerUserId: pm.id,
          members: { create: demoMembers },
        },
        select: { id: true },
      })
    ).id

  const outsiderProjectId = await ensureProject(
    prisma,
    outsider.id,
    '外部用户的项目',
    '不属于演示项目，用于验证列表隔离',
    [outsider.id],
  )

  return { accounts: SEED_ACCOUNTS, projectId, outsiderProjectId }
}

async function runCli(): Promise<void> {
  const { prisma } = await import('./client.js')
  try {
    const result = await seedDatabase(prisma)
    console.log('seed 完成：')
    for (const account of result.accounts) {
      console.log(`  ${account.account.padEnd(9)} ${account.displayName}  密码：${SEED_PASSWORD}`)
    }
    console.log(`  演示项目 id：${result.projectId}`)
    console.log(`  outsider 项目 id：${result.outsiderProjectId}`)
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
