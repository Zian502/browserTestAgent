import { AGENT_API_BASE } from './agent-api-base'
import { authFetch } from './auth/auth-api'

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

/** 拉取当前用户的历史消息（sessionId 由服务端按 JWT 解析）。 */
export async function fetchChatHistoryMessages(options?: {
  limit?: number
  signal?: AbortSignal
}): Promise<ChatHistoryResponse> {
  const limit = options?.limit ?? 300
  const q = new URLSearchParams({ limit: String(limit) })
  const res = await authFetch(`${AGENT_API_BASE}/api/agent/chat/messages?${q}`, {
    method: 'GET',
    signal: options?.signal,
  })
  if (!res.ok) {
    throw new Error(`拉取历史消息失败：HTTP ${res.status}`)
  }
  return (await res.json()) as ChatHistoryResponse
}

export type ChatSessionSummary = {
  sessionId: string
  title?: string
  lastPageUrl?: string
  lastThreadId?: string
  createdAt?: string
  updatedAt?: string
}

/** 拉取当前用户的会话列表。 */
export async function fetchChatSessions(options?: { signal?: AbortSignal }): Promise<{
  sessions: ChatSessionSummary[]
}> {
  const res = await authFetch(`${AGENT_API_BASE}/api/agent/chat/sessions`, {
    method: 'GET',
    signal: options?.signal,
  })
  if (!res.ok) {
    throw new Error(`拉取会话列表失败：HTTP ${res.status}`)
  }
  return (await res.json()) as { sessions: ChatSessionSummary[] }
}
