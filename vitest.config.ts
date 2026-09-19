import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // 在任何测试模块被求值前设置 DATABASE_URL 并建表（见 test/globals.ts）
    setupFiles: ['./test/globals.ts'],
    // 每个测试文件在 beforeAll 里对临时 SQLite 库执行一次 prisma db push，故放宽超时
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    globals: false,
  },
})
