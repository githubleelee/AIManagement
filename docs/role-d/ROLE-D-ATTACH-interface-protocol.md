# ROLE-D 接口协议提案：任务附件公共能力（#36）

> 版本：`role-d.attachments.v0.2-review`
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
| MEMBER（可见且为具备 task.progress 能力的任务负责人） | 允许 | 允许 |
| MEMBER（其他可见成员） | 允许 | 403 |
| VIEWER（任务可见） | 允许 | 403 |
| outsider / 跨项目成员 | 404 | 404 |
| 敏感任务未授权成员 | 404 | 404 |

WRITE 复用既有 `task.progress`，READ 复用任务可见性；不新增 Action 或模块内角色分支。B 在公共层现查权限，D 只调用端口。

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
- 本能力沿用完整列表：不得自行 take:200；250 条须返回 250 条与 total=250，不套用通知分页规则。
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

- 移除按 taskId 查找的删除后回调；SetNull 后该回调无法定位附件，内存测试不证明真实删除联动。
- B 提供窄 `attachmentCleanup` 生命周期端口，C 在同一任务删除事务内标记 DELETING，再清可见性、删任务；提交后经注入端口触发清理。
- B 负责启动扫描与30秒失败重试；保留失败状态并记录异常。任务事务失败不得先删文件。
- D 不越权修改 task/shared/schema/app/routes；真实端点联动证据由 B/C 批次补齐。

## 7. ROLE-B 公共接入清单

1. 新增 Attachment 元数据表/迁移，按第 6 节选择可追踪的删除方案；
2. 实现数据库 `AttachmentRepositoryPort`，保证列表和计数在查询层过滤；
3. 实现 `AttachmentAuthorizationPort`，复用统一 task.progress 和任务可见性；
4. 在应用组装注入仓储、`LocalAttachmentStorage` 和授权端口；
5. 在 `src/routes.ts` 注册 `registerAttachmentRoutes()`；
6. 由 C 在任务删除事务内标状态，提交后调用 B 注入的清理端口，失败可重试；
7. 将 `var/uploads/` 写入 `.gitignore`，但不把目录公开为静态资源；
8. 在 `TaskSection.tsx` 最小挂载 `TaskAttachmentPanel`，不新建任务详情页。

## 8. 当前实现与未完成项

已实现：8 种白名单、严格 10MB 边界、扩展名+MIME 联合校验、路径穿越防护、不覆盖写入、本地存储、元数据端口、权限端口、上传/列表/下载/删除、单附件删除重试和独立前端组件。未知或不可见附件的404响应逐字一致；上传端点不支持 MIME 与超限均抛统一422，由公共错误出口成型。

尚未完成：数据库表/迁移、真实权限适配、公共路由注册、任务删除入口联动、`.gitignore`、任务区挂载和浏览器端到端截图。内存仓储和测试授权器只验证模块语义，不冒充最终数据库或真实权限验收。
