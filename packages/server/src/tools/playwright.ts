import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import {
  createHeldSessionBlankPage,
  disposePlaywrightSession,
  openPageAndCaptureHtmlViaCDP,
  getPlaywrightSessionPage,
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
      /** 空串或未传：启动临时浏览器页并可选先导航 `targetUrl` */
      sessionId?: string
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
    if (input.op !== 'run_test') {
      throw new Error(`未知 Playwright 子操作：${(input as { op?: string }).op}`)
    }
    const rt = input as Extract<PlaywrightCoreInput, { op: 'run_test' }>

    const rawSid = (rt.sessionId ?? '').trim()
    const sid = rawSid || randomUUID()
    /** 本次会话为临时新建（省略 sessionId，或传入的 id 在服务端已不存在），须在 finally 里 dispose */
    let disposeTemporarySession = !rawSid
    let page: Page

    async function gotoTargetOrFail(): Promise<PlaywrightCoreResult | null> {
      const url = rt.targetUrl.trim()
      if (!url) return null
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: rt.timeoutMs ?? 90_000,
        })
        return null
      } catch (e) {
        await disposePlaywrightSession(sid).catch(() => {})
        return { op: 'run_test', ok: false, error: String(e), durationMs: Date.now() - t0 }
      }
    }

    if (!rawSid) {
      page = await createHeldSessionBlankPage(sid, {})
      const early = await gotoTargetOrFail()
      if (early) return early
    } else {
      const held = getPlaywrightSessionPage(sid)
      if (held) {
        page = held
      } else {
        disposeTemporarySession = true
        page = await createHeldSessionBlankPage(sid, {})
        const early = await gotoTargetOrFail()
        if (early) return early
      }
    }

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
