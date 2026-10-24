# B-I34-20261024-notif-runtime-verify-01

- 负责人 / GitHub：githubleelee；角色B；Issue：https://github.com/githubleelee/AIManagement/issues/34
- 工具 / 模型：pi tester（只读复验），实际版本未记录
- agent：b-notif-runtime-verify；指令来源：主控；归档者：B主控
- 精确候选：e3d31c56fbb96553b1d79cca82facebe3bbb0080；对照 main 9160587f08f06ee94c35ea09731d6cb0a024b37d；merge-base 3ed5eaa
- 工作区：/home/lee/aim-wt/notif-verify（detached）；日志 /tmp/notif-verify2/，归档见 evidence/
- 记录时间：2026-10-24T01:10:00+08:00

## 表 5 摘要

| 序号 | 时间 | AI智能体角色 | 任务场景 | 人类输入摘要 | AI输出要点 | 团队处置及理由 |
|---|---|---|---|---|---|---|
| 1 | 精确时刻未记录；本批归档 | B tester | 通知运行时独立复验 | 主控：必跑项 + 自建探针（真实进程/可见性/账本/投影/装配核对） | 结论**可合入、无缺陷**：migrate diff 无漂移、typecheck 0、9 文件/129 例；真实 listen 探针 12/12、调度边界 2/2、可见性 10/10；与 main 合并无冲突且 UML 提交逐字节保留 | 待确认；主控据此合入 main |

## 命令与证据

| 命令 / 探针 | exit | 证据 |
|---|---|---|
| `npx prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | 0 | [migrate-diff](evidence/B-I34-20261024-notif-verify-migrate-diff.txt) `No difference detected.` |
| `npm run typecheck` | 0 | [typecheck](evidence/B-I34-20261024-notif-verify-typecheck.txt) |
| `npx vitest run`（9 文件定向） | 0 | [vitest](evidence/B-I34-20261024-notif-verify-vitest.txt) 129 例全过 |
| 真实 `app.listen` 探针（非 supertest，定时器开启） | 0 | [probe-realprocess](evidence/B-I34-20261024-notif-verify-probe-realprocess.txt) 12/12 |
| 注入时钟调度边界探针 | 0 | [probe-sched](evidence/B-I34-20261024-notif-verify-probe-sched.txt) 2/2 |
| 可见性/账本/投影探针（真实 HTTP） | 0 | [probe-bcd](evidence/B-I34-20261024-notif-verify-probe-bcd.txt) 10/10 |
| `git merge origin/main` 模拟 + 粘性用例复跑 | 0 | [merge](evidence/B-I34-20261024-notif-verify-merge.txt) / [sticky-merged](evidence/B-I34-20261024-notif-verify-sticky-merged.txt) 7/7 |
| `plugin.test.ts` diff 逐条核对 | — | [diff](evidence/B-I34-20261024-notif-verify-plugin-test.diff.txt) |

## 关键事实（原始输出摘录）

- 真实进程：定时器自动启动；`occurredAt = 2026-10-23T16:00:00.000Z`（planEnd 次日 00:00 上海）；幂等键 `task.overdue:<taskId>:<planEnd>`；10s 重复扫描不重复；**重启同库不重置基线、不重复**；桥接自动投递 owner+PM 并落 DELIVERED。
- 调度边界：逾期恰在次日 00:00 触发（DONE 计、CLOSED/未到期不计）；`milestone.due` 08:59:59 不触发、09:00:00 触发、`occurredAt`=当日 09:00，排除启用日前与未来节点。
- 可见性 10/10：撤权/删任务/敏感无白名单隐藏；恢复可见；**风险解绑 taskId 后仍按原事件 `payload.references` 隐藏**；伪造来源归属 fail-closed 404。
- 三端点：未登录 401；越权与不存在 **GET/PATCH 四条响应体逐字相同**；响应不含 `recipientUserId/dedupeKey/sourceEventId/sourceEventName/occurredAt/latencyMs/withinDeliveryTarget`；`total/unreadCount` 同一快照（3/3 → 3/2 → unreadOnly 2/2）；重复已读 `readAt` 冻结；负 latency `-5000` 原样保留。
- 测试装配核对：`plugin.test.ts` 仅顶部一个 hunk；5 个用例名/断言与 main 一致；真实走 `requireAuth`（写库 session），未伪造 `actorUserId`。

## 未验证项与配置风险

- 未跑全量（合并后由主控另跑 #final suite）；未跑 `npm run build`。
- 生产规模下 2s/10s 长时运行未观察（探针窗口约 30s）。
- **配置风险**：`autoStartLoops = NODE_ENV !== 'test'`；默认（未设）= 启动，`npm start` 不带 NODE_ENV 时正常；仅当误设 `NODE_ENV=test` 才不启动（能力会如实降级）。属部署配置项，非代码缺陷。

## 人工复核
- 处置：待确认
