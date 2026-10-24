# A-I34-20261024-task-events — 任务域事件通道补齐（#34 两处生产点）

- 负责人 / GitHub：pHurYmaL / `@pHurYmaL`（ROLE-A，兼本周 DRI）
- Issue：https://github.com/githubleelee/AIManagement/issues/34
- 工具 / 模型：DeepSeek Harness（DSH）· `deepseek-v4-flash`
- 指令来源：人类直输
- 基线 commit：`30db8ff`
- 记录时间：2026-10-24（UTC+08:00）
- 原始会话导出：**缺口**（AI 无法导出自身会话原文；本文件为摘要，见文末）

## 背景

#34 的九类通知里，`task.assigned` 与 `acceptance.submitted` 长期停在"生产方尚未接入"。
B 与 C 分别转向更紧急事项后，余下未完成项由 A 承接；本批补齐任务域的**唯一事件通道**
（此前 gantt / requirement / risk / acceptance 四域都有 `event-port.ts`，唯独 task 没有）。

## 改动

| 文件 | 内容 |
|---|---|
| `src/modules/task/event-port.ts`（新增） | 任务域事件端口：`TaskEventName` / `TaskEventDraft` / `TaskEventPort` / `createTaskEventPort`。幂等键**一律按发生次**（含 `occurredAt`） |
| `src/modules/task/routes.ts` | 端点 24（创建）由裸 `create` 包成 `$transaction` 并追加 `task.assigned`；端点 28 在既有事务内追加 `task.assigned`（**负责人实际变化**时）与 `acceptance.submitted`（**真实进入 DONE** 时）。新增 `publishTaskEvent`：敏感判定在**同一事务内**读 `Task.isSensitive`，敏感任务载荷只能是 `{references}` |
| `src/routes.ts` | `RouteContext.taskEvents`（可选字段，缺失时 `registerTaskRoutes` fail-fast） |
| `src/app.ts` | 与其它四域同处组装：`createTaskEventPort({ repository: eventRepository })` |
| `src/db/notification-runtime.ts` | 两事件从"未接"改判 **AVAILABLE**（依据见下方真实探针）；仍缺者只剩后置的 `task.mentioned` |
| `src/modules/task/task-events.test.ts`（新增） | 11 例：创建/改派/同值不发/进入 DONE/重复 DONE 不发/驳回后重新提交仍发/敏感只 references/创建与状态流转时事件失败整笔回滚 |
| `src/db/notification-{runtime,http}.test.ts` | 能力断言由"六类中四类可用"同步为"六类可用、仅 @提及 未接" |

### 幂等键为什么"按发生次"

同一任务可被**多次改派**，也可被驳回后**重新提交 DONE**。若按 `<eventName>:<taskId>` 计，
第二次真实发生会被静默吞掉 —— 与 `risk.level-raised` 当年踩的坑同源
（技术负责人 GitHub #20 评论 6358121473）。故两个事件统一使用
`<eventName>:<objectId>:<occurredAt ISO>`，同毫秒内重复仍会被合法去重。

## 验证

### 1. 模块测试（套件内）

`npx vitest run src/modules/task/task-events.test.ts` → **11 例通过**（另 2 例 skip，原因见下）。

关键覆盖：同值不发、重复 `DONE` 不发、**驳回回 DOING 后重新提交仍发第二条**、
敏感任务载荷只有 `references`、**创建与状态流转时事件写入失败 → 整笔业务回滚**
（注入点在事务客户端的 `domainEvent.create`，与 `task-delete.adversarial` A4 同法）。

### 2. 端到端（真实进程探针，非 mock）

套件内两例**刻意 skip**：`src/app.ts` 在 `NODE_ENV === 'test'` 下传 `autoStartLoops: false`，
消费桥接的 2 秒定时器不启动，因此测试进程里通知行不会被产生 —— 这是设计如此，不是缺陷。
端到端验证改用真实进程：

```
npx tsx docs/ai-records/A/issue-34/evidence/probe-task-events.mts   # 需 NODE_ENV 非 test
```

实测结果（`probe-task-events-output.json`）：

| 链路 | 事件 | 期望收件人 | 实际收件人 | 通知标题 | latencyMs | 是否达标 |
|---|---|---|---|---|---|---|
| 创建任务 | `task.assigned` | 任务负责人 | 负责人 ✓ | 新任务分配 | 1836 | true |
| 提交验收（DONE） | `acceptance.submitted` | 任务验收人 | 验收人 ✓ | 任务已提交验收 | 1962 | true |

同时确认两条 `DomainEvent` 行由任务域真实生产（`sensitive: false`）。

### 3. 回归

- `npx tsc -p tsconfig.json --noEmit` → exit 0
- `npx tsc -p web/tsconfig.json --noEmit` → exit 0
- `npx vitest run` → **104 文件通过 + 1 跳过 / 2061 例通过 + 2 跳过 + 12 todo / 0 失败**

## 未做 / 缺口

1. **会话原始导出**：AI 无法导出自身会话原文，本文件为摘要；需人类从工具端导出后并排保存。
2. **套件内端到端用例**以 `it.skip` 保留：待桥接测试夹具可用后直接启用（断言与收件人口径已写好）。
3. `task.mentioned`（@提及）仍为**明确后置**项，本批未接入、未新建 Mention 模型。
4. 本批未改动 `task` 的鉴权、FS 开工守卫、附件生命周期与删除语义；未新增 HTTP 端点、未新增依赖。
