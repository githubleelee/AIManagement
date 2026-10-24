# #36 任务附件独立模块

本目录实现任务附件的上传、列表、下载、删除、严格 SI 10MB 校验、扩展名与 MIME 联合校验、
本地文件存储端口和单附件删除失败后的重试能力。

边界：

- 白名单固定为 png/jpg/jpeg/webp/pdf/docx/xlsx/zip；ZIP 只保存，不解压执行。
- 实体默认落项目根 `var/uploads/`，存储键由服务端 UUID 生成，原文件名不参与路径。
- 正式权限适配器复用 task.progress：PM/具备该能力的任务负责人可写，其他可见成员只读，outsider 与敏感未授权者 404。
- 列表仓储端口要求数据库按 taskId/state 查询，不能全量读取后在内存过滤计数。
- 删除实体失败时元数据保留为 `CLEANUP_FAILED`，可调用 `retryCleanup()` 重试。
- 任务删除联动由 B 的状态扫描/attachmentCleanup 端口与 C 的任务删除事务接线负责；不再提供按旧 taskId 查询的删除后回调（SetNull 后无法找到附件）。
- 不修改 `src/shared/*`、schema/迁移、`src/app.ts`、`src/routes.ts`、`.gitignore`、任务模块或公共前端骨架。
- 内存仓储仅用于端口语义和测试，不冒充数据库持久化。

上传 HTTP 协议采用允许 MIME 的原始二进制请求体，原文件名放在 URI 编码后的
`X-File-Name` 请求头中。该方式不绑定 multipart SDK；如公共层决定引入 multipart，须保持服务端
`AttachmentService.upload()` 的校验和权限语义不变。

2026-10-24 按冻结 I-4 与 B 复审更正：未知 Content-Type 由框架拒绝时保留 415，
超过路由 bodyLimit 时保留 413；成功解析后的扩展名/MIME 不匹配或严格 10,000,000 B
业务大小检查仍返回 422。解析器允许多读 1 B 以区分业务超限与传输超限，不能把三条路径
统一改写。公共错误处理器保持原样。旧“一概422”的测试/报告只作历史记录，纠正追加留痕。
