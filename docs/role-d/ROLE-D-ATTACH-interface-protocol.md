# ROLE-D 接口协议提案：任务附件公共能力（#36）

> 版本：`role-d.attachments.v0.1-draft`
> 日期：2026-10-21
> 代码基线：`origin/main@37287c2`
> 实现分支：`feat/ATTACH-task-attachment`
> 状态：ROLE-D 独立模块已实现并通过测试；数据库、统一权限适配、任务删除钩子、公共路由与任务区挂载尚待 ROLE-B 接入。

## 1. 范围与不做项

#36 提供任务附件的上传、列表、下载、删除、本地实体存储和任务删除后的可重试清理能力。

本期不做外部对象存储、在线预览、版本管理、断点续传、ZIP 解压执行、杀毒服务、内容级脱敏，也不把上传目录公开为静态资源。

## 2. 文件规则

| 扩展名 | MIME |
|---|---|
| png | `image/png` |
| jpg / jpeg | `image/jpeg` |
| webp | `image/webp` |
| pdf | `application/pdf` |
| docx | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| xlsx | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| zip | `application/zip` |

- 单文件最大为严格 SI `10,000,000 B`；恰好等于上限允许，超过 1 字节即拒绝。
- 服务端同时校验扩展名和 MIME；前端校验只用于即时提示。
- 不接受 svg/gif/doc/xls/宏 Office、脚本或可执行文件。
- 实体文件默认落项目根 `var/uploads/`；原文件名只保存为元数据，不参与磁盘路径。
- 磁盘存储键为服务端 UUID + 已验证扩展名，写入使用不覆盖模式。

## 3. 权限端口

```ts
authorization.decide(actorUserId, taskId, operation): Promise<
  | { allow: true; projectId: string }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN' | 'NOT_FOUND' }
>

type operation = 'READ' | 'WRITE'
```

正式适配器必须每次请求现查任务、项目成员、角色和敏感白名单：

| 身份 | 列表/下载 | 上传/删除 |
|---|---:|---:|
| PM | 允许 | 允许 |
| MEMBER（任务可见） | 允许 | 允许 |
| VIEWER（任务可见） | 允许 | 403 |
| outsider / 跨项目成员 | 404 | 404 |
| 敏感任务未授权成员 | 404 | 404 |

当前共享 `Action` 没有附件写动作，因此 D 不修改冻结的 `src/shared/types.ts` 或 `permissions.ts`，由 B 在公共接入时提供适配器并确定最小公共 Action 落点。

## 4. HTTP 接口

```text
POST   /tasks/:taskId/attachments
GET    /tasks/:taskId/attachments
GET    /attachments/:attachmentId/download
DELETE /attachments/:attachmentId
```

上传请求使用原始二进制 body：

```text
Content-Type: 白名单中的准确 MIME
X-File-Name: encodeURIComponent(originalName)
```

采用原始二进制而不是在 D 模块中绑定 multipart SDK，避免未经授权修改 `package.json`。如果公共层以后选择 multipart，只替换传输解析层，仍调用同一个 `AttachmentService.upload()`，不得绕过大小、MIME、权限和路径校验。

## 5. 元数据与仓储端口

建议字段：

```ts
type AttachmentRecord = {
  id: string
  taskId: string
  projectId: string
  originalName: string
  extension: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  uploaderUserId: string
  uploadedAt: string
  state: 'ACTIVE' | 'DELETING' | 'CLEANUP_FAILED'
  cleanupAttempts: number
  cleanupError: string | null
}
```

- API 视图不返回 `storageKey`、`cleanupAttempts`、`cleanupError`。
- 列表仓储必须直接使用 `WHERE taskId = ? AND state = 'ACTIVE'`，计数与列表同源；不得全量读取后内存过滤。
- `storageKey` 唯一；应为 `taskId`、`projectId`、`uploaderUserId` 和状态建立必要索引。
- schema/迁移、数据库仓储和具体外键策略由 ROLE-B 单写落地。

## 6. 删除与失败恢复

单附件删除：

1. 先按任务做 WRITE 权限判断；
2. 元数据标为 `DELETING` 并递增尝试次数；
3. 删除实体文件；
4. 成功后删除元数据；失败则保留 `CLEANUP_FAILED` 和安全错误码，返回 409；
5. 后续用 `retryCleanup()` 重试。

任务删除联动：

- D 提供 `cleanupAfterTaskDeleted(taskId)`，只能在任务删除成功后调用。
- 任务删除失败时不得先删文件。
- 若数据库选择级联删除 Attachment，必须另有同事务写入的 cleanup job 保存待删 `storageKey`；否则任务提交后将失去失败重试依据。
- 若保留 Attachment 清理状态到任务删除后，则不得让外键阻止任务成功删除，并需由后台重试最终清零。
- 上述两种数据库方案由 B 在 schema/旧任务删除入口接入时确认；D 模块不越权修改 `src/modules/task/routes.ts`。

## 7. ROLE-B 公共接入清单

1. 新增 Attachment 元数据表/迁移，按第 6 节选择可追踪的删除方案；
2. 实现数据库 `AttachmentRepositoryPort`，保证列表和计数在查询层过滤；
3. 实现 `AttachmentAuthorizationPort`，复用统一权限数据且满足 PM/MEMBER/VIEWER 矩阵；
4. 在应用组装注入仓储、`LocalAttachmentStorage` 和授权端口；
5. 在 `src/routes.ts` 注册 `registerAttachmentRoutes()`；
6. 在任务删除成功路径接入清理回调/cleanup job，失败时保留重试证据；
7. 将 `var/uploads/` 写入 `.gitignore`，但不把目录公开为静态资源；
8. 在 `TaskSection.tsx` 最小挂载 `TaskAttachmentPanel`，不新建任务详情页。

## 8. 当前实现与未完成项

已实现：8 种白名单、严格 10MB 边界、扩展名+MIME 联合校验、路径穿越防护、不覆盖写入、本地存储、元数据端口、权限端口、上传/列表/下载/删除、可重试清理、任务删除后清理回调和独立前端组件。

尚未完成：数据库表/迁移、真实权限适配、公共路由注册、任务删除入口联动、`.gitignore`、任务区挂载和浏览器端到端截图。内存仓储和测试授权器只验证模块语义，不冒充最终数据库或真实权限验收。
