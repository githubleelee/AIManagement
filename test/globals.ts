import { ensureTestDatabase } from './setup'

// Vitest setupFiles：在任何测试模块被求值之前设置 DATABASE_URL 并建表，
// 这样测试文件可以静态 import app / Prisma client（它们在模块加载时构造）。
ensureTestDatabase()
