import http from 'node:http'
import { chromium, type Browser, type Page } from 'playwright'

let attachedBrowser: Browser | null = null

/** 从环境变量读取已有 Chrome 的 CDP 端点，例如 `http://127.0.0.1:9222` */
export function getPlaywrightCdpEndpoint(): string | null {
  const raw = String(process.env.PLAYWRIGHT_CDP_URL ?? process.env.CHROME_CDP_URL ?? '').trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

/** 是否配置了 CDP 端点（不要求端口已监听） */
export function isPlaywrightCdpAttachMode(): boolean {
  return getPlaywrightCdpEndpoint() != null
}

/** 已配置 CDP 时，是否允许在端口不可达时回退为 Playwright 新开浏览器（默认否） */
export function isPlaywrightCdpFallbackLaunchEnabled(): boolean {
  const v = String(process.env.PLAYWRIGHT_CDP_FALLBACK ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** @deprecated 使用 isPlaywrightCdpFallbackLaunchEnabled；保留兼容 */
export function isPlaywrightCdpStrictMode(): boolean {
  return isPlaywrightCdpAttachMode() && !isPlaywrightCdpFallbackLaunchEnabled()
}

let reachabilityCache: { endpoint: string; ok: boolean; at: number } | null = null
const REACHABILITY_TTL_MS = 2_000

function httpProbeCdp(endpoint: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL('/json/version', `${endpoint.replace(/\/+$/, '')}/`)
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

export function clearCdpReachabilityCache(): void {
  reachabilityCache = null
}

/** 探测 CDP HTTP 端点是否可用（Chrome 须以 --remote-debugging-port 冷启动） */
export async function isCdpEndpointReachable(endpoint: string, bypassCache = false): Promise<boolean> {
  const ep = endpoint.replace(/\/+$/, '')
  const now = Date.now()
  if (
    !bypassCache &&
    reachabilityCache &&
    reachabilityCache.endpoint === ep &&
    now - reachabilityCache.at < REACHABILITY_TTL_MS
  ) {
    return reachabilityCache.ok
  }
  let ok = await httpProbeCdp(ep, 2_500)
  if (!ok) {
    try {
      const res = await fetch(`${ep}/json/version`, { signal: AbortSignal.timeout(2_500) })
      ok = res.ok
    } catch {
      ok = false
    }
  }
  reachabilityCache = { endpoint: ep, ok, at: now }
  return ok
}

/** 配置且端口可达时才挂接已有 Chrome */
export async function isPlaywrightCdpAttachActive(): Promise<boolean> {
  const endpoint = getPlaywrightCdpEndpoint()
  if (!endpoint) return false
  return isCdpEndpointReachable(endpoint)
}

export function formatCdpConnectionHelp(endpoint: string): string {
  return (
    `无法连接 Chrome 远程调试端点 ${endpoint}。\n\n` +
    `常见原因：日常 Chrome 仍在运行，导致 \`chrome:cdp\` **并未真正开启 9222**（只会另开普通窗口）。\n\n` +
    `请执行 \`pnpm chrome:cdp\`（默认会退出并以调试模式重启日常 Chrome，通常恢复标签与登录态），\n` +
    `确认终端出现「CDP 端口已监听」后再跑 Agent。\n\n` +
    `若确需端口不可达时由 Playwright 自动新开浏览器，在 .env 设置 \`PLAYWRIGHT_CDP_FALLBACK=1\`。`
  )
}

export async function getOrConnectCdpBrowser(): Promise<Browser> {
  const endpoint = getPlaywrightCdpEndpoint()
  if (!endpoint) {
    throw new Error('未配置 PLAYWRIGHT_CDP_URL（或 CHROME_CDP_URL）')
  }
  if (attachedBrowser?.isConnected()) {
    return attachedBrowser
  }
  try {
    attachedBrowser = await chromium.connectOverCDP(endpoint)
    return attachedBrowser
  } catch (e) {
    const msg = String(e)
    if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
      throw new Error(formatCdpConnectionHelp(endpoint))
    }
    throw e
  }
}

export async function disconnectCdpBrowser(): Promise<void> {
  if (!attachedBrowser) return
  try {
    await attachedBrowser.close()
  } catch {
    /* ignore */
  }
  attachedBrowser = null
}

function urlParts(url: string): { origin: string; pathname: string } | null {
  try {
    const u = new URL(url)
    const pathname = u.pathname.replace(/\/$/, '') || '/'
    return { origin: u.origin, pathname }
  } catch {
    return null
  }
}

/** 目标 URL 与页签 URL 是否视为同一页面（同源且路径一致，或互为前缀） */
export function pageMatchesTargetUrl(pageHref: string, targetUrl: string): boolean {
  const target = targetUrl.trim()
  if (!target) return true
  const href = pageHref.trim()
  if (!href || href === 'about:blank') return false

  const a = urlParts(href)
  const b = urlParts(target)
  if (a && b && a.origin === b.origin && a.pathname === b.pathname) return true

  const hrefBase = href.split(/[?#]/)[0]
  const targetBase = target.split(/[?#]/)[0]
  return hrefBase === targetBase || hrefBase.startsWith(targetBase) || targetBase.startsWith(hrefBase)
}

function collectOpenPages(browser: Browser): Page[] {
  const pages: Page[] = []
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (!p.isClosed()) pages.push(p)
    }
  }
  return pages
}

/** 列出已连接 Chrome 中可识别的页签 URL（用于错误提示） */
export function listOpenPageUrls(browser: Browser): string[] {
  return collectOpenPages(browser)
    .map((p) => p.url())
    .filter((u) => u && !u.startsWith('about:'))
}

/**
 * 在已连接的 Chrome 中查找与 targetUrl 最匹配的页签；
 * 无匹配时返回第一个非 about: 页签，若仍无则返回 undefined。
 */
export function findPageForTargetUrl(browser: Browser, targetUrl: string): Page | undefined {
  const pages = collectOpenPages(browser)
  const target = targetUrl.trim()
  if (!target) {
    return pages.find((p) => !p.url().startsWith('about:')) ?? pages[0]
  }

  const targetBase = target.split(/[?#]/)[0]
  const exact = pages.filter((p) => pageMatchesTargetUrl(p.url(), target))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    return (
      exact.find((p) => p.url().split(/[?#]/)[0] === targetBase) ??
      exact.find((p) => p.url().includes('/zh')) ??
      exact[0]
    )
  }

  return pages.find((p) => {
    const href = p.url()
    return href && href.split(/[?#]/)[0] === targetBase
  })
}
