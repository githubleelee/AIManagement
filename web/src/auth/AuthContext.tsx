import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { UserBrief } from '../../../src/shared/types'
import { clearToken, fetchMe, getToken, login as apiLogin, setToken } from '../api'

/** 当前用户会话（T0-04）。启动时有本地令牌则拉 /auth/me，失败则清理回登录页。 */
type AuthState = {
  user: UserBrief | null
  initializing: boolean
  signIn: (account: string, password: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserBrief | null>(null)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setInitializing(false)
      return
    }
    fetchMe()
      .then(setUser)
      .catch(() => {
        clearToken()
        setUser(null)
      })
      .finally(() => setInitializing(false))
  }, [])

  const signIn = useCallback(async (account: string, password: string) => {
    const res = await apiLogin(account, password)
    setToken(res.token)
    setUser(res.user)
  }, [])

  const signOut = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, initializing, signIn, signOut }),
    [user, initializing, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}

