-- #34 站内通知（ROLE-D 的消费模块；公共存储 / 消费账本由 ROLE-B 落地）。
-- 依据：`DECISIONS.md` `notifications.public-integration-and-scheduling`、
--   `notifications.committed-consumption-and-query-contract`、
--   `notifications.source-event-provenance`；`docs/role-d/ROLE-D-US14-public-integration-request.md`。
--
-- 纯新增：只 CREATE TABLE / CREATE INDEX 三张新表，不改既有表、不动既有数据
--   （故 Project / Task / DomainEvent 等既有表的物理列序不变，`EXPECTED_COLUMNS` 无需改动）。
--
-- 为什么需要：
--   1. `Notification` —— D 的进程内实现在内存里，AC 要求通知可持久化、可按收件人查询；
--      `dedupeKey` 唯一约束把服务层算出的幂等键变成数据库级兜底（并发消费时内存 Map 不足）。
--   2. `NotificationConsumer` —— 首次启用的激活记录（同事务写入），`activatedDay` 兼作
--      里程碑 `milestone.due` 启动补扫的下界。
--   3. `NotificationConsumption` —— `(consumerId, eventId)` 持久消费账本：以「是否已有账本行」
--      判断是否完成；首次启用时把已存在的支持事件记为 `SKIPPED_BASELINE`（不群发旧通知）。
--
-- 列类型说明：
--   occurredAt / storedAt / readAt / activatedAt 用 DATETIME（DateTime）：时间范围查询与排序
--     必须走**原生时间比较**，不能用字符串字典序（与 `DomainEvent` 同款理由）。
--   latencyMs 用 INTEGER 且**允许负值**：事件时间在未来时保留原始差值，不归零伪装达标。
--   sensitive / withinDeliveryTarget / isRead 用 BOOLEAN；枚举列（type / contentKind / status）
--     用 String（SQLite 无原生 enum，与 `schema.prisma` 文件头第 1 条一致）。
--
-- 删除语义：
--   Notification.projectId / recipientUserId → RESTRICT（与 Task / Risk 等一致，项目/人不该被删掉而留下孤儿）。
--   Notification.sourceEventId → DomainEvent RESTRICT，NotificationConsumption.eventId → DomainEvent RESTRICT
--     （`notifications.source-event-provenance`：通知/账本存续期间原事件不是可任意删除的缓存）。
--   NotificationConsumption.consumerId → NotificationConsumer RESTRICT（账本依附于激活记录）。

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "sourceEventName" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "referenceObjectType" TEXT NOT NULL,
    "referenceObjectId" TEXT NOT NULL,
    "contentKind" TEXT NOT NULL,
    "contentTitle" TEXT,
    "contentSummary" TEXT,
    "sensitive" BOOLEAN NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "storedAt" DATETIME NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "withinDeliveryTarget" BOOLEAN NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "DomainEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationConsumer" (
    "consumerId" TEXT NOT NULL PRIMARY KEY,
    "activatedAt" DATETIME NOT NULL,
    "activatedDay" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NotificationConsumption" (
    "consumerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("consumerId", "eventId"),
    CONSTRAINT "NotificationConsumption_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "NotificationConsumer" ("consumerId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NotificationConsumption_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_isRead_storedAt_idx" ON "Notification"("recipientUserId", "isRead", "storedAt");

-- CreateIndex
CREATE INDEX "Notification_sourceEventId_idx" ON "Notification"("sourceEventId");

-- CreateIndex
CREATE INDEX "NotificationConsumption_eventId_idx" ON "NotificationConsumption"("eventId");
