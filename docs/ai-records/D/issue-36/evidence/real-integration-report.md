# #36 真实 API / 独立组件联调证据（2026-10-23）

## 结论

附件独立组件可在真实迁移库、真实 HTTP、真实本地文件存储上走通上传、列表、下载和单附件删除；正式任务页挂载及任务删除清理仍未完成。**本记录不表示 #36 最终验收通过，也不是已上线证明。**

## 精确组合

- main：`014555ba7843863ef7230956b89081b8ccd2f461`。
- B 候选：`feat/attach-public-integration@3086cee`（完整 SHA 与文件散列见 tested-manifest.json）。
- D 模块：`feat/ATTACH-task-attachment@8a4a328a4d09f493ef204e546f1c0f9f83100ed9`。
- 仅在本地验证树组合以上代码。B 的公共文件、旧任务入口未作人工改写；不将 B 候选分支提交到 D 原 PR。
- 使用现有 `createTestContext → buildApp({prisma, uploadRoot})`；新建临时 SQLite 并执行真实迁移，使用隔离 mkdtemp 上传目录。只有合成测试数据。登录走真实 `/auth/login`，业务请求走监听端口，浏览器无请求 mock。

## 实测结果

| 检查 | 实测结果 | 判定 |
|---|---|---|
| 负责人上传 / 查看 / 下载 | 201 / 200 / 200；下载字节与上传内容一致；磁盘文件真实存在 | 通过 |
| VIEWER 与非负责人 MEMBER 上传 | 均 403；VIEWER 可读 | 通过 |
| 项目外用户列表 | 404 | 通过 |
| 不支持 MIME / 超 10,000,000 字节 | 422 VALIDATION_FAILED | 通过 |
| PM 经真实敏感接口撤去 VIEWER 可见权 | 列表、下载、删除均 404；未知 ID 与不可见下载响应逐字节一致 | 通过 |
| 单附件删除 | 204，真实元数据和物理文件均消失 | 通过 |
| 真实库 250 行附件列表 | total=250，items.length=250 | 通过 |
| 真实任务 DELETE 后自动清理 | DELETE 204；再等 31 秒，附件仍 ACTIVE / taskId=null，物理文件仍在 | **未通过** |
| 正式故事详情任务区 | 没有 TaskAttachmentPanel 挂载 | **未完成** |

脚本中 17 次 HTTP 预期状态断言完成，另有一条明确为 false 的生命周期结论；不把脚本正常退出解读为整体验收通过。原始响应见 real-http-results.json。

## 页面证据

| 文件 | 含义 |
|---|---|
| screenshots/01-owner-empty.png | 负责人独立组件空列表 |
| screenshots/02-upload-listed.png | 真实浏览器选择文件并上传，返回后显示文件 |
| screenshots/03-download-click.png | 下载按钮操作后的页面；下载事件、文件名和字节断言见脚本 |
| screenshots/04-viewer-read-only.png | VIEWER 能看到文件，无上传/删除按钮 |
| screenshots/05-outsider-hidden.png | 真实 API 404，不显示文件名 |
| screenshots/06-single-delete.png | 浏览器删除后列表清空 |
| screenshots/07-production-task-section-not-mounted.png | 正式故事详情没有附件入口，作为阻断证据 |
| screenshots/08-sensitive-viewer-hidden.png | PM经正式敏感设置接口标敏后，原可见VIEWER收到404且看不到文件名 |

前六张及第八张使用**额外的独立组件验证页**，页面显著标注环境与限制，直接复用原 TaskAttachmentPanel，不改正式 TaskSection 或路由表。它们证明组件对真实接口的交互，不证明产品入口已挂载。下载截图自身不证明文件字节，脚本另有字节断言。现有组件在加载失败后还会保留“正在加载”提示，此显示问题如实保留在截图中。

## 测试与构建

- 通知不在本验证树内；本树附件模块及 B 附件仓储/清理测试：5 文件，54 通过、1 失败。
- 唯一失败：B `attachment-repository.test.ts` 的旧断言期待未知 MIME 返回 415，实际按冻结修复为 422。未改 B 测试、未删除或跳过失败断言。原输出见 validation-tests.txt。
- 前后端 typecheck 与 build：退出码 0；原输出见 validation-typecheck.txt / validation-build.txt。
- 本轮未跑全量，不沿用前次全量数字冒充本组合验证。

## 重放与后续责任

real-runtime.mts / browser-runtime.mjs 是本次运行脚本；额外页面源文件 attachment-evidence.html、evidence-runtime.tsx 一并归档。将 HTML 放到 web/，TSX 放到 web/src/pages/attachment/ 后，以本组合执行 `EVIDENCE_BROWSER=1 node --import tsx docs/ai-records/D/issue-36/evidence/real-runtime.mts`。脚本中的 Playwright、便携 Chromium 导入路径是本次运行环境路径，其他机器须替换为自己的安装位置；不要上传生成的临时库、上传目录或会话令牌。页面 fixture 由脚本自动生成，运行时含合成标识，无密钥。

B 协调当前 task 写者，在正式删除事务内调用已注入的标记端口，提交后执行可观测清理并补失败恢复；由授权 owner 挂载正式组件。上述完成后再取新的真实端点及页面证据。本轮不合 PR、不关票，不改公共冻结区。
