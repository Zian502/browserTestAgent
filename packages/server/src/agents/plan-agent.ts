import type { PageDSL, State, TaskPlan, AgentOutput } from './state'
import type { ReportType } from '../lib/report-generator'
import { createChatLlm, hasChatLlm } from './llm-client'
import { fileCacheService } from '../lib/file-cache'
import { extractJsonObject, extractMessageText } from './llm-text'
import { PLAN_AGENT_SYSTEM_PROMPT, buildPlanAgentUserMessage } from './prompts/plan-agent.prompt'
import { agentObservation } from './agent-observation'

type PipelineKind = 'test' | 'seo' | 'perf'

const PIPELINE_ORDER: PipelineKind[] = ['test', 'seo', 'perf']

function isPipelineKind(x: unknown): x is PipelineKind {
  return x === 'test' || x === 'seo' || x === 'perf'
}

/** 归一化 LLM 输出：保序去重，仅保留 test | seo | perf */
function normalizePipelines(raw: unknown): PipelineKind[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<PipelineKind>()
  const out: PipelineKind[] = []
  for (const x of raw) {
    if (!isPipelineKind(x) || seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

/** LLM 未返回有效数组时：默认跑齐三条流水线（与历史「全量分析」行为接近） */
function defaultPipelines(): PipelineKind[] {
  return [...PIPELINE_ORDER]
}

/**
 * 将流水线展开为线性 TaskPlan：每段为 parse → 执行 → report；
 * 下一段 parse 依赖上一段 report，保证每段前重新拉取最新 HTML。
 */
function expandPipelinesToTaskPlan(pageUrl: string, userInput: string, pipelines: PipelineKind[]): TaskPlan[] {
  const intent = userInput.replace(/\r?\n/g, ' ').trim().slice(0, 40)
  const tasks: TaskPlan[] = []
  let prevTailId: string | undefined

  for (const p of pipelines) {
    const parseId = `task_parse_${p}`
    const execId = `task_exec_${p}`
    const reportId = `task_report_${p}`

    const midAssign =
      p === 'test' ? ('testCodeAgent' as const) : p === 'seo' ? ('seoAgent' as const) : ('pagespeedAgent' as const)
    const midType = p === 'test' ? ('testCode' as const) : p === 'seo' ? ('seo' as const) : ('pagespeed' as const)
    const reportType: ReportType = p === 'test' ? 'test' : p === 'seo' ? 'seo' : 'pagespeed'

    const parseTitle =
      p === 'test'
        ? `刷新页面并解析 HTML（测试阶段）`
        : p === 'seo'
          ? `刷新页面并解析 HTML（SEO 阶段）`
          : `刷新页面并解析 HTML（性能阶段）`

    const execTitle =
      p === 'test'
        ? `生成「${intent || '需求'}」相关 Playwright 测试（请在后续标题中保留英文 kebab 关键词便于 *.spec.ts 命名）`
        : p === 'seo'
          ? `SEO 分析：${intent || '当前页面'}`
          : `PageSpeed 性能分析：${intent || '当前页面'}`

    tasks.push({
      id: parseId,
      title: parseTitle,
      type: 'parseHtml',
      assignTo: 'parseHtmlAgent',
      dependencies: prevTailId ? [prevTailId] : [],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_parse_${p}_${intent.slice(0, 24)}`,
    })

    tasks.push({
      id: execId,
      title: execTitle,
      type: midType,
      assignTo: midAssign,
      dependencies: [parseId],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_${p}_exec_${intent.slice(0, 24)}`,
    })

    tasks.push({
      id: reportId,
      title:
        p === 'test'
          ? `生成测试阶段 HTML 报告`
          : p === 'seo'
            ? `生成 SEO 阶段 HTML 报告`
            : `生成性能阶段 HTML 报告`,
      type: 'report',
      assignTo: 'reportAgent',
      dependencies: [execId],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_report_${p}_${intent.slice(0, 24)}`,
      reportTypes: [reportType],
    })

    prevTailId = reportId
  }

  return tasks
}

export async function planAgentNode(state: State) {
  let pipelines: PipelineKind[] = defaultPipelines()

  if (hasChatLlm()) {
    const model = createChatLlm({ temperature: 0 })
    const htmlSnapshot = await fileCacheService.readHtmlSnapshotByPageUrl(state.pageUrl)
    const response = await model.invoke([
      { role: 'system', content: PLAN_AGENT_SYSTEM_PROMPT },
      { role: 'user', content: buildPlanAgentUserMessage(state, htmlSnapshot) },
    ])
    try {
      const text = extractMessageText(response.content)
      const parsed = extractJsonObject<{ pipelines?: unknown }>(text)
      const norm = normalizePipelines(parsed.pipelines)
      if (norm.length > 0) pipelines = norm
      else pipelines = defaultPipelines()
    } catch {
      pipelines = defaultPipelines()
    }
  }

  let safePipelines = pipelines
  if (expandPipelinesToTaskPlan(state.pageUrl, state.userInput, safePipelines).length === 0) {
    safePipelines = defaultPipelines()
  }
  const tasks = expandPipelinesToTaskPlan(state.pageUrl, state.userInput, safePipelines)

  const agentOutputs: Record<string, AgentOutput> = {}
  let pageDSL: PageDSL | null = state.pageDSL ?? null

  return {
    taskPlan: tasks,
    pageDSL,
    agentOutputs,
    streamEvents: [
      {
        type: 'plan_created' as const,
        payload: tasks,
        timestamp: Date.now(),
      },
      agentObservation('planAgent', 'done', {
        summary: `流水线 ${safePipelines.join(' → ')}，共 ${tasks.length} 个子任务（每段：解析 → 执行 → 报告）`,
        data: {
          pipelines: safePipelines,
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            assignTo: t.assignTo,
            type: t.type,
            reportTypes: t.reportTypes,
          })),
          pageDSLReady: Boolean(pageDSL),
        },
      }),
    ],
  }
}
