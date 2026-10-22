-- #37 领域事件（ROLE-D 的信封，公共表由 ROLE-B 落地）—— 事件持久化落点。
-- 依据：`docs/role-d/ROLE-D-EVENTS-public-integration-request.md`、
--   `docs/role-d/ROLE-D-EVENTS-interface-protocol.md`、`DECISIONS.md`
--   `arch.shared-ports-and-assembly` / `ownership.public-files-single-writer`。
--
-- 纯新增：只 CREATE TABLE + CREATE INDEX 一张新表，不改既有表、不动既有数据
--   （故 Project / Task 等既有表的物理列序不变，`EXPECTED_COLUMNS` 无需改动）。
--
-- 为什么需要：D 的进程内实现只把事件放在内存里，AC 要求事件可持久化 / 可查询 / 可重放；
--   且 `(projectId, eventName, idempotencyKey)` 的幂等去重必须由数据库唯一约束兜底
--   （并发 publish 时内存 Map 不足以保证）。
--
-- 列类型说明：
--   occurredAt / storedAt 用 DATETIME（DateTime）而非 TEXT：时间范围查询必须走**原生时间
--     比较**；字符串字典序会把带偏移量（如 `+08:00`）的 ISO 串排错（D 的内存桩正是此缺陷）。
--   payload 用 JSONB（Prisma 在 SQLite 上把 Json 映射为 JSONB，实际以文本存储）；
--     敏感事件的 payload 只含 `references`（见信封注释）。
--   actorKind 为 String（SQLite 无原生 enum，与 `schema.prisma` 文件头第 1 条一致）。
--
-- 删除语义：projectId → RESTRICT（与 Task / Risk / Milestone / UmlDiagram 一致，项目不应
--   被删掉而留下孤儿事件）。actor 相关列只是字符串快照、不建外键（事件是历史事实，
--   不应因用户被删而丢失）。

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schemaVersion" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorComponent" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "storedAt" DATETIME NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT,
    "causationId" TEXT,
    "sensitive" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "DomainEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DomainEvent_projectId_occurredAt_idx" ON "DomainEvent"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_projectId_eventName_idx" ON "DomainEvent"("projectId", "eventName");

-- CreateIndex（幂等唯一作用域，D 的信封契约固定为 projectId + eventName + idempotencyKey）
CREATE UNIQUE INDEX "DomainEvent_projectId_eventName_idempotencyKey_key" ON "DomainEvent"("projectId", "eventName", "idempotencyKey");
