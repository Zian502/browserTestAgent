const STORAGE_KEY = 'browser-test-agent:web-page-context'

export type PageContextPayload = {
  pageUrl: string
}

/** 运行在 Chrome 扩展 MV3 上下文中（popup / side panel 等） */
export function isExtensionRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string' &&
    chrome.runtime.id.length > 0
  )
}

/** 可作为分析目标的 http(s) 页面 */
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

export function loadWebPageContext(): PageContextPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return null
    const { pageUrl } = data as PageContextPayload & { rawHtml?: string }
    if (typeof pageUrl !== 'string') return null
    return { pageUrl }
  } catch {
    return null
  }
}

export function saveWebPageContext(payload: PageContextPayload) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function clearWebPageContext() {
  sessionStorage.removeItem(STORAGE_KEY)
}

export function urlsProbablyEqual(a: string, b: string): boolean {
  try {
    return new URL(a.trim()).href === new URL(b.trim()).href
  } catch {
    return a.trim() === b.trim()
  }
}

/** 去掉文案中贴在 URL 两侧的标点、括号、引号、零宽字符等 */
function trimUrlProseJunk(s: string): string {
  return s
    .replace(/^\uFEFF/, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/^[\s\x60"'[\(<{（【「]+/g, '')
    .replace(/[\s),.;:!?'"»」』】）>\]}\x60\u201c\u201d\u2018\u2019、。，；！？]+$/g, '')
}

/** 全角逗号「，」的 UTF-8 百分号序列；其后常为误贴进链接的中文说明 */
function stripEncodedFullwidthCommaSuffix(s: string): string {
  const idx = s.toLowerCase().indexOf('%ef%bc%8c')
  if (idx === -1) return s
  return s.slice(0, idx)
}

/** 去掉「全角/中文逗号 + 中日韩等说明」误接在 URL 后的尾巴（未编码时的粘贴） */
function stripCommaFollowedByCjkSuffix(s: string): string {
  return s.replace(/[\uFF0C，]\s*[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af].*$/u, '')
}

/**
 * 将一段可能含杂质的字符串规范为**唯一合法**的 http(s) URL（`URL` 解析成功且含 hostname）。
 * 从尾部逐字符回退，去掉非法或粘连的特殊字符直至可解析。
 */
export function sanitizePageUrlString(raw: string): string | null {
  let s = trimUrlProseJunk(raw.trim())
  if (!s || !/^https?:\/\//i.test(s)) return null

  s = stripEncodedFullwidthCommaSuffix(s)
  s = stripCommaFollowedByCjkSuffix(s)
  s = trimUrlProseJunk(s)

  const minLen = 'https://'.length + 1
  while (s.length >= minLen) {
    try {
      const u = new URL(s)
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
        return u.href
      }
    } catch {
      /* 继续缩短 */
    }
    s = s.slice(0, -1)
    s = trimUrlProseJunk(s)
  }
  return null
}

/**
 * 从输入框/用户文案中取出**第一个**合法 http(s) URL（用于 Web 环境推断 pageUrl）。
 * 先宽松匹配 `http(s)://…` 片段，再 **sanitize** 去掉粘连的特殊字符。
 */
export function extractPageUrlFromInputText(text: string): string | null {
  if (!text?.trim()) return null
  const re = /https?:\/\/\S+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const href = sanitizePageUrlString(m[0])
    if (href && isAcceptablePageUrl(href)) return href
  }
  return null
}

export type GetPageContextOptions = {
  /** Web 环境下：与输入框一致的最新用户全文，用于从中解析 pageUrl */
  webComposerText?: string
}

/**
 * 供 Agent 请求体中的 pageUrl：
 * - 扩展内：**优先**从用户输入（webComposerText）解析首个 http(s) URL；否则读当前激活标签页
 * - Web：**优先** sessionStorage；否则从 **webComposerText** 解析
 */
export async function getPageContextForAgent(opts?: GetPageContextOptions): Promise<PageContextPayload> {
  const fromInput = opts?.webComposerText ? extractPageUrlFromInputText(opts.webComposerText) : null

  if (isExtensionRuntime()) {
    if (fromInput && isAcceptablePageUrl(fromInput)) {
      return { pageUrl: fromInput }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url) {
      throw new Error('无法获取当前标签页')
    }
    return { pageUrl: tab.url }
  }

  if (fromInput && isAcceptablePageUrl(fromInput)) {
    return { pageUrl: fromInput }
  }

  const saved = loadWebPageContext()
  const savedRaw = saved?.pageUrl?.trim() ?? ''
  const savedUrl = savedRaw ? sanitizePageUrlString(savedRaw) : null
  if (savedUrl && isAcceptablePageUrl(savedUrl)) {
    return { pageUrl: savedUrl }
  }

  return { pageUrl: '' }
}
