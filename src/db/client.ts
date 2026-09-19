// Prisma client 单例。每次请求都从数据库读取权限，不做进程内缓存（决策 I-10）。
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
