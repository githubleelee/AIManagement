# ROLE-C GitHub 工作核查（2026-10-24，main = `faef5ff`）

核查方式：GitHub API 读取全部 122 个 Issue 状态与正文/评论 + `git` 对照 `origin/main` 实际文件内容。只读，不改票、不合 PR。

## 一、ROLE-C 名下票：全部 closed

| 票 | 标题 | 状态 | 关闭依据 |
|---|---|---|---|
| #22 | ROLE-C 汇总：AI 排期 / 在线 UML | closed | DRI 2026-10-24 裁定：两子票达可结项状态 |
| #32 | US-12 AI 排期建议 | closed | C 实现已合 main `455701e`；A 接手完成 12 门禁；PB-01/PB-02 CLOSED |
| #35 | US-15 在线用例图 / 时序图 | closed | AC1–AC5 通过；AC6 按「本期不提供上传路径」验证 |
| #36 | 附件公共能力：任务附件 | closed | DRI 复核 DoD 四项满足；C 两处消费点合入 main `dc9a9ba` |
| #120 | C→B 剩余阻塞汇总与单写窗口 | closed | 阻塞解除后关闭 |

全仓 122 个 Issue 现均为 closed，2026-10-24 13:28–14:23 之间批量收尾。

## 二、我（本会话）的代码交付：全部已在 main

`origin/main = faef5ff`（2026-10-24 22:22）。

| 提交 | 在 main | 内容 |
|---|---|---|
| `fb4fe30` | ✅ | 附件生命周期接线 + TaskSection 面板 + 250 文件输入测试 |
| `22bd2ba` | ✅ | #36/#120 交付回执 |
| `952afba` | ✅ | UML fixture 会话签发顺序修正 |
| `84c8985` | ❌ | AI 使用记录归档（仅在本分支，未合） |

main 实际存在的产物：

- `web/src/pages/task/TaskAttachmentSlot.tsx`
- `src/modules/task/task-attachment-lifecycle.http.test.ts`
- `src/modules/task/task-attachment-input.http.test.ts`
- `src/modules/uml/uml-constraints.http.test.ts`
- `web/src/pages/uml/api.roundtrip.test.ts`
- `src/modules/uml/frontend.vitest.config.ts`
- `docs/role-c/issue-36/delivery.md`、`docs/role-c/issue-35/formal-delivery.md`
- `TaskSection.tsx` 含 `id={\`task-${t.id}\`}` + `tabIndex={-1}` + `scrollIntoView`
- `routes.ts` 含 `attachmentCleanup.markForTaskDeletion(tx, task.id)`

## 三、Backlog 与 main 状态不一致（文档欠账，非代码欠账）

| 项 | Backlog 标注 | main 实际 | 判定 |
|---|---|---|---|
| PB-05 附件 C 消费点 | CLOSED | 已合 main `dc9a9ba` | 一致 |
| **PB-06** 图→任务 `#task-<id>` 锚点 | **OPEN**（「现链接跳到需求页但不高亮任务」） | `TaskSection.tsx` 已有可见行匹配 + `scrollIntoView` + `focus` + `id`/`tabIndex`；正式浏览器 16 项含锚点/深链/历史用例通过 | **代码已完成，Backlog 过时** |
| **PB-07** UML 5 项非阻断跟进 | **OPEN** | `service.ts:82` 非边 P2003 → 无 field 通用 422；`:94` 仅 `edgeEndpoints` 用 `edges.sourceNodeId`；`:93` P2002 → 409 + `DUPLICATE`；过期注释已移除；`verification.md` 已加 2026-10-21 历史快照导航 | **4/5 已完成，Backlog 过时** |
| PB-07 第 5 项（详情端点计时型侧信道） | 同 PB-07 | 未实现，`readWhere` 未用于缺失分支 | 确实未做；A 已列「已知非阻断」 |
| PB-02 #32 十二门禁 | CLOSED | `integration.pending.test.ts` 仅注释提及 `it.todo`，实际 0 个 | 一致 |

## 四、仍未闭环的三项

1. **AI 使用记录未进 main**：`84c8985` 只在 `feat/C-attachment-consumers`。main 无 `docs/ai-records/C/issue-36/`、无 `docs/ai-records/C/INDEX.md`。需合分支或提 PR。
2. **Backlog PB-06 / PB-07 状态过时**：代码已在 main，文档仍写 OPEN。`docs/product-backlog.md` 由 DRI/A 维护，改它需对应窗口，本会话未擅改。
3. **UML 工作树有未提交记录**：`C-I35-...-01.md` 的 2026-10-22 追加、`followup-03` raw 仍未提交；另 `remaining-blockers-*.md` 三个转发草稿悬挂。

## 五、不属于本会话、但属 ROLE-C 域

- #32 排程实现（`455701e`）由**另一 C 会话**交付，12 门禁由 **A** 接手完成。本会话未参与、未验证、不认领。
- #32 模型供应商/模型/地址仍未选定，排期默认显式 unavailable（符合设计，不算缺口）。

## 结论

ROLE-C 的 5 张票**全部关闭**，本会话代码交付**全部合入 main**。剩余不是「功能没做完」，而是三件收尾：AI 记录待合、Backlog 两行状态待同步、本地未提交记录待处置。

## 六、收尾执行（同一批次内完成）

| 收尾项 | 动作 |
|---|---|
| AI 使用记录 | `docs/ai-records/C/issue-36/`（主记录 + 903 条脱敏 raw + 导出/校验脚本）与 `docs/ai-records/C/INDEX.md` 随本批次合入 main |
| 旧会话记录 | `issue-35` 的「后续追加 5」与 `raw/...followup-03` 已从未提交状态归档入库 |
| Backlog | **PB-06 → CLOSED**（锚点已在 main）；**PB-07 → 4/5 完成**，仅剩计时型侧信道保留 OPEN；均已在变更记录留痕 |
| 过期草稿 | `remaining-blockers-*.md`（已被 #120 公开评论取代）**不入库**，仅保留本地 |

合入后以 `origin/main` 实际内容为准复验，不凭本文件预设结果。
