import type { State, StreamEvent } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { extractJsonObject, extractMessageText } from './llm-text'
import { findTaskId, updateStatus } from './graph-helpers'
import { buildSeoUserMessage } from './prompts/seo-agent.prompt'
import { agentObservation } from './agent-observation'
import { fileCacheService } from '../lib/file-cache'
import { runToolWithStreamEvents } from './tool-stream'

const SEO_LLM_ANALYSIS_TOOL = 'seo_llm_analysis' as const

export async function seoAgentNode(state: State) {
  const dsl = state.pageDSL
  if (!dsl) throw new Error('pageDSL 未就绪')

  let seoData: Record<string, unknown> = {
    score: 0,
    issues: [],
    summary: { title: { value: dsl.title, length: dsl.title.length, status: 'info' } },
  }

  const toolStream: StreamEvent[] = []
  const pageHtmlSnippet = ((await fileCacheService.readHtmlSnapshotByPageUrl(state.pageUrl)) ?? '').slice(0, 3000)
  if (hasChatLlm()) {
    const { streamEvents: ev, result } = await runToolWithStreamEvents(
      'seoAgent',
      SEO_LLM_ANALYSIS_TOOL,
      { pageUrl: state.pageUrl },
      async () => {
        const model = createChatLlm({ temperature: 0 })
        const response = await model.invoke(
          buildSeoUserMessage(state.pageUrl, dsl, pageHtmlSnippet),
        )
        try {
          return extractJsonObject<Record<string, unknown>>(extractMessageText(response.content))
        } catch {
          return seoData
        }
      },
      (r) => ({ score: (r as { score?: number }).score ?? 0 }),
    )
    toolStream.push(...ev)
    seoData = result
  }

  const taskId = findTaskId(state.taskPlan, 'seoAgent')
  const score = (seoData as { score?: number }).score ?? 0
  const issues = Array.isArray((seoData as { issues?: unknown }).issues)
    ? (seoData as { issues: unknown[] }).issues.length
    : 0

  return {
    agentOutputs: { seoAgent: { status: 'done', data: seoData } },
    taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
    streamEvents: [
      ...toolStream,
      agentObservation('seoAgent', 'done', {
        taskId,
        summary: `SEO 评分 ${score}，问题条目约 ${issues} 条`,
        data: seoData,
      }),
      {
        type: 'agent_done' as const,
        agentName: 'seoAgent' as const,
        taskId,
        payload: { score },
        timestamp: Date.now(),
      },
    ],
  }
}
