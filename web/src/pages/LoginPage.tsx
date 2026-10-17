import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { POST_SIGN_OUT_KEY, useAuth } from '../auth/AuthContext'
import Button from '../components/Button'
import FormField from '../components/FormField'

/** 只接受站内绝对路径，避免开放重定向。 */
function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/projects'
}

/** 明确退出后换账号回主页；首次深链登录仍能返回原目标。 */
export default function LoginPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirectTo = safeRedirect(params.get('redirect'))
  const submitting = useRef(false)

  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user && !submitting.current) navigate('/projects', { replace: true })
  }, [user, navigate])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    submitting.current = true
    setError(null)
    setBusy(true)
    try {
      await signIn(account, password)
      const switchedAccount = sessionStorage.getItem(POST_SIGN_OUT_KEY) === '1'
      sessionStorage.removeItem(POST_SIGN_OUT_KEY)
      window.location.replace(switchedAccount ? '/projects' : redirectTo)
    } catch (err) {
      submitting.current = false
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
