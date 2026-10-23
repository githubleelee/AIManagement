# B-I31-20261023 AI 面板挂载浏览器走查（B 主代理亲自执行）

**对象**：A 的交付分支 `feat/risk-events-and-ai-panel-mount`（commit `1f3c345`）——需求页最小挂载 `web/src/pages/RequirementDetailPage.tsx`（+21 行，仅此一个前端文件）。

**环境**：worktree `/home/lee/aim-wt/a-risk-events`；独立临时库 `/tmp/a-panel-walk.db`（`migrate deploy` + `tsx src/db/seed.ts`）；API `:3000`（`DATABASE_URL` 显式传入）+ Vite `:5173`；浏览器为 headless Chromium（`NO_PROXY=127.0.0.1,localhost`）。故事经 API 现建：目标「面板走查目标」→ 活动「面板走查活动」→ 故事「面板走查故事」。

| 步骤 | 期望 | 实测 |
|---|---|---|
| PM 打开 `…/requirements/:storyId` | 需求详情页底部出现「AI 需求拆解」面板，含**生成拆解建议** | ✅ 面板渲染（`section.req-task-panel > .ai-panel`），按钮 `["生成拆解建议"]`；文案明示「本地确定性 Stub；无 SDK、无外部网络请求、不会自动写入正式任务」 |
| PM 点击「生成拆解建议」 | 产出建议且**不写正式数据** | ✅ 面板出现 `PENDING local-stub / deterministic-requirement-breakdown@1.0.0 STUB` + 3 项工作建议；DB 实测 `AiSuggestion` 1 条（`status=PENDING, modelMode=STUB, generationStatus=SUCCEEDED`）、`AiDisposition` **0 条**、未新增任务 |
| PM 视角的处置入口 | 出现**仅 PM** 的三个处置动作 | ✅ 面板按钮变为 `["生成拆解建议","采纳","修改后采纳","拒绝"]` |
| MEMBER（member1）打开同一页 | 面板**只读**：能看到已有建议、**无任何操作按钮** | ✅ `.ai-panel` 存在，`querySelectorAll('button')` 长度 **0**；全页无「生成拆解建议」、无「采纳/修改后采纳/拒绝」 |
| 浏览器控制台 | 无 error / pageerror | ✅ 仅 vite / React DevTools 的 info 级输出 |

**证据截图**
- `B-I31-20261023-ai-panel-pm-after-generate.png`（PM：面板 + 生成结果 + 三个处置按钮）
- `B-I31-20261023-ai-panel-member-readonly.png`（MEMBER：面板可见、建议可读、零操作按钮）

**越权路径**（不由前端承担）：MEMBER / VIEWER 的生成与处置 403、outsider 404、敏感故事 404 与不存在逐字一致，已由 B 的 26/26 HTTP 冒烟覆盖（`B-I31-20261021-ai-public-integration-smoke.md`）；本走查仅证明**前端体验层**与裁定一致，**服务端为准**。

**结论**：A 的挂载与 B 的裁定（`canRead` = 项目成员、`canGenerate`/`canReview` = 仅 PM、不新增 URL）**逐条一致**；`npm run build:web` 通过；`npm run typecheck` 退出 0；全量 **71 文件 / 1508 例全绿**。
