import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import {
  attachHeldSessionForTargetUrl,
  createHeldSessionBlankPage,
  disposePlaywrightSession,
  ensureHeldSessionAtUrl,
  ensurePageAtTargetUrl,
  openPageAndCaptureHtmlViaCDP,
  getPlaywrightSessionPage,
  isPlaywrightCdpAttachActive,
  refreshSessionPageHtmlViaCDP,
  type PlaywrightSessionLaunchOptions,
} from '../lib/playwright-browser-session'
import { playwrightRunner } from '../lib/playwright-runner'
import { buildRunTestInjectedEnv } from '../lib/run-test-env'

export const PLAYWRIGHT_TOOL = 'playwright' as const

/** Playwright 相关操作全局串行化，避免多 agent 并行时争用同一 Chromium 会话或系统资源。 */
let playwrightChain: Promise<unknown> = Promise.resolve()

export function runPlaywrightExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = playwrightChain.then(() => fn())
  playwrightChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

type PageCaptureInput = {
  sessionId: string
  pageUrl: string
  launch?: Pick<PlaywrightSessionLaunchOptions, 'headless' | 'slowMoMs' | 'navigationTimeoutMs' | 'waitUntil' | 'exactPath'>
}

async function capturePageHtml(input: PageCaptureInput): Promise<
  | { ok: true; pageHtml: string; sessionId: string; durationMs: number }
  | { ok: false; sessionId: string; durationMs: number; error: string }
> {
  const started = Date.now()
  try {
    const pageHtml = await openPageAndCaptureHtmlViaCDP(input.sessionId, input.pageUrl, {
      headless: input.launch?.headless,
      slowMoMs: input.launch?.slowMoMs,
      navigationTimeoutMs: input.launch?.navigationTimeoutMs,
      waitUntil: input.launch?.waitUntil,
      exactPath: input.launch?.exactPath,
    })
    return {
      ok: true,
      pageHtml,
      sessionId: input.sessionId,
      durationMs: Date.now() - started,
    }
  } catch (e) {
    return {
      ok: false,
      sessionId: input.sessionId,
      durationMs: Date.now() - started,
      error: String(e),
    }
  }
}

export type PlaywrightCoreInput =
  | {
      op: 'capture'
      pageUrl: string
      headless?: boolean
      slowMoMs?: number
      sessionId?: string
      exactPath?: boolean
    }
  | { op: 'refresh_outer_html'; sessionId: string; navigateToUrl?: string; navigateExact?: boolean }
  | {
      op: 'run_test'
      /** 空串或未传：启动临时浏览器页并可选先导航 `targetUrl` */
      sessionId?: string
      code: string
      targetUrl: string
      timeoutMs?: number
      /** 已有会话时仍先导航到 targetUrl（首子任务对齐提示词 URL） */
      forceNavigate?: boolean
      /** 与 ensurePageAtTargetUrl.exactPath 一致 */
      navigateExact?: boolean
    }

export type PlaywrightCoreResult =
  | {
      op: 'capture'
      ok: true
      pageHtml: string
      sessionId: string
      durationMs: number
    }
  | { op: 'capture'; ok: false; sessionId: string; durationMs: number; error: string }
  | { op: 'refresh_outer_html'; ok: true; pageHtml: string; durationMs: number }
  | { op: 'refresh_outer_html'; ok: false; error: string; durationMs: number }
  | {
      op: 'run_test'
      ok: true
      passed: number
      failed: number
      skipped?: boolean
      logs: string[]
      durationMs: number
    }
  | { op: 'run_test'; ok: false; error: string; durationMs: number }

export async function executePlaywrightCoreTool(input: PlaywrightCoreInput): Promise<PlaywrightCoreResult> {
  return runPlaywrightExclusive(async () => {
    const t0 = Date.now()
    if (input.op === 'capture') {
      const sessionId = input.sessionId?.trim() || randomUUID()
      const r = await capturePageHtml({
        sessionId,
        pageUrl: input.pageUrl.trim(),
        launch: {
          headless: input.headless,
          slowMoMs: input.slowMoMs,
          exactPath: input.exactPath,
        },
      })
      const durationMs = Date.now() - t0
      if (r.ok) {
        return { op: 'capture', ok: true, pageHtml: r.pageHtml, sessionId: r.sessionId, durationMs }
      }
      return { op: 'capture', ok: false, sessionId: r.sessionId, durationMs, error: r.error }
    }
    if (input.op === 'refresh_outer_html') {
      try {
        const sid = input.sessionId.trim()
        const navUrl = input.navigateToUrl?.trim()
        const navOpts: PlaywrightSessionLaunchOptions = {
          exactPath: input.navigateExact ?? false,
        }
        if (navUrl) {
          await ensureHeldSessionAtUrl(sid, navUrl, navOpts)
        } else if (!getPlaywrightSessionPage(sid)) {
          return {
            op: 'refresh_outer_html',
            ok: false,
            error: 'CDP 会话不存在，请提供 navigateToUrl 以挂接页签',
            durationMs: Date.now() - t0,
          }
        }
        const html = await refreshSessionPageHtmlViaCDP(sid)
        const durationMs = Date.now() - t0
        if (typeof html === 'string' && html.trim()) {
          return { op: 'refresh_outer_html', ok: true, pageHtml: html, durationMs }
        }
        return {
          op: 'refresh_outer_html',
          ok: false,
          error: 'CDP 刷新返回空或会话不存在',
          durationMs,
        }
      } catch (e) {
        return { op: 'refresh_outer_html', ok: false, error: String(e), durationMs: Date.now() - t0 }
      }
    }
    if (input.op !== 'run_test') {
      throw new Error(`未知 Playwright 子操作：${(input as { op?: string }).op}`)
    }
    const rt = input as Extract<PlaywrightCoreInput, { op: 'run_test' }>

    const rawSid = (rt.sessionId ?? '').trim()
    const sid = rawSid || randomUUID()
    /** 本次会话为临时新建（省略 sessionId，或传入的 id 在服务端已不存在），须在 finally 里 dispose */
    let disposeTemporarySession = !rawSid
    let page: Page

    const targetUrl = rt.targetUrl.trim()
    const attachOnly = await isPlaywrightCdpAttachActive()

    async function gotoTargetOrFail(): Promise<PlaywrightCoreResult | null> {
      if (!targetUrl) return null
      /** 已有会话且非强制导航：保留当前页（前序 test 可能已 SPA 跳转） */
      if (rawSid && getPlaywrightSessionPage(sid) && !rt.forceNavigate) return null
      try {
        await ensurePageAtTargetUrl(page, targetUrl, {
          navigationTimeoutMs: rt.timeoutMs ?? 90_000,
          exactPath: rt.navigateExact ?? false,
        })
        return null
      } catch (e) {
        await disposePlaywrightSession(sid).catch(() => {})
        return { op: 'run_test', ok: false, error: String(e), durationMs: Date.now() - t0 }
      }
    }

    async function resolvePageForRunTest(): Promise<Page> {
      if (attachOnly) {
        if (!targetUrl) {
          throw new Error('挂接模式下 run_test 需要 targetUrl 以匹配已有页签')
        }
        const held = getPlaywrightSessionPage(sid)
        if (held) return held
        return attachHeldSessionForTargetUrl(sid, targetUrl, {
          navigationTimeoutMs: rt.timeoutMs ?? 90_000,
          exactPath: rt.navigateExact ?? false,
        })
      }
      if (!rawSid) {
        const p = await createHeldSessionBlankPage(sid, { pageUrl: targetUrl })
        return p
      }
      const held = getPlaywrightSessionPage(sid)
      if (held) return held
      if (rt.forceNavigate && targetUrl) {
        return ensureHeldSessionAtUrl(sid, targetUrl, {
          navigationTimeoutMs: rt.timeoutMs ?? 90_000,
          exactPath: rt.navigateExact ?? false,
        })
      }
      disposeTemporarySession = true
      return createHeldSessionBlankPage(sid, { pageUrl: targetUrl })
    }

    try {
      page = await resolvePageForRunTest()
    } catch (e) {
      return { op: 'run_test', ok: false, error: String(e), durationMs: Date.now() - t0 }
    }
    const early = await gotoTargetOrFail()
    if (early) return early

    try {
      const testResult = await playwrightRunner.execute({
        code: rt.code,
        targetUrl: rt.targetUrl,
        timeout: rt.timeoutMs ?? 90_000,
        existingPage: page,
        env: buildRunTestInjectedEnv(),
      })
      return {
        op: 'run_test',
        ok: true,
        passed: testResult.passed,
        failed: testResult.failed,
        skipped: testResult.skipped,
        logs: testResult.logs,
        durationMs: Date.now() - t0,
      }
    } catch (e) {
      return { op: 'run_test', ok: false, error: String(e), durationMs: Date.now() - t0 }
    } finally {
      if (disposeTemporarySession) await disposePlaywrightSession(sid).catch(() => {})
    }
  })
}
