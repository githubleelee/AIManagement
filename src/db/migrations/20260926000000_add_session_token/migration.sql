-- 会话令牌存库（决策 I-8 认证约定：不透明随机串、存库校验、不使用 JWT）。
-- 只存 SHA-256 哈希；到期时间存 ISO 8601 UTC 字符串。
ALTER TABLE "User" ADD COLUMN "sessionTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "sessionTokenExpiresAt" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_sessionTokenHash_key" ON "User"("sessionTokenHash");
