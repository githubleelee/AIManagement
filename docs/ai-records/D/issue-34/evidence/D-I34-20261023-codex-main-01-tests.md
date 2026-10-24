# #34 评审修正验证（2026-10-23）

验证树基线：main@caa002cc42c0edad77e1874b76e91ed77576e243 + 本票模块；工作目录 fix34。

- `npm test -- --run src/modules/notification src/modules/requirement/requirement.adversarial2.test.ts`：4文件/109项通过（通知38项、既有需求71项）。
- `npm run typecheck`：前后端通过。
- `npm run build`：服务端与Web构建通过。
- 首次 `npm test`：75文件通过/1文件失败；1558项通过/1项5秒超时，耗时113.58秒。失败为 requirement.adversarial2 的“并发10条创建”。未改该旧模块；其整文件71项随后单独复测全部通过（并发10条327ms）。本次不声称首次全量全绿。
- 三个指定反例：未来 occurredAt 保留负 latency、withinDeliveryTarget=false；handler 返回 UNAVAILABLE；第三个 subscribe 抛错释放前两个 disposer。均已成为正式回归。
- 其他回归：源故障、缺来源提示数据、200上限真实总数、单快照统计、撤权后读写404、公开视图不含内部诊断、已读重放保留首次时间。
- 内存权限回调只验证端口语义；正式数据库当前权限过滤、激活基线/消费账本、真实生产方与最终AC1/AC2仍属B/A/C集成。
- 浏览器走查未完成：Playwright无已安装浏览器；官方headless shell下载返回无效/截断包，安装失败。没有截图、没有真实端到端通过声明。
