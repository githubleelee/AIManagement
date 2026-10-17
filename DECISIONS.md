# DECISIONS

项目级长期决策记录。格式：key / value / timestamp / rationale（一句）。追加式；如需变更，以 `supersedes: <key>@<timestamp>` 注明被取代条目，最新适用条目生效。

---

## `role-d.ai.demo-external-api-scope`

- **value:** 演示部署范围内，AI 先本地桩开发，后续接外部公有云大模型 API；普通虚构教学/演示数据可入外部模型，不要求复杂数据脱敏；仍禁止外发真实密码、token、密钥、真实个人信息及未授权真实资料，被标敏感对象默认不入上下文；具体供应商/模型暂未确定，期间允许先做本地桩和可替换接口，公共端口不绑定供应商 SDK，前端不放 key、backend 从 env 读 key，mock 不得冒充真实 AI 验收，API 切换显式；关键 AI 建议仍由 PM 人工确认后应用并留审计。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 项目负责人明确将本轮演示范围改为可接外部公有云大模型 API，故原「仅本地私有化、真实数据不得外发云」不再作为本轮口径（原 AC13 不声称满足）；含 2026-10-17 补充确认（供应商未定期间先做本地桩与可替换接口）。

## `arch.shared-ports-and-assembly`

- **value:** 公共 AI/事件类型与端口放 `src/shared/`，运行时由 `src/app.ts` 应用组装注入；禁止业务模块互调 service；D 写 AI/事件独立实现，B 落公共接入，A/C 复用端口不调用 D 业务 service；事件域 D 只做传输/存储/订阅/幂等，领域生产者仍由原业务域负责。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 维持单一组装点与依赖方向，避免模块间 service 循环依赖。

## `ownership.public-files-single-writer`

- **value:** 公共文件统一由 ROLE-B = `githubleelee` 修改/合入，D 提交接口/字段/迁移/补丁申请、不并发直接写；范围含 `src/shared/*`、`src/db/schema.prisma` 及迁移、`src/routes.ts`、`src/app.ts`、前端公共骨架、`docs/frontend-routes.md`、`var/uploads` 的 `.gitignore`；`src/modules/authz/permissions.ts` 的权限/签名不在本次授权内，须适用契约另行确认；其他业务域修改权限不自动扩大。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 原冻结归属变更经项目负责人授权给 B 统一写入，保证公共层一致性。

## `attachments.policy`

- **value:** 白名单 png/jpg/jpeg/webp/pdf/docx/xlsx/zip；服务端单文件 ≤10MB，扩展名与 MIME 联合校验（不扩 svg/gif/doc/xls/宏 Office/可执行/脚本）；按字节时用严格 SI 10,000,000 B 且前后端一致；数据库存元数据、实体文件放项目根 `var/uploads/` 并加入 `.gitignore`；下载按任务权限；任务成功删除时元数据与实体同时清理、失败可追踪重试、任务删除失败不先删文件（DB 与文件系统非天然原子）；ZIP 不自动解压运行，不加额外杀毒。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 统一受限类型与体积口径，明确元数据/实体文件的落点与清理约束。

## `notifications.events-timing-timezone`

- **value:** 仅站内通知（不做邮件/短信/企业 IM），时区 Asia/Shanghai；逾期为 planEnd 当日结束后次日 00:00 仍未关闭（含 DONE 未关闭），同任务+截止日期+接收者只提醒一次；覆盖分配、@提及、逾期、验收提交、验收通过/驳回、正式风险新建/等级提升、节点六类事件，接收者与节点固定规则按本次确认表执行（节点：里程碑无单独负责人时只发 PM，有负责人时发 PM + 负责人并去重，不推断他人）；普通事件从业务写入成功计时、定时事件从约定条件成立计时，≤60 秒入库且目标账号可查询，在线同步显示、离线不要求 60 秒打开或已读；不重发相同通知、不泄漏权限。
- **timestamp:** 2026-10-17T17:55:19+08:00
- **rationale:** 冻结通知渠道、事件/接收者映射、计时起点、去重与时效口径，避免各域各自解释；含 2026-10-17 补充确认（节点无单独负责人时只发 PM）。
