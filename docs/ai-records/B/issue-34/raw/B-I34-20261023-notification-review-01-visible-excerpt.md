# b-notification-review 可见返回摘录

> 如果 B 只做"schema + 路由 + 挂 subscriber + 挂铃铛"，结果会是：**列表返回 AVAILABLE / 暂无通知，但任何真实业务事件都不会产生通知。**

> 方案骨架成立、方向正确：以"已提交 DomainEvent 为权威 + 按 eventId 持久成功消费账本（NOT EXISTS）"替代 storedAt/id 水位，能正确处理晚提交与同毫秒随机 UUID。

> 端口把 consume 结果吞了，reader 无法区分"消费成功"与 UNAVAILABLE。

> 账本初始为空 ⇒ 首次/启动补扫会消费全部历史事件。

> findById / markRead 签名带 actorUserId；DB 侧 markRead 用带 recipient+scope 条件的条件更新，不可见即 404。

以上是子 agent 两次返回的可见原文摘录（代码标识去掉格式用作可读文本），不是完整评审导出。主控据此裁定并另派 tester 复现；未索取或保存隐藏推理。
