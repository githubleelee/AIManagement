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

/**
 * 由发布输入 + 基础设施元数据构造完整信封（**纯函数**，shared 单写）。
 *
 * 为什么集中在这里：`id` / `schemaVersion` / `storedAt` 的补齐是**基础设施职责**，
 * 域内适配器只注入 `id` / `storedAt` 两个值，避免每个域各自拼信封、各自决定
 * `schemaVersion`。本函数在 `src/shared/` 内，会被前端打包，故**不得** import
 * `node:crypto` / `node:process`；`id` 与 `storedAt` 的缺省值一律由调用方（模块内适配器）
 * 给出（缺省 `randomUUID()` + `new Date().toISOString()`，测试可覆盖）。
 */
export function buildDomainEventEnvelope(
  input: PublishEventInput,
  meta: { id: string; storedAt: string },
): DomainEventEnvelope {
  return { ...input, id: meta.id, schemaVersion: 1, storedAt: meta.storedAt }
}

// ---------------------------------------------------------------------------
// 业务域事件目录（ROLE-B 生产接线，本批接入甘特 + 需求）
// ---------------------------------------------------------------------------
//
// 命名规范：`<domain>.<object>.<action>`（全小写、点分三段）。domain 取模块名，
// object 取被动名词，action 取过去式动词。新增事件必须遵循本规范并在此登记。
//
// | 事件名                              | object                    | 非敏感载荷                                            | 幂等键                                        | 敏感判定来源                                            |
// | ----------------------------------- | ------------------------- | ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
// | `gantt.milestone.created`           | `milestone`               | `{name, dueDate}`                                     | `<name>:<milestoneId>`                        | 关联任务任一 `isSensitive`                              |
// | `gantt.milestone.updated`           | `milestone`               | `{name, dueDate}`                                     | `<name>:<milestoneId>:<occurredAt>`           | 更新后关联任务任一 `isSensitive`                        |
// | `gantt.milestone.deleted`           | `milestone`               | `{name, dueDate}`                                     | `<name>:<milestoneId>`                        | 删除前关联任务任一 `isSensitive`                        |
// | `gantt.dependency.created`          | `task-dependency`         | `{predecessorTaskId, successorTaskId, type:'FS'}`     | `<name>:<dependencyId>`                       | 两端任务任一 `isSensitive`                              |
// | `gantt.dependency.deleted`          | `task-dependency`         | `{predecessorTaskId, successorTaskId, type:'FS'}`     | `<name>:<dependencyId>`                       | 两端任务任一 `isSensitive`                              |
// | `requirement.story.status-changed`  | `story`                   | `{from, to}`（只含状态）                              | `<name>:<storyId>:<occurredAt>`               | 故事 `isSensitive`                                      |
//
// 敏感规则（契约 I-6，必须遵守）：只要事件涉及的对象里有**敏感**的 `task` / `story`，
// 该事件必须以**敏感事件**发布（`sensitive: true`，`payload` **只能**是
// `{references: EventObjectRef[]}`）。否则 `src/db/event-repository.ts` 的查询层过滤
// 看不到它、会泄漏给非授权成员。before/after 等业务值已在 `AuditLog` 审计行里，
// **不**放进敏感事件载荷。
//
// 幂等键规则（确定性）：创建 / 删除 → `<eventName>:<objectId>`；更新 / 状态变更 →
// `<eventName>:<objectId>:<occurredAt ISO>`。同一毫秒内的重复更新会因幂等键相同而被
// 去重（`DUPLICATE`）——这是**有意**的可接受行为（同毫秒内同对象同动作视为同一次）。
// 幂等作用域仍由数据库的 `(projectId, eventName, idempotencyKey)` 唯一约束兜底。
//
// 同事务语义：域内写路径必须在**业务写入的同一个 `$transaction` 内**调用
// `appendIfAbsent(event, tx)` 落库（适配器**不自行提交**）。**发布失败 = 业务写入回滚**
// —— 宁可业务失败，也不产生「业务成功但事件丢失」。订阅者派发是 `app.events.publisher`
// 的职责，不在域内；本批**无 outbox**、不承诺 exactly-once（见文件头固定语义 3）。
// ---------------------------------------------------------------------------

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
