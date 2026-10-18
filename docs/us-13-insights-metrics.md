# US-13 四类指标聚合 · 实现说明（本批次）

> 归属：**角色 A / 工单 #33**。本文件说明**已实现的那一块**（四类指标的聚合计算）。
> 设计文档见 `docs/us-13-ai-insights-design.md`（那份是设计，含建议对象、处置与审计的设计；
> 本文件只讲本轮落地了什么、口径从哪来、什么还没做）。

---

## 1. 本批次做了什么

`src/modules/ai-insights/`：

| 文件 | 作用 |
|---|---|
| `types.ts` | 四类指标的类型与线上常量（含 D §2.1 的四个场景值） |
| `aggregate.ts` | **纯聚合层**：只吃「计数事实」，无 Prisma、无 I/O |
| `metrics.ts` | **取数层**：判权 → 取可见性作用域 → 查库 → 组装计数事实 → 附口径声明 |
| `aggregate.test.ts` | 纯计算用例 28 条（口径边界，不需要数据库） |
| `metrics.test.ts` | 取数层用例 18 条（判权、C6、敏感、只读、数据边界、与 #30 交叉校验） |

分两层不是风格偏好：取数层**只取计数**，因此标题 / 描述 / 人名**没有机会**进入结果
（由类型保证）；口径边界可以用不建库的用例逐条钉住。

## 2. 本批次**没有**做（等 D 的公共层 / 另行授权）

- **不建表、不加迁移** —— 建议与处置走 #31 的共享存储（`ai.suggestion-store-shared`）；
- **不加 `Action`、不判处置权限** —— 与 #32 合并为同一个动作（`permissions.ai-suggestion-disposal`）；
- **不注册路由、不实现端点** —— AC5 要接入 #31 公共端口后才生成建议；
- **不做建议生成 / 处置 / 采纳率统计**；
- **不 import 其它模块的 service**（契约 I-9）。

## 3. 口径来源（AC6：与 #30 一致，不各自定义）

| 类别 | 口径 | 来源 |
|---|---|---|
| 进度 | 已关闭 ÷ 总数（`DONE` 不计入）；计划时间进度含首尾；偏差 = 计划 − 实际（pp）；≤10 / ≤25 / >25 分级 | **直接 import #30 的纯函数**：`analytics/service.ts` 的 `planTimeDaysOf` / `healthOf` 与两个阈值常量 |
| 计划窗口 | **可见窗口**：分子、分母与计划区间同源同窗口 | DECISIONS `analytics.dashboard-window-basis` |
| 质量 | 驳回数 / 重验次数 = Σ max(0, 该任务记录数 − 1) / 驳回率（分母 0 → `null`）/ 卡住任务数 | #29 的 `AcceptanceRecord` 与任务六态（本模块定义并写进 `basis`） |
| 风险 | 未解决 = 未处理 + 处理中；`byLevel` 只统计未解决 | 与 #30 的关闭阻断**同源**（`RESOLVED` / `CLOSED` 不阻断） |
| 效率 | 负载 = 负责人名下非 `CLOSED` 任务数（**含 `DONE`**） | #27 与 DECISIONS `scheduling.load-aggregation-baseline` |

**为什么不复制进度公式**：那份公式刚被独立评审修掉一个浮点边界缺陷（H2，
`(0.4−0.3)×100 = 10.000000000000004 > 10` 把正好落在阈值上的情形错分）。复制一份
等于把缺陷搬进一个没有交叉校验用例的新模块。现在的关系是**单向依赖纯函数**
（`ai-insights → analytics`，只取无 I/O、无鉴权的纯函数，不调 `buildDashboard`），
且 `metrics.test.ts` 有两条例接口层**交叉校验**：同一批造数下，本模块的进度 / 健康度 /
计划窗口必须与 `GET /projects/:projectId/dashboard` **逐字段相等**（PM 与非 PM 各一条）。
哪天 #30 改了口径，这两条会立刻红。

## 4. 数据边界（设计 §5.1 第 2 条）

- 结果**只含计数 / 比率 / 天数**：不含任务标题、描述、驳回原因原文、成员姓名或账号；
- 成员维度**只给匿名键** `memberKey = sha256("ai-insights:member:" + projectId + ":" + userId)`
  前 12 位十六进制：同项目同一成员稳定，跨项目不同（防跨项目串联）；
- **只读**：不写库、不写审计、不发事件（用例钉住「调用前后行数不变」）；
- 可见性在**查询层**过滤（契约 I-6）：任务 / 验收 / 风险三侧拼同一个作用域；
  敏感风险继承所关联任务的可见性（#30 批复第 7 项）。

上述四条都有用例：结果里搜不到任何标题 / 姓名 / 账号 / `taskId` / `riskId`。

## 5. 已知限制（算不出来的，如实登记在响应的 `unavailable` 里）

1. `quality.avgAcceptanceDays` **恒为 `null`**：库里没有「任务何时进入待验收（`DONE`）」
   的时间戳。用「创建 → 验收」冒充会把整个执行时长当成等待时长，故不用 0 或替代值冒充。
2. `doingTasks` / `pendingAcceptanceTasks` 只给**数量**（积压规模），给不出**滞留天数**
   —— 同样缺状态变更时间戳。
3. **敏感对象的 AI 参与子集**（`sourceCount` / `includedCount` / `excludedSensitiveCount`，
   D §2.3）属**生成层**，本票不产出；且非 PM 一律不得产出 —— 那会泄漏敏感对象的存在性。
4. **不设「超过 N 即过载」阈值**：阈值属业务裁定，不在聚合层发明。
5. **本批次无端点**：调用方是未来的生成层；用例直接调取数层函数（唯一走 HTTP 的是
   #30 的仪表盘，用于交叉校验）。

## 6. 复现

```
npx vitest run src/modules/ai-insights/aggregate.test.ts src/modules/ai-insights/metrics.test.ts
# → 2 files / 46 passed

npx vitest run      # 全量：58 files / 1338 passed，0 skipped（2026-10-19）
npx tsc -p tsconfig.json --noEmit && npx tsc -p web/tsconfig.json --noEmit   # 双端 exit 0
```
