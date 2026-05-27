/** 扩展环境下清除 github.com 会话 Cookie（Web 调试模式无此 API） */
export async function clearGithubBrowserCache(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.cookies?.getAll) return

  const seen = new Set<string>()

  for (const domain of ['github.com', '.github.com']) {
    const cookies = await new Promise<chrome.cookies.Cookie[]>((resolve) => {
      chrome.cookies.getAll({ domain }, (items) => resolve(items ?? []))
    })

    for (const cookie of cookies) {
      const dedupeKey = `${cookie.name}\0${cookie.domain}\0${cookie.path}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
      const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`
      await new Promise<void>((resolve) => {
        chrome.cookies.remove({ url, name: cookie.name }, () => resolve())
      })
    }
  }
}
