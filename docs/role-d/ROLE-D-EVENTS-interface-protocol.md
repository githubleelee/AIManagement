# ROLE-D 接口协议提案：领域事件传输、存储与幂等（#37）

> 版本：`role-d.events.v0.3-draft`
> 日期：2026-10-21（业务日期 `Asia/Shanghai`；记录时间使用 ISO 8601 UTC）
> 代码基线：`origin/main@37287c2`
> 实现分支：`feat/EVENTS-domain-events`
> 状态：ROLE-D 独立实现与协议提案；公共端口、事件表和运行时接线尚未由 ROLE-B 落地。

## 1. 范围与不做项

#37 只提供事件信封、存储、进程内发布/订阅、查询、重放、显式重投和幂等基础。各业务域负责
生产自己的领域事件并定义 payload；ROLE-D 不代写看板、排期、风险、通知等业务逻辑。

本期不引入外部消息队列、分布式投递或 outbox，不承诺 exactly-once、跨进程可靠投递或消费方
副作用幂等。公共文件继续由 ROLE-B 单写。

## 2. 事件信封

```ts
type DomainEventEnvelope = {
  id: string
  schemaVersion: 1
  eventName: `${string}.${string}`
  projectId: string
  object: { objectType: string; objectId: string }
  actor: { kind: 'USER'; userId: string } | { kind: 'SYSTEM'; component: string }
  occurredAt: string
  storedAt: string
  idempotencyKey: string
  correlationId?: string
  causationId?: string
  sensitive: boolean
  payload: JsonObject
}
```

- 事件名使用小写 `namespace.name`；具体事件名归生产方业务域所有。
- 幂等唯一作用域固定为 `(projectId, eventName, idempotencyKey)`。
- 不使用易变时间戳作为幂等键。
- `occurredAt/storedAt` 使用 ISO 8601 UTC。
- 敏感事件的 payload 只能包含对象引用，不包含标题、描述、人名或正文。

## 3. 公共端口

```ts
publisher.publish(input): Promise<{
  persistence: 'APPENDED' | 'DUPLICATE'
  event: DomainEventEnvelope
  deliveries: Array<{
    subscriberId: string
    status: 'DELIVERED' | 'FAILED'
    errorCode: string | null
  }>
}>

subscriber.subscribe(eventName, subscriberId, handler): () => void
query.query(actorUserId, filter): Promise<DomainEventEnvelope[]>
replay.redeliver(actorUserId, eventId): Promise<DeliveryResult>
replay.replay(actorUserId, filter): Promise<DeliveryResult[]>
lifecycle.start(): Promise<void>
lifecycle.stop(): Promise<void>
```

完整可执行类型位于 `src/modules/events/contracts.ts`。A/C/B 业务模块最终只依赖提升到
`src/shared/` 的公共端口，不直接调用 D 的 service。

## 4. 发布、幂等与重投语义

1. `publish()` 先通过 `appendIfAbsent()` 保存事件，再向当前进程订阅方投递。
2. 未注册订阅方时事件仍保存成功，`deliveries=[]`，不报错。
3. 同一幂等作用域重复发布只返回已有事件，`persistence='DUPLICATE'`。
4. 重复发布不自动再次投递；主动恢复使用 `redeliver(eventId)`。
5. `redeliver/replay` 不新增事件记录。
6. 单个订阅者失败不删除事件，也不阻止其他订阅者；返回稳定的 `SUBSCRIBER_FAILED`，不泄漏异常正文。
7. 消费方必须按 `event.id` 自行保证副作用幂等。

## 5. 业务提交与失败恢复边界

对业务生产方的固定语义：

1. 业务事务提交是业务数据成功的唯一提交点。
2. 事务提交后、事务外调用 `publish()`；事件投递失败不得回滚或重写已提交业务。
3. 事件已存储但投递失败/响应丢失时，可按事件 id 显式重投或按条件重放。
4. 业务已提交但事件存储前进程崩溃时，当前没有事件记录，无法自动恢复。
5. 第4项只有引入 outbox、提交后扫描或外部队列才能收窄；本票未获该范围授权，不得宣称可靠必达。
6. 领域生产者负责登记“业务已提交但事件未送达”的集成失败证据，并决定重试策略。

## 6. 权限与敏感载荷

- 查询、重放和显式重投先读取最小项目归属，再调用统一权限端口。
- outsider、外项目或不可见对象返回不泄漏详情的 404；可见但无操作权为 403。
- 敏感事件 payload 只能为 `references: [{ objectType, objectId }]`。
- 不允许载荷包含标题、正文、姓名、账号、token、密钥或其他受保护内容。
- 业务域在发布前负责最小化载荷；事件基础设施只执行通用结构校验。

## 7. ROLE-B 公共接入清单

1. 从 `src/modules/events/contracts.ts` 提取事件信封和发布、订阅、查询、重放、生命周期端口到
   `src/shared/`；
2. 新增事件表与唯一索引 `(projectId, eventName, idempotencyKey)`；
3. 提供数据库 `EventRepositoryPort` 适配器；
4. 在 `src/app.ts` 显式注入事件仓储和权限端口，并在应用生命周期调用 `start/stop`；
5. 各业务域通过公共 publisher 发布自己的事件，不 import D 的 service；
6. 不在本批自动加入 outbox、队列或投递失败表；如需增加，另行申请字段与迁移授权。

## 8. 当前实现与未完成项

已实现：事件信封校验、进程内订阅、内存存储、幂等去重、查询、重放、定点重投、逐订阅方
delivery report、敏感引用限制、权限端口、生命周期与依赖方向测试。

尚未完成：`src/shared/` 公共提取、数据库表/迁移、真实 `can()` 与 app 组装、业务生产方联调、
跨进程恢复、outbox、exactly-once。模块内存实现不得冒充数据库持久化或真实生产方验收。
