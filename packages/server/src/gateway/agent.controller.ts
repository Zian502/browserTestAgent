import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard'
import type { Response } from 'express'
import { buildGraph } from '../agents/graph'
import { BrowserTestState } from '../agents/state'
import { isAcceptablePageUrl } from '../lib/page-url'
import { disposePlaywrightSession } from '../lib/playwright-browser-session'
import type { State, StreamEvent } from '../agents/state'
import { DEFAULT_CHAT_SESSION_ID, chatSessionIdForUser } from '../chat/constants'
import { formatSseDataForAssistantContent } from '../chat/sse-display-text'
import { ChatPersistenceService } from '../chat/chat-persistence.service'
import { executeCoreTool, PLAYWRIGHT_TOOL } from '../tools'
import { executeReadTool } from '../tools/read'

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
@UseGuards(AuthGuard)
export class AgentController {
  private graph = buildGraph()

  constructor(private readonly chatPersistence: ChatPersistenceService) {}

  private resolveChatContext(req: AuthenticatedRequest): { userId?: string; sessionId: string } {
    const userId = req.user?.id?.trim() || undefined
    return { userId, sessionId: chatSessionIdForUser(userId) }
  }

  /**
   * 读取 `.agent-cache` 下已生成的报告 HTML（供扩展新标签页展示）。
   * 仅允许 `reports/*.html`，防止路径穿越。
   */
  @Get('agent/report-html')
  async getReportHtml(@Query('path') rawPath: string, @Res() res: Response) {
    const relativePath = String(rawPath ?? '').trim().replace(/^[/\\]+/, '')
    if (!relativePath.startsWith('reports/')) {
      throw new BadRequestException('path 必须以 reports/ 开头')
    }
    if (!relativePath.endsWith('.html')) {
      throw new BadRequestException('仅支持 .html 文件')
    }
    const { content } = await executeReadTool({ relativePath })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(content)
  }

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

  /** 会话列表（MongoDB `chat_sessions`），仅返回当前登录用户的会话。 */
  @Get('agent/chat/sessions')
  async listChatSessions(@Req() req: AuthenticatedRequest) {
    const { userId } = this.resolveChatContext(req)
    const sessions = await this.chatPersistence.listSessions(userId)
    return { sessions }
  }

  /**
   * 历史对话消息列表（MongoDB `chat_messages`）。
   * 已登录时按 JWT 用户 id 解析 sessionId；`limit` 默认 300、最大 500。
   */
  @Get('agent/chat/messages')
  async listChatMessagesQuery(
    @Req() req: AuthenticatedRequest,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const ctx = this.resolveChatContext(req)
    const sid = ctx.userId
      ? ctx.sessionId
      : String(sessionId ?? '').trim() || DEFAULT_CHAT_SESSION_ID
    const lim = parseInt(String(limitRaw ?? '300'), 10)
    const limit = Number.isFinite(lim) ? Math.min(500, Math.max(1, lim)) : 300
    const messages = await this.chatPersistence.listMessages(sid, limit, ctx.userId)
    return { sessionId: sid, messages }
  }

  /** 某会话下的历史消息（MongoDB `chat_messages`），路径参数版。 */
  @Get('agent/chat/sessions/:sessionId/messages')
  async listChatMessages(@Req() req: AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    const ctx = this.resolveChatContext(req)
    const sid = String(sessionId ?? '').trim()
    if (!sid) throw new BadRequestException('缺少 sessionId')
    if (ctx.userId && sid !== ctx.sessionId) {
      throw new ForbiddenException('无权访问该会话')
    }
    const messages = await this.chatPersistence.listMessages(sid, 300, ctx.userId)
    return { sessionId: sid, messages }
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
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    ;(res as Response & { flushHeaders?: () => void }).flushHeaders?.()

    const threadId = `thread_${Date.now()}`
    const { userId, sessionId: chatSessionId } = this.resolveChatContext(req)

    let assistantTextBuf = ''
    const send = (obj: Record<string, unknown>) => {
      assistantTextBuf += formatSseDataForAssistantContent(obj)
      void this.chatPersistence
        .appendSseEvent({
          sessionId: chatSessionId,
          threadId,
          userId,
          data: obj,
        })
        .catch(() => {})
      res.write(`data: ${JSON.stringify(obj)}\n\n`)
    }

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
        userId,
        pageUrl,
        runnerSessionId: '',
        usePlaywrightBrowser: usePw,
        playwrightHeadless: body.headless ?? false,
        playwrightSlowMoMs: body.slowMoMs ?? 0,
      } as typeof BrowserTestState.Update

      await this.chatPersistence.recordUserTurn({
        sessionId: chatSessionId,
        threadId,
        userInput: body.userInput ?? '',
        pageUrl,
        userId,
      })

      const stream = await this.graph.stream(input, {
        configurable: { thread_id: threadId, userId: userId ?? '' },
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
      await this.chatPersistence
        .recordAssistantTurn({
          sessionId: chatSessionId,
          threadId,
          content: assistantTextBuf,
          userId,
        })
        .catch(() => {})
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
}
