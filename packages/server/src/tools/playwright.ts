import { randomUUID } from 'node:crypto'
import {
  openPageAndCaptureHtmlViaCDP,
  getPlaywrightSessionPage,
  refreshSessionPageHtmlViaCDP,
  type PlaywrightSessionLaunchOptions,
} from '../lib/playwright-browser-session'
import { playwrightRunner } from '../lib/playwright-runner'

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
  launch?: Pick<PlaywrightSessionLaunchOptions, 'headless' | 'slowMoMs' | 'navigationTimeoutMs' | 'waitUntil'>
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
    }
  | { op: 'refresh_outer_html'; sessionId: string }
  | {
      op: 'run_test'
      sessionId: string
      code: string
      targetUrl: string
      timeoutMs?: number
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
        launch: { headless: input.headless, slowMoMs: input.slowMoMs },
      })
      const durationMs = Date.now() - t0
      if (r.ok) {
        return { op: 'capture', ok: true, pageHtml: r.pageHtml, sessionId: r.sessionId, durationMs }
      }
      return { op: 'capture', ok: false, sessionId: r.sessionId, durationMs, error: r.error }
    }
    if (input.op === 'refresh_outer_html') {
      try {
        const html = await refreshSessionPageHtmlViaCDP(input.sessionId.trim())
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
    try {
      const page = getPlaywrightSessionPage(input.sessionId.trim())
      const testResult = await playwrightRunner.execute({
        code: input.code,
        targetUrl: input.targetUrl,
        timeout: input.timeoutMs ?? 90_000,
        existingPage: page,
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
    }
  })
}
