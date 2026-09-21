/**
 * M1 身份与会话 —— 数据访问（T0-04）
 *
 * 契约依据
 *   - 决策 I-9：数据访问层所有模块都可以直接使用。本文件只读写 `User` 表，
 *     不调用其它模块的 service。
 *   - 决策 I-2：响应里的用户形状是 `UserBrief = { id, account, displayName }`。
 *
 * 归属说明（决策 I-0）：本文件是 `src/auth/` 内的新增文件，属 M1 独占，不触碰冻结文件。
 */
import type { PrismaClient } from '@prisma/client'
import type { UserBrief } from '../shared/types.js'

/** `User` 表行 → 决策 I-2 的 `UserBrief`。 */
export function toUserBrief(row: { id: string; account: string; displayName: string }): UserBrief {
  return { id: row.id, account: row.account, displayName: row.displayName }
}

/**
 * 按账号取登录所需凭据（含 `passwordHash`）。
 * 仅供登录流程内部校验使用，**不要把 `passwordHash` 放进任何响应**。
 */
export async function findCredentialByAccount(
  prisma: PrismaClient,
  account: string,
): Promise<{ id: string; account: string; displayName: string; passwordHash: string } | null> {
  return prisma.user.findUnique({
    where: { account },
    select: { id: true, account: true, displayName: true, passwordHash: true },
  })
}

/** 按 id 取当前用户简要信息（端点 2）。 */
export async function findUserBriefById(
  prisma: PrismaClient,
  userId: string,
): Promise<UserBrief | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, account: true, displayName: true },
  })
}

