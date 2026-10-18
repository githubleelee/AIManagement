-- US-08 个人工作台（工单 #28）：任务进度与卡住原因。
--
-- 六状态（TODO / DOING / BLOCKED / SUSPENDED / DONE / CLOSED）落在既有的字符串列上，
-- 因此这里只新增两列，不改列类型、不动既有数据（旧行保持 NULL）。
-- progress：0-100 的百分比；blockedReason：仅 status = BLOCKED 时有意义。

ALTER TABLE "Task" ADD COLUMN "progress" INTEGER;
ALTER TABLE "Task" ADD COLUMN "blockedReason" TEXT;