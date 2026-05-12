import type { PageDSL, State, StreamEvent, TaskPlan } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { extractJsonObject, extractMessageText } from './llm-text'
import { findTaskId, updateStatus } from './graph-helpers'
import {
  PARSE_HTML_DSL_SYSTEM_PROMPT,
  PARSE_HTML_DSL_MULTI_FIRST_APPEND,
  PARSE_HTML_DSL_CONTINUATION_SYSTEM_PROMPT,
  buildParseHtmlUserMessage,
  buildParseHtmlMultiFirstUserMessage,
  buildParseHtmlContinuationUserMessage,
  wrapCompressedHtmlWithChunkMarkers,
} from './prompts/parse-html-agent.prompt'
import { agentObservation } from './agent-observation'
import { fileCacheService } from '../lib/file-cache'
import { runSkill } from '../skills'
import type { SkillRunContext } from '../skills/skill-types'

/** 单段压缩 HTML 最大字符数（为 system + 输出预留上下文，默认适配 DeepSeek 类 64k 窗口） */
const DEFAULT_MAX_CHUNK_CHARS = 28_000

function maxChunkCharsForLlm(): number {
  const raw = process.env.PARSE_HTML_LLM_MAX_CHUNK_CHARS?.trim()
  if (!raw) return DEFAULT_MAX_CHUNK_CHARS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 4_000) return DEFAULT_MAX_CHUNK_CHARS
  return Math.min(n, 200_000)
}

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

/** 外部 JSON 可能缺字段，避免 `.length` / 迭代报错 */
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

interface HtmlChunk {
  index: number
  total: number
  charStart: number
  charEnd: number
  body: string
}

/** 将 end 尽量对齐到最近的 `>`，减少截断在标签中间 */
function adjustChunkEnd(html: string, start: number, desiredEnd: number): number {
  if (desiredEnd >= html.length) return html.length
  const relEnd = desiredEnd - start
  const window = html.slice(start, desiredEnd)
  const lastGt = window.lastIndexOf('>')
  if (lastGt < Math.min(80, relEnd - 1)) return desiredEnd
  return start + lastGt + 1
}

/** 按最大字符数切分压缩 HTML，并带起止下标 */
function splitCompressedHtmlIntoChunks(html: string, maxChunkChars: number): HtmlChunk[] {
  const totalLen = html.length
  if (totalLen === 0) return []
  if (totalLen <= maxChunkChars) {
    return [{ index: 1, total: 1, charStart: 0, charEnd: totalLen, body: html }]
  }

  const chunks: HtmlChunk[] = []
  let start = 0
  let idx = 0
  while (start < totalLen) {
    idx += 1
    let end = Math.min(totalLen, start + maxChunkChars)
    end = adjustChunkEnd(html, start, end)
    if (end <= start) end = Math.min(totalLen, start + maxChunkChars)
    chunks.push({ index: idx, total: -1, charStart: start, charEnd: end, body: html.slice(start, end) })
    start = end
  }
  const total = chunks.length
  for (const c of chunks) c.total = total
  return chunks
}

interface PageDslDelta {
  elements: PageDSL['elements']
  forms: PageDSL['forms']
  landmarks: PageDSL['landmarks']
}

function normalizeChunkDelta(raw: Record<string, unknown>): PageDslDelta {
  return {
    elements: Array.isArray(raw.elements) ? (raw.elements as PageDSL['elements']) : [],
    forms: Array.isArray(raw.forms) ? (raw.forms as PageDSL['forms']) : [],
    landmarks:
      raw.landmarks && typeof raw.landmarks === 'object' && !Array.isArray(raw.landmarks)
        ? (raw.landmarks as PageDSL['landmarks'])
        : {},
  }
}

/** 从模型返回中只取增量字段（若误返回完整 PageDSL 也可解析） */
function parseContinuationDelta(text: string): PageDslDelta {
  const parsed = extractJsonObject<Record<string, unknown>>(text)
  return normalizeChunkDelta(parsed)
}

function mergePageDslFragments(base: PageDSL, delta: PageDslDelta): PageDSL {
  const seenE = new Set(base.elements.map((e) => e.id))
  const elements = [...base.elements]
  for (const e of delta.elements) {
    if (e && typeof e.id === 'string' && e.id.trim() && !seenE.has(e.id)) {
      seenE.add(e.id)
      elements.push(e)
    }
  }
  const seenF = new Set(base.forms.map((f) => f.id))
  const forms = [...base.forms]
  for (const f of delta.forms) {
    if (f && typeof f.id === 'string' && f.id.trim() && !seenF.has(f.id)) {
      seenF.add(f.id)
      forms.push(f)
    }
  }
  const landmarks = { ...base.landmarks, ...delta.landmarks }
  return { ...base, elements, forms, landmarks }
}

function summarizeExistingIdsForPrompt(dsl: PageDSL): string {
  const maxE = 220
  const maxF = 80
  const eids = dsl.elements.map((e) => e.id).slice(0, maxE)
  const fids = dsl.forms.map((f) => f.id).slice(0, maxF)
  const payload = {
    elementIds: eids,
    elementIdTotal: dsl.elements.length,
    formIds: fids,
    formIdTotal: dsl.forms.length,
    truncated:
      dsl.elements.length > maxE || dsl.forms.length > maxF
        ? '仅列出前若干 id，其余亦视为已占用，新 id 不得与任意已有 id 重复。'
        : undefined,
  }
  return JSON.stringify(payload, null, 2)
}

async function resolvePageHtml(state: State, skillCtx: SkillRunContext): Promise<string> {
  let pageHtml = (await fileCacheService.readHtmlSnapshotByPageUrl(state.pageUrl)) ?? ''
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
  return pageHtml
}

async function persistHtmlSnapshot(
  pageUrl: string,
  pageHtml: string,
  skillCtx: SkillRunContext,
): Promise<void> {
  await runSkill('cache-file', skillCtx, {
    kind: 'html_snapshot',
    pageUrl,
    html: pageHtml,
  })
}

function compressedSourceForLlm(compressedSkillOut: Record<string, unknown>, pageHtml: string): string {
  const compressedHtml = String(compressedSkillOut['compressedHtml'] ?? '')
  return (compressedHtml.trim() ? compressedHtml : pageHtml) ?? ''
}

async function dslFromLlmSingle(sourceForLlm: string, pageUrl: string, pageHtmlForFallback: string): Promise<PageDSL | null> {
  if (!sourceForLlm.trim() || !hasChatLlm()) return null
  const model = createChatLlm({ temperature: 0 })
  const response = await model.invoke([
    { role: 'system', content: PARSE_HTML_DSL_SYSTEM_PROMPT },
    { role: 'user', content: buildParseHtmlUserMessage(sourceForLlm, pageUrl) },
  ])
  try {
    const parsed = extractJsonObject<PageDSL>(extractMessageText(response.content))
    return normalizePageDsl(parsed, pageUrl, pageHtmlForFallback)
  } catch {
    return null
  }
}

async function dslFromLlmChunked(
  sourceForLlm: string,
  pageUrl: string,
  pageHtmlForFallback: string,
  maxChunkChars: number,
): Promise<{ dsl: PageDSL | null; chunkCount: number }> {
  if (!sourceForLlm.trim() || !hasChatLlm()) return { dsl: null, chunkCount: 0 }
  const chunks = splitCompressedHtmlIntoChunks(sourceForLlm, maxChunkChars)
  const chunkCount = chunks.length
  if (chunkCount === 0) return { dsl: null, chunkCount: 0 }
  const model = createChatLlm({ temperature: 0 })
  const totalChars = sourceForLlm.length

  const firstWrapped = wrapCompressedHtmlWithChunkMarkers(
    chunks[0].body,
    1,
    chunkCount,
    totalChars,
    chunks[0].charStart,
    chunks[0].charEnd,
  )
  const firstSystem = `${PARSE_HTML_DSL_SYSTEM_PROMPT}${PARSE_HTML_DSL_MULTI_FIRST_APPEND}`
  let acc: PageDSL
  try {
    const r0 = await model.invoke([
      { role: 'system', content: firstSystem },
      { role: 'user', content: buildParseHtmlMultiFirstUserMessage(pageUrl, firstWrapped) },
    ])
    const parsed0 = extractJsonObject<PageDSL>(extractMessageText(r0.content))
    acc = normalizePageDsl(parsed0, pageUrl, pageHtmlForFallback)
  } catch {
    return { dsl: null, chunkCount }
  }

  for (let i = 1; i < chunks.length; i++) {
    const ch = chunks[i]
    const wrapped = wrapCompressedHtmlWithChunkMarkers(
      ch.body,
      ch.index,
      chunkCount,
      totalChars,
      ch.charStart,
      ch.charEnd,
    )
    const existingJson = summarizeExistingIdsForPrompt(acc)
    const userMsg = buildParseHtmlContinuationUserMessage(
      pageUrl,
      ch.index,
      chunkCount,
      wrapped,
      existingJson,
    )
    try {
      const ri = await model.invoke([
        { role: 'system', content: PARSE_HTML_DSL_CONTINUATION_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ])
      const delta = parseContinuationDelta(extractMessageText(ri.content))
      acc = mergePageDslFragments(acc, delta)
    } catch {
      /* 本段失败则跳过该段，保留已合并结果 */
    }
  }

  return { dsl: acc, chunkCount }
}

async function dslFromLlm(
  sourceForLlm: string,
  pageUrl: string,
  pageHtmlForFallback: string,
): Promise<{ dsl: PageDSL | null; llmChunks: number }> {
  if (!sourceForLlm.trim() || !hasChatLlm()) return { dsl: null, llmChunks: 0 }
  const maxChunk = maxChunkCharsForLlm()
  if (sourceForLlm.length <= maxChunk) {
    const dsl = await dslFromLlmSingle(sourceForLlm, pageUrl, pageHtmlForFallback)
    return { dsl, llmChunks: dsl ? 1 : 0 }
  }
  const { dsl, chunkCount } = await dslFromLlmChunked(sourceForLlm, pageUrl, pageHtmlForFallback, maxChunk)
  return { dsl, llmChunks: chunkCount }
}

export async function parseHtmlAgentNode(state: State) {
  const taskId = findTaskId(state.taskPlan, 'parseHtmlAgent')
  const task = taskId ? state.taskPlan.find((t: TaskPlan) => t.id === taskId) : undefined

  const streamEvents: StreamEvent[] = []
  const emit = (e: StreamEvent) => {
    streamEvents.push(e)
  }
  const skillCtx = { state, agentName: 'parseHtmlAgent' as const, taskId, emit }

  const pageHtml = await resolvePageHtml(state, skillCtx)
  await persistHtmlSnapshot(state.pageUrl, pageHtml, skillCtx)

  const compressed = await runSkill('compress-html', skillCtx, { html: pageHtml })
  const sourceForLlm = compressedSourceForLlm(compressed, pageHtml)
  const maxChunk = maxChunkCharsForLlm()
  const htmlLlmSegments =
    !sourceForLlm.trim() ? 0 : sourceForLlm.length <= maxChunk ? 1 : splitCompressedHtmlIntoChunks(sourceForLlm, maxChunk).length

  const { dsl: fromLlm, llmChunks } = await dslFromLlm(sourceForLlm, state.pageUrl, pageHtml)
  const dsl: PageDSL = fromLlm ?? minimalDsl(state.pageUrl, pageHtml)

  const chunked = htmlLlmSegments > 1

  return {
    pageDSL: dsl,
    agentOutputs: { parseHtmlAgent: { status: 'done', data: dsl } },
    taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
    streamEvents: [
      ...streamEvents,
      agentObservation('parseHtmlAgent', 'done', {
        taskId,
        summary:
          chunked && hasChatLlm()
            ? `解析完成：${dsl.title}（压缩 HTML 分 ${htmlLlmSegments} 段调用 LLM，共 ${llmChunks} 次请求）`
            : chunked && !hasChatLlm()
              ? `解析完成：${dsl.title}（压缩 HTML 超长，可分 ${htmlLlmSegments} 段；未配置 LLM 已用语义回退）`
              : `解析完成：${dsl.title}`,
        data: {
          title: dsl.title,
          elementsCount: dsl.elements.length,
          formsCount: dsl.forms.length,
          compressedHtmlLength: sourceForLlm.length,
          maxChunkChars: maxChunk,
          chunked,
          htmlLlmSegments,
          llmChunks,
          taskCacheKey: task?.cacheKey ?? null,
          llmParse: Boolean(fromLlm),
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
