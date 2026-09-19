/**
 * 数据表结构与删除保护测试（T0-02）
 *
 * 覆盖验收标准：
 *   1. 迁移可重复执行；9 张表与契约决策 I-7 一致
 *   2. 枚举列为 String（迁移 SQL 中为 TEXT），planStart/planEnd 为 String，
 *      createdAt 为 DateTime（迁移 SQL 中为 DATETIME）
 *   3. 外键 RESTRICT 真实生效：目标下有用户活动时删除目标被拒绝
 *   4. ProjectMember 的级联删除生效
 *   5. 清理助手按外键逆序清库且可重复使用
 *
 * 为什么必须有第 3 条：SQLite 的外键约束需要 `PRAGMA foreign_keys=ON` 才生效，
 * 若未生效 `onDelete: Restrict` 会静默失效（不报错、只留孤儿数据）。
 * 因此本测试不只断言「抛错」，还断言删除后数据仍在、并在移除子项后同一次删除调用成功。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  createTempDatabase,
  resetDatabase,
  type TestDatabase,
} from '../src/db/test-support.js'

let db: TestDatabase

/** 生成唯一 account / name，避免唯一约束冲突。 */
let seq = 0
function unique(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

beforeAll(() => {
  db = createTempDatabase()
}, 120_000)

afterAll(async () => {
  await db.dispose()
})

beforeEach(async () => {
  await resetDatabase(db.prisma)
})

// ---------------------------------------------------------------------------
// 工厂函数：只创建测试所需的最小数据
// ---------------------------------------------------------------------------

function makeUser(account = unique('user')) {
  return db.prisma.user.create({
    data: { account, displayName: account, passwordHash: 'hash' },
  })
}

function makeProject(ownerUserId: string, name = unique('project')) {
  return db.prisma.project.create({ data: { name, ownerUserId } })
}

function makeGoal(projectId: string, name = unique('goal')) {
  return db.prisma.businessGoal.create({ data: { projectId, name, sortOrder: 1 } })
}

function makeActivity(projectId: string, goalId: string, name = unique('activity')) {
  return db.prisma.userActivity.create({ data: { projectId, goalId, name, sortOrder: 1 } })
}

// ---------------------------------------------------------------------------
// 1. 表结构、迁移与 SQLite 外键开关
// ---------------------------------------------------------------------------

describe('表结构与迁移', () => {
  it('迁移创建了契约决策 I-7 规定的 9 张表', async () => {
    const rows = await db.prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_prisma%'
       ORDER BY name`,
    )
    expect(rows.map((row) => row.name)).toEqual([
      'AuditLog',
      'BusinessGoal',
      'ObjectVisibility',
      'Project',
      'ProjectMember',
      'Task',
      'User',
      'UserActivity',
      'UserStory',
    ])
  })

  it('迁移可重复执行：对同一库再次 deploy 不报错', () => {
    expect(() => applyMigrations(db.databaseUrl)).not.toThrow()
  })

  // 关键前置：若该断言失败，后面的 RESTRICT 测试即使「通过」也毫无意义
  it('SQLite 外键约束实际开启（PRAGMA foreign_keys = 1）', async () => {
    const rows = await db.prisma.$queryRawUnsafe<Array<{ foreign_keys: number | bigint }>>(
      'PRAGMA foreign_keys',
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]?.foreign_keys)).toBe(1)
  })

  it('枚举列与 planStart/planEnd 为 String（TEXT），createdAt 为 DateTime（DATETIME）', async () => {
    type ColumnInfo = { name: string; type: string }

    async function columnTypes(table: string): Promise<Record<string, string>> {
      const rows = await db.prisma.$queryRawUnsafe<ColumnInfo[]>(`PRAGMA table_info('${table}')`)
      return Object.fromEntries(rows.map((row) => [row.name, row.type.toUpperCase()]))
    }

    const task = await columnTypes('Task')
    expect(task.planStart).toBe('TEXT')
    expect(task.planEnd).toBe('TEXT')
    expect(task.status).toBe('TEXT') // 枚举列：String
    expect(task.createdAt).toBe('DATETIME') // createdAt：DateTime

    const story = await columnTypes('UserStory')
    expect(story.priority).toBe('TEXT') // 枚举列：String
    expect(story.status).toBe('TEXT') // 枚举列：String
    expect(story.createdAt).toBe('DATETIME')

    const goal = await columnTypes('BusinessGoal')
    expect(goal.status).toBe('TEXT') // 枚举列：String
  })
})

// ---------------------------------------------------------------------------
// 2. 外键 RESTRICT（本工单最隐蔽的验收点）
// ---------------------------------------------------------------------------

describe('外键删除保护（RESTRICT）', () => {
  it('目标下有用户活动时，删除目标被数据库拒绝，且不产生孤儿数据', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)

    // (1) 删除被拒绝，且拒绝原因是外键约束失败（P2003）
    await expect(
      db.prisma.businessGoal.delete({ where: { id: goal.id } }),
    ).rejects.toMatchObject({ code: 'P2003' })

    // (2) 目标与其子活动都仍然存在 —— 没有静默删除、也没有留下孤儿
    expect(await db.prisma.businessGoal.count({ where: { id: goal.id } })).toBe(1)
    expect(await db.prisma.userActivity.count({ where: { id: activity.id } })).toBe(1)

    // (3) 对照实验：移除子项后，**同一次 delete 调用**必须成功。
    //     这证明 (1) 的拒绝确实由外键约束引起，而不是 delete 语句本身写错
    //     （例如 id 拼错、目标本就不存在等，那样 (3) 也会失败）。
    await db.prisma.userActivity.delete({ where: { id: activity.id } })
    await expect(
      db.prisma.businessGoal.delete({ where: { id: goal.id } }),
    ).resolves.toMatchObject({ id: goal.id })
    expect(await db.prisma.businessGoal.count({ where: { id: goal.id } })).toBe(0)
  })

  it('项目下有业务目标时，删除项目同样被 RESTRICT 拒绝', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    await makeGoal(project.id)

    await expect(db.prisma.project.delete({ where: { id: project.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.project.count({ where: { id: project.id } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. 外键 CASCADE（ProjectMember）
// ---------------------------------------------------------------------------

describe('级联删除（CASCADE）', () => {
  it('删除项目时，其 ProjectMember 记录被级联删除，用户本身保留', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.projectMember.create({
      data: { projectId: project.id, userId: owner.id, role: 'PM' },
    })
    await db.prisma.projectMember.create({
      data: { projectId: project.id, userId: member.id, role: 'MEMBER' },
    })

    expect(await db.prisma.projectMember.count({ where: { projectId: project.id } })).toBe(2)

    await db.prisma.project.delete({ where: { id: project.id } })

    expect(await db.prisma.projectMember.count({ where: { projectId: project.id } })).toBe(0)
    // CASCADE 只删除成员关系，不删除用户
    expect(
      await db.prisma.user.count({ where: { id: { in: [owner.id, member.id] } } }),
    ).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 4. 清理助手：按外键逆序清空全表，且可重复使用
// ---------------------------------------------------------------------------

describe('清理助手 resetDatabase', () => {
  it('清空全部 9 张表，且清空后能重新建数据（可重复使用）', async () => {
    // 造满 9 张表各至少一行
    const owner = await makeUser()
    const acceptor = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.projectMember.create({
      data: { projectId: project.id, userId: owner.id, role: 'PM' },
    })
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)
    const story = await db.prisma.userStory.create({
      data: {
        projectId: project.id,
        activityId: activity.id,
        title: 'title',
        roleText: 'role',
        capabilityText: 'capability',
        valueText: 'value',
        businessValue: 'businessValue',
        priority: 'P0',
      },
    })
    await db.prisma.task.create({
      data: {
        projectId: project.id,
        storyId: story.id,
        title: 'task',
        ownerUserId: owner.id,
        acceptorUserId: acceptor.id,
        planStart: '2026-09-01',
        planEnd: '2026-09-02',
      },
    })
    await db.prisma.objectVisibility.create({
      data: { projectId: project.id, objectType: 'story', objectId: story.id, userId: owner.id },
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

    await resetDatabase(db.prisma)

    const counts = {
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
    expect(counts).toEqual({
      auditLog: 0,
      objectVisibility: 0,
      task: 0,
      userStory: 0,
      userActivity: 0,
      businessGoal: 0,
      projectMember: 0,
      project: 0,
      user: 0,
    })

    // 可重复使用：清空后仍能正常插入（account 唯一约束不会因残留数据失败）
    const recreated = await db.prisma.user.create({
      data: { account: 'recreated', displayName: 'recreated', passwordHash: 'hash' },
    })
    expect(await db.prisma.user.count()).toBe(1)
    expect(recreated.account).toBe('recreated')
  })
})
