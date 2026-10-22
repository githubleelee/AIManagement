/**
 * US-15 在线 UML（工单 #35）—— P1 模型层自检（行为级）
 *
 * 权威来源：`docs/role-b-uml-design.md` **FROZEN v1.0** §3（模型设计）、§3.6（删除语义汇总）、
 * §3.7（实测记录）、§7.3 第 4 项（本文件即该项点名的「新表自检」）与 §7.4（列序陷阱）；
 * `DECISIONS.md` `uml.minimal-model-and-visibility`。
 *
 * 为什么单独一个文件、不进 `test/db-schema-contract.test.ts` 的 `EXPECTED_COLUMNS` /
 * `EXPECTED_FKS`：那两个清单的既定职责是「断言直接对齐契约 I-7 原文」，只覆盖契约 9 张表
 * （US-09 先例：新表列集合由该票自己的核对覆盖，未混进契约清单）。本文件因此自建 PRAGMA 断言。
 *
 * 覆盖（对应设计 §7.3 第 4 项的三条 + 派生的边界）：
 *   ① 7 张新表逐列（`PRAGMA table_info`：名 / 类型 / 可空性 / 默认值 / 主键序号）
 *   ② 全部 14 处外键的 `onDelete`（2 处 Restrict + 12 处 Cascade）与复合外键的列序
 *   ③ 删任务 → `UmlDiagramTask` 关联行消失，且既有 `DELETE /tasks/:taskId`（端点 29）语义不变
 *   ④ 删节点 → 其边消失
 *   ⑤ 跨图建边被数据库拒绝（P2003）
 *   ⑥ `seq = null` 的多条边可共存；`(diagramId, seq)` 重复被拒（P2002）
 *
 * 列序注意（设计 §7.4）：本批是纯 `CREATE TABLE`，物理列序 = 迁移 SQL 的 `CREATE TABLE`
 * 语句顺序 = `schema.prisma` 字段顺序。若将来有人对 `UmlNode` 等做 `ALTER TABLE ADD COLUMN`
 * （例如加坐标），新列会物理落在末尾，届时必须同步改本文件的列断言。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, type HttpTestContext } from '../../../test/helpers.js'
import {
  makeActivity,
  makeGoal,
  makeMember,
  makeProject,
  makeStory,
  makeTask,
  makeUser,
} from '../../../test/factories.js'

let ctx: HttpTestContext

beforeAll(async () => {
  ctx = await createTestContext()
}, 120_000)

afterAll(async () => {
  await ctx.dispose()
})

beforeEach(async () => {
  await ctx.reset()
})

// ---------------------------------------------------------------------------
// PRAGMA 读取助手（分组处理复合外键：SQLite 为复合外键的每一列各返回一行）
// ---------------------------------------------------------------------------

type ColumnSpec = { name: string; type: string; notNull: boolean; def: string | null; pk: number }

type RawColumn = {
  name: string
  type: string
  notnull: number | bigint
  dflt_value: string | null
  pk: number | bigint
}

async function getColumns(table: string): Promise<ColumnSpec[]> {
  const rows = await ctx.db.$queryRawUnsafe<RawColumn[]>(
    `PRAGMA table_info(${JSON.stringify(table)})`,
  )
  return rows.map((r) => ({
    name: r.name,
    type: r.type.toUpperCase(),
    notNull: Number(r.notnull) === 1,
    def: r.dflt_value,
    pk: Number(r.pk),
  }))
}

type FkSpec = { from: string[]; table: string; to: string[]; onDelete: string }

type RawFk = {
  id: number | bigint
  seq: number | bigint
  table: string
  from: string
  to: string
  on_delete: string
}

/** 按外键 id 分组：复合外键在 PRAGMA 里是「一列一行」，必须合回一条。 */
async function getFks(table: string): Promise<FkSpec[]> {
  const rows = await ctx.db.$queryRawUnsafe<RawFk[]>(
    `PRAGMA foreign_key_list(${JSON.stringify(table)})`,
  )
  const groups = new Map<number, RawFk[]>()
  for (const row of rows) {
    const id = Number(row.id)
    const bucket = groups.get(id) ?? []
    bucket.push(row)
    groups.set(id, bucket)
  }
  return [...groups.values()]
    .map((group) => {
      const ordered = [...group].sort((a, b) => Number(a.seq) - Number(b.seq))
      return {
        from: ordered.map((r) => r.from),
        table: ordered[0]!.table,
        to: ordered.map((r) => r.to),
        onDelete: ordered[0]!.on_delete,
      }
    })
    .sort((a, b) => a.from.join(',').localeCompare(b.from.join(',')))
}

type IndexInfo = { name: string; unique: boolean; origin: string; columns: string[] }
type RawIndex = { name: string; unique: number | bigint; origin: string }
type RawIndexColumn = { name: string | null }

async function getIndexes(table: string): Promise<IndexInfo[]> {
  const rows = await ctx.db.$queryRawUnsafe<RawIndex[]>(
    `PRAGMA index_list(${JSON.stringify(table)})`,
  )
  const result: IndexInfo[] = []
  for (const row of rows) {
    const cols = await ctx.db.$queryRawUnsafe<RawIndexColumn[]>(
      `PRAGMA index_info(${JSON.stringify(row.name)})`,
    )
    result.push({
      name: row.name,
      unique: Number(row.unique) === 1,
      origin: row.origin,
      columns: cols.map((c) => c.name ?? ''),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// 造数助手（直接写库；接口断言另见 ③）
// ---------------------------------------------------------------------------

async function makeDiagram(
  projectId: string,
  ownerUserId: string,
  kind: 'USECASE' | 'SEQUENCE' = 'USECASE',
  title = '测试图',
): Promise<string> {
  const diagram = await ctx.db.umlDiagram.create({
    data: { projectId, ownerUserId, kind, title },
    select: { id: true },
  })
  return diagram.id
}

async function makeNode(
  diagramId: string,
  nodeType = 'ACTOR',
  name = '节点',
  orderIndex = 0,
): Promise<string> {
  const node = await ctx.db.umlNode.create({
    data: { diagramId, nodeType, name, orderIndex },
    select: { id: true },
  })
  return node.id
}

async function makeEdge(params: {
  diagramId: string
  sourceNodeId: string
  targetNodeId: string
  edgeType?: string
  seq?: number | null
  label?: string | null
}): Promise<string> {
  const edge = await ctx.db.umlEdge.create({
    data: {
      diagramId: params.diagramId,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      edgeType: params.edgeType ?? 'ASSOCIATION',
      seq: params.seq ?? null,
      label: params.label ?? null,
    },
    select: { id: true },
  })
  return edge.id
}

/** 项目 + 目标 + 活动 + 故事（走契约工厂，保证 projectId 由父级推导）。 */
async function seedProjectTree(pmId: string): Promise<{
  projectId: string
  goalId: string
  activityId: string
  storyId: string
}> {
  const { projectId } = await makeProject(pmId)
  const goalId = await makeGoal(projectId)
  const activityId = await makeActivity(goalId)
  const storyId = await makeStory(activityId)
  return { projectId, goalId, activityId, storyId }
}

// ---------------------------------------------------------------------------
// ① 7 张新表逐列（PRAGMA table_info）
// ---------------------------------------------------------------------------

describe('UML 新表逐列结构（PRAGMA table_info）', () => {
  it('UmlDiagram：9 列（含 everRestricted guard），主键 id，createdAt/updatedAt 为 DATETIME', async () => {
    expect(await getColumns('UmlDiagram')).toEqual([
      { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
      { name: 'projectId', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'kind', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'title', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'description', type: 'TEXT', notNull: false, def: null, pk: 0 },
      { name: 'ownerUserId', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
      { name: 'updatedAt', type: 'DATETIME', notNull: true, def: null, pk: 0 },
      // ★ 持久「曾经受限」guard（DECISIONS `uml.no-auto-declassification-guard`，2026-10-21 裁定 A）：
      //   默认 false、非空；一旦置位永不自动清除，非 PM 读一律 404。
      { name: 'everRestricted', type: 'BOOLEAN', notNull: true, def: 'false', pk: 0 },
    ])
  })

  it('UmlNode：6 列，orderIndex 为 INTEGER 默认 0（序，不是坐标）', async () => {
    expect(await getColumns('UmlNode')).toEqual([
      { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
      { name: 'diagramId', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'nodeType', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'name', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'orderIndex', type: 'INTEGER', notNull: true, def: '0', pk: 0 },
      { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
    ])
  })

  it('UmlEdge：8 列，label 与 seq 可空（用例图 seq 恒 null）', async () => {
    expect(await getColumns('UmlEdge')).toEqual([
      { name: 'id', type: 'TEXT', notNull: true, def: null, pk: 1 },
      { name: 'diagramId', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'edgeType', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'sourceNodeId', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'targetNodeId', type: 'TEXT', notNull: true, def: null, pk: 0 },
      { name: 'label', type: 'TEXT', notNull: false, def: null, pk: 0 },
      { name: 'seq', type: 'INTEGER', notNull: false, def: null, pk: 0 },
      { name: 'createdAt', type: 'DATETIME', notNull: true, def: 'CURRENT_TIMESTAMP', pk: 0 },
    ])
  })

  it('4 张关联表都是两列复合主键（diagramId 为第 1 列）', async () => {
    const expected: Record<string, string> = {
      UmlDiagramGoal: 'goalId',
      UmlDiagramActivity: 'activityId',
      UmlDiagramStory: 'storyId',
      UmlDiagramTask: 'taskId',
    }
    for (const [table, other] of Object.entries(expected)) {
      expect(await getColumns(table)).toEqual([
        { name: 'diagramId', type: 'TEXT', notNull: true, def: null, pk: 1 },
        { name: other, type: 'TEXT', notNull: true, def: null, pk: 2 },
      ])
    }
  })

  it('UmlNode 有 UNIQUE (diagramId, id) —— 复合外键的引用目标；无 (diagramId, orderIndex) 唯一约束', async () => {
    const indexes = await getIndexes('UmlNode')
    const uniques = indexes.filter((i) => i.unique && i.origin === 'c')
    expect(uniques.map((i) => i.columns.join(','))).toEqual(['diagramId,id'])
    // 用例图所有节点 orderIndex = 0，若加了唯一约束会直接撞车（设计 §3.3）
    expect(indexes.some((i) => i.columns.join(',') === 'diagramId,orderIndex')).toBe(false)
  })

  it('UmlEdge 有 UNIQUE (diagramId, seq) 与 3 个索引（diagramId / sourceNodeId / targetNodeId）', async () => {
    const indexes = await getIndexes('UmlEdge')
    const uniques = indexes.filter((i) => i.unique && i.origin === 'c')
    expect(uniques.map((i) => i.columns.join(','))).toEqual(['diagramId,seq'])
    const plain = indexes.filter((i) => !i.unique && i.origin === 'c')
    expect(plain.map((i) => i.columns.join(',')).sort()).toEqual(
      ['diagramId', 'sourceNodeId', 'targetNodeId'].sort(),
    )
  })

  it('UmlDiagram 有 @@index([projectId, kind])、@@index([ownerUserId]) 与 guard 索引', async () => {
    const indexes = await getIndexes('UmlDiagram')
    const plain = indexes.filter((i) => !i.unique && i.origin === 'c')
    expect(plain.map((i) => i.columns.join(',')).sort()).toEqual(
      ['ownerUserId', 'projectId,kind', 'projectId,kind,everRestricted'].sort(),
    )
  })

  it('4 张关联表各有对「被关联对象」侧的单列索引', async () => {
    const expected: Record<string, string> = {
      UmlDiagramGoal: 'goalId',
      UmlDiagramActivity: 'activityId',
      UmlDiagramStory: 'storyId',
      UmlDiagramTask: 'taskId',
    }
    for (const [table, column] of Object.entries(expected)) {
      const plain = (await getIndexes(table)).filter((i) => !i.unique && i.origin === 'c')
      expect(plain.map((i) => i.columns.join(','))).toEqual([column])
    }
  })
})

// ---------------------------------------------------------------------------
// ② 全部 14 处外键与 onDelete 语义
// ---------------------------------------------------------------------------

describe('UML 新表外键与 ON DELETE 规则', () => {
  it('UmlDiagram：projectId / ownerUserId 两处均 RESTRICT', async () => {
    expect(await getFks('UmlDiagram')).toEqual([
      { from: ['ownerUserId'], table: 'User', to: ['id'], onDelete: 'RESTRICT' },
      { from: ['projectId'], table: 'Project', to: ['id'], onDelete: 'RESTRICT' },
    ])
  })

  it('UmlNode：diagramId → UmlDiagram CASCADE', async () => {
    expect(await getFks('UmlNode')).toEqual([
      { from: ['diagramId'], table: 'UmlDiagram', to: ['id'], onDelete: 'CASCADE' },
    ])
  })

  it('UmlEdge：3 处 CASCADE，且两端是**复合外键** (diagramId, source/targetNodeId) → UmlNode(diagramId, id)', async () => {
    expect(await getFks('UmlEdge')).toEqual([
      { from: ['diagramId'], table: 'UmlDiagram', to: ['id'], onDelete: 'CASCADE' },
      {
        from: ['diagramId', 'sourceNodeId'],
        table: 'UmlNode',
        to: ['diagramId', 'id'],
        onDelete: 'CASCADE',
      },
      {
        from: ['diagramId', 'targetNodeId'],
        table: 'UmlNode',
        to: ['diagramId', 'id'],
        onDelete: 'CASCADE',
      },
    ])
  })

  it('4 张关联表：两端均 CASCADE（共 8 处）', async () => {
    const expected: Record<string, { column: string; table: string }> = {
      UmlDiagramGoal: { column: 'goalId', table: 'BusinessGoal' },
      UmlDiagramActivity: { column: 'activityId', table: 'UserActivity' },
      UmlDiagramStory: { column: 'storyId', table: 'UserStory' },
      UmlDiagramTask: { column: 'taskId', table: 'Task' },
    }
    for (const [table, other] of Object.entries(expected)) {
      // getFks 按 from 列名排序，故期望值也按 from 排序后比对
      const expectedFks = [
        { from: ['diagramId'], table: 'UmlDiagram', to: ['id'], onDelete: 'CASCADE' },
        { from: [other.column], table: other.table, to: ['id'], onDelete: 'CASCADE' },
      ].sort((a, b) => a.from.join(',').localeCompare(b.from.join(',')))
      expect(await getFks(table)).toEqual(expectedFks)
    }
  })

  it('7 张新表外键合计 14 处 = 2 处 RESTRICT + 12 处 CASCADE（设计 §3.6 全表）', async () => {
    const tables = [
      'UmlDiagram',
      'UmlNode',
      'UmlEdge',
      'UmlDiagramGoal',
      'UmlDiagramActivity',
      'UmlDiagramStory',
      'UmlDiagramTask',
    ]
    const all: FkSpec[] = []
    for (const table of tables) all.push(...(await getFks(table)))

    expect(all).toHaveLength(14)
    expect(all.filter((f) => f.onDelete === 'RESTRICT')).toHaveLength(2)
    expect(all.filter((f) => f.onDelete === 'CASCADE')).toHaveLength(12)
  })
})

// ---------------------------------------------------------------------------
// ② 行为级：RESTRICT（图 → 项目 / 负责人）
// ---------------------------------------------------------------------------

describe('删除保护：图 → 项目 / 负责人 Restrict', () => {
  it('项目下有 UML 图时，删除项目被数据库拒绝（P2003），图仍在', async () => {
    const pm = await makeUser('pm-restrict-project')
    const { projectId } = await makeProject(pm.id)
    const diagramId = await makeDiagram(projectId, pm.id)

    await expect(ctx.db.project.delete({ where: { id: projectId } })).rejects.toMatchObject({
      code: 'P2003',
    })
    expect(await ctx.db.umlDiagram.count({ where: { id: diagramId } })).toBe(1)

    // 反事实对照：移除图后，同一次 delete 调用必须成功（证明上面的拒绝确由该外键引起）
    await ctx.db.umlDiagram.delete({ where: { id: diagramId } })
    await expect(ctx.db.project.delete({ where: { id: projectId } })).resolves.toMatchObject({
      id: projectId,
    })
  })

  it('用户是某图的负责人时，删除该用户被拒绝（P2003）', async () => {
    const pm = await makeUser('pm-restrict-owner')
    const { projectId } = await makeProject(pm.id)
    await makeDiagram(projectId, pm.id)

    await expect(ctx.db.user.delete({ where: { id: pm.id } })).rejects.toMatchObject({
      code: 'P2003',
    })
  })
})

// ---------------------------------------------------------------------------
// ②③④ 行为级：CASCADE
// ---------------------------------------------------------------------------

describe('级联删除：图内容与关联行', () => {
  it('删图 → 节点 / 边 / 4 类关联行全部消失（DB 级联，不需要手写清理）', async () => {
    const pm = await makeUser('pm-cascade-diagram')
    const member = await makeUser('member-cascade-diagram')
    await makeMember((await makeProject(pm.id)).projectId, member.id)
    const { projectId, goalId, activityId, storyId } = await seedProjectTree(pm.id)
    const taskId = await makeTask(storyId, pm.id, member.id)

    const diagramId = await makeDiagram(projectId, pm.id)
    const actorId = await makeNode(diagramId, 'ACTOR', '参与者')
    const usecaseId = await makeNode(diagramId, 'USECASE', '用例')
    await makeEdge({ diagramId, sourceNodeId: actorId, targetNodeId: usecaseId })
    await ctx.db.umlDiagramGoal.create({ data: { diagramId, goalId } })
    await ctx.db.umlDiagramActivity.create({ data: { diagramId, activityId } })
    await ctx.db.umlDiagramStory.create({ data: { diagramId, storyId } })
    await ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } })

    await ctx.db.umlDiagram.delete({ where: { id: diagramId } })

    expect(await ctx.db.umlNode.count({ where: { diagramId } })).toBe(0)
    expect(await ctx.db.umlEdge.count({ where: { diagramId } })).toBe(0)
    expect(await ctx.db.umlDiagramGoal.count({ where: { diagramId } })).toBe(0)
    expect(await ctx.db.umlDiagramActivity.count({ where: { diagramId } })).toBe(0)
    expect(await ctx.db.umlDiagramStory.count({ where: { diagramId } })).toBe(0)
    expect(await ctx.db.umlDiagramTask.count({ where: { diagramId } })).toBe(0)
    // 关联的业务对象本身不受影响
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(1)
    expect(await ctx.db.userStory.count({ where: { id: storyId } })).toBe(1)
  })

  it('删节点 → 其出边与入边都被级联删除，另一节点的边保留', async () => {
    const pm = await makeUser('pm-cascade-node')
    const { projectId } = await makeProject(pm.id)
    const diagramId = await makeDiagram(projectId, pm.id)

    const a = await makeNode(diagramId, 'ACTOR', 'A')
    const b = await makeNode(diagramId, 'USECASE', 'B')
    const c = await makeNode(diagramId, 'USECASE', 'C')
    const ab = await makeEdge({ diagramId, sourceNodeId: a, targetNodeId: b })
    const ba = await makeEdge({ diagramId, sourceNodeId: b, targetNodeId: a, edgeType: 'INCLUDE' })
    const bc = await makeEdge({ diagramId, sourceNodeId: b, targetNodeId: c, edgeType: 'EXTEND' })

    await ctx.db.umlNode.delete({ where: { id: a } })

    expect(await ctx.db.umlEdge.count({ where: { id: { in: [ab, ba] } } })).toBe(0)
    expect(await ctx.db.umlEdge.count({ where: { id: bc } })).toBe(1)
  })

  it('删关联对象：任务 / 故事 / 活动 / 目标被删时其关联行消失', async () => {
    const pm = await makeUser('pm-cascade-targets')
    const member = await makeUser('member-cascade-targets')
    const { projectId, goalId, activityId, storyId } = await seedProjectTree(pm.id)
    await makeMember(projectId, member.id)
    const taskId = await makeTask(storyId, pm.id, member.id)

    const diagramId = await makeDiagram(projectId, pm.id)
    await ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } })
    await ctx.db.umlDiagramStory.create({ data: { diagramId, storyId } })
    await ctx.db.umlDiagramActivity.create({ data: { diagramId, activityId } })
    await ctx.db.umlDiagramGoal.create({ data: { diagramId, goalId } })

    await ctx.db.task.delete({ where: { id: taskId } })
    expect(await ctx.db.umlDiagramTask.count({ where: { diagramId } })).toBe(0)

    // 故事被删会连带其任务（Restrict 于 Task.storyId ⇒ 先删任务已在上一步完成）
    await ctx.db.userStory.delete({ where: { id: storyId } })
    expect(await ctx.db.umlDiagramStory.count({ where: { diagramId } })).toBe(0)

    await ctx.db.userActivity.delete({ where: { id: activityId } })
    expect(await ctx.db.umlDiagramActivity.count({ where: { diagramId } })).toBe(0)

    await ctx.db.businessGoal.delete({ where: { id: goalId } })
    expect(await ctx.db.umlDiagramGoal.count({ where: { diagramId } })).toBe(0)

    // 图本身不受关联对象删除影响（不自动降密、不自动删图）
    expect(await ctx.db.umlDiagram.count({ where: { id: diagramId } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// ③ 删任务 → 关联行消失，且既有 DELETE /tasks/:taskId 语义不变
// ---------------------------------------------------------------------------

describe('端点 29（DELETE /tasks/:taskId）语义不变', () => {
  it('任务被 UML 图关联后，PM 删除该任务仍返回 204（不因 UML 关联变 409），关联行随之消失', async () => {
    const pm = await makeUser('pm-task-delete')
    const member = await makeUser('member-task-delete')
    const { projectId, storyId } = await seedProjectTree(pm.id)
    await makeMember(projectId, member.id)
    const taskId = await makeTask(storyId, pm.id, member.id)

    const diagramId = await makeDiagram(projectId, pm.id)
    await ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } })
    expect(await ctx.db.umlDiagramTask.count({ where: { diagramId, taskId } })).toBe(1)

    const res = await ctx.asUser(ctx.loginAs(pm.id)).delete(`/tasks/${taskId}`)

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(await ctx.db.task.count({ where: { id: taskId } })).toBe(0)
    // 关键断言：关联行被 DB 级联清理，无需端点 29 做任何改动
    expect(await ctx.db.umlDiagramTask.count({ where: { diagramId } })).toBe(0)
    // 图仍在（删任务不会删图）
    expect(await ctx.db.umlDiagram.count({ where: { id: diagramId } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// ⑤ 跨图建边被数据库拒绝
// ---------------------------------------------------------------------------

describe('边同图约束（复合外键兜底）', () => {
  it('A 图的边指向 B 图的节点 → P2003（写入层漏检也不可能落库）', async () => {
    const pm = await makeUser('pm-cross-diagram')
    const { projectId } = await makeProject(pm.id)
    const diagramA = await makeDiagram(projectId, pm.id, 'USECASE', '图 A')
    const diagramB = await makeDiagram(projectId, pm.id, 'USECASE', '图 B')

    const aNode = await makeNode(diagramA, 'ACTOR', 'A 图参与者')
    const bNode = await makeNode(diagramB, 'USECASE', 'B 图用例')

    // 同图建边正常
    const aUsecase = await makeNode(diagramA, 'USECASE', 'A 图用例')
    await expect(
      makeEdge({ diagramId: diagramA, sourceNodeId: aNode, targetNodeId: aUsecase }),
    ).resolves.toEqual(expect.any(String))

    // 跨图建边被数据库直接拒绝
    await expect(
      makeEdge({ diagramId: diagramA, sourceNodeId: aNode, targetNodeId: bNode }),
    ).rejects.toMatchObject({ code: 'P2003' })

    expect(await ctx.db.umlEdge.count({ where: { diagramId: diagramA } })).toBe(1)
  })

  it('自环边（source = target）数据库**接受**（拒绝责任在写入层，设计 §3.7）', async () => {
    const pm = await makeUser('pm-self-loop')
    const { projectId } = await makeProject(pm.id)
    const diagramId = await makeDiagram(projectId, pm.id, 'SEQUENCE', '时序图')
    const lifeline = await makeNode(diagramId, 'LIFELINE', '生命线', 0)

    await expect(
      makeEdge({ diagramId, sourceNodeId: lifeline, targetNodeId: lifeline, edgeType: 'SYNC', seq: 1 }),
    ).resolves.toEqual(expect.any(String))
  })
})

// ---------------------------------------------------------------------------
// ⑥ seq 唯一性语义
// ---------------------------------------------------------------------------

describe('seq 唯一约束的语义边界', () => {
  it('多条 seq = null 的边可共存（用例图多边的前提）', async () => {
    const pm = await makeUser('pm-seq-null')
    const { projectId } = await makeProject(pm.id)
    const diagramId = await makeDiagram(projectId, pm.id, 'USECASE', '用例图')
    const a = await makeNode(diagramId, 'ACTOR', 'A')
    const u1 = await makeNode(diagramId, 'USECASE', 'U1')
    const u2 = await makeNode(diagramId, 'USECASE', 'U2')

    await makeEdge({ diagramId, sourceNodeId: a, targetNodeId: u1 })
    await makeEdge({ diagramId, sourceNodeId: a, targetNodeId: u2 })

    const rows = await ctx.db.umlEdge.findMany({ where: { diagramId }, select: { seq: true } })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.seq === null)).toBe(true)
  })

  it('同一图内 (diagramId, seq) 重复被拒（P2002）；不同图可复用同一 seq', async () => {
    const pm = await makeUser('pm-seq-dup')
    const { projectId } = await makeProject(pm.id)
    const d1 = await makeDiagram(projectId, pm.id, 'SEQUENCE', '时序图 1')
    const d2 = await makeDiagram(projectId, pm.id, 'SEQUENCE', '时序图 2')

    const l1 = await makeNode(d1, 'LIFELINE', 'L1', 0)
    const l2 = await makeNode(d1, 'LIFELINE', 'L2', 1)
    await makeEdge({ diagramId: d1, sourceNodeId: l1, targetNodeId: l2, edgeType: 'SYNC', seq: 1 })
    await expect(
      makeEdge({ diagramId: d1, sourceNodeId: l2, targetNodeId: l1, edgeType: 'RETURN', seq: 1 }),
    ).rejects.toMatchObject({ code: 'P2002' })

    // 跨图同一 seq 合法（唯一约束带 diagramId 前缀）
    const m1 = await makeNode(d2, 'LIFELINE', 'M1', 0)
    const m2 = await makeNode(d2, 'LIFELINE', 'M2', 1)
    await expect(
      makeEdge({ diagramId: d2, sourceNodeId: m1, targetNodeId: m2, edgeType: 'SYNC', seq: 1 }),
    ).resolves.toEqual(expect.any(String))
  })

  it('时序图允许同 (source, target, edgeType) 的重复边（不同 seq）—— 不建 DB 唯一约束', async () => {
    const pm = await makeUser('pm-seq-repeat')
    const { projectId } = await makeProject(pm.id)
    const diagramId = await makeDiagram(projectId, pm.id, 'SEQUENCE', '时序图')
    const l1 = await makeNode(diagramId, 'LIFELINE', 'L1', 0)
    const l2 = await makeNode(diagramId, 'LIFELINE', 'L2', 1)

    await makeEdge({ diagramId, sourceNodeId: l1, targetNodeId: l2, edgeType: 'SYNC', seq: 1 })
    await expect(
      makeEdge({ diagramId, sourceNodeId: l1, targetNodeId: l2, edgeType: 'SYNC', seq: 2 }),
    ).resolves.toEqual(expect.any(String))
  })
})

// ---------------------------------------------------------------------------
// 关联表复合主键去重
// ---------------------------------------------------------------------------

describe('关联表复合主键去重', () => {
  it('同一 (diagramId, taskId) 插入两次被拒（P2002）', async () => {
    const pm = await makeUser('pm-link-dup')
    const member = await makeUser('member-link-dup')
    const { projectId, storyId } = await seedProjectTree(pm.id)
    await makeMember(projectId, member.id)
    const taskId = await makeTask(storyId, pm.id, member.id)
    const diagramId = await makeDiagram(projectId, pm.id)

    await ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } })
    await expect(
      ctx.db.umlDiagramTask.create({ data: { diagramId, taskId } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})
