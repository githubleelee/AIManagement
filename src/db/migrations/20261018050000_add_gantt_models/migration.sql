-- US-06 甘特图（工单 #26）：里程碑、任务—里程碑关联、FS 依赖边。
--
-- 纯新增：只 CREATE TABLE + CREATE INDEX 三张新表，不改既有表、不动既有数据。
-- 依据：ROLE-B 设计 `docs/role-b-gantt-design.md` §3（模型候选 A：独立关联表，不侵入 Task）、
--   §4（仅 FS、自然日口径）与 GitHub #26 授权（本票本地批次 P1：最小模型 + 迁移 + 配套）。
--
-- 为什么需要：
--   AC1 要求同一视图展示需求 / 任务 / 里程碑；AC4 要求任务可关联里程碑并汇总；
--   AC5 / AC6 要求仅 FS 依赖、拒绝自环与跨项目边。既有 9 张表没有任何字段能承载
--   里程碑、任务—里程碑多对多或任务间依赖。
--
-- 枚举列全部为 String（SQLite 无原生 enum，与 `src/db/schema.prisma` 文件头第 1 条一致）：
--   TaskDependency.type 本期仅接受 'FS'，其余值由写入层拒绝（设计 §4.2；DB 层不约束枚举）。
--
-- 删除语义理由（三张表刻意不同）：
--   Milestone.projectId        → Restrict：与 Task / UserStory 等业务对象一致，项目不应被删掉而留下孤儿里程碑。
--   Milestone.ownerUserId      → Restrict：人不该被删掉而留下无主里程碑。
--   TaskMilestone 两端         → Cascade：关联行只是任务与里程碑之间的连接，任一端消失即失去意义。
--   TaskDependency.projectId   → Restrict：项目不再存在时不应留下孤儿依赖边。
--   TaskDependency 两端任务     → Restrict：删除任务不静默丢边（会影响旧 DELETE /tasks/:taskId 的语义，
--                                具体删除口径见设计 §3.2，属后续批次待决项，本迁移不改变旧业务行为）。

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Milestone_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskMilestone" (
    "taskId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "milestoneId"),
    CONSTRAINT "TaskMilestone_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskMilestone_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "predecessorTaskId" TEXT NOT NULL,
    "successorTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_predecessorTaskId_fkey" FOREIGN KEY ("predecessorTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_successorTaskId_fkey" FOREIGN KEY ("successorTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");

-- CreateIndex
CREATE INDEX "Milestone_ownerUserId_idx" ON "Milestone"("ownerUserId");

-- CreateIndex
CREATE INDEX "TaskMilestone_milestoneId_idx" ON "TaskMilestone"("milestoneId");

-- CreateIndex
CREATE INDEX "TaskDependency_projectId_idx" ON "TaskDependency"("projectId");

-- CreateIndex
CREATE INDEX "TaskDependency_predecessorTaskId_idx" ON "TaskDependency"("predecessorTaskId");

-- CreateIndex
CREATE INDEX "TaskDependency_successorTaskId_idx" ON "TaskDependency"("successorTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_predecessorTaskId_successorTaskId_type_key" ON "TaskDependency"("predecessorTaskId", "successorTaskId", "type");
