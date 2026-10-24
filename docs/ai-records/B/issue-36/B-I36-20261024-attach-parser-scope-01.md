# B-I36-20261024-attach-parser-scope-01

- 负责人 / GitHub：githubleelee；角色B；Issue：https://github.com/githubleelee/AIManagement/pull/94（#36）
- 工具 / 模型：pi 主控（本记录为第二轮附件修正的主控执行），实际版本未记录
- 指令来源：主控依据独立复审结论；父记录：[修正版复审](B-I36-20261023-attachment-review-02.md)、[I-4纠错](B-I36-20261023-main-correction-02.md)
- 工作区：/home/lee/aim-wt/b-attach（分支 feat/attach-public-integration）
- 起始基线 3086cee97540fec0bea0c6715e6d04b4d4407f3f；本批结束 902cfa1e2cbe8a4dfbc29f9c2653a8abc834a20e（已 push，远端 ref 一致）
- 记录时间：2026-10-24T00:15:00+08:00；命令时间为实际运行时刻

## 表 5 摘要

| 序号 | 时间 | AI智能体角色 | 任务场景 | 人类输入摘要 | AI输出要点 | 团队处置及理由 |
|---|---|---|---|---|---|---|
| 1 | 2026-10-24 00:06-00:15 | B主控 | 复核并修正上传解析器作用域 | 主控据复审：根 app 注册 8 个附件 MIME parser 会让其它端点不再 415 | 改回 `app.register` 封装子上下文；独立探针实测 POST /projects+application/pdf 恢复 415，附件路由仍消费该 MIME（未登录 401 而非 415） | 待确认；保留同步 fail-fast，不引入 hasRoute/skip |
| 2 | 同批 | B主控 | 恢复决策记录追加式 | 主控据复审：23c4704 就地重写 attachments 条目违反追加式 | 原文逐字恢复 + 新条目以 `supersedes` 追加并写明曾被就地重写 | 待确认；未删除任何历史 |
| 3 | 同批 | B主控 | 如实记录组合事实 | 主控要求不造绿 | main 版 plugin.test.ts（用真实 app + 自行再注册）与封装注册冲突报 FastifyError；该文件正是 D PR94 已替换为 bare Fastify 的版本 | 待确认；B 未改 D 文件、未加生产守卫，组合顺序为先 D #94 再 B/C |

## 实际命令与证据（cwd=/home/lee/aim-wt/b-attach）

| 命令 | exit | 证据 |
|---|---|---|
| `npm run typecheck` | 0 | [typecheck](evidence/B-I36-20261024-parser-fix-typecheck.txt) |
| `npx vitest run src/db/attachment-cleanup.test.ts src/db/attachment-repository.test.ts src/modules/attachment/local-storage.test.ts src/modules/attachment/service.test.ts test/skeleton-smoke.test.ts` | 0 | [tests](evidence/B-I36-20261024-parser-fix-tests.txt)：5 文件 50 例 + skeleton-smoke 6 例（含 37 路由断言中的 4 条附件路由） |
| 临时探针 `npx vitest run src/db/__parser-scope.probe.test.ts`（跑后删除） | 0 | [probe](evidence/B-I36-20261024-parser-scope-probe.txt)、[源码](evidence/B-I36-20261024-parser-scope-probe-source.ts.txt)；2 例通过 |
| 同一次运行含 `src/modules/attachment/plugin.test.ts`（main 版） | 1 | 见 [tests 日志](evidence/B-I36-20261024-parser-fix-tests.txt) 开头 FastifyError「Method 'POST' already declared」；**已知组合冲突**，D PR94 版本已改为 bare Fastify，未由 B 代改 |

## 探针断言（真实 buildApp + 临时 SQLite）

1. `POST /projects` + `Content-Type: application/pdf` → **415**（封装前会被解析后走业务 422）。
2. `POST /tasks/t-1/attachments` + `Content-Type: application/pdf` → **401**（说明附件路由仍消费该 MIME，框架 415 未被误触发）。

## 限制与未做

- 未跑全量；未改 D 的 plugin/测试/协议；未接 C 的真实任务删除与 TaskSection。
- 探针为临时文件、已删除，非仓库常驻测试；若后续需要常驻回归，应在 D #94 合入后补入合适位置（不在本次越界新增）。
- 探针只覆盖 MIME 作用域与附件路由消费两点，未覆盖真实下载/清理端到端（已在其它记录覆盖）。
- 公共候选仍不合入：真实 DELETE 孤儿与 TaskSection 未挂载由 C 负责。

## 人工复核
- 处置：待确认
