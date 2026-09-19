import { useState, type FormEvent } from 'react'
import type { UserBrief } from '../../../src/shared/types'
import { ApiError, login, setToken } from '../api'

/** 登录页（端点 1）。成功后把令牌写入 localStorage 并通知外层。 */
export default function LoginPage({ onSuccess }: { onSuccess: (user: UserBrief) => void }) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await login(account, password)
      setToken(res.token)
      onSuccess(res.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <h1>爱管理</h1>
      <p className="tagline">登录以进入项目空间</p>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          账号
          <input
            value={account}
            autoComplete="username"
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  )
}
