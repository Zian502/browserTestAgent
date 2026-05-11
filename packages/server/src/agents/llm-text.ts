export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c && typeof (c as { text: unknown }).text === 'string') {
          return (c as { text: string }).text
        }
        return ''
      })
      .join('')
  }
  return String(content ?? '')
}

export function extractJsonObject<T>(raw: string): T {
  const trimmed = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed)
  const body = fence ? fence[1].trim() : trimmed
  return JSON.parse(body) as T
}
