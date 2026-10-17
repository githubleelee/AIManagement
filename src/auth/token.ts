/**
 * 会话令牌的签发与校验（决策 I-8 认证约定）
 *
 * ===========================================================================
 * 设计：**不透明随机串 + 存库校验**（不使用 JWT，不引入签名密钥）
 * ===========================================================================
 *
 * 契约决策 I-8「认证约定」原文：凭证为不透明随机串，**存库校验**，不使用 JWT
 * （避免密钥管理）。因此本实现：
 *
 *   - `issueToken()` 生成 32 字节随机串（base64url），把它的 **SHA-256 哈希**
 *     写入 `User.sessionTokenHash`，并把到期时间写入 `User.sessionTokenExpiresAt`
 *     （ISO 8601 UTC 字符串）。**不存明文**。
 *   - `verifyToken()` 对来串取哈希后查库比对，并检查是否过期。
 *   - 没有 HMAC、没有 `TOKEN_SECRET`、没有进程内缓存 —— 每次请求现查库，
 *     因此「权限变更即时生效」（决策 I-10）不受影响。
 *
 * 已知取舍（如实记录，供表 7 引用）：单用户单会话（再次登录会覆盖旧令牌）。
 * Sprint 1 不需要多端同时在线，故可接受；Sprint 2 若需要，改用会话表。
 *
 * 说明：`User` 表新增两个可空列是本实现为满足「存库校验」所必需的最小改动，
 * 契约 I-7 未给出令牌存放位置（其 User 模型无会话字段），此处为补齐该空白。
 */
import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

/** 令牌有效期：7 天。教学模拟 Sprint 足够，同时避免长期有效令牌。 */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 对令牌取 SHA-256 十六进制哈希。存库与比对都用它，明文不落库。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 生成不透明随机令牌（32 字节，base64url，无填充）。 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * 签发令牌：把随机串的哈希与到期时间写入该用户，返回明文令牌。
 *
 * 同一用户再次登录会覆盖旧令牌（单会话）。
 */
export async function issueToken(prisma: PrismaClient, userId: string): Promise<string> {
  const token = generateToken()
  await prisma.user.update({
    where: { id: userId },
    data: {
      sessionTokenHash: hashToken(token),
      sessionTokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    },
  })
  return token
}

/**
 * 校验令牌并返回 userId；未提供、不存在或已过期时返回 null。
 *
 * 每次调用现查数据库（决策 I-10：不做进程内缓存）。
 */
export async function verifyToken(prisma: PrismaClient, token: string): Promise<string | null> {
  if (!token) return null

  const user = await prisma.user.findUnique({
    where: { sessionTokenHash: hashToken(token) },
    select: { id: true, sessionTokenExpiresAt: true },
  })
  if (!user) return null

  if (user.sessionTokenExpiresAt !== null) {
    const expiresAt = Date.parse(user.sessionTokenExpiresAt)
    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) return null
  }

  return user.id
}
