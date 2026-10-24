# #36 错误状态修正与前次记录更正（2026-10-24）

## 权威依据与历史更正

冻结契约 `docs/sprint1-spec-interface-contract.md` I-4 明确保留框架 413/415。
B 在 PR94 comment-6368193098 撤回此前“一概422”的要求。本轮删除 D 上传路由级 errorHandler 的改写。
**前次将 B 的415测试称为“旧断言”的判断不准确，该断言正确。**
旧 AI 记录、54通过/1失败原始输出、真实运行 JSON、截图和脚本全部保留原样；前次422观测是当时行为，不能作为冻结契约正确性的依据，也不代表当前正确行为。

## 三种路径分别验证

| 路径 | 输入 | 预期与实测 |
|---|---|---|
| 框架 MIME 拒绝 | image/svg+xml 原始请求体 | 415 |
| 框架传输大小拒绝 | 10,000,002 B，超过 bodyLimit=10,000,001 B | 413 |
| 已解析后的业务超限 | 10,000,001 B | 422 VALIDATION_FAILED |
| 已解析后的扩展名/MIME 不匹配 | image/png + a.pdf | 422 VALIDATION_FAILED |
| 严格合法边界 | application/pdf，10,000,000 B | 201，sizeBytes相同 |
| 解析器封装（B候选） | POST /projects + application/pdf | 415，不被附件parser污染 |

保留 preHandler/bodyLimit/业务translate，不改公共error-handler或顶层错误码。独立附件组件在真实404后不再同时显示“正在加载…”。

## 基线和结果

- 原PR分支：b5407058345ec6ab8a786edb136b15585eb59548 + 本次 D 自有文件修复。
- 独立模块：3文件/36项通过；前后端typecheck和build退出0。
- 真实DB组合：B候选902cfa1e2cbe8a4dfbc29f9c2653a8abc834a20e + 本次D附件模块，6文件/63项通过（附件、DB仓储/清理、skeleton）。B原415断言原样通过。
- 两套验证树均完成类型检查与构建，未跑全量。不把前次main全量数字移用于本组合。
- 新脚本通过真实迁移临时SQLite、隔离mkdtemp目录、生产buildApp、真实HTTP登录执行上表6条；没有mock请求。原始输出：20261024-http-and-browser-results.json。
- 页面截图：screenshots/20261024-error-without-loading.png。复用真实TaskAttachmentPanel的额外独立验证页，外部账号收到真实404，错误可见且加载提示不存在；它不代表正式TaskSection已经挂载。

## 最新main组合的独立限制

尝试 main568cc1b 与 B候选902cfa1 试合并时，公共文件 DECISIONS.md、src/db/schema.prisma、src/routes.ts、test/db-schema-contract.test.ts、test/db-schema.test.ts 发生冲突。已撤销本地试合并，**未裁定或提交任何公共文件**。本轮真实组合验证因此明确限定在B902候选，不声称最新main整合通过；B须按其公共单写归属协调。

C 的真实任务DELETE事务标记/提交后清理与正式TaskSection挂载仍未交付，本轮不接管，也不重复制造已完成结论。

## 重放

20261024-status-regression.mts 使用EVIDENCE_ISSUE=36。归档HTML/TSX分别放到web/attachment-status-regression.html、web/src/pages/attachment/status-regression.tsx后，在上述B+D组合运行。
Playwright位置用EVIDENCE_PLAYWRIGHT_MODULE，浏览器路径用EVIDENCE_CHROMIUM_PATH；可选EVIDENCE_CHROMIUM_ARGS_MODULE指定便携Chromium参数模块。临时库和上传文件不交付，生成fixture只含合成任务ID，不含会话令牌。
