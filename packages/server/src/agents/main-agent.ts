import { Command } from '@langchain/langgraph'
import type { State, StreamEvent } from './state'
import { MISSING_PAGE_CONTEXT_MESSAGE } from './prompts/main-agent.prompt'
import { runSkill } from '../skills'

function isBlank(s: string | undefined): boolean {
  return !s?.trim()
}

export async function mainAgentNode(state: State) {
  if (isBlank(state.pageUrl)) {
    return new Command({
      update: {
        streamEvents: [
          {
            type: 'text' as const,
            payload: { content: MISSING_PAGE_CONTEXT_MESSAGE },
            timestamp: Date.now(),
          },
        ],
      },
      goto: 'finalSummary',
    })
  }

  if (!state.usePlaywrightBrowser) {
    return new Command({
      update: {
        streamEvents: [
          {
            type: 'text' as const,
            payload: {
              content:
                '请在请求体中设置 **usePlaywright: true**，由 mainAgent 经 **get-html** skill 调用 Playwright 工具打开浏览器并通过 CDP 获取页面 HTML（扩展默认会传该字段）。',
            },
            timestamp: Date.now(),
          },
        ],
      },
      goto: 'finalSummary',
    })
  }

  if (state.runnerSessionId.trim() && state.pageHtml.trim()) {
    return new Command({
      update: {
        streamEvents: [
          {
            type: 'agent_start',
            agentName: 'planAgent',
            timestamp: Date.now(),
          },
        ],
      },
      goto: 'planAgent',
    })
  }

  const streamEvents: StreamEvent[] = []
  const emit = (e: StreamEvent) => {
    streamEvents.push(e)
  }
  const skillCtx = { state, agentName: 'mainAgent' as const, emit }

  const cap = await runSkill(
    'get-html',
    skillCtx,
    {
      phase: 'capture',
      pageUrl: state.pageUrl.trim(),
      headless: state.playwrightHeadless ?? false,
      slowMoMs: state.playwrightSlowMoMs ?? 0,
    },
  )

  if (cap['ok'] === true && typeof cap['pageHtml'] === 'string' && typeof cap['sessionId'] === 'string') {
    await runSkill('cache-file', skillCtx, {
      kind: 'html_snapshot',
      pageUrl: state.pageUrl.trim(),
      html: cap['pageHtml'] as string,
    })
    return new Command({
      update: {
        streamEvents,
        pageHtml: cap['pageHtml'] as string,
        runnerSessionId: cap['sessionId'] as string,
        usePlaywrightBrowser: true,
      },
      goto: 'mainAgent',
    })
  }

  return new Command({
    update: {
      streamEvents: [
        ...streamEvents,
        {
          type: 'text' as const,
          payload: {
            content:
              `无法通过 **Playwright + CDP** 获取页面 HTML：\n\n${String(cap['error'] ?? 'unknown')}\n\n请检查本机 Chrome/Chromium、可执行 \`pnpm --filter @browser-test-agent/server playwright:install\`，并确认页面可达。`,
          },
          timestamp: Date.now(),
        },
      ],
    },
    goto: 'finalSummary',
  })
}
