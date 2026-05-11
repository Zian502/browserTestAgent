import type { PageDSL, State, StreamEvent, TaskPlan } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { fileCacheService } from '../lib/file-cache'
import { extractJsonObject, extractMessageText } from './llm-text'
import { findTaskId, updateStatus } from './graph-helpers'
import { buildParseHtmlUserMessage } from './prompts/parse-html-agent.prompt'
import { agentObservation } from './agent-observation'
import { runSkill } from '../skills'

function minimalDsl(url: string, html: string): PageDSL {
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  return {
    url,
    title: titleMatch?.[1]?.trim() || 'Untitled',
    elements: [],
    forms: [],
    landmarks: {},
  }
}

export async function parseHtmlAgentNode(state: State) {
  const taskId = findTaskId(state.taskPlan, 'parseHtmlAgent')
  const task = taskId ? state.taskPlan.find((t: TaskPlan) => t.id === taskId) : undefined
  const cacheKey = task?.cacheKey

  if (cacheKey) {
    const cached = await fileCacheService.get<PageDSL>(cacheKey)
    if (cached) {
      return {
        pageDSL: cached,
        agentOutputs: { parseHtmlAgent: { status: 'cached', data: cached, fromCache: true } },
        taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
        streamEvents: [
          {
            type: 'tool_result' as const,
            agentName: 'parseHtmlAgent' as const,
            payload: { cached: true },
            timestamp: Date.now(),
          },
          agentObservation('parseHtmlAgent', 'skipped', {
            taskId,
            summary: 'PageDSL 来自文件缓存',
            data: {
              title: cached.title,
              elementsCount: cached.elements.length,
              formsCount: cached.forms.length,
              fromCache: true,
            },
          }),
          {
            type: 'agent_done' as const,
            agentName: 'parseHtmlAgent' as const,
            payload: { cached: true, elementsCount: cached.elements.length },
            timestamp: Date.now(),
          },
        ],
      }
    }
  }

  const streamEvents: StreamEvent[] = []
  const emit = (e: StreamEvent) => {
    streamEvents.push(e)
  }
  const skillCtx = { state, agentName: 'parseHtmlAgent' as const, taskId, emit }

  let pageHtml = state.pageHtml
  if (state.runnerSessionId?.trim() && state.usePlaywrightBrowser) {
    const refreshed = await runSkill('get-html', skillCtx, {
      phase: 'cdp_refresh',
      sessionId: state.runnerSessionId.trim(),
      pageUrl: state.pageUrl,
    })
    if (refreshed['ok'] === true && typeof refreshed['pageHtml'] === 'string' && refreshed['pageHtml'].trim()) {
      pageHtml = refreshed['pageHtml'] as string
    }
  }

  await runSkill('cache-file', skillCtx, {
    kind: 'html_snapshot',
    pageUrl: state.pageUrl,
    html: pageHtml,
  })

  const compressed = await runSkill('compress-html', skillCtx, { html: pageHtml })
  const compressedHtml = String(compressed['compressedHtml'] ?? '')
  const sourceForLlm = compressedHtml.trim() ? compressedHtml : pageHtml

  let dsl: PageDSL = minimalDsl(state.pageUrl, pageHtml)
  if (sourceForLlm.trim() && hasChatLlm()) {
    const model = createChatLlm({ temperature: 0 })
    const response = await model.invoke(buildParseHtmlUserMessage(sourceForLlm, state.pageUrl))
    try {
      dsl = extractJsonObject<PageDSL>(extractMessageText(response.content))
    } catch {
      dsl = minimalDsl(state.pageUrl, pageHtml)
    }
  }

  if (cacheKey) {
    await runSkill('cache-file', skillCtx, {
      kind: 'kv_cache',
      cacheKey,
      data: dsl,
      ttl: 3600,
    })
    await runSkill('cache-file', skillCtx, {
      kind: 'dsl_snapshot',
      cacheKey,
      pageUrl: state.pageUrl,
      dsl,
    })
  }

  return {
    pageHtml,
    pageDSL: dsl,
    agentOutputs: { parseHtmlAgent: { status: 'done', data: dsl } },
    taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
    streamEvents: [
      ...streamEvents,
      agentObservation('parseHtmlAgent', 'done', {
        taskId,
        summary: `解析完成：${dsl.title}`,
        data: {
          title: dsl.title,
          elementsCount: dsl.elements.length,
          formsCount: dsl.forms.length,
          compressedHtmlLength: sourceForLlm.length,
        },
      }),
      {
        type: 'agent_done' as const,
        agentName: 'parseHtmlAgent' as const,
        payload: { elementsCount: dsl.elements.length },
        timestamp: Date.now(),
      },
    ],
  }
}
