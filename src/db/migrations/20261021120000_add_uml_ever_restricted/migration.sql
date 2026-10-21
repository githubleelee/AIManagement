-- US-15 在线 UML：持久「曾经受限」guard（项目负责人 2026-10-21 裁定 A）
-- 依据：`DECISIONS.md` `uml.no-auto-declassification-guard`、设计稿 §3.2 / §5 / §Z
--
-- 为什么需要：交集可见性下，解除最后一个受限关联（或删目标触发 Cascade）会使 every(empty)=true，
-- 图正文对成员自动公开 —— 实际可见范围扩大，与「不自动降密」冲突。故持久化「曾经受限」，
-- 一旦置位则非 PM 一律 404，不再有自动公开路径；显式降密需另案（PM 动作 + 审计）。

-- 1) 新列（默认 false；对本批已存在的图按当前关联回填，避免历史受限图漏置位）
ALTER TABLE "UmlDiagram" ADD COLUMN "everRestricted" BOOLEAN NOT NULL DEFAULT false;

-- 2) 回填：仍关联着敏感任务或敏感故事的图
UPDATE "UmlDiagram" SET "everRestricted" = true
WHERE EXISTS (
  SELECT 1 FROM "UmlDiagramTask" l JOIN "Task" t ON t."id" = l."taskId"
  WHERE l."diagramId" = "UmlDiagram"."id" AND t."isSensitive" = true
) OR EXISTS (
  SELECT 1 FROM "UmlDiagramStory" l JOIN "UserStory" s ON s."id" = l."storyId"
  WHERE l."diagramId" = "UmlDiagram"."id" AND s."isSensitive" = true
);

-- 3) 索引：非 PM 读取条件包含 everRestricted = false
CREATE INDEX "UmlDiagram_projectId_kind_everRestricted_idx" ON "UmlDiagram"("projectId", "kind", "everRestricted");
