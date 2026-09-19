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
  },
})
