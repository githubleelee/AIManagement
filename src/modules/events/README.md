# #37 领域事件基础实现

本目录是 ROLE-D 的独立实现，提供事件信封、进程内发布/订阅、存储、查询、幂等、重放和定点重投。
业务域仍负责生产自己的事件；本模块不导入其他业务 service。

## 已实现语义

- 幂等作用域：`projectId + eventName + idempotencyKey`；
- 先保存事件，再调用进程内订阅者；订阅者失败按 delivery report 返回，已存事件不回滚；
- 重复 publish 不重复落库，也不隐式重投；显式恢复调用 `redeliver(eventId)`；
- replay/redeliver 不新增事件记录；
- 事件查询与重放通过权限端口，outsider 404；
- 敏感事件 payload 只能包含对象引用；
- 查询时间边界先归一化为 UTC，内存桩按时间值而不是字符串字典序过滤和排序；
- start/stop 与测试注入入口由工厂提供。

## 仓储边界

- `src/db/event-repository.ts` 是正式数据库适配器，负责在数据库查询层应用对象级可见性过滤；
- `InMemoryEventRepository` 只用于模块测试，不实现正式的对象可见性规则，也不能作为权限验收证据；
- 服务层只负责调用统一鉴权端口并把查询条件传给仓储，禁止先取全量事件再在内存中剔除敏感对象。

## 不承诺

- 不承诺 exactly-once、跨进程可靠投递或 consumer 副作用幂等；
- 没有 outbox/队列。业务 commit 后、事件落库前进程崩溃时没有可重放记录；
- 内存仓储只用于模块测试，不是数据库持久化或可见性验收；
- 公共类型、数据库适配器与应用组装由 ROLE-B 维护，本模块不并发修改公共冻结区。

完整协议见 `docs/role-d/ROLE-D-EVENTS-interface-protocol.md`。
