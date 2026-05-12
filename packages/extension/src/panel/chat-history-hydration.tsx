import { useEffect } from 'react'
import { useAui } from '@assistant-ui/react'
import { fetchChatHistoryMessages } from './chat-history-api'

/** StrictMode / 重挂载时使进行中的拉取失效，避免重复灌入。 */
let chatHistoryHydrationEpoch = 0

export function ChatHistoryHydration() {
  const aui = useAui()

  useEffect(() => {
    const epoch = ++chatHistoryHydrationEpoch
    const ac = new AbortController()

    void (async () => {
      try {
        const { messages } = await fetchChatHistoryMessages({ signal: ac.signal, limit: 300 })
        if (epoch !== chatHistoryHydrationEpoch) return
        if (!messages.length) return
        if (aui.thread().getState().messages.length > 0) return

        for (const row of messages) {
          if (epoch !== chatHistoryHydrationEpoch) return
          if (aui.thread().getState().messages.length > 0) return
          const role = row.role === 'assistant' ? 'assistant' : 'user'
          const text = typeof row.content === 'string' ? row.content : ''
          if (!text.trim()) continue
          await Promise.resolve(
            aui.thread().append({
              role,
              content: [{ type: 'text', text }],
              startRun: false,
            }),
          )
        }
      } catch {
        /* 离线、Mongo 未起或 CORS：忽略，不影响新对话 */
      }
    })()

    return () => {
      ac.abort()
      chatHistoryHydrationEpoch++
    }
  }, [aui])

  return null
}
