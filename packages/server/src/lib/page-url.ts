/** 可作为分析目标的 http(s) 页面（与扩展侧约定一致） */
export function isAcceptablePageUrl(url: string): boolean {
  const u = url.trim()
  if (!u) return false
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
