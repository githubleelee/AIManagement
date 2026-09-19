/**
 * 密码哈希（T0-03 最小骨架）
 *
 * 使用 Node 内置 `scrypt`，**不引入任何新依赖**（`bcryptjs` / `bcrypt` 均未安装，
 * 而新增依赖会改动 package.json 与 lock 文件，可能与他人改动冲突）。
 *
 * 存储格式：`scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>`
 * 把参数写进哈希串，使将来调参后旧密码仍可校验（无需强制改密）。
 *
 * 注意 `User.passwordHash` 是 schema 中**已存在**的字段，本文件只是填充它，
 * 因此不需要任何 schema 改动。
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/** scrypt 参数。N=16384 在本机约 30–60ms，兼顾安全与测试速度。 */
const PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 } as const

/**
 * scrypt 的 Promise 版本。
 *
 * 不能直接写 `promisify(scrypt)`：node:crypto 的 scrypt 有多个重载，
 * promisify 会挑中不含 options 的那个，传入 options 时编译期报
 * 「Expected 3 arguments, but got 4」。故此处显式声明签名以选中带 options 的重载。
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/** scrypt 默认 maxmem 为 32MB，而 N=16384,r=8 需约 16MB，故显式放宽。 */
const MAX_MEM = 64 * 1024 * 1024

/** 生成密码哈希。 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(plain, salt, PARAMS.keyLen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAX_MEM,
  })

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/**
 * 校验密码。
 *
 * 任何格式异常（哈希串损坏、字段缺失）都返回 false 而不抛异常——
 * 避免把「库里有脏数据」暴露成 500，那会泄漏库内状态。
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6) return false
  const [scheme, nStr, rStr, pStr, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  if (scheme !== 'scrypt') return false

  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')

  let derived: Buffer
  try {
    derived = await scryptAsync(plain, salt, expected.length, { N, r, p, maxmem: MAX_MEM })
  } catch {
    return false
  }

  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
