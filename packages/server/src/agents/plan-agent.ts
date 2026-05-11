import type { AgentOutput, PageDSL, State, TaskPlan } from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { fileCacheService } from '../lib/file-cache'
import { extractJsonObject, extractMessageText } from './llm-text'
import { PLAN_AGENT_SYSTEM_PROMPT, buildPlanAgentUserMessage } from './prompts/plan-agent.prompt'
import { agentObservation } from './agent-observation'

const PLAN_TASK_ORDER = ['task_parse', 'task_test', 'task_seo', 'task_perf', 'task_report'] as const

function defaultTasks(pageUrl: string, userInput: string): TaskPlan[] {
  const intent = userInput.slice(0, 40)
  return [
    {
      id: 'task_parse',
      title: '解析页面 HTML 结构',
      type: 'parseHtml',
      assignTo: 'parseHtmlAgent',
      dependencies: [],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_parse`,
    },
    {
      id: 'task_test',
      title: `生成「${intent}」相关 Playwright 测试`,
      type: 'testCode',
      assignTo: 'testCodeAgent',
      dependencies: ['task_parse'],
      canParallel: true,
      status: 'pending',
      cacheKey: `${pageUrl}_test_${intent}`,
    },
    {
      id: 'task_seo',
      title: '分析页面 SEO 指标',
      type: 'seo',
      assignTo: 'seoAgent',
      dependencies: ['task_parse'],
      canParallel: true,
      status: 'pending',
      cacheKey: `${pageUrl}_seo`,
    },
    {
      id: 'task_perf',
      title: '分析页面性能（PageSpeed）',
      type: 'pagespeed',
      assignTo: 'pagespeedAgent',
      dependencies: [],
      canParallel: true,
      status: 'pending',
      cacheKey: `${pageUrl}_perf`,
    },
    {
      id: 'task_report',
      title: '生成 HTML 报告',
      type: 'report',
      assignTo: 'reportAgent',
      dependencies: ['task_test', 'task_seo', 'task_perf'],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_report`,
    },
  ]
}

/** 将 LLM 返回的任务与默认模板合并：固定 id 集、补全 parse/report、重写依赖与 title/cacheKey */
function mergePlanFromLlmTasks(llmTasks: TaskPlan[], pageUrl: string, userInput: string): TaskPlan[] {
  const defaults = defaultTasks(pageUrl, userInput)
  const defById = new Map(defaults.map((t) => [t.id, t]))
  const llmById = new Map<string, TaskPlan>()
  for (const t of llmTasks) {
    if (typeof t.id !== 'string') continue
    if (!defById.has(t.id)) continue
    llmById.set(t.id, t)
  }

  if (llmTasks.length > 0 && llmById.size === 0) {
    return defaults
  }

  let idSet = new Set<string>(llmById.keys())
  if ([...idSet].some((id) => id === 'task_test' || id === 'task_seo')) {
    idSet.add('task_parse')
  }

  const hasExecutor = [...idSet].some((id) => id !== 'task_report')
  if (hasExecutor && !idSet.has('task_report')) {
    idSet.add('task_report')
  }

  const ordered = PLAN_TASK_ORDER.filter((id) => idSet.has(id))
  const nonReport = ordered.filter((id) => id !== 'task_report')
  if (nonReport.length === 0) {
    return defaults
  }

  return ordered.map((id) => {
    const base = { ...defById.get(id)! }
    const llm = llmById.get(id)
    const title = llm?.title?.trim() ? llm.title.trim() : base.title
    const cacheKey = llm?.cacheKey?.trim() ? llm.cacheKey.trim() : base.cacheKey!
    const canParallel =
      id === 'task_parse' || id === 'task_report'
        ? false
        : typeof llm?.canParallel === 'boolean'
          ? llm.canParallel
          : base.canParallel

    const dependencies: string[] =
      id === 'task_report' ? [...nonReport] : base.dependencies.filter((dep) => idSet.has(dep))

    return {
      ...base,
      title,
      cacheKey,
      canParallel,
      dependencies,
      status: 'pending' as const,
    }
  })
}

export async function planAgentNode(state: State) {
  let tasks: TaskPlan[] = defaultTasks(state.pageUrl, state.userInput)

  if (hasChatLlm()) {
    const model = createChatLlm({ temperature: 0 })
    const response = await model.invoke([
      { role: 'system', content: PLAN_AGENT_SYSTEM_PROMPT },
      { role: 'user', content: buildPlanAgentUserMessage(state) },
    ])
    try {
      const text = extractMessageText(response.content)
      const parsed = extractJsonObject<{ tasks: TaskPlan[] }>(text)
      if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
        tasks = defaultTasks(state.pageUrl, state.userInput)
      } else {
        tasks = mergePlanFromLlmTasks(parsed.tasks, state.pageUrl, state.userInput)
      }
    } catch {
      tasks = defaultTasks(state.pageUrl, state.userInput)
    }
  }

  const tasksWithCacheCheck = await Promise.all(
    tasks.map(async (task) => {
      if (!task.cacheKey) return { ...task, status: 'pending' as const }
      const cached = await fileCacheService.get<unknown>(task.cacheKey)
      if (cached && task.assignTo !== 'reportAgent') {
        return { ...task, status: 'skipped' as const }
      }
      return { ...task, status: 'pending' as const }
    }),
  )

  let pageDSL: PageDSL | null = state.pageDSL
  const parseTask = tasksWithCacheCheck.find((t) => t.assignTo === 'parseHtmlAgent')
  if (parseTask?.status === 'skipped' && parseTask.cacheKey) {
    const dsl = await fileCacheService.get<PageDSL>(parseTask.cacheKey)
    if (dsl) pageDSL = dsl
  }

  const agentOutputs: Record<string, AgentOutput> = {}
  if (pageDSL) {
    agentOutputs.parseHtmlAgent = { status: 'cached', data: pageDSL, fromCache: true }
  }

  for (const t of tasksWithCacheCheck) {
    if (t.status !== 'skipped' || !t.cacheKey) continue
    if (t.assignTo === 'parseHtmlAgent') continue
    const data = await fileCacheService.get<unknown>(t.cacheKey)
    if (data) {
      agentOutputs[t.assignTo] = { status: 'cached', data, fromCache: true }
    }
  }

  const skipped = tasksWithCacheCheck.filter((t) => t.status === 'skipped').length

  return {
    taskPlan: tasksWithCacheCheck,
    pageDSL,
    agentOutputs,
    streamEvents: [
      {
        type: 'plan_created' as const,
        payload: tasksWithCacheCheck,
        timestamp: Date.now(),
      },
      agentObservation('planAgent', 'done', {
        summary: `任务 ${tasksWithCacheCheck.length} 项，命中缓存跳过 ${skipped} 项`,
        data: {
          tasks: tasksWithCacheCheck.map((t) => ({
            id: t.id,
            title: t.title,
            assignTo: t.assignTo,
            status: t.status,
            cacheKey: t.cacheKey,
          })),
          pageDSLReady: Boolean(pageDSL),
          prefilledAgentOutputs: Object.keys(agentOutputs),
        },
      }),
    ],
  }
}
