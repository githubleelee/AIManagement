## 目的

把 ROLE-C 的收尾项合入 main。本 PR 只含**文档与 AI 记录归档**，不改任何产品代码、测试断言或基础设施。

## 内容

### 1. AI 使用记录补齐（此前缺失）

- `docs/ai-records/C/issue-36/`：会话 `01a163ee`（2026-10-22 → 10-24）主记录 + 903 条脱敏 raw 导出 + 导出/校验脚本。
- `docs/ai-records/C/INDEX.md`：C 记录总览（按会话索引 + 已知缺口 + 脱敏口径）。
- `docs/ai-records/C/issue-35/`：补入旧会话 `01a14ec5` 的「后续追加 5」（2026-10-22 只读核查）与 `raw/...followup-03`，此前一直未提交。

脱敏复核：`docs/ai-records/C/issue-36/evidence/redaction-check-all.txt` → **PASSED**（本机用户名、演示口令、token/key、带凭据代理地址均无残留；`sk-` 开头的 runner 标签已确认非密钥）。

### 2. Backlog 状态与 main 实际代码对齐

- **PB-06 → CLOSED**：任务锚点已在 `web/src/pages/task/TaskSection.tsx` 实现（`useLocation` + 可见行匹配 + `scrollIntoView`/`focus` + `id`/`tabIndex`），随附件消费点合入 main `dc9a9ba`；正式路由 16 项浏览器检查覆盖锚点、深链刷新、同页换 hash、前进后退、隐藏 hash 不请求。
- **PB-07 → 4/5 已完成**：P2003 收窄（`service.ts:82,94`）、wire 往返 vitest、P2002 `DUPLICATE`（`service.ts:93`）、过期注释与 `verification.md` 导航均已落地；**仅剩第 ⑤ 项**（详情端点计时型侧信道）未做，保留 OPEN 并标注为已知非阻断。

每项均在 `docs/product-backlog.md` 变更记录留痕，未改写既有历史条目。

### 3. 核查留档

- `docs/role-c/issue-36/audit-role-c-status.md`：按 GitHub API + `origin/main` 实际内容逐项核对 ROLE-C 五张票与代码落点。
- `verify-main-state.ps1` / `verify-pb-state.ps1`：可复跑的只读核查脚本。

## 明确不做

- 不改产品代码、不改测试、不改 `DECISIONS.md`。
- 不把已被 #120 公开评论取代的 `remaining-blockers-*.md` 草稿入库。
- 不宣称 PB-07 第 ⑤ 项已完成。

## 复核要点

建议重点看 `docs/product-backlog.md` 的 PB-06/PB-07 两行与变更记录行是否与 `origin/main` 代码一致。
