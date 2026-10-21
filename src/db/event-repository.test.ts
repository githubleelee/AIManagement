/**
 * #37 领域事件数据库仓储适配器测试（ROLE-B）
 *
 * 覆盖公共接入要求：
 *   ① P2002 → `DUPLICATE` 且返回已有事件；
 *   ② 重复 publish 语义（同幂等键、不同 payload 只去重，不重投）；
 *   ③ **查询层**对象级可见性过滤（成员看不到敏感 task 的事件；PM 全量；不可见与不存在同一条）；
 *   ④ 时间范围用原生比较（`+08:00` 输入归一化为 UTC，不被字符串字典序静默算错）；
 *   ⑤ 事务上下文（在调用方事务内 append，回滚后事件不落库）；
 *   ⑥ `src/app.ts` 的组装注入与生命周期。
 * 另含 `src/shared/events.ts` 的端口形状编译期断言。
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import type {
  DomainEventEnvelope,
  DomainEventInfrastructurePort,
  DomainEventPublisherPort,
  EventAuthorizationPort,
  EventQuery,
  EventRepositoryPort,
  JsonObject,
  PublishEventInput,
} from '../shared/events.js'
import { buildApp } from '../app.js'
import {
  PrismaEventRepository,
  createEventAuthorizationPort,
} from './event-repository.js'
import {
  createTempDatabase,
  resetDatabase,
  type TestDatabase,
} from './test-support.js'
import { createDomainEventInfrastructure } from '../modules/events/factory.js'

let db: TestDatabase
let repo: PrismaEventRepository
let authz: EventAuthorizationPort

beforeAll(() => {
  db = createTempDatabase()
}, 120_000)

afterAll(async () => {
  await db.dispose()
})

beforeEach(async () => {
  await resetDatabase(db.prisma)
  repo = new PrismaEventRepository(db.prisma)
  authz = createEventAuthorizationPort(db.prisma)
})

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

let seq = 0
function unique(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

async function makeUser() {
  const account = unique('user')
  return db.prisma.user.create({
    data: { account, displayName: account, passwordHash: 'hash' },
  })
}

async function makeProject(ownerUserId: string) {
  return db.prisma.project.create({ data: { name: unique('project'), ownerUserId } })
}

async function addMember(projectId: string, userId: string, role: 'PM' | 'MEMBER' | 'VIEWER') {
  await db.prisma.projectMember.create({ data: { projectId, userId, role } })
}

/** 造一条完整需求链并返回 task（`isSensitive` 可指定）。 */
async function makeTask(
  projectId: string,
  ownerUserId: string,
  acceptorUserId: string,
  isSensitive = false,
) {
  const goal = await db.prisma.businessGoal.create({
    data: { projectId, name: unique('goal'), sortOrder: 1 },
  })
  const activity = await db.prisma.userActivity.create({
    data: { projectId, goalId: goal.id, name: unique('activity'), sortOrder: 1 },
  })
  const story = await db.prisma.userStory.create({
    data: {
      projectId,
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
      projectId,
      storyId: story.id,
      title: unique('task'),
      ownerUserId,
      acceptorUserId,
      planStart: '2026-01-01',
      planEnd: '2026-01-02',
      isSensitive,
    },
  })
  return task
}

type EnvelopeOverrides = Partial<Omit<DomainEventEnvelope, 'sensitive' | 'payload'>> & {
  sensitive?: boolean
  payload?: unknown
}

/** 造一个非敏感信封（默认 `storedAt = occurredAt`）。 */
function makeEnvelope(
  projectId: string,
  actorUserId: string,
  object: { objectType: string; objectId: string },
  overrides: EnvelopeOverrides = {},
): DomainEventEnvelope {
  const occurredAt = overrides.occurredAt ?? '2026-01-01T00:00:00.000Z'
  return {
    id: overrides.id ?? randomUUID(),
    schemaVersion: 1,
    eventName: overrides.eventName ?? 'task.progress',
    projectId,
    object,
    actor: overrides.actor ?? { kind: 'USER', userId: actorUserId },
    occurredAt,
    storedAt: overrides.storedAt ?? occurredAt,
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    ...(overrides.correlationId === undefined ? {} : { correlationId: overrides.correlationId }),
    ...(overrides.causationId === undefined ? {} : { causationId: overrides.causationId }),
    sensitive: false,
    payload: (overrides.payload ?? { progress: 50 }) as JsonObject,
  }
}

/** 造一个敏感信封（payload 只能是 `references`）。 */
function makeSensitiveEnvelope(
  projectId: string,
  actorUserId: string,
  object: { objectType: string; objectId: string },
  references: Array<{ objectType: string; objectId: string }>,
  overrides: EnvelopeOverrides = {},
): DomainEventEnvelope {
  const occurredAt = overrides.occurredAt ?? '2026-01-01T00:00:00.000Z'
  return {
    id: overrides.id ?? randomUUID(),
    schemaVersion: 1,
    eventName: overrides.eventName ?? 'task.progress',
    projectId,
    object,
    actor: overrides.actor ?? { kind: 'USER', userId: actorUserId },
    occurredAt,
    storedAt: overrides.storedAt ?? occurredAt,
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    sensitive: true,
    payload: { references },
  }
}

// ---------------------------------------------------------------------------
// ① 幂等：P2002 → DUPLICATE 且返回已有事件
// ---------------------------------------------------------------------------

describe('appendIfAbsent 幂等', () => {
  it('同幂等键第二次追加 → DUPLICATE，并返回第一次的事件（不是新 payload）', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const task = await makeTask(project.id, owner.id, owner.id)

    const first = makeEnvelope(project.id, owner.id, { objectType: 'task', objectId: task.id }, {
      idempotencyKey: 'same-key',
      payload: { progress: 10 },
    })
    const second = makeEnvelope(project.id, owner.id, { objectType: 'task', objectId: task.id }, {
      idempotencyKey: 'same-key',
      payload: { progress: 99 },
    })

    const appended = await repo.appendIfAbsent(first)
    expect(appended.kind).toBe('APPENDED')

    const duplicate = await repo.appendIfAbsent(second)
    expect(duplicate.kind).toBe('DUPLICATE')
    expect(duplicate.event.id).toBe(first.id)
    expect(duplicate.event.payload).toEqual({ progress: 10 })
    // 只落库一条
    expect(await db.prisma.domainEvent.count()).toBe(1)
  })

  it('唯一约束由数据库兜底（直接插入同 (projectId,eventName,idempotencyKey) 得 P2002）', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const task = await makeTask(project.id, owner.id, owner.id)
    const event = makeEnvelope(project.id, owner.id, { objectType: 'task', objectId: task.id })
    await repo.appendIfAbsent(event)
    await expect(
      db.prisma.domainEvent.create({
        data: {
          id: randomUUID(),
          schemaVersion: 1,
          eventName: event.eventName,
          projectId: project.id,
          objectType: 'task',
          objectId: task.id,
          actorKind: 'USER',
          actorUserId: owner.id,
          occurredAt: new Date(event.occurredAt),
          storedAt: new Date(event.storedAt),
          idempotencyKey: event.idempotencyKey,
          sensitive: false,
          payload: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})

// ---------------------------------------------------------------------------
// ② 重复 publish 语义（经 D 的 service + 本仓储）
// ---------------------------------------------------------------------------

describe('重复 publish 只去重、不重投', () => {
  it('同幂等键、不同 payload 只去重；deliveries 为空', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const task = await makeTask(project.id, owner.id, owner.id)

    const infrastructure = createDomainEventInfrastructure({ repository: repo, authorization: authz })
    await infrastructure.start()

    const deliveries: string[] = []
    infrastructure.subscribe('task.progress', 'probe', (event) => {
      deliveries.push(event.id)
    })

    const input: PublishEventInput = {
      eventName: 'task.progress',
      projectId: project.id,
      object: { objectType: 'task', objectId: task.id },
      actor: { kind: 'USER', userId: owner.id },
      occurredAt: '2026-01-01T00:00:00.000Z',
      idempotencyKey: 'publish-key',
      sensitive: false,
      payload: { progress: 20 },
    }

    const first = await infrastructure.publish(input)
    expect(first.persistence).toBe('APPENDED')
    expect(first.deliveries).toHaveLength(1)

    const second = await infrastructure.publish({ ...input, payload: { progress: 80 } })
    expect(second.persistence).toBe('DUPLICATE')
    expect(second.event.id).toBe(first.event.id)
    expect(second.event.payload).toEqual({ progress: 20 })
    expect(second.deliveries).toEqual([]) // 重复发布不重投
    expect(deliveries).toEqual([first.event.id]) // 订阅者只被调用一次

    await infrastructure.stop()
  })
})

// ---------------------------------------------------------------------------
// ③ 查询层可见性过滤（契约 I-6）
// ---------------------------------------------------------------------------

describe('query 的查询层可见性过滤', () => {
  it('成员看不到不可见敏感 task 的事件；PM 看全量', async () => {
    const pm = await makeUser()
    const member = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    await addMember(project.id, member.id, 'MEMBER')

    const normalTask = await makeTask(project.id, pm.id, pm.id, false)
    const whitelistedSensitive = await makeTask(project.id, pm.id, pm.id, true)
    const hiddenSensitive = await makeTask(project.id, pm.id, pm.id, true)
    await db.prisma.objectVisibility.create({
      data: {
        projectId: project.id,
        objectType: 'task',
        objectId: whitelistedSensitive.id,
        userId: member.id,
      },
    })

    const normalEvent = makeEnvelope(project.id, pm.id, {
      objectType: 'task',
      objectId: normalTask.id,
    })
    const visibleEvent = makeEnvelope(project.id, pm.id, {
      objectType: 'task',
      objectId: whitelistedSensitive.id,
    })
    const hiddenEvent = makeEnvelope(project.id, pm.id, {
      objectType: 'task',
      objectId: hiddenSensitive.id,
    })
    await repo.appendIfAbsent(normalEvent)
    await repo.appendIfAbsent(visibleEvent)
    await repo.appendIfAbsent(hiddenEvent)

    const memberView = await repo.query({ projectId: project.id, actorUserId: member.id })
    expect(memberView.map((event) => event.id).sort()).toEqual(
      [normalEvent.id, visibleEvent.id].sort(),
    )
    // 不可见的敏感事件一条都不返回（不是「返回后再内存剔除」）
    expect(memberView.some((event) => event.id === hiddenEvent.id)).toBe(false)

    const pmView = await repo.query({ projectId: project.id, actorUserId: pm.id })
    expect(pmView.map((event) => event.id).sort()).toEqual(
      [normalEvent.id, visibleEvent.id, hiddenEvent.id].sort(),
    )
  })

  it('敏感事件的 payload.references 指向不可见对象时整条不返回', async () => {
    const pm = await makeUser()
    const member = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')
    await addMember(project.id, member.id, 'MEMBER')

    const visibleTask = await makeTask(project.id, pm.id, pm.id, true)
    const hiddenTask = await makeTask(project.id, pm.id, pm.id, true)
    await db.prisma.objectVisibility.create({
      data: {
        projectId: project.id,
        objectType: 'task',
        objectId: visibleTask.id,
        userId: member.id,
      },
    })

    // object 可见，但 references 含一个成员不可见的敏感任务
    const leaking = makeSensitiveEnvelope(
      project.id,
      pm.id,
      { objectType: 'task', objectId: visibleTask.id },
      [
        { objectType: 'task', objectId: visibleTask.id },
        { objectType: 'task', objectId: hiddenTask.id },
      ],
    )
    // object 与 references 都可见
    const clean = makeSensitiveEnvelope(
      project.id,
      pm.id,
      { objectType: 'task', objectId: visibleTask.id },
      [{ objectType: 'task', objectId: visibleTask.id }],
    )
    await repo.appendIfAbsent(leaking)
    await repo.appendIfAbsent(clean)

    const memberView = await repo.query({ projectId: project.id, actorUserId: member.id })
    expect(memberView.map((event) => event.id)).toEqual([clean.id])

    const pmView = await repo.query({ projectId: project.id, actorUserId: pm.id })
    expect(pmView).toHaveLength(2)
  })

  it('不可见与不存在同一条：非成员与不存在的项目得到逐字一致的 404', async () => {
    const pm = await makeUser()
    const outsider = await makeUser()
    const project = await makeProject(pm.id)
    await addMember(project.id, pm.id, 'PM')

    const nonMember = await authz.canRead(outsider.id, project.id)
    const missingProject = await authz.canRead(outsider.id, 'does-not-exist')
    expect(nonMember).toEqual({ allow: false, status: 404, code: 'NOT_FOUND' })
    expect(missingProject).toEqual(nonMember)

    expect(await authz.canRead(pm.id, project.id)).toEqual({ allow: true })
  })
})

// ---------------------------------------------------------------------------
// ④ 时间范围：原生比较 + UTC 归一化
// ---------------------------------------------------------------------------

describe('query 时间范围用原生时间比较', () => {
  it('`+08:00` 输入先归一化为 UTC，不被字符串字典序静默算错', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const task = await makeTask(project.id, owner.id, owner.id)

    const early = makeEnvelope(project.id, owner.id, { objectType: 'task', objectId: task.id }, {
      occurredAt: '2026-01-01T00:00:00.000Z',
      storedAt: '2026-01-01T00:00:00.000Z',
    })
    const late = makeEnvelope(project.id, owner.id, { objectType: 'task', objectId: task.id }, {
      occurredAt: '2026-01-01T08:00:00.000Z',
      storedAt: '2026-01-01T08:00:00.000Z',
    })
    await repo.appendIfAbsent(early)
    await repo.appendIfAbsent(late)

    // `2026-01-01T12:00:00+08:00` == `2026-01-01T04:00:00Z`
    // 原生：early(00:00Z) <= 04:00Z ✓，late(08:00Z) 被排除。
    // 字符串字典序：'…T08:00…' <= '…T12:00+08:00' 会**错误地**把 late 也纳入。
    const query: EventQuery = {
      projectId: project.id,
      storedTo: '2026-01-01T12:00:00+08:00',
    }
    const result = await repo.query(query)
    expect(result.map((event) => event.id)).toEqual([early.id])
  })
})

// ---------------------------------------------------------------------------
// ⑤ 事务上下文：调用方事务回滚 → 事件不落库
// ---------------------------------------------------------------------------

describe('appendIfAbsent 接受调用方事务上下文', () => {
  it('在调用方事务内追加，回滚后事件不落库', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const task = await makeTask(project.id, owner.id, owner.id)
    const event = makeEnvelope(project.id, owner.id, { objectType: 'task', objectId: task.id })

    await expect(
      db.prisma.$transaction(async (tx) => {
        await repo.appendIfAbsent(event, tx)
        throw new Error('rollback on purpose')
      }),
    ).rejects.toThrow('rollback on purpose')

    expect(await repo.findById(event.id)).toBeNull()
    expect(await db.prisma.domainEvent.count()).toBe(0)
  })

  it('在调用方事务内追加并提交 → 事件落库', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    const task = await makeTask(project.id, owner.id, owner.id)
    const event = makeEnvelope(project.id, owner.id, { objectType: 'task', objectId: task.id })

    await db.prisma.$transaction(async (tx) => {
      const result = await repo.appendIfAbsent(event, tx)
      expect(result.kind).toBe('APPENDED')
    })

    expect(await repo.findById(event.id)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ⑥ app 组装注入与生命周期
// ---------------------------------------------------------------------------

describe('src/app.ts 组装注入', () => {
  it('挂载事件端口，onReady 启动、publish/query 可用', async () => {
    const owner = await makeUser()
    const project = await makeProject(owner.id)
    await addMember(project.id, owner.id, 'PM')
    const task = await makeTask(project.id, owner.id, owner.id)

    const app = buildApp({ logger: false, prisma: db.prisma })
    await app.ready()

    const published = await app.events.publisher.publish({
      eventName: 'task.progress',
      projectId: project.id,
      object: { objectType: 'task', objectId: task.id },
      actor: { kind: 'USER', userId: owner.id },
      occurredAt: '2026-01-01T00:00:00.000Z',
      idempotencyKey: 'app-wiring-key',
      sensitive: false,
      payload: { progress: 42 },
    })
    expect(published.persistence).toBe('APPENDED')

    const listed = await app.events.query.query(owner.id, { projectId: project.id })
    expect(listed.map((event) => event.id)).toContain(published.event.id)

    await app.close()
  })
})

// ---------------------------------------------------------------------------
// 公共端口形状（编译期断言）
// ---------------------------------------------------------------------------

describe('src/shared/events.ts 端口形状', () => {
  it('公共端口集合齐全（编译期）', () => {
    expectTypeOf<DomainEventInfrastructurePort>().toHaveProperty('publish')
    expectTypeOf<DomainEventInfrastructurePort>().toHaveProperty('subscribe')
    expectTypeOf<DomainEventInfrastructurePort>().toHaveProperty('query')
    expectTypeOf<DomainEventInfrastructurePort>().toHaveProperty('redeliver')
    expectTypeOf<DomainEventInfrastructurePort>().toHaveProperty('replay')
    expectTypeOf<DomainEventInfrastructurePort>().toHaveProperty('start')
    expectTypeOf<DomainEventInfrastructurePort>().toHaveProperty('stop')

    expectTypeOf<DomainEventInfrastructurePort>().toMatchTypeOf<DomainEventPublisherPort>()
    expectTypeOf<EventRepositoryPort>().toHaveProperty('appendIfAbsent')
    expectTypeOf<EventRepositoryPort>().toHaveProperty('findById')
    expectTypeOf<EventRepositoryPort>().toHaveProperty('query')
    expectTypeOf<EventAuthorizationPort>().toHaveProperty('canRead')

    // 信封 schemaVersion 是字面量 1（不是 number）
    expectTypeOf<DomainEventEnvelope['schemaVersion']>().toEqualTypeOf<1>()
    // 幂等唯一作用域字段在信封上存在
    expectTypeOf<DomainEventEnvelope>().toHaveProperty('idempotencyKey')
  })
})
