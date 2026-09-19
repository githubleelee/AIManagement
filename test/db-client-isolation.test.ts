/**
 * Prisma client 单例与临时库的隔离性验证（T0-02 对抗性验证）
 *
 * 契约决策 I-0 要求 client 单例（`src/db/client.ts` 用 globalThis 缓存），
 * 而 `src/db/test-support.ts` 为每个测试文件创建独立 client。本文件探明：
 *   1. 两个临时库之间互不污染；
 *   2. 单例在第一次构造时绑定当时的 `DATABASE_URL`，之后改变环境变量不会
 *      重新绑定（globalThis 缓存命中同一实例）—— 这是「混用会读串库」的
 *      潜在风险来源；
 *   3. 现有测试基础设施不 import 单例，因此当前 39+ 用例不受该风险影响。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  createTempDatabase,
  resetDatabase,
  type TestDatabase,
} from '../src/db/test-support.js'

type PrismaGlobal = { __prisma__?: PrismaClient }

let dbA: TestDatabase
let dbB: TestDatabase

beforeAll(() => {
  dbA = createTempDatabase()
  dbB = createTempDatabase()
}, 120_000)

afterAll(async () => {
  await dbA.dispose()
  await dbB.dispose()
})

describe('临时库之间的隔离', () => {
  it('写入库 A 不会出现在库 B', async () => {
    await dbA.prisma.user.create({
      data: { account: 'only-in-a', displayName: 'a', passwordHash: 'h' },
    })
    expect(await dbA.prisma.user.count()).toBe(1)
    expect(await dbB.prisma.user.count()).toBe(0)
  })
})

describe('client 单例的绑定时机（潜在污染风险证据）', () => {
  async function disconnectCachedSingleton(): Promise<void> {
    const cached: PrismaClient | undefined = (globalThis as unknown as PrismaGlobal).__prisma__
    if (cached) {
      await cached.$disconnect()
    }
    delete (globalThis as unknown as PrismaGlobal).__prisma__
  }

  it('单例绑定构造时的 DATABASE_URL，后续修改环境变量不会重新绑定', async () => {
    const originalUrl = process.env.DATABASE_URL
    const previousNodeEnv = process.env.NODE_ENV

    // 清掉可能残留的单例缓存，确保从干净状态开始
    await disconnectCachedSingleton()

    try {
      // 前一个用例已向 A 写入数据，先清干净以得到确定的基数
      await resetDatabase(dbA.prisma)
      await resetDatabase(dbB.prisma)

      process.env.NODE_ENV = 'test' // client.ts 仅在非 production 下写 globalThis 缓存
      process.env.DATABASE_URL = dbA.databaseUrl
      const first = await import('../src/db/client.js')
      await first.prisma.user.create({
        data: { account: 'via-singleton', displayName: 's', passwordHash: 'h' },
      })
      expect(await dbA.prisma.user.count()).toBe(1)
      expect(await dbB.prisma.user.count()).toBe(0)

      // 改环境变量并重置模块注册表，强制重新执行 client.ts
      process.env.DATABASE_URL = dbB.databaseUrl
      vi.resetModules()
      const second = await import('../src/db/client.js')

      // globalThis 缓存命中同一实例：仍然指向库 A，而不是新环境变量指向的库 B
      expect(second.prisma).toBe(first.prisma)
      expect(await second.prisma.user.count()).toBe(1)
      expect(await dbB.prisma.user.count()).toBe(0)
    } finally {
      await disconnectCachedSingleton()
      if (originalUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = originalUrl
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  })
})
