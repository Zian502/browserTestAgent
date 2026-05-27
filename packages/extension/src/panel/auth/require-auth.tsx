import type { ReactNode } from 'react'
import { LoginPage } from '../components/LoginPage'
import { useAuth } from './auth-context'

const loadingShell = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontSize: 13,
} as const

/** 未登录且服务端要求鉴权时，仅渲染登录页。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, canAccessApp } = useAuth()

  if (status === 'loading') {
    return <div style={loadingShell}>正在检查登录状态…</div>
  }

  if (!canAccessApp) {
    return <LoginPage />
  }

  return children
}
