/**
 * 数据表结构逐字段契约比对（T0-02 对抗性验证）
 *
 * 权威来源：`docs/sprint1-spec-interface-contract.md` 决策 I-7 的 Prisma schema
 * 与迁移文件 `src/db/migrations/20260919102113_init/migration.sql`。
 *
 * 与既有 `db-schema.test.ts` 的区别：
 *   - 既有测试只断言「9 张表名存在」、少量列类型、1 处 RESTRICT + 1 处 CASCADE。
 *   - 本文件逐表逐列比对 **字段名 / 类型 / 可空性 / 默认值 / 主键位置**，
 *     并逐条比对 **全部 14 处外键的删除规则**、复合主键与索引落点。
 *
 * 断言直接对齐契约原文，不对齐当前实现；任何一处不符即判为缺陷。
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

// ---------------------------------------------------------------------------
// 契约描述：决策 I-7 的每一列
//   type   —— 迁移 SQL 中的列类型（SQLite 的 type affinity 串）
//   notNull—— NOT NULL 与否
//   def    —— 原始默认值（sqlite PRAGMA dflt_value 的表示）
//   pk     —— 主键序号，0 表示非主键
// ---------------------------------------------------------------------------

type ColumnSpec = { name: string; type: string; notNull: boolean; def: string | null; pk: number }

const EXPECTED_COLUMNS: Record<string, ColumnSpec[]> = {
  User: [
    { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'account', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'displayName', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'passwordHash', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
  ],
  Project: [
    { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'name', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'description', type: 'TEXT', notNull: false, def: null, pk: 0 },
    { name: 'ownerUserId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
  ],
  ProjectMember: [
    { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'userId', type: 'TEXT', notNull: true, def: null, pk: 2 },
    { name: 'role', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'joinedAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
  ],
  BusinessGoal: [
    { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'name', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'description', type: 'TEXT', notNull: false, def: null, pk: 0 },
    { name: 'status', type: 'TEXT', notNull: true, def: "'ACTIVE'", pk: 0 },
    { name: 'sortOrder', type: 'INTEGER', notNull: true, def: null, pk: 0 },
  ],
  UserActivity: [
    { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'goalId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'name', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'description', type: 'TEXT', notNull: false, def: null, pk: 0 },
    { name: 'status', type: 'TEXT', notNull: true, def: "'ACTIVE'", pk: 0 },
    { name: 'sortOrder', type: 'INTEGER', notNull: true, def: null, pk: 0 },
  ],
  UserStory: [
    { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'activityId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'title', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'roleText', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'capabilityText', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'valueText', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'businessValue', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'priority', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'status', type: 'TEXT', notNull: true, def: "'DRAFT'", pk: 0 },
    { name: 'acceptanceCriteria', type: 'TEXT', notNull: false, def: null, pk: 0 },
    { name: 'isSensitive', type: 'BOOLEAN', notNull: true, def: 'false', pk: 0 },
    { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
  ],
  Task: [
    { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'storyId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'title', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'description', type: 'TEXT', notNull: false, def: null, pk: 0 },
    { name: 'ownerUserId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'acceptorUserId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'planStart', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'planEnd', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'status', type: 'TEXT', notNull: true, def: "'TODO'", pk: 0 },
    { name: 'isSensitive', type: 'BOOLEAN', notNull: true, def: 'false', pk: 0 },
    { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
  ],
  ObjectVisibility: [
    { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'objectType', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'objectId', type: 'TEXT', notNull: true, def: null, pk: 2 },
    { name: 'userId', type: 'TEXT', notNull: true, def: null, pk: 3 },
  ],
  AuditLog: [
    { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
    { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'actorUserId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'action', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'objectType', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'objectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
    { name: 'before', type: 'TEXT', notNull: false, def: null, pk: 0 },
    { name: 'after', type: 'TEXT', notNull: false, def: null, pk: 0 },
    { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
  ],
}

// 全部 14 处外键：9 处 RESTRICT + 5 处 CASCADE（契约冻结 schema 的完整清单）
type FkSpec = { from: string; table: string; to: string; onDelete: 'RESTRICT' | 'CASCADE' }

const EXPECTED_FKS: Record<string, FkSpec[]> = {
  User: [],
  Project: [{ from: 'ownerUserId', table: 'User', to: 'id', onDelete: 'RESTRICT' }],
  ProjectMember: [
    { from: 'projectId', table: 'Project', to: 'id', onDelete: 'CASCADE' },
    { from: 'userId', table: 'User', to: 'id', onDelete: 'CASCADE' },
  ],
  BusinessGoal: [{ from: 'projectId', table: 'Project', to: 'id', onDelete: 'RESTRICT' }],
  UserActivity: [{ from: 'goalId', table: 'BusinessGoal', to: 'id', onDelete: 'RESTRICT' }],
  UserStory: [
    { from: 'projectId', table: 'Project', to: 'id', onDelete: 'RESTRICT' },
    { from: 'activityId', table: 'UserActivity', to: 'id', onDelete: 'RESTRICT' },
  ],
  Task: [
    { from: 'projectId', table: 'Project', to: 'id', onDelete: 'RESTRICT' },
    { from: 'storyId', table: 'UserStory', to: 'id', onDelete: 'RESTRICT' },
    { from: 'ownerUserId', table: 'User', to: 'id', onDelete: 'RESTRICT' },
    { from: 'acceptorUserId', table: 'User', to: 'id', onDelete: 'RESTRICT' },
  ],
  ObjectVisibility: [
    { from: 'projectId', table: 'Project', to: 'id', onDelete: 'CASCADE' },
    { from: 'userId', table: 'User', to: 'id', onDelete: 'CASCADE' },
  ],
  AuditLog: [{ from: 'projectId', table: 'Project', to: 'id', onDelete: 'CASCADE' }],
}

// ---------------------------------------------------------------------------
// PRAGMA 读取助手
// ---------------------------------------------------------------------------

type RawColumn = {
  name: string
  type: string
  notnull: number | bigint
  dflt_value: string | null
  pk: number | bigint
}

async function getColumns(table: string): Promise<ColumnSpec[]> {
  const rows = await db.prisma.$queryRawUnsafe<RawColumn[]>(`PRAGMA table_info(${JSON.stringify(table)})`)
  return rows.map((r) => ({
    name: r.name,
    type: r.type.toUpperCase(),
    notNull: Number(r.notnull) === 1,
    def: r.dflt_value,
    pk: Number(r.pk),
  }))
}

type RawFk = { table: string; from: string; to: string; on_delete: string }

async function getFks(table: string): Promise<FkSpec[]> {
  const rows = await db.prisma.$queryRawUnsafe<RawFk[]>(
    `PRAGMA foreign_key_list(${JSON.stringify(table)})`,
  )
  return rows
    .map((r) => ({
      from: r.from,
      table: r.table,
      to: r.to,
      onDelete: r.on_delete as FkSpec['onDelete'],
    }))
    .sort((a, b) => a.from.localeCompare(b.from))
}

async function getTableNames(): Promise<string[]> {
  const rows = await db.prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'
     ORDER BY name`,
  )
  return rows.map((r) => r.name)
}

type IndexRow = { name: string; unique: number | bigint; origin: string }
type IndexInfo = { name: string }

async function getIndexes(
  table: string,
): Promise<Array<{ name: string; unique: boolean; origin: string; columns: string[] }>> {
  const rows = await db.prisma.$queryRawUnsafe<IndexRow[]>(`PRAGMA index_list(${JSON.stringify(table)})`)
  const result = []
  for (const row of rows) {
    const info = await db.prisma.$queryRawUnsafe<IndexInfo[]>(
      `PRAGMA index_info(${JSON.stringify(row.name)})`,
    )
    result.push({
      name: row.name,
      unique: Number(row.unique) === 1,
      origin: row.origin,
      columns: info.map((c) => c.name),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1. 表集合与逐字段比对
// ---------------------------------------------------------------------------

describe('决策 I-7 表集合与字段逐列比对', () => {
  it('恰好存在契约规定的 9 张表', async () => {
    expect(await getTableNames()).toEqual([
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

  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    it(`表 ${table}：字段名 / 类型 / 可空性 / 默认值 / 主键位置逐列一致`, async () => {
      expect(await getColumns(table)).toEqual(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// 2. 外键与删除规则逐条比对
// ---------------------------------------------------------------------------

describe('决策 I-7 外键与删除规则逐条比对', () => {
  for (const [table, expected] of Object.entries(EXPECTED_FKS)) {
    it(`表 ${table}：外键指向与 ON DELETE 规则一致`, async () => {
      expect(await getFks(table)).toEqual([...expected].sort((a, b) => a.from.localeCompare(b.from)))
    })
  }

  it('全部外键合计为 9 处 RESTRICT + 5 处 CASCADE（契约冻结 schema 的完整清单）', async () => {
    const all: FkSpec[] = []
    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      all.push(...(await getFks(table)))
    }
    expect(all).toHaveLength(14)
    expect(all.filter((f) => f.onDelete === 'RESTRICT')).toHaveLength(9)
    expect(all.filter((f) => f.onDelete === 'CASCADE')).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// 3. 复合主键、唯一约束与索引落点
// ---------------------------------------------------------------------------

describe('复合主键、唯一约束与索引落点', () => {
  it('ProjectMember 复合主键为 (projectId, userId)', async () => {
    const pk = (await getColumns('ProjectMember'))
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    expect(pk).toEqual(['projectId', 'userId'])
  })

  it('ObjectVisibility 复合主键为 (objectType, objectId, userId)', async () => {
    const pk = (await getColumns('ObjectVisibility'))
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    expect(pk).toEqual(['objectType', 'objectId', 'userId'])
  })

  it('User.account 有唯一约束，重复账号插入被拒绝（P2002）', async () => {
    const indexes = await getIndexes('User')
    expect(
      indexes.some((i) => i.unique && i.columns.join(',') === 'account'),
    ).toBe(true)

    await makeUser('dup-account')
    await expect(makeUser('dup-account')).rejects.toMatchObject({ code: 'P2002' })
  })

  it('ObjectVisibility 有 @@index([objectType, objectId]) 与 @@index([projectId, objectType])', async () => {
    const indexes = await getIndexes('ObjectVisibility')
    const nonPk = indexes.filter((i) => i.origin === 'c')
    expect(nonPk.map((i) => i.columns.join(',')).sort()).toEqual(
      ['objectType,objectId', 'projectId,objectType'].sort(),
    )
    expect(nonPk.every((i) => !i.unique)).toBe(true)
  })

  it('ProjectMember 复合主键真实去重：同一 (projectId, userId) 插入两次被拒绝（P2002）', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    await db.prisma.projectMember.create({ data: { projectId: project.id, userId: owner.id, role: 'PM' } })
    await expect(
      db.prisma.projectMember.create({ data: { projectId: project.id, userId: owner.id, role: 'MEMBER' } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('ObjectVisibility 复合主键真实去重：同一 (objectType, objectId, userId) 插入两次被拒绝（P2002）', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const row = { projectId: project.id, objectType: 'story', objectId: 's1', userId: owner.id }
    await db.prisma.objectVisibility.create({ data: row })
    await expect(db.prisma.objectVisibility.create({ data: row })).rejects.toMatchObject({ code: 'P2002' })
  })
})

// ---------------------------------------------------------------------------
// 4. 枚举默认值的行为级验证（写入时省略字段）
// ---------------------------------------------------------------------------

describe('枚举列默认值在真实写入时生效', () => {
  it('BusinessGoal.status 默认 ACTIVE、UserActivity.status 默认 ACTIVE', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await db.prisma.businessGoal.create({
      data: { projectId: project.id, name: 'g', sortOrder: 1 },
    })
    const activity = await db.prisma.userActivity.create({
      data: { projectId: project.id, goalId: goal.id, name: 'a', sortOrder: 1 },
    })
    expect(goal.status).toBe('ACTIVE')
    expect(activity.status).toBe('ACTIVE')
  })

  it('UserStory.status 默认 DRAFT、isSensitive 默认 false', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await db.prisma.businessGoal.create({
      data: { projectId: project.id, name: 'g', sortOrder: 1 },
    })
    const activity = await db.prisma.userActivity.create({
      data: { projectId: project.id, goalId: goal.id, name: 'a', sortOrder: 1 },
    })
    const story = await db.prisma.userStory.create({
      data: {
        projectId: project.id,
        activityId: activity.id,
        title: 't',
        roleText: 'r',
        capabilityText: 'c',
        valueText: 'v',
        businessValue: 'bv',
        priority: 'P0',
      },
    })
    expect(story.status).toBe('DRAFT')
    expect(story.isSensitive).toBe(false)
  })

  it('Task.status 默认 TODO、isSensitive 默认 false', async () => {
    const owner = await makeUser()
    const acceptor = await makeUser()
    const project = await makeProject(owner.id)
    const goal = await db.prisma.businessGoal.create({
      data: { projectId: project.id, name: 'g', sortOrder: 1 },
    })
    const activity = await db.prisma.userActivity.create({
      data: { projectId: project.id, goalId: goal.id, name: 'a', sortOrder: 1 },
    })
    const story = await db.prisma.userStory.create({
      data: {
        projectId: project.id,
        activityId: activity.id,
        title: 't',
        roleText: 'r',
        capabilityText: 'c',
        valueText: 'v',
        businessValue: 'bv',
        priority: 'P0',
      },
    })
    const task = await db.prisma.task.create({
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
    expect(task.status).toBe('TODO')
    expect(task.isSensitive).toBe(false)
  })
})
