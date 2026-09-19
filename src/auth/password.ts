import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// 口令散列。用 Node 内建 scrypt，避免 bcrypt 的原生编译依赖（Windows 上易翻车）。

const KEY_LENGTH = 64
const SALT_BYTES = 16

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const derived = scryptSync(plain, salt, KEY_LENGTH)
  return `${salt}:${derived.toString('hex')}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(plain, salt, KEY_LENGTH)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
