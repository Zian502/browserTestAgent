import { AgentThread } from './components/AgentThread'
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

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '10px 12px',
  borderBottom: '1px solid #e4e4e7',
  background: '#fff',
  flexShrink: 0,
} as const

const headerTitle = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  color: '#111827',
} as const

const userRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
} as const

const avatarStyle = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  flexShrink: 0,
} as const

const userName = {
  fontSize: 12,
  color: '#374151',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 120,
} as const

const logoutBtn = {
  border: '1px solid #e4e4e7',
  background: '#fff',
  color: '#374151',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
} as const

function AuthenticatedPanel() {
  const { authRequired, user, logout } = useAuth()

  return (
    <>
      {authRequired && user ? (
        <header style={headerStyle}>
          <h2 style={headerTitle}>Browser Test Agent</h2>
          <div style={userRow}>
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={avatarStyle} /> : null}
            <span style={userName}>{user.name || user.login}</span>
            <button type="button" style={logoutBtn} onClick={() => void logout()}>
              退出
            </button>
          </div>
        </header>
      ) : null}
      <AgentRuntimeProvider>
        <AgentThread />
      </AgentRuntimeProvider>
    </>
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
