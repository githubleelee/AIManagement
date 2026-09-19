/**
 * 全部外键删除规则的行为验证（T0-02 对抗性验证）
 *
 * 权威来源：契约决策 I-7。冻结 schema 共 14 处外键：
 *   9 处 RESTRICT：Project.owner、BusinessGoal.project、UserActivity.goal、
 *     UserStory.project、UserStory.activity、Task.project、Task.story、
 *     Task.owner、Task.acceptor
 *   5 处 CASCADE：ProjectMember.project、ProjectMember.user、
 *     ObjectVisibility.project、ObjectVisibility.user、AuditLog.project
 *
 * 与既有 `db-schema.test.ts` 的区别：既有测试只覆盖 1 处 RESTRICT
 * （BusinessGoal）与 1 处 CASCADE（ProjectMember.project）。本文件逐条断言，
 * 并对会被其它外键「顺带拦住」的 RESTRICT 用交叉项目引用做隔离，确保测的是
 * 目标那一条外键，而不是碰巧被另一条拦住。
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

function makeUser(account = unique('user')) {
  return db.prisma.user.create({ data: { account, displayName: account, passwordHash: 'hash' } })
}

function makeProject(ownerUserId: string) {
  return db.prisma.project.create({ data: { name: unique('project'), ownerUserId } })
}

function makeGoal(projectId: string) {
  return db.prisma.businessGoal.create({
    data: { projectId, name: unique('goal'), sortOrder: 1 },
  })
}

function makeActivity(projectId: string, goalId: string) {
  return db.prisma.userActivity.create({
    data: { projectId, goalId, name: unique('activity'), sortOrder: 1 },
  })
}

function makeStory(projectId: string, activityId: string) {
  return db.prisma.userStory.create({
    data: {
      projectId,
      activityId,
      title: unique('title'),
      roleText: 'role',
      capabilityText: 'cap',
      valueText: 'value',
      businessValue: 'bv',
      priority: 'P0',
    },
  })
}

function makeTask(projectId: string, storyId: string, ownerUserId: string, acceptorUserId: string) {
  return db.prisma.task.create({
    data: {
      projectId,
      storyId,
      title: unique('task'),
      ownerUserId,
      acceptorUserId,
      planStart: '2026-09-01',
      planEnd: '2026-09-02',
    },
  })
}

// ---------------------------------------------------------------------------
// RESTRICT：逐条断言删除被数据库拒绝，且父对象仍在
// ---------------------------------------------------------------------------

describe('RESTRICT 删除保护（9 处，逐条验证）', () => {
  it('Project.owner：删除拥有项目的用户被拒绝', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)

    await expect(db.prisma.user.delete({ where: { id: owner.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.user.count({ where: { id: owner.id } })).toBe(1)
    expect(await db.prisma.project.count({ where: { id: project.id } })).toBe(1)
  })

  it('BusinessGoal.project：删除仍有业务目标的项目被拒绝', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await makeGoal(project.id)

    await expect(db.prisma.project.delete({ where: { id: project.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.project.count({ where: { id: project.id } })).toBe(1)
    expect(await db.prisma.businessGoal.count({ where: { id: goal.id } })).toBe(1)
  })

  it('UserActivity.goal：删除仍有用户活动的目标被拒绝', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)

    await expect(db.prisma.businessGoal.delete({ where: { id: goal.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.businessGoal.count({ where: { id: goal.id } })).toBe(1)
    expect(await db.prisma.userActivity.count({ where: { id: activity.id } })).toBe(1)
  })

  it('UserStory.project：删除被故事引用的项目被拒绝（用交叉项目引用隔离该外键）', async () => {
    const owner = await makeUser()
    const projectWithGoal = await makeProject(owner.id)
    const projectReferencedByStory = await makeProject(owner.id)
    const goal = await makeGoal(projectWithGoal.id)
    const activity = await makeActivity(projectWithGoal.id, goal.id)
    // story.projectId 指向 B，activity 属于 A；B 下没有任何 goal/task，删除 B 只会被 UserStory.project 拦住
    await makeStory(projectReferencedByStory.id, activity.id)

    await expect(
      db.prisma.project.delete({ where: { id: projectReferencedByStory.id } }),
    ).rejects.toMatchObject({ code: 'P2003' })
    expect(await db.prisma.project.count({ where: { id: projectReferencedByStory.id } })).toBe(1)
  })

  it('UserStory.activity：删除仍挂着用户故事的用户活动被拒绝', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)
    const story = await makeStory(project.id, activity.id)

    await expect(db.prisma.userActivity.delete({ where: { id: activity.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.userActivity.count({ where: { id: activity.id } })).toBe(1)
    expect(await db.prisma.userStory.count({ where: { id: story.id } })).toBe(1)
  })

  it('Task.project：删除被任务引用的项目被拒绝（用交叉项目引用隔离该外键）', async () => {
    const owner = await makeUser()
    const acceptor = await makeUser()
    const projectWithStory = await makeProject(owner.id)
    const projectReferencedByTask = await makeProject(owner.id)
    const goal = await makeGoal(projectWithStory.id)
    const activity = await makeActivity(projectWithStory.id, goal.id)
    const story = await makeStory(projectWithStory.id, activity.id)
    // task.projectId 指向 B，story 属于 A
    await makeTask(projectReferencedByTask.id, story.id, owner.id, acceptor.id)

    await expect(
      db.prisma.project.delete({ where: { id: projectReferencedByTask.id } }),
    ).rejects.toMatchObject({ code: 'P2003' })
    expect(await db.prisma.project.count({ where: { id: projectReferencedByTask.id } })).toBe(1)
  })

  it('Task.story：删除仍有任务的用户故事被拒绝', async () => {
    const owner = await makeUser()
    const acceptor = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)
    const story = await makeStory(project.id, activity.id)
    const task = await makeTask(project.id, story.id, owner.id, acceptor.id)

    await expect(db.prisma.userStory.delete({ where: { id: story.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.userStory.count({ where: { id: story.id } })).toBe(1)
    expect(await db.prisma.task.count({ where: { id: task.id } })).toBe(1)
  })

  it('Task.owner：删除任务的负责人被拒绝（负责人不是项目 owner，隔离 Project.owner）', async () => {
    const projectOwner = await makeUser()
    const taskOwner = await makeUser()
    const acceptor = await makeUser()
    const project = await makeProject(projectOwner.id)
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)
    const story = await makeStory(project.id, activity.id)
    const task = await makeTask(project.id, story.id, taskOwner.id, acceptor.id)

    await expect(db.prisma.user.delete({ where: { id: taskOwner.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.user.count({ where: { id: taskOwner.id } })).toBe(1)
    expect(await db.prisma.task.count({ where: { id: task.id } })).toBe(1)
  })

  it('Task.acceptor：删除任务的验收人被拒绝（验收人不是项目 owner，隔离 Project.owner）', async () => {
    const projectOwner = await makeUser()
    const taskOwner = await makeUser()
    const acceptor = await makeUser()
    const project = await makeProject(projectOwner.id)
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)
    const story = await makeStory(project.id, activity.id)
    const task = await makeTask(project.id, story.id, taskOwner.id, acceptor.id)

    await expect(db.prisma.user.delete({ where: { id: acceptor.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await db.prisma.user.count({ where: { id: acceptor.id } })).toBe(1)
    expect(await db.prisma.task.count({ where: { id: task.id } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// CASCADE：逐条断言删除父对象后子记录消失
// ---------------------------------------------------------------------------

describe('CASCADE 级联删除（5 处，逐条验证）', () => {
  it('ProjectMember.project：删除项目级联删除成员关系，用户保留', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.projectMember.create({ data: { projectId: project.id, userId: owner.id, role: 'PM' } })
    await db.prisma.projectMember.create({ data: { projectId: project.id, userId: member.id, role: 'MEMBER' } })

    await db.prisma.project.delete({ where: { id: project.id } })

    expect(await db.prisma.projectMember.count({ where: { projectId: project.id } })).toBe(0)
    expect(await db.prisma.user.count({ where: { id: { in: [owner.id, member.id] } } })).toBe(2)
  })

  it('ProjectMember.user：删除用户级联删除其成员关系，项目保留', async () => {
    const owner = await makeUser()
    const member = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.projectMember.create({ data: { projectId: project.id, userId: member.id, role: 'MEMBER' } })

    await db.prisma.user.delete({ where: { id: member.id } })

    expect(await db.prisma.projectMember.count()).toBe(0)
    expect(await db.prisma.project.count({ where: { id: project.id } })).toBe(1)
  })

  it('ObjectVisibility.project：删除项目级联删除可见性记录', async () => {
    const owner = await makeUser()
    const viewer = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.objectVisibility.create({
      data: { projectId: project.id, objectType: 'story', objectId: 's1', userId: viewer.id },
    })

    await db.prisma.project.delete({ where: { id: project.id } })

    expect(await db.prisma.objectVisibility.count()).toBe(0)
    expect(await db.prisma.user.count({ where: { id: viewer.id } })).toBe(1)
  })

  it('ObjectVisibility.user：删除用户级联删除其可见性记录，项目保留', async () => {
    const owner = await makeUser()
    const viewer = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.objectVisibility.create({
      data: { projectId: project.id, objectType: 'task', objectId: 't1', userId: viewer.id },
    })

    await db.prisma.user.delete({ where: { id: viewer.id } })

    expect(await db.prisma.objectVisibility.count()).toBe(0)
    expect(await db.prisma.project.count({ where: { id: project.id } })).toBe(1)
  })

  it('AuditLog.project：删除项目级联删除审计日志', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.auditLog.create({
      data: {
        projectId: project.id,
        actorUserId: owner.id,
        action: 'sensitivity.update',
        objectType: 'story',
        objectId: 's1',
      },
    })

    await db.prisma.project.delete({ where: { id: project.id } })

    expect(await db.prisma.auditLog.count()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 对照实验：外键约束真的在拦截，而不是 delete 语句本身失败
// ---------------------------------------------------------------------------

describe('RESTRICT 的反事实对照', () => {
  it('移除子项后，同一条删除语句必须成功（证明拒绝由外键引起）', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await makeGoal(project.id)
    const activity = await makeActivity(project.id, goal.id)

    await expect(db.prisma.businessGoal.delete({ where: { id: goal.id } })).rejects.toMatchObject({
      code: 'P2003',
    })

    await db.prisma.userActivity.delete({ where: { id: activity.id } })
    await expect(db.prisma.businessGoal.delete({ where: { id: goal.id } })).resolves.toMatchObject({
      id: goal.id,
    })
    expect(await db.prisma.businessGoal.count({ where: { id: goal.id } })).toBe(0)
  })
})
