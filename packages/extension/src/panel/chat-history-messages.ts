import type { ThreadMessageLike } from '@assistant-ui/react'
import type { ChatHistoryMessage } from './chat-history-api'

export function chatHistoryToThreadMessages(messages: ChatHistoryMessage[]): ThreadMessageLike[] {
  return messages
    .filter((row) => typeof row.content === 'string' && row.content.trim())
    .map((row, index) => ({
      id: `${row.threadId}-${row.role}-${index}`,
      role: row.role,
      content: [{ type: 'text' as const, text: row.content }],
      createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
    }))
}
