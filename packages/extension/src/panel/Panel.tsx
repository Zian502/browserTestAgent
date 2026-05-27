import { useEffect, useState } from 'react'
import { AgentThread } from './components/AgentThread'
import { UserProfileBar } from './components/UserProfileBar'
import { AgentRuntimeProvider } from './agent-runtime'
import { AuthProvider, useAuth } from './auth/auth-context'
import { RequireAuth } from './auth/require-auth'
import { fetchChatHistoryMessages } from './chat-history-api'
import { chatHistoryToThreadMessages } from './chat-history-messages'
import type { ThreadMessageLike } from '@assistant-ui/react'

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

const historyLoadingShell = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontSize: 13,
} as const

function AuthenticatedPanel() {
  const { authRequired, user, logout, status } = useAuth()
  const [initialMessages, setInitialMessages] = useState<ThreadMessageLike[] | null>(null)

  useEffect(() => {
    if (status === 'loading') return
    if (authRequired && !user) return

    setInitialMessages(null)
    const ac = new AbortController()

    void (async () => {
      try {
        const { messages } = await fetchChatHistoryMessages({ signal: ac.signal, limit: 300 })
        if (ac.signal.aborted) return
        setInitialMessages(chatHistoryToThreadMessages(messages))
      } catch {
        if (ac.signal.aborted) return
        setInitialMessages([])
      }
    })()

    return () => ac.abort()
  }, [status, authRequired, user?.id])

  return (
    <div style={authenticatedShell}>
      {authRequired && user ? (
        <UserProfileBar user={user} onLogout={() => void logout()} />
      ) : null}
      {initialMessages === null ? (
        <div style={historyLoadingShell}>正在加载历史消息…</div>
      ) : (
        <AgentRuntimeProvider key={user?.id ?? 'anonymous'} initialMessages={initialMessages}>
          <AgentThread />
        </AgentRuntimeProvider>
      )}
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
