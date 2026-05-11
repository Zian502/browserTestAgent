import type { PageDSL, State, StreamEvent, TaskPlan } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { fileCacheService } from '../lib/file-cache'
import { extractJsonObject, extractMessageText } from './llm-text'
import { findTaskId, updateStatus } from './graph-helpers'
import { buildParseHtmlUserMessage } from './prompts/parse-html-agent.prompt'
import { agentObservation } from './agent-observation'
import { runSkill } from '../skills'

function minimalDsl(url: string, html: string): PageDSL {
  const safeHtml = html ?? ''
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(safeHtml)
  return {
    url,
    title: titleMatch?.[1]?.trim() || 'Untitled',
    elements: [],
    forms: [],
    landmarks: {},
  }
}

/** LLM / 缓存 JSON 可能缺字段，避免 `.length` / 迭代报错 */
function normalizePageDsl(raw: PageDSL, pageUrl: string, fallbackHtml: string): PageDSL {
  const base = minimalDsl(pageUrl, fallbackHtml)
  return {
    url: typeof raw.url === 'string' && raw.url.trim() ? raw.url : base.url,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : base.title,
    elements: Array.isArray(raw.elements) ? raw.elements : [],
    forms: Array.isArray(raw.forms) ? raw.forms : [],
    landmarks: raw.landmarks && typeof raw.landmarks === 'object' && !Array.isArray(raw.landmarks) ? raw.landmarks : {},
  }
}

export async function parseHtmlAgentNode(state: State) {
  const taskId = findTaskId(state.taskPlan, 'parseHtmlAgent')
  const task = taskId ? state.taskPlan.find((t: TaskPlan) => t.id === taskId) : undefined
  const cacheKey = task?.cacheKey

  if (cacheKey) {
    const cached = await fileCacheService.get<PageDSL>(cacheKey)
    if (cached) {
      const safe = normalizePageDsl(cached, state.pageUrl, state.pageHtml ?? '')
      return {
        pageDSL: safe,
        agentOutputs: { parseHtmlAgent: { status: 'cached', data: safe, fromCache: true } },
        taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
        streamEvents: [
          agentObservation('parseHtmlAgent', 'skipped', {
            taskId,
            summary: 'PageDSL 来自文件缓存',
            data: {
              title: safe.title,
              elementsCount: safe.elements.length,
              formsCount: safe.forms.length,
              fromCache: true,
            },
          }),
          {
            type: 'agent_done' as const,
            agentName: 'parseHtmlAgent' as const,
            payload: { cached: true, elementsCount: safe.elements.length },
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

  let pageHtml = String(state.pageHtml ?? '')
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
  const sourceForLlm = (compressedHtml.trim() ? compressedHtml : pageHtml) ?? ''

  let dsl: PageDSL = minimalDsl(state.pageUrl, pageHtml)
  if (sourceForLlm.trim() && hasChatLlm()) {
    const model = createChatLlm({ temperature: 0 })
    const response = await model.invoke(buildParseHtmlUserMessage(sourceForLlm, state.pageUrl))
    try {
      const parsed = extractJsonObject<PageDSL>(extractMessageText(response.content))
      dsl = normalizePageDsl(parsed, state.pageUrl, pageHtml)
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
