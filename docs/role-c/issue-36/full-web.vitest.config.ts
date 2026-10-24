import { defineConfig } from 'vitest/config'

/**
 * 补跑主配置未覆盖的 web/ 前端纯函数测试。
 * 主 vitest.config.ts 的 include 只含 test/** 与 src/**，不含 web/**。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx'],
    reporters: ['default'],
    sequence: { shuffle: false },
    maxWorkers: 2,
    minWorkers: 1,
  },
})
