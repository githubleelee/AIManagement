import { randomBytes } from 'node:crypto'

// 会话存储。
// 接口契约决策 I-8 要求「凭证为不透明随机串，存库校验」，但冻结的 schema（决策 I-7）没有
// session 表，新增表属于契约变更。Sprint 1 先用进程内 Map 承载；登录端点（T0-04）同样依赖它。
// 权限与可见范围判定不在这里，仍由 can() / visibilityScope() 每次查库（决策 I-10）。

const sessions = new Map<string, string>()

export function createSession(userId: string): string {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, userId)
  return token
}

export function resolveSession(token: string): string | undefined {
  return sessions.get(token)
}

export function destroySession(token: string): void {
  sessions.delete(token)
}

export function clearSessions(): void {
  sessions.clear()
}
