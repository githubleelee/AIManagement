# ROLE-D 接口协议提案：站内通知（#34）

> 版本：`role-d.notifications.v0.1-draft`
> 日期：2026-10-21（展示时区 `Asia/Shanghai`；存储时间使用 ISO 8601 UTC）
> 代码基线：`origin/main@37287c2`
> 实现分支：`feat/US14-notifications`
> 状态：ROLE-D 独立模块已实现并通过测试；数据库、公共事件端口、运行时路由与顶栏挂载尚待 ROLE-B 接入。

## 1. 范围与不做项

#34 只提供站内通知的事件消费、接收者解析端口、幂等写入端口、本人查询/详情/已读、数据源三态降级和通知铃铛组件。不发送邮件、短信或企业 IM，不引入 WebSocket，也不修改 ROLE-B 单写的公共文件。

## 2. 六类通知与事件映射

| 通知类型 | 事件名 | 接收者规则 |
|---|---|---|
| `TASK_ASSIGNED` | `task.assigned` | 新负责人 |
| `MENTIONED` | `task.mentioned` | 被提及且仍为项目成员的用户 |
| `TASK_OVERDUE` | `task.overdue` | 任务负责人 + PM |
| `ACCEPTANCE` | `acceptance.submitted` | 验收人 |
| `ACCEPTANCE` | `acceptance.approved/rejected` | 任务负责人 |
| `RISK_ALERT` | `risk.created/level-raised` | PM + 风险负责人 |
| `MILESTONE_REMINDER` | `milestone.due` | PM；有节点负责人时再加节点负责人 |

接收者必须由服务端 `NotificationRecipientResolverPort` 从权威业务数据解析。通知模块不读取、不信任事件 payload 中的收件人或展示正文。

## 3. 消费端口

```ts
type NotificationSourceEvent = {
  id: string
  eventName:
    | 'task.assigned'
    | 'task.mentioned'
    | 'task.overdue'
    | 'acceptance.submitted'
    | 'acceptance.approved'
    | 'acceptance.rejected'
    | 'risk.created'
    | 'risk.level-raised'
    | 'milestone.due'
  projectId: string
  object: { objectType: string; objectId: string }
  occurredAt: string
  sensitive: boolean
  payload: unknown
}

eventSource.subscribe(eventName, subscriberId, handler): () => void
recipientResolver.resolve(event, type): Promise<
  | { state: 'AVAILABLE'; recipients: NotificationRecipient[]; dedupeDiscriminator?: string }
  | { state: 'UNAVAILABLE'; note: string }
>
```

上述订阅签名与 #37 的最小订阅端口兼容。解析依赖未就绪时必须返回 `UNAVAILABLE + note`，不能返回空接收者列表冒充“没有接收者”。

## 4. 写入与去重

- 普通通知按 `sourceEventId + recipientUserId` 去重。
- 逾期通知按 `projectId + TASK_OVERDUE + taskId + planEnd + recipientUserId` 去重。
- 逾期解析结果未提供 `planEnd` 去重依据时返回 422，不写通知。
- 同一事件中的重复接收者先在服务层折叠，再调用仓储。
- 仓储必须提供原子的 `appendIfAbsent()`；数据库实现需为 `dedupeKey` 建唯一约束。
- 每条记录保存 `occurredAt`、`storedAt`、`latencyMs` 和 `withinDeliveryTarget`，目标为 60 秒内可查询。

## 5. 敏感信息

- `sensitive=true` 时强制保存 `REFERENCE_ONLY`，标题和摘要均为 `null`。
- 即使接收者解析器返回了文案，敏感事件也会由通知服务丢弃文案。
- 通知记录只保留对象类型和对象 ID；对象详情继续由目标模块按原权限校验读取。
- 非本人访问通知详情或标记已读，与不存在通知返回相同的 404。

## 6. HTTP 接口

```text
GET   /me/notifications?unreadOnly=true|false
GET   /notifications/:notificationId
PATCH /notifications/:notificationId/read
```

列表响应采用明确三态中的两种：

```ts
type NotificationListResult =
  | { state: 'AVAILABLE'; total: number; unreadCount: number; items: NotificationRecord[]; note: null }
  | { state: 'UNAVAILABLE'; total: null; unreadCount: null; items: []; note: string }
```

公共事件源未接入或订阅已停止时返回 `UNAVAILABLE`，不得返回 `total=0` 或把空列表解释成真实无通知。

## 7. 时间规则

- 存储时间统一为 ISO 8601 UTC；前端按 `Asia/Shanghai` 展示。
- 逾期扫描的业务规则是：任务计划结束日的次日 00:00（`Asia/Shanghai`）仍未 `CLOSED` 即产生事件，`DONE` 也属于逾期范围。
- 里程碑提醒在到期日 09:00（`Asia/Shanghai`）由生产方产生 `milestone.due`。
- 定时扫描器及上述两个计划事件的生产逻辑属于业务生产方/公共调度接入，不在通知消费模块内伪造。

## 8. ROLE-B 公共接入清单

1. 将 #37 公共订阅端口注入 `createNotificationModule()` 并调用 `start/stop`；
2. 在 schema/迁移中新增通知表和 `dedupeKey` 唯一约束，并实现 `NotificationRepositoryPort`；
3. 为任务、成员、验收、风险、里程碑权威数据实现 `NotificationRecipientResolverPort`；
4. 在 `src/app.ts` 注入依赖，在 `src/routes.ts` 注册 `registerNotificationRoutes()`；
5. 在 `web/src/layouts/AppLayout.tsx` 最小挂载 `NotificationBell`；
6. 后交付方使用真实业务写路径完成一次单向联调取证；@提及真数据证据按契约作为后置联调项。

## 9. 当前实现与未完成项

已实现：六类映射、九个事件订阅、服务端接收者端口、敏感引用保护、两类去重、60 秒度量、本人列表/详情/已读、三态降级、30 秒在线轮询组件、针对性 HTTP 和服务测试。

尚未完成：数据库表/迁移、真实接收者适配器、公共事件运行时接线、业务生产方事件、定时扫描器、公共路由注册、顶栏挂载和真实浏览器联调。内存仓储与模块模拟事件只用于独立验证，不冒充数据库持久化或端到端验收。
