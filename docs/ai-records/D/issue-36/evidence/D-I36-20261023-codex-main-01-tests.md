# #36 评审修正验证（2026-10-23）

验证树：main@caa002cc42c0edad77e1874b76e91ed77576e243 + 本票模块；工作目录 fix36。

- `npm test -- --run src/modules/attachment`：3文件/34项通过（service21、plugin10、storage3）。
- `npm run typecheck`：前后端通过。
- `npm run build`：服务端与Web通过。
- `npm test`：76文件/1556项通过，耗时113.11秒。
- HTTP隔离装配：Fastify + 统一错误出口，测试身份钩子和内存端口，仅注册一次；不调用buildApp，不触碰真实上传目录，不递归删除项目var/uploads。
- HTTP回归：合法上传/列表/下载/单附件删除；viewer/非负责人可读不可写403；outsider与未知ID下载/删除404响应逐字一致；3种未知MIME统一422；扩展名/MIME不符422；超过parser大小限制仍422。
- service回归：250条完整列表返回total250/items250；SetNull错误回调和假任务删除断言已移除，单附件失败重试仍覆盖。
- 未验证：B的真实DB仓储、任务成功删除后的事务标记/清理、启动/定时重试、TaskSection挂载与浏览器完整联调。以上不以本模块夹具冒充通过。
