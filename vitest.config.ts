import { defineConfig } from 'vitest/config'

/**
 * 测试运行器配置（T0-01）。
 *
 * 接口契约「Testing Decisions」规定：唯一 seam 是 HTTP 接口层。
 * 因此测试统一放在 test/ 目录，通过 supertest 对 Fastify 实例发起请求。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // 契约要求测试数据由工厂函数自建、不依赖全局种子；测试之间互不污染。
    sequence: { shuffle: false },
    reporters: ['default'],
    // 并发上限（2026-10-24 加入）：默认按 CPU 数（本机 28）起 worker，每个 worker 还会带一个
    // Prisma 查询引擎进程，共用一个 SQLite 文件的并发写会周期性出现 `database is locked`
    // 伪失败（每个失败文件单跑均全过）。这里把同时运行的测试文件数压到 8，既保留并行，
    // 又避免超订；如果将来机器内存/磁盘更弱可继续下调。
    maxWorkers: 8,
    minWorkers: 8,
  },
})
