# ROLE-A / #30 公共层两项请求与 #32 读取口径 · 项目负责人批复

> 本文档为中文确认稿，可直接转发。**不代表已在 GitHub 发布、评论或改动任何 Issue / 标签。**

| 项目 | 内容 |
|---|---|
| 批复人 | GitHub `githubleelee`，即 ROLE-B / 项目负责人 |
| 接收人 | ROLE-A `lyh`（#30）；第 3 节供 ROLE-C `xichoutrees` 引用 |
| 日期 | 2026-10-18 |
| 覆盖范围 | #30 [评论](https://github.com/githubleelee/AIManagement/issues/30#issuecomment-6249055794) 第四节的 2 项请求、#24 [留痕](https://github.com/githubleelee/AIManagement/issues/24#issuecomment-6249060303) 第二节、C 在 #24 提出的 #32 读取边界 |
| 决策记录 | `DECISIONS.md` 的 `permissions.risk-flow-guard`、`contract.close-blocking-response` |

---

## 1. `risk.flow` 判定：由 B 落地，落地前先 fail-closed

**结论**：`ObjectRef` 增加 `risk` 类型与 `risk.flow` 判定**由 ROLE-B 在公共层落地**（`src/shared/types.ts` + `src/modules/authz/permissions.ts`），实现方式与你建议的对象关系判定同型（PM 由 `can()` 第 3 条放行，MEMBER 仅 `ownerUserId` = 本人，VIEWER 403，非成员 404）。你不需要在业务代码里判角色。

**落地前的行为（立即生效）**：**先 fail-closed —— 成员不得流转任何风险状态（一律 403）**，直到公共层支持到位后再放开「自己负责的风险」。

- 原因：现状「MEMBER 可流转任意风险」超出已批准口径（成员只能流转自己负责的风险），在公共层就绪前保持开放会造成越权窗口。
- 落地后你需要补一条「成员可流转自己负责的风险 / 他人风险 403」的用例；在公共层就绪前，该用例应断言 403 并标注原因，**不得以此勾最终 AC**。
- 你**不需要**自行修改 `permissions.ts` / `src/shared/types.ts`；若 B 需要你的 patch 提案，由 B 另行要求。

---

## 2. 关闭阻断的返回形式：维持现有错误信封

**结论**：**采用你倾向的 (b)**——不改冻结契约 I-3 的错误信封。

- 关闭请求被阻断时返回 **409 CONFLICT + 计数摘要**（未关闭任务数、未处理 / 处理中风险数），并在响应中提示调用 `GET /projects/:projectId/closure-check` 获取清单。
- 清单只在该端点返回，且必须按调用者权限过滤：无权者看不到敏感任务 / 风险，也不得通过计数反推。
- 不需要给 `details` 加 `blockers` 字段，也不要求其他客户端适配新信封；你现有实现与走查结果继续有效。

---

## 3. #32 读取口径：维持仅 PM（回答 C 的边界问题）

**结论**：`scheduling.permission-pm-only` **继续适用，不因 #33 的可见范围表述而扩张**。

- #32（AI 排期建议）的生成、查看、采纳、修改后采纳、拒绝、审计仍**全部仅 PM**；MEMBER / VIEWER 不开放，且不得从 #33 的「PM 全项目 / MEMBER·VIEWER 可见范围」推导适用。
- 因此**不需要** `supersedes`，原条目原样有效；共享通知或说明文档里的通用表述不构成对 #32 的授权。
- 若将来确要开放 #32 只读，必须单独立项并写 `supersedes` 覆盖原条目。

---

## 4. #30 票面更正（由项目负责人代改）

你的账号无 GitHub 写权限，票面由我代改，变更点：

1. 「权限与敏感用例」中「member：只读按可见性」→ 更正为 **member 可写风险台账，状态流转仅限自己负责的风险（公共层落地前先 403）**。
2. 「C1 / C9 / C6 / C13 未定」的表述 → 更新为已定口径（阈值、关闭阻断、基础汇总、关闭入口归属均已批复），并链接本批复与既有决策条目。

---

## 5. 待办

| 事项 | 负责人 |
|---|---|
| `ObjectRef` 加 `risk` 类型、`permissions.ts` 加 `risk.flow` 判定（对象关系判定同型） | B |
| 落地前把成员风险状态流转收窄为 403，落地后放开「自己负责的风险」 | A |
| 关闭阻断保持 409 + 摘要 + `closure-check` 清单，清单按权限过滤 | A（已完成，维持） |
| #32 读取保持 PM-only，不新增 supersedes | C（确认收到即可） |

---

## 6. 声明

- 本文档只记录批复结论，**不代表已在 GitHub 发布、评论或改动任何 Issue / 标签**。
- 除本次明确的两项公共层调整与 #32 读取确认外，`permissions.risk-status-flow`、`analytics.project-close-blocking` 等既有结论不变。
