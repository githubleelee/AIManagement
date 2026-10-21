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
- start/stop 与测试注入入口由工厂提供。

## 不承诺

- 不承诺 exactly-once、跨进程可靠投递或 consumer 副作用幂等；
- 没有 outbox/队列。业务 commit 后、事件落库前进程崩溃时没有可重放记录；
- 内存仓储只用于模块测试，不是数据库持久化验收；
- 当前尚未写 `src/shared/`、schema/migration、`src/app.ts` 或 `src/routes.ts`。

完整协议见 `docs/role-d/ROLE-D-EVENTS-interface-protocol.md`。
