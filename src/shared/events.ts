/**
 * 领域事件公共契约（#37 公共接入，ROLE-B 单写）
 *
 * 权威来源：`docs/role-d/ROLE-D-EVENTS-interface-protocol.md`（ROLE-D 的接口协议提案）、
 * `docs/role-d/ROLE-D-EVENTS-public-integration-request.md`（公共接入申请）、
 * `DECISIONS.md` `arch.shared-ports-and-assembly`（公共类型与端口放 `src/shared/`）。
 *
 * ===========================================================================
 * 归属与依赖方向
 * ===========================================================================
 *
 * - 本文件是**唯一权威定义**：D 的 `src/modules/events/contracts.ts` 改为从本文件
 *   `export *`，避免两份会漂移的定义；D 的 service / factory / in-memory-repository /
 *   validation 继续 import `./contracts.js`（经 re-export 解析到本文件），D 的实现零改动。
 * - 依赖方向：`src/shared/` **不** import 任何业务模块；业务模块只依赖本文件的端口，
 *   不 import D 的 `service.ts`（契约 I-9「不跨模块调 service」）。
 *
 * ===========================================================================
 * 固定语义（引用方必须遵守，本批不扩张）
 * ===========================================================================
 *
 * 1. **时间戳一律 ISO 8601 UTC 带毫秒（`…Z`）**：`occurredAt` / `storedAt` 由生产方
 *    给出 / 由基础设施在落库时生成；带偏移量的输入（如 `+08:00`）在适配器内先归一化为
 *    UTC。DB 侧用原生时间列比较，**禁止**字符串字典序比较。
 * 2. **幂等作用域固定为 `(projectId, eventName, idempotencyKey)`**：唯一约束由数据库兜底；
 *    重复 `publish()` 只去重（返回既有事件，`persistence = 'DUPLICATE'`），**不自动重投**。
 *    主动恢复调用 `redeliver(eventId)`。
 * 3. **无 outbox / 不承诺 exactly-once**：业务事务提交后、事件存储前进程崩溃时没有可恢复
 *    记录；业务已提交但事件未送达由领域生产者登记集成失败证据并决定重试策略。
 * 4. **消费方按 `event.id` 自保副作用幂等**：投递可能重复（重放 / 显式重投），基础设施
 *    不承诺跨进程可靠投递，也不回滚已提交业务。
 * 5. **敏感事件**：`sensitive = true` 的 `payload` 只能包含 `references`（对象引用），
 *    不得含标题、正文、人名、账号、token、密钥等受保护内容。
 */

// ---------------------------------------------------------------------------
// JSON 值（与 D 的信封定义逐字一致）
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

// ---------------------------------------------------------------------------
// 事件信封
// ---------------------------------------------------------------------------

/** 事件名：小写 `namespace.name`；具体事件名归生产方业务域所有。 */
export type DomainEventName = `${string}.${string}`

/** 事件主体对象引用（`object` 与敏感事件 `references` 的元素）。 */
export type EventObjectRef = {
  objectType: string
  objectId: string
}

/** 事件发起者：登录用户或系统组件。 */
export type EventActor =
  | { kind: 'USER'; userId: string }
  | { kind: 'SYSTEM'; component: string }

type PublishEventBase = {
  eventName: DomainEventName
  projectId: string
  object: EventObjectRef
  actor: EventActor
  /** ISO 8601 UTC（带毫秒，`…Z`）；带偏移量的输入由适配器归一化。 */
  occurredAt: string
  idempotencyKey: string
  correlationId?: string
  causationId?: string
}

/**
 * 发布输入。
 *
 * 敏感事件走判别联合的 `sensitive: true` 分支，**载荷只能是对象引用**。
 */
export type PublishEventInput =
  | (PublishEventBase & { sensitive: false; payload: JsonObject })
  | (PublishEventBase & {
      sensitive: true
      /** Sensitive events carry references only; never titles, descriptions or content. */
      payload: { references: EventObjectRef[] }
    })

/** 落库后的完整信封：在发布输入之上补齐 `id` / `schemaVersion` / `storedAt`。 */
export type DomainEventEnvelope = PublishEventInput & {
  id: string
  schemaVersion: 1
  /** ISO 8601 UTC（带毫秒，`…Z`）。 */
  storedAt: string
}

/** 权限判定所需的最小事件元数据（不含 payload，避免越权读取敏感内容）。 */
export type EventAccessMetadata = Pick<
  DomainEventEnvelope,
  'id' | 'projectId' | 'eventName' | 'object' | 'sensitive' | 'storedAt'
>

/**
 * 查询过滤条件。
 *
 * `storedFrom` / `storedTo`：ISO 8601 时间串（可带偏移量，如 `+08:00`）；仓储适配器
 * 先归一化为 UTC，再用**原生时间列比较**（不得字符串字典序）。
 *
 * `actorUserId`：**由组装层注入**（`src/app.ts` 的公共 query 端口把
 * `DomainEventQueryPort.query(actorUserId, …)` 的 actor 一并放进 filter）。D 的
 * `DomainEventService` 原样透传给仓储、不解读该字段；DB 仓储用它做**查询层**的对象级
 * 可见性过滤（契约 I-6）。为空时仓储按「无可见性上下文」处理。
 */
export type EventQuery = {
  projectId: string
  eventName?: DomainEventName
  storedFrom?: string
  storedTo?: string
  actorUserId?: string
}

/** `appendIfAbsent` 的结果：新增或命中既有幂等记录。 */
export type AppendEventResult =
  | { kind: 'APPENDED'; event: DomainEventEnvelope }
  | { kind: 'DUPLICATE'; event: DomainEventEnvelope }

/**
 * 事件仓储端口（DB 适配器实现）。
 *
 * 幂等作用域固定为 `projectId + eventName + idempotencyKey`；实现方须接受调用方事务上下文
 * 且**不自行提交**（见 `src/db/event-repository.ts` 的 `appendIfAbsent(event, db?)`）。
 */
export interface EventRepositoryPort {
  appendIfAbsent(event: DomainEventEnvelope): Promise<AppendEventResult>
  findAccessMetadata(eventId: string): Promise<EventAccessMetadata | null>
  findById(eventId: string): Promise<DomainEventEnvelope | null>
  query(query: EventQuery): Promise<DomainEventEnvelope[]>
}

// ---------------------------------------------------------------------------
// 权限端口
// ---------------------------------------------------------------------------

export type EventReadDecision =
  | { allow: true }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }

/**
 * 事件读取权限端口。
 *
 * 适配器必须用统一鉴权入口 `can()` 实现（`project.read` + `{ kind: 'project', projectId }`），
 * **不得**自写角色名字面判断；outsider / 外项目 / 不可见对象返回不泄漏详情的 404。
 */
export interface EventAuthorizationPort {
  canRead(actorUserId: string, projectId: string): Promise<EventReadDecision>
}

// ---------------------------------------------------------------------------
// 发布 / 订阅 / 查询 / 重放 / 生命周期端口
// ---------------------------------------------------------------------------

export type EventDeliveryKind = 'LIVE' | 'REDELIVERY' | 'REPLAY'

export type EventHandler = (
  event: DomainEventEnvelope,
  context: { deliveryKind: EventDeliveryKind },
) => Promise<void> | void

export type EventDeliveryResult = {
  subscriberId: string
  status: 'DELIVERED' | 'FAILED'
  errorCode: string | null
}

export type PublishEventResult = {
  persistence: 'APPENDED' | 'DUPLICATE'
  event: DomainEventEnvelope
  deliveries: EventDeliveryResult[]
}

export type RedeliverEventResult = {
  event: DomainEventEnvelope
  deliveries: EventDeliveryResult[]
}

export interface DomainEventPublisherPort {
  publish(input: PublishEventInput): Promise<PublishEventResult>
}

export interface DomainEventSubscriberPort {
  subscribe(eventName: DomainEventName, subscriberId: string, handler: EventHandler): () => void
}

export interface DomainEventQueryPort {
  query(actorUserId: string, query: EventQuery): Promise<DomainEventEnvelope[]>
}

export interface DomainEventReplayPort {
  redeliver(actorUserId: string, eventId: string): Promise<RedeliverEventResult>
  replay(actorUserId: string, query: EventQuery): Promise<RedeliverEventResult[]>
}

export interface DomainEventLifecyclePort {
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * 事件基础设施端口集合：由 D 的 `createDomainEventInfrastructure` 返回，在 `src/app.ts`
 * 组装注入并在应用生命周期调用 `start` / `stop`。业务域只用 publisher / subscriber /
 * query / replay 子端口，不 import D 的 service。
 */
export type DomainEventInfrastructurePort = DomainEventPublisherPort &
  DomainEventSubscriberPort &
  DomainEventQueryPort &
  DomainEventReplayPort &
  DomainEventLifecyclePort
