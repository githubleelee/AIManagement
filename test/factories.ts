import type { UserBrief } from '../src/shared/types'
import { hashPassword } from '../src/auth/password'
import { createSession } from '../src/auth/session'
import { getPrisma } from './helpers'

// 测试数据工厂（T0-03）。每个测试自建数据，不依赖全局种子。
// 目前只放 T1.1 需要的 makeUser，后续任务按需扩展。

export const DEFAULT_PASSWORD = 'Passw0rd!'

export type TestUser = UserBrief & { token: string; password: string }

export async function makeUser(
  account: string,
  displayName: string,
  password = DEFAULT_PASSWORD,
): Promise<TestUser> {
  const prisma = await getPrisma()
  const user = await prisma.user.create({
    data: { account, displayName, passwordHash: hashPassword(password) },
  })
  const token = createSession(user.id)
  return {
    id: user.id,
    account: user.account,
    displayName: user.displayName,
    token,
    password,
  }
}
