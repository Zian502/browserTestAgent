import type { AgentOutput, State, StreamEvent } from './state'
import { findTaskId } from './graph-helpers'
import { createChatLlm, hasChatLlm } from './llm-client'
import { extractJsonObject, extractMessageText } from './llm-text'
import { runToolWithStreamEvents } from './tool-stream'
import { REPORT_LLM_SYSTEM_PROMPT, buildReportLlmUserContent } from './prompts/report-agent.prompt'
import type { ReportType, ReportLlmOutline } from '../lib/report-generator'
import { coerceReportLlmOutline } from '../lib/report-generator'
import { runSkill } from '../skills'

const REPORT_KEYS = [
  { key: 'testCodeAgent' as const, type: 'test' as const },
  { key: 'seoAgent' as const, type: 'seo' as const },
  { key: 'pagespeedAgent' as const, type: 'pagespeed' as const },
] as const

function dataJsonForLlm(data: unknown, maxChars = 24000): string {
  try {
    const s = JSON.stringify(data, null, 2)
    return s.length > maxChars ? `${s.slice(0, maxChars)}\n…（截断）` : s
  } catch {
    return String(data).slice(0, maxChars)
  }
}

function fallbackTitle(type: ReportType): string {
  if (type === 'test') return '自动化测试报告'
  if (type === 'seo') return 'SEO 分析报告'
  return '性能（PageSpeed）报告'
}

async function llmOutlineForType(
  type: ReportType,
  state: State,
  data: unknown,
): Promise<{ streamEvents: StreamEvent[]; outline: ReportLlmOutline }> {
  const fb = fallbackTitle(type)
  if (!hasChatLlm()) {
    return { streamEvents: [], outline: coerceReportLlmOutline(null, fb) }
  }
  const userContent = buildReportLlmUserContent(type, {
    pageUrl: state.pageUrl,
    userInput: state.userInput,
    dataJson: dataJsonForLlm(data),
  })
  const { streamEvents, result } = await runToolWithStreamEvents(
    'reportAgent',
    `report_llm_spec_${type}`,
    { reportType: type },
    async () => {
      try {
        const model = createChatLlm({ temperature: 0.2 })
        const response = await model.invoke([
          { role: 'system', content: REPORT_LLM_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ])
        return extractJsonObject<unknown>(extractMessageText(response.content))
      } catch {
        return null
      }
    },
    (r) => ({ hasParsedJson: r != null }),
  )
  return { streamEvents, outline: coerceReportLlmOutline(result, fb) }
}

/** 按已完成子任务类型调用 LLM 生成报告纲要 JSON，再经 `report` skill 落盘并推送事件。 */
export async function reportAgentNode(state: State) {
  const tasksToReport = REPORT_KEYS.filter(
    (t) => state.agentOutputs[t.key]?.status === 'done' || state.agentOutputs[t.key]?.status === 'cached',
  )

  const streamEvents: StreamEvent[] = []
  const llmSpecs: Partial<Record<ReportType, ReportLlmOutline>> = {}

  for (const { key, type } of tasksToReport) {
    const data = state.agentOutputs[key]?.data
    try {
      const { streamEvents: ev, outline } = await llmOutlineForType(type, state, data)
      streamEvents.push(...ev)
      llmSpecs[type] = outline
    } catch {
      streamEvents.push({
        type: 'text' as const,
        agentName: 'reportAgent' as const,
        payload: {
          content: `报告纲要（${type}）生成异常，已使用默认纲要继续落盘该类型 HTML。`,
        },
        timestamp: Date.now(),
      })
      llmSpecs[type] = coerceReportLlmOutline(null, fallbackTitle(type))
    }
  }

  const emit = (e: StreamEvent) => {
    streamEvents.push(e)
  }
  const taskId = findTaskId(state.taskPlan, 'reportAgent')
  const reportOut = await runSkill(
    'report',
    { state, agentName: 'reportAgent', taskId, emit },
    { llmSpecs, taskId },
  )

  const reports = (reportOut['reports'] as Record<string, string>) ?? {}
  const reportFailed = Boolean(reportOut['reportAgentFailed'])
  const taskPlan = (reportOut['taskPlan'] as State['taskPlan']) ?? state.taskPlan

  if (reportFailed) {
    streamEvents.push({
      type: 'agent_failed' as const,
      agentName: 'reportAgent' as const,
      taskId,
      payload: { message: String(reportOut['reportAgentError'] ?? '报告生成失败') },
      timestamp: Date.now(),
    })
  } else {
    streamEvents.push({
      type: 'agent_done' as const,
      agentName: 'reportAgent' as const,
      taskId,
      payload: {
        reports,
        generatedTypes: Object.keys(reports),
      },
      timestamp: Date.now(),
    })
  }

  return {
    streamEvents,
    reports,
    taskPlan,
    agentOutputs: { reportAgent: reportOut['agentOutput'] as AgentOutput },
  }
}
