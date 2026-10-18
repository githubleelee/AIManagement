-- US-10 进度 / 健康度与风险（工单 #30）：风险台账 + 项目生命周期列。
--
-- 只新增一张表 + 给 Project 加一列；不改既有列、不动既有数据。
-- 依据：契约门 #24 的 ROLE-A 结论（2026-10-18 人工确认，见 #24 comment 6244749384 /
-- #30 comment 6244752319）与 ROLE-B 的公共文件单写授权。
--
-- 为什么需要：
--   AC3 要求风险支持三级 + 四态、非法值拒绝；AC7 要求敏感风险不计入无权者的总数与清单；
--   AC4 / AC5 要求「存在未关闭任务或未处理 / 处理中风险时拒绝关闭项目」。
--   项目模块没有任何字段能承载风险台账；关闭入口在本票新模块，故 Project 只需一个状态列。
--
-- 枚举列全部为 String（SQLite 无原生 enum，与仓库惯例一致）；
-- 线上取值与 Zod 校验由 `src/modules/risk/` 定义：
--   level  : 'HIGH' | 'MEDIUM' | 'LOW'
--   status : 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
--   Project.status : 'ACTIVE' | 'CLOSED'
--
-- 删除语义（三处外键刻意不同）：
--   projectId → Restrict：与 Task / UserStory 等业务对象一致，项目不应被删掉而留下孤儿风险。
--   ownerUserId → Restrict：人不该被删掉而留下无主风险。
--   taskId → SetNull：风险是独立台账，关联任务被删除时保留风险本身。

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ownerUserId" TEXT NOT NULL,
    "taskId" TEXT,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Risk_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Risk_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex：按项目 + 状态列清单（风险台账主查询）
CREATE INDEX "Risk_projectId_status_idx" ON "Risk"("projectId", "status");

-- CreateIndex：按负责人查
CREATE INDEX "Risk_ownerUserId_idx" ON "Risk"("ownerUserId");

-- CreateIndex：按关联任务查（敏感可见性继承）
CREATE INDEX "Risk_taskId_idx" ON "Risk"("taskId");

-- AlterTable：项目生命周期（默认 ACTIVE，既有数据全部保持可用）
ALTER TABLE "Project" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
