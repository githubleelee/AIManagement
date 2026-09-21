import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuth } from '../auth/AuthContext'
import Button from '../components/Button'
import FormField from '../components/FormField'

/** 只接受站内绝对路径，避免开放重定向。 */
function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/projects'
}

/** 登录页（端点 1）。支持 ?redirect= 深链回跳。 */
export default function LoginPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirectTo = safeRedirect(params.get('redirect'))

  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true })
  }, [user, redirectTo, navigate])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(account, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <div className="card login-card">
        <h1>爱管理</h1>
        <p className="muted">登录以进入项目空间</p>
        <form className="form" onSubmit={handleSubmit}>
          <FormField label="账号">
            <input
              value={account}
              autoComplete="username"
              onChange={(e) => setAccount(e.target.value)}
            />
          </FormField>
          <FormField label="密码">
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {error ? <p className="error">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </Button>
        </form>
      </div>
    </main>
  )
}

