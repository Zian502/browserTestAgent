import { AgentThread } from './components/AgentThread'
import { UserProfileBar } from './components/UserProfileBar'
import { AgentRuntimeProvider } from './agent-runtime'
import { AuthProvider, useAuth } from './auth/auth-context'
import { RequireAuth } from './auth/require-auth'

const panelShell = {
  maxWidth: 560,
  height: 'calc(100% - 20px)',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, sans-serif',
  float: 'right',
  boxSizing: 'border-box',
  border: '1px solid #e4e4e7',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
} as const

const authenticatedShell = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
} as const

function AuthenticatedPanel() {
  const { authRequired, user, logout } = useAuth()

  return (
    <div style={authenticatedShell}>
      {authRequired && user ? (
        <UserProfileBar user={user} onLogout={() => void logout()} />
      ) : null}
      <AgentRuntimeProvider>
        <AgentThread />
      </AgentRuntimeProvider>
    </div>
  )
}

export function Panel() {
  return (
    <div style={panelShell}>
      <AuthProvider>
        <RequireAuth>
          <AuthenticatedPanel />
        </RequireAuth>
      </AuthProvider>
    </div>
  )
}
