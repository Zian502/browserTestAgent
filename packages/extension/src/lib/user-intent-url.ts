import type { ThreadMessage } from '@assistant-ui/react'

function userText(m: ThreadMessage): string {
  if (m.role !== 'user') return ''
  return m.content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim()
}

/**
 * 取**最新一条**用户消息的完整文本，作为 API 的 `userInput`。
 * 不把消息中的 URL 拆到 `pageUrl`：`pageUrl` 仅由 `getPageContextForAgent()`（当前标签或 Web 的 sessionStorage）提供。
 */
export function resolveLatestUserInput(messages: readonly ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const t = userText(m)
    if (t) return t
  }
  return ''
}
