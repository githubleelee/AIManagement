/**
 * #37 领域事件 —— 数据库仓储适配器（ROLE-B 单写）
 *
 * 实现 `src/shared/events.ts` 的 `EventRepositoryPort`（D 的 `DomainEventService` 依赖它），
 * 把事件落到 `DomainEvent` 表（迁移 `20261021130000_add_domain_event`）。
 *
 * 依据：
 *   - `docs/role-d/ROLE-D-EVENTS-public-integration-request.md` 第 2、3 项；
 *   - `docs/role-d/ROLE-D-EVENTS-interface-protocol.md` §2、§4、§6；
 *   - `DECISIONS.md` `arch.shared-ports-and-assembly`、`ownership.public-files-single-writer`；
 *   - 契约 I-6（列表**必须在查询层**过滤）、I-9（不跨模块调 service）。
 *
 * ===========================================================================
 * 两个必须点（与 D 的内存桩的差异）
 * ===========================================================================
 *
 * 1. **查询层对象级可见性过滤（H1 / 契约 I-6）**：`query()` 用统一入口
 *    `visibilityScope(actor, projectId, 'task' | 'story')` 生成 `where` 条件，直接拼进
 *    同一条 SQL。**禁止**「先取全量再在内存里剔除」——后者会让不可见敏感对象的存在性
 *    从计数 / 分页里泄漏。敏感事件的 `payload.references` 同样在查询层用 `json_each`
 *    过滤（引用到不可见 task/story 的事件整条不返回）。
 * 2. **原生时间比较**：`storedFrom` / `storedTo` 先归一化为 UTC `Date`，再用 `DATETIME`
 *    列比较。D 的内存桩用 `storedAt` 字符串字典序比较，带偏移量（`+08:00`）的输入会被
 *    静默算错；本适配器不做字符串比较。
 *
 * ===========================================================================
 * 事务语义
 * ===========================================================================
 *
 * `appendIfAbsent(event, db?)` 接受调用方事务上下文（`Prisma.TransactionClient` 与
 * `PrismaClient` 结构上都满足 `EventDb`，与 `permissions.ts` 的 `AuthzDb` 同款先例），
 * **不自行 `$transaction` / 不自行提交**：业务域可在自己的事务里追加事件，回滚时事件一并
 * 消失。不传 `db` 时用构造时的根客户端。
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { createAuthorization } from '../modules/authz/permissions.js'
import type {
  AppendEventResult,
  DomainEventEnvelope,
  EventAccessMetadata,
  EventAuthorizationPort,
  EventObjectRef,
  EventQuery,
  EventReadDecision,
  EventRepositoryPort,
  JsonObject,
} from '../shared/events.js'
import type { Scope } from '../shared/types.js'

/**
 * 仓储实际用到的 Prisma 形状。
 *
 * 与 `permissions.ts` 的 `AuthzDb` 同款理由：`Prisma.TransactionClient` 不满足完整
 * `PrismaClient`，但结构上满足这个窄 `Pick`，因此 `appendIfAbsent` 可在调用方事务内复用。
 */
export type EventDb = Pick<PrismaClient, 'domainEvent'>

/** `SELECT *` 的原始行形状（Prisma `$queryRaw` 已按列类型反序列化：Date / Json / Boolean）。 */
type DomainEventRow = {
  id: string
  schemaVersion: number
  eventName: string
  projectId: string
  objectType: string
  objectId: string
  actorKind: string
  actorUserId: string | null
  actorComponent: string | null
  occurredAt: Date | string
  storedAt: Date | string
  idempotencyKey: string
  correlationId: string | null
  causationId: string | null
  sensitive: boolean
  payload: unknown
}

/**
 * 读出 Prisma 已知错误码（`P2002` 等），非 Prisma 错误返回 `null`。
 *
 * 用鸭子类型而非 `instanceof`：注入的 client 与错误类可能不是同一模块实例，构造器身份
 * 不一致会让错误映射静默退化为 500。同款写法见 `src/modules/gantt/write.ts` 的
 * `prismaErrorCode`。
 */
function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null
}

/** 时间列 → ISO 8601 UTC 字符串（`$queryRaw` 可能给 Date，也可能给字符串）。 */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** payload 列 → 已解析对象（Prisma 正常查询给对象；原始 SQL 在个别驱动上给字符串）。 */
function toPayload(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

/** 行 → 完整信封（`object` / `actor` 由扁平列重组；时间归一化为 `…Z`）。 */
function toEnvelope(row: DomainEventRow): DomainEventEnvelope {
  const base = {
    id: row.id,
    schemaVersion: 1 as const,
    eventName: row.eventName as DomainEventEnvelope['eventName'],
    projectId: row.projectId,
    object: { objectType: row.objectType, objectId: row.objectId } satisfies EventObjectRef,
    actor:
      row.actorKind === 'SYSTEM'
        ? ({ kind: 'SYSTEM', component: row.actorComponent ?? '' } as const)
        : ({ kind: 'USER', userId: row.actorUserId ?? '' } as const),
    occurredAt: toIso(row.occurredAt),
    storedAt: toIso(row.storedAt),
    idempotencyKey: row.idempotencyKey,
    ...(row.correlationId === null ? {} : { correlationId: row.correlationId }),
    ...(row.causationId === null ? {} : { causationId: row.causationId }),
  }
  const payload = toPayload(row.payload)
  if (row.sensitive) {
    return {
      ...base,
      sensitive: true,
      payload: payload as { references: EventObjectRef[] },
    }
  }
  return { ...base, sensitive: false, payload: payload as JsonObject }
}

/** 信封 → 扁平插入行（时间字符串先经 `Date` 归一化为 UTC）。 */
function toRow(event: DomainEventEnvelope): Prisma.DomainEventUncheckedCreateInput {
  return {
    id: event.id,
    schemaVersion: event.schemaVersion,
    eventName: event.eventName,
    projectId: event.projectId,
    objectType: event.object.objectType,
    objectId: event.object.objectId,
    actorKind: event.actor.kind,
    actorUserId: event.actor.kind === 'USER' ? event.actor.userId : null,
    actorComponent: event.actor.kind === 'SYSTEM' ? event.actor.component : null,
    occurredAt: new Date(event.occurredAt),
    storedAt: new Date(event.storedAt),
    idempotencyKey: event.idempotencyKey,
    correlationId: event.correlationId ?? null,
    causationId: event.causationId ?? null,
    sensitive: event.sensitive,
    payload: event.payload as unknown as Prisma.InputJsonValue,
  }
}

/**
 * `object` 的对象级可见性条件（契约 I-6）。
 *
 * 只有 story / task 支持对象级敏感（`VisibilityObjectType`），其它 objectType 不受影响。
 * `mode === 'all'`（PM）不加条件；`mode === 'subset'` 追加 `objectId IN (:ids)`；
 * 空 ids 表示该类对象一条都不返回。返回 `null` 表示两类都无需过滤。
 */
function objectVisibilityCondition(taskScope: Scope, storyScope: Scope): Prisma.Sql | null {
  if (taskScope.mode === 'all' && storyScope.mode === 'all') return null

  const parts: Prisma.Sql[] = [Prisma.sql`"objectType" NOT IN ('task', 'story')`]
  if (taskScope.mode === 'all') {
    parts.push(Prisma.sql`"objectType" = 'task'`)
  } else if (taskScope.ids.length > 0) {
    parts.push(
      Prisma.sql`("objectType" = 'task' AND "objectId" IN (${Prisma.join(taskScope.ids)}))`,
    )
  }
  if (storyScope.mode === 'all') {
    parts.push(Prisma.sql`"objectType" = 'story'`)
  } else if (storyScope.ids.length > 0) {
    parts.push(
      Prisma.sql`("objectType" = 'story' AND "objectId" IN (${Prisma.join(storyScope.ids)}))`,
    )
  }
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`
}

/**
 * 敏感事件 `payload.references` 的可见性条件（契约 I-6，同样在查询层）。
 *
 * 敏感事件的载荷按契约只能是 `references: [{ objectType, objectId }]`；若其中任一引用指向
 * actor 不可见的 task / story，整条事件不返回（引用列表本身也不得泄漏存在性）。
 * 非敏感事件载荷是任意 JsonObject，可能含同名 `references` 键，故只对 `sensitive = true` 生效。
 * 两类作用域都为 `all`（PM）时无需过滤，返回 `null`。
 */
function referenceVisibilityCondition(taskScope: Scope, storyScope: Scope): Prisma.Sql | null {
  if (taskScope.mode === 'all' && storyScope.mode === 'all') return null

  const invisible: Prisma.Sql[] = []
  if (taskScope.mode === 'subset') {
    invisible.push(
      taskScope.ids.length > 0
        ? Prisma.sql`(json_extract(ref.value, '$.objectType') = 'task' AND json_extract(ref.value, '$.objectId') NOT IN (${Prisma.join(taskScope.ids)}))`
        : Prisma.sql`json_extract(ref.value, '$.objectType') = 'task'`,
    )
  }
  if (storyScope.mode === 'subset') {
    invisible.push(
      storyScope.ids.length > 0
        ? Prisma.sql`(json_extract(ref.value, '$.objectType') = 'story' AND json_extract(ref.value, '$.objectId') NOT IN (${Prisma.join(storyScope.ids)}))`
        : Prisma.sql`json_extract(ref.value, '$.objectType') = 'story'`,
    )
  }
  return Prisma.sql`("sensitive" = false OR NOT EXISTS (
    SELECT 1 FROM json_each("DomainEvent"."payload", '$.references') AS ref
    WHERE ${Prisma.join(invisible, ' OR ')}
  ))`
}

export class PrismaEventRepository implements EventRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 幂等追加：唯一约束冲突（`P2002`）→ 返回既有行，`kind = 'DUPLICATE'`。
   *
   * 接受调用方事务上下文（`db?`），**不自行提交**；`db` 缺省用根客户端。
   * 并发 publish 由 `(projectId, eventName, idempotencyKey)` 唯一索引兜底。
   */
  async appendIfAbsent(event: DomainEventEnvelope, db?: EventDb): Promise<AppendEventResult> {
    const client = db ?? this.prisma
    try {
      const row = await client.domainEvent.create({ data: toRow(event) })
      return { kind: 'APPENDED', event: toEnvelope(row as DomainEventRow) }
    } catch (error) {
      if (prismaErrorCode(error) !== 'P2002') throw error
      const existing = await client.domainEvent.findUnique({
        where: {
          projectId_eventName_idempotencyKey: {
            projectId: event.projectId,
            eventName: event.eventName,
            idempotencyKey: event.idempotencyKey,
          },
        },
      })
      // 理论上 P2002 后必能查到既有行；查不到说明不是本唯一约束冲突，原样抛出。
      if (!existing) throw error
      return { kind: 'DUPLICATE', event: toEnvelope(existing as DomainEventRow) }
    }
  }

  async findAccessMetadata(eventId: string): Promise<EventAccessMetadata | null> {
    const row = await this.prisma.domainEvent.findUnique({ where: { id: eventId } })
    if (!row) return null
    return {
      id: row.id,
      projectId: row.projectId,
      eventName: row.eventName as EventAccessMetadata['eventName'],
      object: { objectType: row.objectType, objectId: row.objectId },
      sensitive: row.sensitive,
      storedAt: row.storedAt.toISOString(),
    }
  }

  async findById(eventId: string): Promise<DomainEventEnvelope | null> {
    const row = await this.prisma.domainEvent.findUnique({ where: { id: eventId } })
    return row ? toEnvelope(row as DomainEventRow) : null
  }

  /**
   * 查询事件：**查询层**完成时间范围（原生比较）与对象级可见性过滤（契约 I-6）。
   *
   * `query.actorUserId` 由组装层的公共 query 端口注入（见 `src/shared/events.ts` 的
   * `EventQuery` 注释）；缺省时不做对象级过滤（无可见性上下文）。
   */
  async query(query: EventQuery): Promise<DomainEventEnvelope[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`"projectId" = ${query.projectId}`]
    if (query.eventName) conditions.push(Prisma.sql`"eventName" = ${query.eventName}`)
    // 原生时间比较：带偏移量的 ISO 串先经 Date 归一化为 UTC。
    if (query.storedFrom) conditions.push(Prisma.sql`"storedAt" >= ${new Date(query.storedFrom)}`)
    if (query.storedTo) conditions.push(Prisma.sql`"storedAt" <= ${new Date(query.storedTo)}`)

    if (query.actorUserId) {
      const { visibilityScope } = createAuthorization(this.prisma)
      const [taskScope, storyScope] = await Promise.all([
        visibilityScope(query.actorUserId, query.projectId, 'task'),
        visibilityScope(query.actorUserId, query.projectId, 'story'),
      ])
      const objectCondition = objectVisibilityCondition(taskScope, storyScope)
      if (objectCondition) conditions.push(objectCondition)
      const referenceCondition = referenceVisibilityCondition(taskScope, storyScope)
      if (referenceCondition) conditions.push(referenceCondition)
    }

    const rows = await this.prisma.$queryRaw<DomainEventRow[]>(Prisma.sql`
      SELECT * FROM "DomainEvent"
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY "storedAt" ASC, "id" ASC
    `)
    return rows.map(toEnvelope)
  }
}

/**
 * 事件读取权限适配器（`EventAuthorizationPort`）。
 *
 * **只用统一鉴权入口 `can()`**（`project.read` + `{ kind: 'project', projectId }`），
 * 不自写角色名字面判断；`can()` 已保证「非成员 / 外项目 / 不存在的项目」逐字同一条 404。
 */
export function createEventAuthorizationPort(prisma: PrismaClient): EventAuthorizationPort {
  const { can } = createAuthorization(prisma)
  return {
    async canRead(actorUserId: string, projectId: string): Promise<EventReadDecision> {
      const decision = await can(actorUserId, 'project.read', { kind: 'project', projectId })
      return decision.allow
        ? { allow: true }
        : { allow: false, status: decision.status, code: decision.code }
    },
  }
}
