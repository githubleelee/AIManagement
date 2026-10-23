# #36 任务附件独立模块

本目录实现任务附件的上传、列表、下载、删除、严格 SI 10MB 校验、扩展名与 MIME 联合校验、
本地文件存储端口和任务删除后的可重试清理回调。

边界：

- 白名单固定为 png/jpg/jpeg/webp/pdf/docx/xlsx/zip；ZIP 只保存，不解压执行。
- 实体默认落项目根 `var/uploads/`，存储键由服务端 UUID 生成，原文件名不参与路径。
- 正式权限适配器须现查任务权限：PM/MEMBER 可写，VIEWER 只读，outsider 与敏感未授权者 404。
- 列表仓储端口要求数据库按 taskId/state 查询，不能全量读取后在内存过滤计数。
- 删除实体失败时元数据保留为 `CLEANUP_FAILED`，可调用 `retryCleanup()` 重试。
- `cleanupAfterTaskDeleted()` 只能在任务删除成功后调用；任务删除失败不得先调用。
- 不修改 `src/shared/*`、schema/迁移、`src/app.ts`、`src/routes.ts`、`.gitignore`、任务模块或公共前端骨架。
- 内存仓储仅用于端口语义和测试，不冒充数据库持久化。

上传 HTTP 协议采用允许 MIME 的原始二进制请求体，原文件名放在 URI 编码后的
`X-File-Name` 请求头中。该方式不绑定 multipart SDK；如公共层决定引入 multipart，须保持服务端
`AttachmentService.upload()` 的校验和权限语义不变。
