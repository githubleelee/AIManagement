/**
 * 会话令牌的签发与校验（T0-03 最小骨架）
 *
 * ===========================================================================
 * 设计决策：**无状态签名令牌**，不改动 schema
 * ===========================================================================
 *
 * 背景：契约决策 I-7 冻结的 `User` 模型**没有会话字段**（只有 id / account /
 * displayName / passwordHash / createdAt），M1 也尚未实现，所以「token 存哪」
 * 在契约里是空白。三种可选方案：
 *
 *   A. 在 `User` 增字段（如 sessionTokenHash）
 *   B. 新建会话表（第 10 张表）
 *   C. **自包含签名令牌，不落库**（本实现）
 *
 * 选 C 的理由：
 *   - A 要改 `src/db/schema.prisma`，那是**冻结文件**，改动需走契约变更流程；
 *     而当前 T0 的接口部分尚未归属到人，贸然改 schema 会与后续实现冲突。
 *   - B 会新增第 10 张表，直接违反决策 I-7「9 张表」的冻结约定。
 *   - C **零 schema 改动、零新依赖、多进程可用**，能立刻解开 US-03 等模块的
 *     「无法发带凭证请求」死结，是最小且可逆的介入。
 *
 * 取舍（如实记录，供表 7 / 表五引用）：**无服务端状态 = 无法在过期前强制吊销
 * 单个令牌**。Sprint 1 的验收标准（AC-US-01-07 未登录拦截、AC-US-02-07 权限变更
 * 即时生效）都不要求令牌吊销，故本轮可接受。
 *
 * 权限即时生效仍然成立：令牌只证明「你是谁」，「你能做什么」由 `can()` /
 * `visibilityScope()` 每次请求现查 `ProjectMember` 表得出（契约决策 I-10
 * 「不做进程内缓存」）。因此移除成员或取消白名单后，下一次请求立即被拒。
 *
 * 后续接管建议：若 M1 负责人选择方案 A 或 B，只需替换本文件的
 * `issueToken` / `verifyToken` 两个函数内部实现——`requireAuth` 及所有调用方
 * 的接口不变。
 * ===========================================================================
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** 令牌有效期：7 天。教学模拟 Sprint 足够，同时避免长期有效令牌。 */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 签名密钥。
 *
 * 开发环境允许回落到固定值，使克隆后开箱即用；生产环境必须由环境变量提供。
 * 注意不要把真实密钥写进仓库（`.env` 已被 .gitignore 忽略）。
 */
function getSecret(): string {
  const fromEnv = process.env.TOKEN_SECRET
  if (fromEnv && fromEnv.length > 0) return fromEnv
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须设置 TOKEN_SECRET 环境变量')
  }
  return 'ai-management-sprint1-dev-secret'
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

function sign(payload: string): string {
  return base64url(createHmac('sha256', getSecret()).update(payload).digest())
}

/** 令牌载荷：userId + 签发时间 + 随机 nonce（避免同毫秒签发相同令牌）。 */
type TokenPayload = { u: string; t: number; n: string }

/**
 * 签发令牌。格式：`base64url(JSON载荷).base64url(HMAC-SHA256签名)`。
 */
export function issueToken(userId: string): string {
  const payload: TokenPayload = {
    u: userId,
    t: Date.now(),
    n: base64url(randomBytes(8)),
  }
  const encoded = base64url(JSON.stringify(payload))
  return `${encoded}.${sign(encoded)}`
}

/**
 * 校验令牌并返回 userId；无效、被篡改或已过期时返回 null。
 *
 * 用 `timingSafeEqual` 做常量时间比较，避免通过响应时间推测签名。
 */
export function verifyToken(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, signature] = parts as [string, string]

  const expected = sign(encoded)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let payload: TokenPayload
  try {
    payload = JSON.parse(fromBase64url(encoded).toString('utf8')) as TokenPayload
  } catch {
    return null
  }
  if (typeof payload.u !== 'string' || typeof payload.t !== 'number') return null
  if (Date.now() - payload.t > TOKEN_TTL_MS) return null

  return payload.u
}
