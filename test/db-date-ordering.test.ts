/**
 * planStart / planEnd 的 TEXT('YYYY-MM-DD') 排序语义验证（T0-02 对抗性验证）
 *
 * 契约决策 I-10 规定：`planStart` / `planEnd` 只接受 `YYYY-MM-DD` 字符串。
 * 选择该格式的前提是「字典序 == 时间序」。若不成立，端点 24 / 26 的
 * 「按 planStart 升序」就是契约级缺陷。本文件用真实入库 + 数据库排序来验证。
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

async function makeTaskGraph() {
  const owner = await db.prisma.user.create({
    data: { account: unique('owner'), displayName: 'owner', passwordHash: 'h' },
  })
  const acceptor = await db.prisma.user.create({
    data: { account: unique('acceptor'), displayName: 'acceptor', passwordHash: 'h' },
  })
  const project = await db.prisma.project.create({ data: { name: unique('project'), ownerUserId: owner.id } })
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
  return { project, story, owner, acceptor }
}

const DATES = [
  '2026-12-31',
  '2026-01-05',
  '2027-01-01',
  '2026-02-28',
  '2026-09-19',
  '2026-01-10',
  '2026-10-09',
  '2026-02-01',
]

describe('planStart / planEnd 的字典序 == 时间序', () => {
  it('有效零填充日期：数据库 ORDER BY planStart ASC 与时间序完全一致', async () => {
    const { project, story, owner, acceptor } = await makeTaskGraph()

    for (const date of DATES) {
      await db.prisma.task.create({
        data: {
          projectId: project.id,
          storyId: story.id,
          title: `task-${date}`,
          ownerUserId: owner.id,
          acceptorUserId: acceptor.id,
          planStart: date,
          planEnd: date,
        },
      })
    }

    const rows = await db.prisma.task.findMany({
      orderBy: { planStart: 'asc' },
      select: { planStart: true },
    })
    const dbOrder = rows.map((r) => r.planStart)

    const lexOrder = [...DATES].sort()
    const chronoOrder = [...DATES].sort(
      (a, b) => new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime(),
    )

    expect(dbOrder).toEqual(lexOrder)
    expect(lexOrder).toEqual(chronoOrder)
  })

  it('planEnd 同样满足字典序 == 时间序，且跨年、跨闰日边界正确', async () => {
    const dates = ['2024-02-29', '2024-03-01', '2025-12-31', '2026-01-01', '2026-02-28']
    const { project, story, owner, acceptor } = await makeTaskGraph()

    for (const date of dates) {
      await db.prisma.task.create({
        data: {
          projectId: project.id,
          storyId: story.id,
          title: `task-${date}`,
          ownerUserId: owner.id,
          acceptorUserId: acceptor.id,
          planStart: '2024-01-01',
          planEnd: date,
        },
      })
    }

    const rows = await db.prisma.task.findMany({
      orderBy: { planEnd: 'asc' },
      select: { planEnd: true },
    })
    const dbOrder = rows.map((r) => r.planEnd)
    expect(dbOrder).toEqual([...dates].sort())
    expect(dbOrder).toEqual([...dates].sort((a, b) => new Date(a).getTime() - new Date(b).getTime()))
  })

  it('文档化依赖：非零填充日期会破坏字典序，故格式必须由 Zod 校验保证（DB 不强制）', () => {
    // 这是「选择字符串存储」的已知前提：数据库不校验格式，Zod 的
    // /^\d{4}-\d{2}-\d{2}$/ 才是该格式保证的唯一来源。
    const nonPadded = ['2026-1-5', '2026-10-01', '2026-2-1']
    const lexOrder = [...nonPadded].sort()
    const chronoOrder = [...nonPadded].sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    expect(lexOrder).not.toEqual(chronoOrder)
  })
})
