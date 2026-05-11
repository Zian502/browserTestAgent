import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

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

/**
 * 启动 Chromium/Chrome，导航到 pageUrl，通过 CDP 抓取 HTML，并**保持浏览器与会话**供后续
 * parseHtmlAgent / testCodeAgent 复用同一标签页。
 */
export async function openPageAndCaptureHtmlViaCDP(
  sessionId: string,
  pageUrl: string,
  opts: PlaywrightSessionLaunchOptions = {},
): Promise<string> {
  if (sessions.has(sessionId)) {
    await disposePlaywrightSession(sessionId)
  }

  const browser = await launchChromeLikeBrowser(opts)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const navTimeout = opts.navigationTimeoutMs ?? 90_000
  page.setDefaultNavigationTimeout(navTimeout)

  try {
    await page.goto(pageUrl, {
      waitUntil: opts.waitUntil ?? 'domcontentloaded',
      timeout: navTimeout,
    })

    const html = await getDocumentOuterHtmlViaCDP(page)
    sessions.set(sessionId, { browser, context, page })
    return html
  } catch (e) {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
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
