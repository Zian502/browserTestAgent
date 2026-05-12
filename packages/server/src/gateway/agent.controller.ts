import { BadRequestException, Body, Controller, Post, Res } from '@nestjs/common'
import type { Response } from 'express'
import { buildGraph } from '../agents/graph'
import { BrowserTestState } from '../agents/state'
import { isAcceptablePageUrl } from '../lib/page-url'
import { disposePlaywrightSession } from '../lib/playwright-browser-session'
import type { State, StreamEvent } from '../agents/state'
import { executeCoreTool, PLAYWRIGHT_TOOL } from '../tools'

/**
 * LangGraph `streamMode: 'updates'` 时，单步 chunk 形如 `{ mainAgent: { streamEvents, ... }, planAgent: {...} }`，
 * `streamEvents` 在各节点键下；兼容顶层即 Update 的旧形状。
 */
function extractStreamEventsFromGraphStreamChunk(chunk: unknown): StreamEvent[] {
  if (!chunk || typeof chunk !== 'object') return []
  const o = chunk as Record<string, unknown>

  const top = o.streamEvents
  if (Array.isArray(top)) return top as StreamEvent[]

  const out: StreamEvent[] = []
  for (const v of Object.values(o)) {
    if (!v || typeof v !== 'object') continue
    const inner = (v as Record<string, unknown>).streamEvents
    if (Array.isArray(inner)) out.push(...(inner as StreamEvent[]))
  }
  return out
}

@Controller('api')
export class AgentController {
  private graph = buildGraph()

  /**
   * 扩展侧「重新执行」run-test-code：调用 `playwright` 的 `run_test`。
   * 有 `sessionId` 时复用 CDP 会话页；省略或空串时由服务端起临时浏览器（可选先打开 `targetUrl`）。
   */
  @Post('agent/run-test-code')
  async runTestCode(
    @Body()
    body: {
      sessionId?: string
      code?: string
      targetUrl?: string
      timeoutMs?: number
    },
  ) {
    const sessionId = String(body.sessionId ?? '').trim()
    const code = String(body.code ?? '')
    const targetUrl = String(body.targetUrl ?? '')
    if (!code.trim()) throw new BadRequestException('缺少 code')
    const out = await executeCoreTool(PLAYWRIGHT_TOOL, {
      op: 'run_test',
      sessionId,
      code,
      targetUrl,
      timeoutMs: body.timeoutMs != null && Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : 90_000,
    })
    return out
  }

  @Post('agent/run')
  async run(
    @Body()
    body: {
      userInput: string
      pageUrl: string
      /** 为 true 时用 Playwright 打开 Chrome/Chromium，经 CDP 取 HTML，并与后续测试共用同页签 */
      usePlaywright?: boolean
      headless?: boolean
      slowMoMs?: number
    },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    ;(res as Response & { flushHeaders?: () => void }).flushHeaders?.()

    const send = (obj: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`)
    }

    const threadId = `thread_${Date.now()}`
    try {
      const pageUrl = (body.pageUrl ?? '').trim()
      const usePw = Boolean(body.usePlaywright)

      if (pageUrl) {
        if (!isAcceptablePageUrl(pageUrl)) {
          send({
            event: 'text',
            payload: { content: '无效的 **pageUrl**：需要完整的 `http://` 或 `https://` 地址。' },
            timestamp: Date.now(),
          })
          send({
            event: 'complete',
            payload: { agentOutputs: {}, reports: {} },
            timestamp: Date.now(),
          })
          return
        }
        if (!usePw) {
          send({
            event: 'text',
            payload: {
              content:
                '请在请求体中设置 **`usePlaywright: true`**，由 **mainAgent** 调用 Playwright 工具经 CDP 获取页面 HTML（扩展默认会传该字段）。',
            },
            timestamp: Date.now(),
          })
          send({
            event: 'complete',
            payload: { agentOutputs: {}, reports: {} },
            timestamp: Date.now(),
          })
          return
        }
      }

      const input = {
        userInput: body.userInput,
        pageUrl,
        runnerSessionId: '',
        usePlaywrightBrowser: usePw,
        playwrightHeadless: body.headless ?? false,
        playwrightSlowMoMs: body.slowMoMs ?? 0,
      } as typeof BrowserTestState.Update

      const stream = await this.graph.stream(input, {
        configurable: { thread_id: threadId },
        streamMode: 'updates',
      })
      for await (const ev of stream) {
        const events = extractStreamEventsFromGraphStreamChunk(ev)
        for (const e of events) {
          send({ event: e.type, ...e })
        }
      }
    } catch (err) {
      send({ event: 'error', message: String(err) })
    } finally {
      try {
        const snap = await this.graph.getState({ configurable: { thread_id: threadId } })
        const rid = (snap?.values as State | undefined)?.runnerSessionId?.trim()
        if (rid) await disposePlaywrightSession(rid).catch(() => {})
      } catch {
        /* 图未产生 checkpoint 等 */
      }
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
}
