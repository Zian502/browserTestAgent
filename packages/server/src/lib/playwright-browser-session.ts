import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import {
  findPageForTargetUrl,
  formatCdpConnectionHelp,
  getOrConnectCdpBrowser,
  getPlaywrightCdpEndpoint,
  isPlaywrightCdpAttachActive,
  isPlaywrightCdpAttachMode,
  isPlaywrightCdpFallbackLaunchEnabled,
  listOpenPageUrls,
  pageMatchesTargetUrl,
} from './playwright-cdp-connect'

export {
  getPlaywrightCdpEndpoint,
  isPlaywrightCdpAttachMode,
  isPlaywrightCdpAttachActive,
  formatCdpConnectionHelp,
} from './playwright-cdp-connect'

export type PlaywrightSessionLaunchOptions = {
  /** 默认 false：弹出真实窗口便于观察解析与测试过程 */
  headless?: boolean
  /** 放慢操作节奏（毫秒），便于肉眼跟随 */
  slowMoMs?: number
  navigationTimeoutMs?: number
  /**
   * 默认 `domcontentloaded`：大量 SPA / 交易所站点的第三方脚本、长连接会导致 `load` 长时间不触发甚至永不触发。
   * 需要与旧版行为一致时可显式传 `load`。
   */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
}

type HeldSession = {
  browser: Browser
  context: BrowserContext
  page: Page
  /** 挂接到用户已打开的 Chrome 时，dispose 不关闭浏览器/上下文 */
  external?: boolean
}

const sessions = new Map<string, HeldSession>()

/** 通过 CDP Runtime.evaluate 读取 documentElement.outerHTML（与扩展侧 outerHTML 语义一致） */
export async function getDocumentOuterHtmlViaCDP(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Runtime.enable')
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true,
    })
    const v = result?.value
    if (typeof v !== 'string' || !v.trim()) {
      throw new Error('CDP 返回的 HTML 为空')
    }
    return v
  } finally {
    await cdp.detach().catch(() => {})
  }
}

async function launchChromeLikeBrowser(opts: PlaywrightSessionLaunchOptions): Promise<Browser> {
  const headless = opts.headless ?? false
  const slowMo = opts.slowMoMs ?? 0
  try {
    return await chromium.launch({
      channel: 'chrome',
      headless,
      slowMo,
    })
  } catch {
    return await chromium.launch({ headless, slowMo })
  }
}

async function navigatePageIfNeeded(
  page: Page,
  pageUrl: string,
  opts: PlaywrightSessionLaunchOptions,
): Promise<void> {
  const url = pageUrl.trim()
  if (!url) return
  const navTimeout = opts.navigationTimeoutMs ?? 90_000
  page.setDefaultNavigationTimeout(navTimeout)
  if (pageMatchesTargetUrl(page.url(), url)) return
  await page.goto(url, {
    waitUntil: opts.waitUntil ?? 'domcontentloaded',
    timeout: navTimeout,
  })
}

/** 挂接模式：仅复用已打开且 URL 匹配的页签，不启动浏览器、不新建页签、不导航 */
async function acquireBrowserPageAttachOnly(
  pageUrl: string,
  opts: PlaywrightSessionLaunchOptions = {},
): Promise<HeldSession> {
  const url = pageUrl.trim()
  if (!url) {
    throw new Error(
      '挂接模式下必须提供目标 URL（例如 https://www.bydfi.com/zh），以便匹配你已打开的页签',
    )
  }
  const browser = await getOrConnectCdpBrowser()
  const page = findPageForTargetUrl(browser, url)
  if (!page) {
    const open = listOpenPageUrls(browser)
    throw new Error(
      `未在已连接的 Chrome 中找到与 ${url} 匹配的页签。` +
        `请先在 Chrome 中打开该页面。当前页签：${open.length ? open.join(' | ') : '(无)'}`,
    )
  }
  const navTimeout = opts.navigationTimeoutMs ?? 90_000
  page.setDefaultNavigationTimeout(navTimeout)
  await page.bringToFront().catch(() => {})
  return { browser, context: page.context(), page, external: true }
}

/**
 * 取得用于会话的 Browser + Page：
 * - `PLAYWRIGHT_CDP_URL`：挂接已有 Chrome，仅匹配现有页签；
 * - 否则启动 Chromium/Chrome 并导航。
 */
async function acquireLaunchedBrowserPage(
  pageUrl: string,
  opts: PlaywrightSessionLaunchOptions,
): Promise<HeldSession> {
  const browser = await launchChromeLikeBrowser(opts)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await navigatePageIfNeeded(page, pageUrl, opts)
  return { browser, context, page, external: false }
}

async function acquireBrowserPage(
  pageUrl: string,
  opts: PlaywrightSessionLaunchOptions = {},
): Promise<HeldSession> {
  if (isPlaywrightCdpAttachMode()) {
    const endpoint = getPlaywrightCdpEndpoint()!
    const active = await isPlaywrightCdpAttachActive()
    if (active) {
      const held = await acquireBrowserPageAttachOnly(pageUrl, opts)
      console.warn(
        `[playwright] CDP 挂接 ${endpoint}，复用页签: ${held.page.url()}`,
      )
      return held
    }
    if (isPlaywrightCdpFallbackLaunchEnabled()) {
      console.warn(
        `[playwright] ${endpoint} 不可达，PLAYWRIGHT_CDP_FALLBACK=1 → 回退为 Playwright 启动 Chrome`,
      )
      return acquireLaunchedBrowserPage(pageUrl, opts)
    }
    throw new Error(formatCdpConnectionHelp(endpoint))
  }

  return acquireLaunchedBrowserPage(pageUrl, opts)
}

/**
 * 挂接到目标 URL 对应的**已有页签**并登记会话（不 capture、不 goto）。
 * 供 `run_test` 在 `PLAYWRIGHT_CDP_URL` 模式下直接在当前 Chrome 页签执行测试。
 */
export async function attachHeldSessionForTargetUrl(
  sessionId: string,
  pageUrl: string,
  opts: PlaywrightSessionLaunchOptions = {},
): Promise<Page> {
  if (sessions.has(sessionId)) {
    await disposePlaywrightSession(sessionId)
  }
  const held = await acquireBrowserPageAttachOnly(pageUrl, opts)
  sessions.set(sessionId, held)
  return held.page
}

/**
 * 在 `sessions` 中登记空白页会话（不导航 URL），与主流程 CDP 会话同源管理；
 * 供 `run_test` 在省略 `sessionId` 时用临时 id 创建页签，并由 `disposePlaywrightSession` 释放。
 */
export async function createHeldSessionBlankPage(
  sessionId: string,
  opts: PlaywrightSessionLaunchOptions & { pageUrl?: string } = {},
): Promise<Page> {
  if (sessions.has(sessionId)) {
    await disposePlaywrightSession(sessionId)
  }
  const target = String(opts.pageUrl ?? '').trim()
  if (await isPlaywrightCdpAttachActive()) {
    if (!target) {
      throw new Error('挂接模式下 createHeldSessionBlankPage 需要传入 pageUrl')
    }
    return attachHeldSessionForTargetUrl(sessionId, target, opts)
  }
  const held = await acquireBrowserPage(target, opts)
  sessions.set(sessionId, held)
  return held.page
}

/**
 * 打开页面并 CDP 抓取 HTML，保持浏览器与会话供后续 agent 复用同一标签页。
 * 若设置 `PLAYWRIGHT_CDP_URL`，则挂接本机已开启远程调试的 Chrome，优先使用 URL 匹配的现有页签。
 */
export async function openPageAndCaptureHtmlViaCDP(
  sessionId: string,
  pageUrl: string,
  opts: PlaywrightSessionLaunchOptions = {},
): Promise<string> {
  if (sessions.has(sessionId)) {
    await disposePlaywrightSession(sessionId)
  }

  let held: HeldSession | undefined
  try {
    held = await acquireBrowserPage(pageUrl, opts)
    const html = await getDocumentOuterHtmlViaCDP(held.page)
    sessions.set(sessionId, held)
    return html
  } catch (e) {
    if (held && !held.external) {
      await held.context.close().catch(() => {})
      await held.browser.close().catch(() => {})
    }
    throw e
  }
}

export function getPlaywrightSessionPage(sessionId: string): Page | undefined {
  return sessions.get(sessionId)?.page
}

export async function refreshSessionPageHtmlViaCDP(sessionId: string): Promise<string | null> {
  const page = sessions.get(sessionId)?.page
  if (!page) return null
  return getDocumentOuterHtmlViaCDP(page)
}

export async function disposePlaywrightSession(sessionId: string): Promise<void> {
  const held = sessions.get(sessionId)
  if (!held) return
  sessions.delete(sessionId)
  if (held.external) return
  try {
    await held.context.close()
  } catch {
    /* ignore */
  }
  try {
    await held.browser.close()
  } catch {
    /* ignore */
  }
}
