import { AgentThread } from './components/AgentThread'
import { AgentRuntimeProvider } from './agent-runtime'

export function Panel() {
  return (
    <div
      style={{
        width: 'min(100%, 420px)',
        maxWidth: 560,
        height: 'calc(100% - 20px)',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        paddingBottom: 20,
        float: 'right',
      }}
    >
      <AgentRuntimeProvider>
        <AgentThread />
      </AgentRuntimeProvider>
    </div>
  )
}
