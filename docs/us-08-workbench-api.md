# US-08 个人工作台 · 接口说明（本票新增）

> 归属：**角色 A / 工单 #28**。实现位置：`src/modules/workbench/`。
> **本文件不修改** `docs/sprint1-spec-interface-contract.md`：那份是 Sprint 1 冻结契约，
> 改动需走「提出 → 全员确认 → 单人修改 → 通知」流程。本票按该流程**提出**新增端点如下，
> 经仓库 owner 口头批准后先落地实现，**并入契约由技术负责人执行**。

---

## 1. 为什么需要新端点

工作台是**跨项目的个人视角**（"我为负责人的所有任务"），而 Sprint 1 的 30 个端点
全部是**项目内**查询（如端点 26 `GET /projects/:projectId/tasks`）。用现有端点实现需要
「先列出我参与的项目 → 再逐个查 → 前端合并」，有两个问题：

1. 计数会变成前端内存聚合，与契约决策 I-6「计数必须在查询层、禁止内存过滤后计数」冲突；
2. 敏感对象的可见性要在每个项目各算一次，前端无法可靠复用 `visibilityScope()`。

因此新增**一个只读聚合端点**，把 5 块一次算完。

## 2. 端点定义

| 项 | 值 |
|---|---|
| 方法 / 路径 | `GET /me/workbench` |
| 权限 | **登录即可**（`requireAuth`）。范围由"我参与的项目"+ `visibilityScope()` 决定 |
| 请求参数 | 无 |
| 成功响应 | `200`，见下方结构 |
| 失败 | `401 UNAUTHENTICATED`（未登录）；其余同全局错误信封（契约 I-3） |

### 响应结构

```jsonc
{
  "blocks": [
    {
      "key": "todo",              // todo | overdue | accept | mention | upcoming
      "state": "ok",              // ok | unavailable
      "total": 7,                 // state=ok 时为精确总条数；unavailable 时为 null
      "rows": [ /* TaskView[]，最多 50 条 */ ],
      "note": "…"                 // 仅 state=unavailable 时出现，面向界面直接显示
    }
    // …共 5 块，顺序固定
  ],
  "basis": {                      // 计算口径的显式声明，随响应返回
    "asOf": "2026-10-17",
    "todoMeans": "我是负责人、且还没提交验收的任务",
    "overdueMeans": "计划结束日期早于 2026-10-17（按 UTC 日期比较）",
    "upcomingWindowDays": 7,
    "sixStatesNote": "六状态尚未落地，当前把「未关闭」近似为「状态不是 DONE」…"
  }
}
```

明细行**复用共享类型 `TaskView`**（含 `projectId` / `storyId`），前端据此跳转到
`/projects/:projectId/requirements/:storyId` 查看与更新该任务。

## 3. 五块的口径

| 块 | 条件 | 排序 |
|---|---|---|
| `todo` 我的待办 | 我是负责人，且状态不是 `DONE` | `planEnd` 升序，再 `planStart` |
| `overdue` 逾期 | 我是负责人，状态不是 `DONE`，且 `planEnd < 今天` | `planEnd` 升序 |
| `accept` 待验收 | 我是验收人，且状态 `= DONE`（执行人已提交） | `planEnd` 升序 |
| `mention` 被提及 | **暂无数据源** → `state=unavailable`、`total=null` | — |
| `upcoming` 近期计划 | 我是负责人，状态不是 `DONE`，且 `planStart` 或 `planEnd` 落在 [今天, 今天+7] | `planStart`、`planEnd` 升序 |

**两条口径是"当前断言"而非"定论"**（已随 `basis` 返回，便于审查核对）：

1. **"今天"取 UTC 日期** —— 逾期判定时区属待确认项 **C3**，定案后只改
   `service.ts` 的 `isoToday()` 一处。
2. **"未关闭" ≈ 状态不是 `DONE`** —— 六状态（`TODO/DOING/BLOCKED/SUSPENDED/DONE/CLOSED`）
   尚未落地（交接文档 §6 / #24 第 2 点）。当前 `DONE` 表示"执行人提交验收"，
   不等于"验收关闭"，因此这是**近似**；六状态落地后应改为 `status != 'CLOSED'`。

## 4. 可见性与敏感性（契约决策 I-6）

- 项目清单取自 `ProjectMember`（我参与的项目）；**非成员的项目既不在清单里，也不会漏出对象**。
- 每个项目用冻结入口 `visibilityScope(actor, projectId, 'task')` 取作用域：
  - PM → `mode='all'`，不加条件；
  - 其余 → `mode='subset'`，追加 `id IN (ids)`。
- 作用域条件与各块自己的条件**拼进同一个 `where.AND`**，在**查询层**过滤；
  **不存在**"先查全量再在内存剔除"的路径（那会在 `total` 上泄漏敏感对象的存在性）。
- 本项目**不 import** `src/modules/task/` 的任何 service（决策 I-9 禁止跨模块调 service），
  自己查 Prisma 并按 `TaskView` 组装。

## 5. 三态设计（`ok` / `unavailable`，没有 `null` 冒充 `0`）

`mention` 依赖通知模块（**别人的票**，尚未交付）。本端点对它返回
`state='unavailable'` + `total=null` + `note`，而**不是** `total=0`：

> 返回 `0` 会让界面显示"你没有消息"——那是把"还没接上"说成"没有数据"。
> 本仓库前端审查已把同类混淆（把"取不到"渲染成"没有"）登记为问题。

界面约定：`unavailable` 时该块显示「—」并展示 `note`，**不显示"0 条"**。

## 6. 与工单 AC 的对应 / 未完成项

| AC | 本端点是否覆盖 | 说明 |
|---|---|---|
| AC1 5 块、同一数据模型 | ✅ | 5 块一次返回，同源 |
| AC2 个人待办 = 我为负责人且未关闭 | ⚠️ 近似 | "未关闭"待六状态落地后精确化 |
| AC3 逾期 = 计划结束早于今天 | ⚠️ 口径待定 | 时区属 C3 |
| AC4 待验收 = 我为验收人且待验收 | ⚠️ 近似 | 与 #29 状态机一致性待六状态落地 |
| AC5 被提及来自真通知 | ❌ 未覆盖 | 等通知模块；`state=unavailable` |
| AC6 近期计划 | ✅ | 窗口 7 天为本票自定口径 |
| AC7 仅负责人/协作人可更新 | ❌ 写路径未做 | 属第 3 步；"协作人"当前**无数据模型**（C12） |
| AC8 阻塞态必填原因 | ❌ 写路径未做 | 依赖六状态里的 `BLOCKED` |
| AC9 敏感不计入 | ✅ | 查询层过滤，含 `total` |

**结论**：本端点解决 AC1 / AC6 / AC9 与 AC2·AC3·AC4 的**读取部分**；
AC5 等通知模块，AC7 / AC8 属第 3 步（写路径）。
