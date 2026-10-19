-- US-15 在线 UML（工单 #35）：用例图 / 时序图的最小模型。
--
-- 纯新增：只 CREATE TABLE + CREATE INDEX 七张新表，不改既有表、不动既有数据
-- （设计 §7.4：本批不对既有表做 ALTER TABLE，故 Project / Task / User / UserStory 的
--   物理列序不变，`EXPECTED_COLUMNS` 无需改动）。
-- 依据：`docs/role-b-uml-design.md` §3（FROZEN v1.0）与 `DECISIONS.md`
--   `uml.minimal-model-and-visibility` / `permissions.uml-write`。
--
-- 为什么需要：AC1 要求在线创建并编辑用例图 / 时序图（非仅上传），AC2 要求图可关联
--   项目 / 业务目标 / 用户活动 / 用户故事 / 任务。既有表没有任何字段能承载图、节点、
--   边或类型化关联。
--
-- 枚举列全部为 String（SQLite 无原生 enum，与 `src/db/schema.prisma` 文件头第 1 条一致）：
--   UmlDiagram.kind、UmlNode.nodeType、UmlEdge.edgeType 的合法取值由写入层白名单保证，
--   DB 层不约束枚举（设计 §3.1③ / §4.2）。
--
-- 边同图约束（设计 §3.3 / §3.7 实测）：UmlEdge 用**复合外键**
--   ("diagramId", "sourceNodeId") / ("diagramId", "targetNodeId") → UmlNode("diagramId", "id")，
--   因此「A 图的边指向 B 图的节点」在物理上不可能落库（跨图建边得 P2003）。
--   该复合外键的引用目标由 UmlNode 的 UNIQUE ("diagramId", "id") 提供。
--
-- 删除语义（设计 §3.6，共 14 处外键：2 处 RESTRICT + 12 处 CASCADE）：
--   UmlDiagram.projectId        → Restrict：项目不应被删掉而留下孤儿图。
--   UmlDiagram.ownerUserId      → Restrict：人不该被删掉而留下无主图。
--   UmlNode.diagramId           → Cascade ：图内容的从属物。
--   UmlEdge.diagramId           → Cascade ：同上。
--   UmlEdge 两端 → UmlNode      → Cascade ：节点删除后残留边即脏数据。
--   UmlDiagramGoal / Activity / Story / Task 两端 → Cascade：关联行只是连接，任一端消失即失去意义。
--     **关键**：任务 / 故事侧用 Cascade 而非 Restrict，否则既有 `DELETE /tasks/:taskId`
--     （端点 29）会因外键约束开始返回 409 —— 已批准口径点名的理由。

-- CreateTable
CREATE TABLE "UmlDiagram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UmlDiagram_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UmlDiagram_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UmlNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diagramId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UmlNode_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "UmlDiagram" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UmlEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diagramId" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "label" TEXT,
    "seq" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UmlEdge_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "UmlDiagram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UmlEdge_diagramId_sourceNodeId_fkey" FOREIGN KEY ("diagramId", "sourceNodeId") REFERENCES "UmlNode" ("diagramId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UmlEdge_diagramId_targetNodeId_fkey" FOREIGN KEY ("diagramId", "targetNodeId") REFERENCES "UmlNode" ("diagramId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UmlDiagramGoal" (
    "diagramId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,

    PRIMARY KEY ("diagramId", "goalId"),
    CONSTRAINT "UmlDiagramGoal_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "UmlDiagram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UmlDiagramGoal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "BusinessGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UmlDiagramActivity" (
    "diagramId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,

    PRIMARY KEY ("diagramId", "activityId"),
    CONSTRAINT "UmlDiagramActivity_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "UmlDiagram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UmlDiagramActivity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "UserActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UmlDiagramStory" (
    "diagramId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,

    PRIMARY KEY ("diagramId", "storyId"),
    CONSTRAINT "UmlDiagramStory_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "UmlDiagram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UmlDiagramStory_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "UserStory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UmlDiagramTask" (
    "diagramId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    PRIMARY KEY ("diagramId", "taskId"),
    CONSTRAINT "UmlDiagramTask_diagramId_fkey" FOREIGN KEY ("diagramId") REFERENCES "UmlDiagram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UmlDiagramTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UmlDiagram_projectId_kind_idx" ON "UmlDiagram"("projectId", "kind");

-- CreateIndex
CREATE INDEX "UmlDiagram_ownerUserId_idx" ON "UmlDiagram"("ownerUserId");

-- CreateIndex
CREATE INDEX "UmlNode_diagramId_idx" ON "UmlNode"("diagramId");

-- CreateIndex
CREATE UNIQUE INDEX "UmlNode_diagramId_id_key" ON "UmlNode"("diagramId", "id");

-- CreateIndex
CREATE INDEX "UmlEdge_diagramId_idx" ON "UmlEdge"("diagramId");

-- CreateIndex
CREATE INDEX "UmlEdge_sourceNodeId_idx" ON "UmlEdge"("sourceNodeId");

-- CreateIndex
CREATE INDEX "UmlEdge_targetNodeId_idx" ON "UmlEdge"("targetNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "UmlEdge_diagramId_seq_key" ON "UmlEdge"("diagramId", "seq");

-- CreateIndex
CREATE INDEX "UmlDiagramGoal_goalId_idx" ON "UmlDiagramGoal"("goalId");

-- CreateIndex
CREATE INDEX "UmlDiagramActivity_activityId_idx" ON "UmlDiagramActivity"("activityId");

-- CreateIndex
CREATE INDEX "UmlDiagramStory_storyId_idx" ON "UmlDiagramStory"("storyId");

-- CreateIndex
CREATE INDEX "UmlDiagramTask_taskId_idx" ON "UmlDiagramTask"("taskId");

