# B-I37-20261021 业务域事件生产 HTTP 证据（真实服务 + 真实 DB 行）

执行：`node docs/ai-records/B/issue-37/evidence/B-I37-20261021-domain-event-production-probe.cjs`（每次独立临时库与端口；需 `NO_PROXY=127.0.0.1,localhost`）

流程：`migrate deploy` + seed → 起服务 → PM 经 HTTP 建目标/活动/故事 → 里程碑创建 → 故事状态变更 → 同值 PATCH → 标记敏感后再次变更；每一步直接读 `DomainEvent` / `AuditLog` 表核对。

```text
PASS  PM 建里程碑 → 恰好一条 gantt.milestone.created :: 201 n=1
      last={"name":"gantt.milestone.created","obj":"milestone:<id>","sensitive":false,
            "payload":{"name":"M1 事件证据","dueDate":"2026-11-30"},"actor":"<pmId>",
            "key":"gantt.milestone.created:<id>"}
PASS  里程碑事件：object / 非敏感载荷 / actor / 确定性幂等键正确
PASS  PM 改故事状态 → 恰好一条事件且载荷只含 {from,to} :: 200
      {"obj":"story:<id>","sensitive":false,"payload":{"from":"DRAFT","to":"PLANNING"},
       "key":"requirement.story.status-changed:<id>:2026-10-21T13:34:52.697Z"}
PASS  同值 PATCH（状态未变）→ 不新增事件 :: n=2
PASS  敏感故事状态变更 → 敏感事件（载荷只有 references）
      {"sensitive":true,"payload":{"references":[{"objectType":"story","objectId":"<id>"}]},"keys":["references"]}
PASS  状态变更审计行仍在（before/after 留在 AuditLog） :: rows=2

==== 6/6 通过 ====
```
