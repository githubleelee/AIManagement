-- US-09 任务验收（工单 #29）：验收记录表。
--
-- 只新增一张表；不改既有表的任何列、不动既有数据。
--
-- 为何需要它：AC5 要求「重验可再次通过 / 驳回，全过程可追溯（who / when / 结论 / 原因）」，
-- 而 Task 上没有任何字段能承载"验收结论 + 驳回原因"（blockedReason 的语义是卡住原因，
-- 且非 BLOCKED 态会被端点 28 清空）。因此新增本表，一次验收 = 一行，重验 = 多行。
--
-- 删除语义（三处外键刻意不同）：
--   taskId    → Cascade ：任务删了，它的验收历史没有意义；也让端点 29 的删除路径
--                         与 test-support 的 resetDatabase 都不必新增清理代码。
--   projectId → Cascade ：与同文件的 AuditLog / ObjectVisibility 惯例一致。
--   actorUserId → Restrict：人不该被删掉而留下无主的验收记录。
--
-- 状态机依据（契约门 #24 的 ROLE-A 结论 comment 6233430993）：
--   验收人把 DONE 的任务 → CLOSED（PASS）或 → DOING（REJECT，必填原因）。
--   故 statusBefore 恒为 'DONE'，statusAfter 为 'CLOSED' 或 'DOING'；两列都存，
--   使这一行审计记录脱离 Task 表也读得懂。

-- CreateTable
CREATE TABLE "AcceptanceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "reason" TEXT,
    "statusBefore" TEXT NOT NULL,
    "statusAfter" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcceptanceRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AcceptanceRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AcceptanceRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex：按任务读验收历史（旧 → 新）
CREATE INDEX "AcceptanceRecord_taskId_createdAt_idx" ON "AcceptanceRecord"("taskId", "createdAt");

-- CreateIndex：按项目读（供 #30 / #33 的质量信号）
CREATE INDEX "AcceptanceRecord_projectId_createdAt_idx" ON "AcceptanceRecord"("projectId", "createdAt");
