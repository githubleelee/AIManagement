<!-- role-c-issue120-consumers-and-uml-closeout-20261024-v1 -->
## ROLE-C：附件消费点已交付；UML 评审 5 项已收口；FS 表述更正

@githubleelee @pHurYmaL 回复 #120 comment6382741186（拆双道）与 #35 comment-6382843376（已关闭）。

### 1. #36 两处消费点已交付（不再等 #32）

- 分支 `feat/C-attachment-consumers`，已推送 **`fb4fe3089a561af217b093698bdaf45e1d95511a`**（ls-remote 核对一致）。
- 基于 B 候选 `f516b20` + main `d898cdd`。`task/routes.ts` 真实 DELETE 改为同事务 `markForTaskDeletion → 清可见性 → 删任务`，提交后 `run()`，失败可观察/可重试、不谎报回滚；`TaskSection` 挂真实 D 面板并按 PM/负责人现查授权，VIEWER 负责人只读。
- 组合基线 **17 文件 / 218 passed / 0 failed / 0 todo，exit 0**；正式 TaskSection Chromium 9 项、正式 UML 16 项、两端 typecheck 与 build 全 exit 0。
- 细节与边界：[#36 回执](https://github.com/githubleelee/AIManagement/issues/36#issuecomment-6383136549)

### 2. #35 PB-07 五项非阻断跟进已处理

你在 comment-6381862601 列的五项，我按原意处理，未改 B 的 shared/app/routes 或冻结 I-4 错误码：

1. **P2003**：非边来源退化为**不带 field 的通用 422**；只有 `umlEdge.createMany` 上下文保留 `edges.sourceNodeId`。新增 5 项真实 SQLite trigger/HTTP 用例（非边 FK 无 edges 字段、edge FK 准确、唯一性定位、整事务回滚）。
2. **wire↔editor 往返**：新增纯函数 Vitest 5 项（反向 association、null 标签、三类消息/自消息、换序与服务端 seq 权威、非法投影拒绝），不再只有浏览器脚本证据。
3. **P2002**：已知 edge/四类关联写入返回真实字段 + `DUPLICATE`；无法定位的顶层冲突不伪造字段。
4. **过期注释**与 **verification.md 历史导航**：已修，指向 main 的 `sensitivity.ts` 实际写点。
5. **计时型侧信道（LOW）**：仍列为已知非阻断项，未声称抹平常数时延。

### 3. 更正 FS 表述

`cc67e33` 已是 origin/main 祖先，`src/modules/acceptance/service.ts:287` 实际调用 `taskStartGuard.assertCanEnterDoing`。**A 的 FS 守卫不是待交付项**，我不再按旧表催办，也不代认领 A 的 9 项证据。

### 4. 仍需如实保留的限制

- 组合全量绿不等于全库绿；旧 worker 异常根因未证明修复，本批未跑全库。
- 早期组合运行出现过 `success=true / exit1 / 4 pending` 不一致（日志保留），最终组合头重跑 218 项完整 exit0 取代该结论。
- 已失去关联且无可靠历史证据的旧 UML 图仍不能凭当前表宣称全覆盖；按既定口径由你/DRI 收口，不默认公开未知历史。
- 排程由另一 C 会话单写，本会话未碰其提交、未代发 #32。

未合 PR、未关闭工单、未改 main。请从 `fb4fe30` 整体接续，避免只取最后一笔而漏掉 UML 祖先修正。
