import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AGENT_API_BASE } from '../agent-api-base'
import { fetchAuthConfig, loginWithGithub as startGithubLogin, setUnauthorizedHandler } from './auth-api'
import {
  clearAccessTokenFromLocationHash,
  clearAuthSession,
  getStoredAccessToken,
  parseAccessTokenFromLocationHash,
  saveAuthSession,
  type AuthUser,
} from './auth-storage'

type AuthStatus = 'loading' | 'guest' | 'authenticated'

type AuthContextValue = {
  status: AuthStatus
  authRequired: boolean
  /** 是否可进入主界面（未开启鉴权，或已登录） */
  canAccessApp: boolean
  user: AuthUser | null
  login: () => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [authRequired, setAuthRequired] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  const hydrateFromServer = useCallback(async () => {
    const config = await fetchAuthConfig()
    if (!config.enabled) {
      setAuthRequired(false)
      setUser(null)
      setStatus('authenticated')
      return
    }

    setAuthRequired(true)

    const hashToken = parseAccessTokenFromLocationHash()
    if (hashToken) {
      clearAccessTokenFromLocationHash()
    }

    const token = hashToken ?? (await getStoredAccessToken())
    if (!token) {
      setUser(null)
      setStatus('guest')
      return
    }

    const me = await fetchMeWithToken(token)
    if (!me.authenticated || !me.user) {
      await clearAuthSession()
      setUser(null)
      setStatus('guest')
      return
    }

    await saveAuthSession(token, me.user)
    setUser(me.user)
    setStatus('authenticated')
  }, [])

  useEffect(() => {
    void hydrateFromServer().catch(() => {
      setUser(null)
      setStatus('guest')
      setAuthRequired(true)
    })
  }, [hydrateFromServer])

  const login = useCallback(async () => {
    const { token, user: nextUser } = await startGithubLogin()
    await saveAuthSession(token, nextUser)
    setUser(nextUser)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    await clearAuthSession()
    setUser(null)
    setStatus('guest')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearAuthSession().then(() => {
        setUser(null)
        setStatus('guest')
      })
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const canAccessApp = status === 'authenticated' && (!authRequired || user != null)

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      authRequired,
      canAccessApp,
      user,
      login,
      logout,
      refresh: hydrateFromServer,
    }),
    [status, authRequired, canAccessApp, user, login, logout, hydrateFromServer],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return ctx
}

async function fetchMeWithToken(token: string) {
  const res = await fetch(`${AGENT_API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    return { authenticated: false, authRequired: true, user: null as AuthUser | null }
  }
  return (await res.json()) as { authenticated: boolean; authRequired: boolean; user: AuthUser | null }
}
