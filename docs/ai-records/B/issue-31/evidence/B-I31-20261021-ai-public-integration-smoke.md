# B-I31-20261021 AI 公共接入冒烟（真实 HTTP，LOCAL_STUB）

执行：`node docs/ai-records/B/issue-31/evidence/B-I31-20261021-ai-smoke-fixture.cjs`（每次运行使用独立 SQLite 文件与端口；需绕本机代理：`NO_PROXY=127.0.0.1,localhost`）

分支：`feat/ai-suggestion-store`（commit 见 PR）；服务：`DATABASE_URL=file:<临时库> PORT=<临时> npx tsx src/server.ts`；数据：`prisma migrate deploy` + `tsx src/db/seed.ts` + 经 API 建 goal/activity/2 故事（其中一条标敏感）。

```text
PASS  空库 migrate deploy + seed
PASS  五个演示账号可登录（pm/member1/viewer1/outsider）
PASS  建 goal/activity/2 story + 标记 story B 敏感 :: sA=201 sB=201 sens=200 
PASS  PM POST generate → 201 且 status 非终态 :: 201 status=PENDING model=undefined/1.0.0 
PASS  生成记录含输入范围/快照指纹/生成时间 :: scope={"projectId":"a8b34c48-6a2a-4703-b36c-2884a07ae068","populationBasis":"OBJECT","objects":[{"objectType":"story","objectId":"2728e805-448e-454a-b62a-7d4ff300445f"}],"filters":{},"includedFields":["title","roleText","capabilityText","valueText","businessValue","acceptanceCriteria"],"excludedFields":["isSensitive","sensitive visibility list","member personal data","passwords","tokens","attachments"],"population":{"sourceCount":1,"includedCount":1,"excludedSensitiveCount":0},"containsSensitiveData":false} fp=4038e5de86e8d897…
PASS  PM GET list → 200 且含该建议 :: n=1
PASS  ACCEPTED 不填理由被接受（B 裁定：仅 MODIFIED/REJECTED 必填） :: 200
PASS  PM ACCEPTED 处置（不填理由）→ 200 且终态 :: 200 status=DISPOSED
PASS  已终态建议：同 requestId 重放幂等（同一条结果） :: first=409 replay=409 same=true
PASS  已终态建议：不同 requestId → 冲突（唯一最终处置 + CAS） :: 409 {"error":{"code":"CONFLICT","message":"该 AI 建议已有不同的最终处置"}}
PASS  MODIFIED 缺理由 → 422（字段 note） :: 422 {"error":{"code":"VALIDATION_FAILED","message":"字段校验失败","details":[{"field":"note","code":"INVALID_VALUE"}]}}
PASS  MODIFIED 齐备 → 200 且终态 :: 200 status=DISPOSED
PASS  同 requestId 同 digest 重放 → 幂等返回首次结果 :: 200
PASS  MEMBER GET list → 200（只读） :: 200
PASS  MEMBER POST generate → 403 :: 403 
PASS  MEMBER POST disposition → 403 :: 403
PASS  MEMBER 读敏感故事建议 → 404 :: 404
PASS  MEMBER 对敏感故事生成 → 404 :: 404
PASS  敏感故事 404 与不存在故事 404 响应体逐字一致 :: {"error":{"code":"NOT_FOUND","message":"资源不存在或不可见"}}
PASS  VIEWER GET list → 200；generate → 403 :: 200/403
PASS  outsider GET list → 404 :: 404
PASS  DB：AiSuggestion 2 条 / AiDisposition 2 条 / AiApplication 0 条（未应用） :: {"s":2,"d":2,"a":0}
PASS  DB：处置行唯一（1:1 子表）且记录处置人/理由 :: [{"st":"ACCEPTED","reason":null},{"st":"MODIFIED","reason":"需要拆分"}]
PASS  DB：建议记录含模型模式与快照指纹 :: [{"st":"DISPOSED","m":"STUB"},{"st":"DISPOSED","m":"STUB"}]
PASS  未把建议写进 AuditLog（决策禁止） :: audits=0
PASS  重启后 PM 仍能看到 2 条建议（真持久化） :: n=2
==== 26/26 通过 ====
```
