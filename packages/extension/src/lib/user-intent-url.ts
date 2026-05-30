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
 * `pageUrl` 由 `getPageContextForAgent({ webComposerText })` 提供：扩展/Web 均**优先**从该文案中提取首个 http(s) URL。
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
