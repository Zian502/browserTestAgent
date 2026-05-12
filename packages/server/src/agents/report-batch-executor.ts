import type { State, StreamEvent } from './state'
import { reportGenerator, type ReportLlmOutline, type ReportType } from '../lib/report-generator'
import { fileCacheService } from '../lib/file-cache'

const REPORT_TASKS = [
  { key: 'testCodeAgent' as const, type: 'test' as const },
  { key: 'seoAgent' as const, type: 'seo' as const },
  { key: 'pagespeedAgent' as const, type: 'pagespeed' as const },
] as const

async function generateOneReportFile(
  state: State,
  type: ReportType,
  key: (typeof REPORT_TASKS)[number]['key'],
  llmSpecs: Partial<Record<ReportType, ReportLlmOutline>>,
  writeText: (relativePath: string, content: string) => Promise<void>,
): Promise<
  | { ok: true; type: ReportType; reportPath: string }
  | { ok: false; type: ReportType; error: string }
> {
  try {
    const data = state.agentOutputs[key]?.data
    const html = await reportGenerator.generate(type, {
      data,
      url: state.pageUrl,
      userInput: state.userInput,
      generatedAt: new Date().toISOString(),
      llmOutline: llmSpecs[type],
    })
    const reportPath = `reports/${type}_${Date.now()}.html`
    await writeText(reportPath, html)
    return { ok: true, type, reportPath }
  } catch (e) {
    return { ok: false, type, error: String(e) }
  }
}

/** `report` skill 调用；`writeText` 默认走 file-cache，可换为经 `write` 工具落盘以产生 tool_start / tool_success 事件。 */
export async function executeReportBatchForTool(
  state: State,
  options?: {
    llmSpecs?: Partial<Record<ReportType, ReportLlmOutline>>
    writeText?: (relativePath: string, content: string) => Promise<void>
    /** 若设置，仅对已完成的对应子 agent 输出生成这些类型的报告 */
    onlyTypes?: ReportType[]
  },
): Promise<{
  reports: Record<string, string>
  streamEvents: StreamEvent[]
  /** 各类型生成结果，供 report_ready / 观测使用 */
  outcomes: Array<{ type: ReportType; ok: true; reportPath: string } | { type: ReportType; ok: false; error: string }>
}> {
  const llmSpecs = options?.llmSpecs ?? {}
  const reports: Record<string, string> = {}
  const writeText =
    options?.writeText ??
    (async (relativePath: string, content: string) => {
      await fileCacheService.writeFile(relativePath, content)
    })

  const eligible = REPORT_TASKS.filter((t) => {
    const ok = state.agentOutputs[t.key]?.status === 'done' || state.agentOutputs[t.key]?.status === 'cached'
    if (!ok) return false
    if (options?.onlyTypes?.length) return options.onlyTypes.includes(t.type)
    return true
  })

  const outcomes = await Promise.all(
    eligible.map(({ key, type }) => generateOneReportFile(state, type, key, llmSpecs, writeText)),
  )

  const streamEvents: StreamEvent[] = []
  for (const o of outcomes) {
    if (o.ok) {
      reports[o.type] = o.reportPath
      streamEvents.push({
        type: 'report_ready' as const,
        agentName: 'reportAgent' as const,
        payload: { reportType: o.type, reportPath: o.reportPath, ok: true as const },
        timestamp: Date.now(),
      })
    } else {
      streamEvents.push({
        type: 'report_ready' as const,
        agentName: 'reportAgent' as const,
        payload: { reportType: o.type, ok: false as const, error: o.error },
        timestamp: Date.now(),
      })
    }
  }

  return { reports, streamEvents, outcomes }
}
