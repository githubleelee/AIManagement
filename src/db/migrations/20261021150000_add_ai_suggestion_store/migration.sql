-- #31 US-11 AI 建议共享存储（ROLE-D 的「建议 + 处置」存储，公共表由 ROLE-B 落地）。
-- 依据：`DECISIONS.md` `ai.suggestion-store-shared` / `permissions.ai-suggestion-disposal` /
--   `arch.shared-ports-and-assembly`；
--   `docs/role-d/ROLE-D-US11-public-integration-request.md`；
--   PR #82 评审结论（H3 字段级补丁、M7 应用失败可重试、M8 status 唯一真源）。
--
-- 纯新增：只 CREATE TABLE + CREATE INDEX 三张新表，不改既有表、不动既有数据
--   （故既有表的物理列序与 `EXPECTED_COLUMNS` 无需改动）。
--
-- 三张表（AiSuggestion / AiDisposition / AiApplication）而不是 1:1 合并的理由：
--   1. `AiDisposition.suggestionId` 作为**主键**（1:1 子表）把「唯一最终处置」变成物理约束 ——
--      同一建议的第二条处置落库直接 P2002，并发处置下恰好一次成功（裁定 3）；
--   2. `AiApplication` 可变（应用失败可重试，裁定 5），与不可变的建议正文 / 快照分离；
--   3. 与 D 的 `AiSuggestionRecord{ disposition, application }` 嵌套结构一一对应。
--
-- 列类型说明：
--   generatedAt / disposedAt / appliedAt / snapshotAsOf / createdAt 用 DATETIME（DateTime）而非
--     TEXT：时间排序与范围查询必须走**原生时间比较**（与 `DomainEvent` 同款理由）。
--   结构化对象（snapshotData / inputScope / suggestion / result / targetReferences 等）用
--     JSONB（Prisma 在 SQLite 上把 Json 映射为 JSONB，实际以文本存储）。
--   枚举列全部为 String（SQLite 无原生 enum，与 `schema.prisma` 文件头第 1 条一致），
--     取值合法性由共享契约类型 + 校验层保证。
--
-- 「status 为唯一真源」（裁定 6）：`AiSuggestion.status` 是生命周期唯一真源；
--   `application.status` **不落库**，读取时按 `src/shared/ai.ts` 的派生规则计算。
-- **不得**用 `AuditLog` 当建议存储（`DECISIONS.md` `ai.suggestion-store-shared`）。
--
-- 删除语义：projectId → RESTRICT（与 Task / Risk / Milestone / UmlDiagram / DomainEvent 一致，
--   项目不应被删掉而留下孤儿建议）；suggestionId → CASCADE（处置 / 应用是建议的从属物）。
--   操作者列是字符串快照、不建外键到 `User`（历史事实，不应因用户被删而丢失）。

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "sourceObjectType" TEXT NOT NULL,
    "sourceObjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "generationStatus" TEXT NOT NULL,
    "generationRequestId" TEXT NOT NULL,
    "generationErrorCode" TEXT,
    "generationErrorMessage" TEXT,
    "generationRetryable" BOOLEAN,
    "modelProvider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "modelMode" TEXT NOT NULL,
    "modelExecution" TEXT NOT NULL,
    "suggestion" JSONB,
    "inputScope" JSONB NOT NULL,
    "snapshotAsOf" DATETIME NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "snapshotFingerprint" TEXT NOT NULL,
    "snapshotFingerprintAlgorithm" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable（唯一最终处置：suggestionId 主键 ⇒ 1:1）
CREATE TABLE "AiDisposition" (
    "suggestionId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "disposedByUserId" TEXT NOT NULL,
    "disposedAt" DATETIME NOT NULL,
    "requestId" TEXT NOT NULL,
    "contentDigest" TEXT NOT NULL,
    "reason" TEXT,
    "modification" JSONB,
    "finalContent" JSONB,
    CONSTRAINT "AiDisposition_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiSuggestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable（应用结果；status 派生自 AiSuggestion.status，不落库）
CREATE TABLE "AiApplication" (
    "suggestionId" TEXT NOT NULL PRIMARY KEY,
    "appliedAt" DATETIME NOT NULL,
    "appliedByUserId" TEXT NOT NULL,
    "result" JSONB,
    "targetReferences" JSONB NOT NULL,
    CONSTRAINT "AiApplication_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiSuggestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiSuggestion_projectId_scenario_generatedAt_idx" ON "AiSuggestion"("projectId", "scenario", "generatedAt");

-- CreateIndex
CREATE INDEX "AiSuggestion_projectId_sourceObjectType_sourceObjectId_idx" ON "AiSuggestion"("projectId", "sourceObjectType", "sourceObjectId");

-- CreateIndex
CREATE INDEX "AiDisposition_disposedByUserId_requestId_idx" ON "AiDisposition"("disposedByUserId", "requestId");
