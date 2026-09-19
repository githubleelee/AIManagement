import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 测试数据库装配。
// 每个测试文件在独立进程里拥有自己的临时 SQLite 文件：
// 不用 :memory:，因为 SQLite 内存库是每连接一个，Prisma 连接池会产生多个连接，
// 表现为「表不存在」的偶发失败（见接口契约测试决策）。
// 相对 URL 以 schema 所在目录（src/db）为基准，CLI 与运行时解析一致。

let ready = false
let dbFileName: string | undefined

export function ensureTestDatabase(): void {
  if (ready) return
  dbFileName = `test-${randomUUID()}.db`
  process.env.DATABASE_URL = `file:./${dbFileName}`
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  })
  ready = true
  process.on('exit', cleanupTestDatabase)
}

export function cleanupTestDatabase(): void {
  if (!dbFileName) return
  const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db')
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    // Windows 上文件可能仍被进程占用，删除失败不应让测试套件失败
    try {
      rmSync(join(schemaDir, `${dbFileName}${suffix}`), { force: true })
    } catch {
      /* 忽略：临时文件已 gitignore */
    }
  }
}
