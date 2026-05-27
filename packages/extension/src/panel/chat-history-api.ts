import { AGENT_API_BASE } from './agent-api-base'
import { authFetch } from './auth/auth-api'
import { DEFAULT_CHAT_SESSION_ID } from './chat-session'

export type ChatHistoryMessage = {
  threadId: string
  role: 'user' | 'assistant'
  content: string
  pageUrl?: string
  createdAt?: string
}

export type ChatHistoryResponse = {
  sessionId: string
  messages: ChatHistoryMessage[]
}

export async function fetchChatHistoryMessages(options?: {
  sessionId?: string
  limit?: number
  signal?: AbortSignal
}): Promise<ChatHistoryResponse> {
  const sessionId = options?.sessionId?.trim() || DEFAULT_CHAT_SESSION_ID
  const limit = options?.limit ?? 300
  const q = new URLSearchParams({ sessionId, limit: String(limit) })
  const res = await authFetch(`${AGENT_API_BASE}/api/agent/chat/messages?${q}`, {
    method: 'GET',
    signal: options?.signal,
  })
  if (!res.ok) {
    throw new Error(`拉取历史消息失败：HTTP ${res.status}`)
  }
  return (await res.json()) as ChatHistoryResponse
}
