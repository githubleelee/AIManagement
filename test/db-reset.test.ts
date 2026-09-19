/**
 * resetDatabase() 清空彻底性验证（T0-02 对抗性验证）
 *
 * 既有 `db-schema.test.ts` 已断言「造满 9 表后清空并重建成功」，但重建成功
 * 不等于清空干净。本文件在**每张表放多行、并放入悬挂的 ObjectVisibility**
 * （objectId 指向不存在的对象）后清空，逐表 count 断言必须为 0，并验证
 * 连续调用两次 resetDatabase 仍然幂等。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTempDatabase, resetDatabase, type TestDatabase } from '../src/db/test-support.js'

let db: TestDatabase

beforeAll(() => {
  db = createTempDatabase()
}, 120_000)

afterAll(async () => {
  await db.dispose()
})

beforeEach(async () => {
  await resetDatabase(db.prisma)
})

let seq = 0
function unique(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

async function countAll(): Promise<Record<string, number>> {
  return {
    auditLog: await db.prisma.auditLog.count(),
    objectVisibility: await db.prisma.objectVisibility.count(),
    task: await db.prisma.task.count(),
    userStory: await db.prisma.userStory.count(),
    userActivity: await db.prisma.userActivity.count(),
    businessGoal: await db.prisma.businessGoal.count(),
    projectMember: await db.prisma.projectMember.count(),
    project: await db.prisma.project.count(),
    user: await db.prisma.user.count(),
  }
}

const ZERO = {
  auditLog: 0,
  objectVisibility: 0,
  task: 0,
  userStory: 0,
  userActivity: 0,
  businessGoal: 0,
  projectMember: 0,
  project: 0,
  user: 0,
}

/** 造一个「满负载」的库：每张表多行 + 悬挂可见性。 */
async function seedFull() {
  const owner = await db.prisma.user.create({
    data: { account: unique('owner'), displayName: 'o', passwordHash: 'h' },
  })
  const member = await db.prisma.user.create({
    data: { account: unique('member'), displayName: 'm', passwordHash: 'h' },
  })
  const project = await db.prisma.project.create({ data: { name: unique('project'), ownerUserId: owner.id } })

  await db.prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: owner.id, role: 'PM' },
      { projectId: project.id, userId: member.id, role: 'MEMBER' },
    ],
  })

  // 两个 goal，每个一个 activity，每个一个 story，每个 story 一个 task
  for (let i = 0; i < 2; i += 1) {
    const goal = await db.prisma.businessGoal.create({
      data: { projectId: project.id, name: unique('goal'), sortOrder: i },
    })
    const activity = await db.prisma.userActivity.create({
      data: { projectId: project.id, goalId: goal.id, name: unique('activity'), sortOrder: i },
    })
    const story = await db.prisma.userStory.create({
      data: {
        projectId: project.id,
        activityId: activity.id,
        title: unique('title'),
        roleText: 'r',
        capabilityText: 'c',
        valueText: 'v',
        businessValue: 'bv',
        priority: 'P0',
      },
    })
    await db.prisma.task.create({
      data: {
        projectId: project.id,
        storyId: story.id,
        title: unique('task'),
        ownerUserId: owner.id,
        acceptorUserId: member.id,
        planStart: '2026-09-01',
        planEnd: '2026-09-02',
      },
    })
    await db.prisma.objectVisibility.create({
      data: { projectId: project.id, objectType: 'story', objectId: story.id, userId: member.id },
    })
    await db.prisma.auditLog.create({
      data: {
        projectId: project.id,
        actorUserId: owner.id,
        action: 'sensitivity.update',
        objectType: 'story',
        objectId: story.id,
      },
    })
  }

  // 悬挂可见性：objectId 指向不存在的 story/task，同样必须被清掉
  await db.prisma.objectVisibility.create({
    data: { projectId: project.id, objectType: 'story', objectId: 'ghost-story', userId: owner.id },
  })
  await db.prisma.objectVisibility.create({
    data: { projectId: project.id, objectType: 'task', objectId: 'ghost-task', userId: member.id },
  })
}

describe('resetDatabase 清空彻底性', () => {
  it('满负载（每表多行 + 悬挂可见性）清空后，9 张表逐表 count 必须为 0', async () => {
    await seedFull()
    const before = await countAll()
    // 确认确实造出了数据
    expect(before.project).toBe(1)
    expect(before.user).toBe(2)
    expect(before.objectVisibility).toBe(4) // 2 正常 + 2 悬挂
    expect(before.task).toBe(2)
    expect(before.auditLog).toBe(2)

    await resetDatabase(db.prisma)

    expect(await countAll()).toEqual(ZERO)
  })

  it('对已清空的库连续调用 resetDatabase 两次仍然幂等', async () => {
    await seedFull()
    await resetDatabase(db.prisma)
    await expect(resetDatabase(db.prisma)).resolves.toBeUndefined()
    expect(await countAll()).toEqual(ZERO)
  })

  it('清空后可用同一 account 重新插入，唯一约束不残留脏数据', async () => {
    const account = unique('reuse-account')
    await db.prisma.user.create({ data: { account, displayName: account, passwordHash: 'h' } })
    await resetDatabase(db.prisma)
    await expect(
      db.prisma.user.create({ data: { account, displayName: account, passwordHash: 'h' } }),
    ).resolves.toMatchObject({ account })
  })
})
