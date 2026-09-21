/**
 * seed 脚本：创建演示账号与演示项目，且可重复执行。
 * 用 createTempDatabase 隔离，不触碰 dev.db。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTempDatabase, type TestDatabase } from '../src/db/test-support.js'
import { verifyPassword } from '../src/auth/password.js'
import { seedDatabase, SEED_ACCOUNTS, SEED_PASSWORD } from '../src/db/seed.js'

let db: TestDatabase

beforeAll(() => {
  db = createTempDatabase()
})

afterAll(async () => {
  await db?.dispose()
})

describe('seed 脚本', () => {
  it('创建演示账号、口令可校验，演示项目含 4 名成员', async () => {
    const result = await seedDatabase(db.prisma)

    const users = await db.prisma.user.findMany()
    expect(users).toHaveLength(SEED_ACCOUNTS.length)

    const pm = users.find((u) => u.account === 'pm')
    expect(pm).toBeTruthy()
    expect(await verifyPassword(SEED_PASSWORD, pm!.passwordHash)).toBe(true)

    const members = await db.prisma.projectMember.findMany({
      where: { projectId: result.projectId },
    })
    expect(members).toHaveLength(4)
    expect(members.map((m) => m.role).sort()).toEqual(['MEMBER', 'MEMBER', 'PM', 'VIEWER'])

    // outsider 不属于演示项目，用于非成员 404 演示
    const outsider = users.find((u) => u.account === 'outsider')
    expect(outsider).toBeTruthy()
    const outsiderInDemo = members.some((m) => m.userId === outsider!.id)
    expect(outsiderInDemo).toBe(false)

    // outsider 有自己的项目，用于列表隔离演示
    const outsiderMembers = await db.prisma.projectMember.findMany({
      where: { projectId: result.outsiderProjectId },
    })
    expect(outsiderMembers).toHaveLength(1)
    expect(outsiderMembers[0]?.userId).toBe(outsider!.id)
  })

  it('可重复执行（幂等）：账号与项目不重复', async () => {
    const first = await seedDatabase(db.prisma)
    const second = await seedDatabase(db.prisma)

    expect(await db.prisma.user.count()).toBe(SEED_ACCOUNTS.length)
    expect(await db.prisma.project.count()).toBe(2)
    expect(second.projectId).toBe(first.projectId)
    expect(second.outsiderProjectId).toBe(first.outsiderProjectId)
  })
})

