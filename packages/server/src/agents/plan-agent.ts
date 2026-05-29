import type {
  PageDSL,
  State,
  TaskPlanMain,
  TaskPlanStep,
  AgentOutput,
  PipelineKind,
  TaskPlanStepType,
  AgentName,
} from './state'
import { createChatLlm, hasChatLlm } from './llm-client'
import { fileCacheService } from '../lib/file-cache'
import { extractJsonObject, extractMessageText } from './llm-text'
import { PLAN_AGENT_SYSTEM_PROMPT, buildPlanAgentUserMessage } from './prompts/plan-agent.prompt'
import { agentObservation } from './agent-observation'
import type { ReportType } from '../lib/report-generator'

const PIPELINE_ORDER: PipelineKind[] = ['test', 'seo', 'perf']

const MID_STEP: Record<
  PipelineKind,
  { type: TaskPlanStepType; assignTo: AgentName; reportType: ReportType }
> = {
  test: { type: 'testCode', assignTo: 'testCodeAgent', reportType: 'test' },
  seo: { type: 'seo', assignTo: 'seoAgent', reportType: 'seo' },
  perf: { type: 'pagespeed', assignTo: 'pagespeedAgent', reportType: 'pagespeed' },
}

function isPipelineKind(x: unknown): x is PipelineKind {
  return x === 'test' || x === 'seo' || x === 'perf'
}

function normalizePipelinesArray(raw: unknown): PipelineKind[] {
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

function defaultPipelines(): PipelineKind[] {
  return [...PIPELINE_ORDER]
}

function expectedSubTaskKinds(pipeline: PipelineKind): TaskPlanStepType[] {
  const mid = MID_STEP[pipeline].type
  return ['parseHtml', mid, 'report']
}

interface LlmSubTaskDraft {
  kind?: string
  title?: string
}

interface LlmTestStepDraft {
  title?: string
}

interface LlmMainTaskDraft {
  id?: string
  title?: string
  pipeline?: string
  subTasks?: LlmSubTaskDraft[]
  testSteps?: LlmTestStepDraft[]
}

interface MainTaskBuildInput {
  id?: string
  title?: string
  pipeline: PipelineKind
  /** seo/perf：与 expectedSubTaskKinds 对齐的 3 项标题 */
  subTaskTitles?: [string, string, string]
  /** test：多段测试步骤标题（每段 parse→testCode 片段→合并） */
  testSteps?: string[]
}

function parseTestSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const t = String((row as LlmTestStepDraft).title ?? '').trim()
    if (t) out.push(t)
  }
  return out
}

function defaultTestStepTitles(userInput: string, intent: string): string[] {
  const u = userInput.toLowerCase()
  if (/登录|login|sign\s*in|账号|密码/.test(u)) {
    return [
      '点击登录入口并断言登录弹框/层可见',
      '在弹框内填写账号密码并提交，断言登录结果',
    ]
  }
  return [`生成「${intent || '需求'}」相关 Playwright 测试（保留英文 kebab 关键词便于命名）`]
}

function parseMainTasksFromLlmText(text: string): MainTaskBuildInput[] {
  try {
    const parsed = extractJsonObject<{ mainTasks?: unknown; pipelines?: unknown }>(text)
    if (Array.isArray(parsed.mainTasks) && parsed.mainTasks.length > 0) {
      return normalizeLlmMainTasks(parsed.mainTasks)
    }
    const pipes = normalizePipelinesArray(parsed.pipelines)
    if (pipes.length > 0) {
      return pipes.map((p, i) => ({ pipeline: p, id: `main_${p}_${i}` }))
    }
  } catch {
    /* fallthrough */
  }
  return []
}

function normalizeLlmMainTasks(raw: unknown[]): MainTaskBuildInput[] {
  const out: MainTaskBuildInput[] = []
  let i = 0
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as LlmMainTaskDraft
    const p = o.pipeline
    if (!isPipelineKind(p)) continue
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `main_${p}_${i}`
    const title = typeof o.title === 'string' ? o.title.trim() : undefined

    const testSteps = p === 'test' ? parseTestSteps(o.testSteps) : undefined

    const sub = Array.isArray(o.subTasks) ? o.subTasks : undefined
    const kinds = expectedSubTaskKinds(p)
    let titles: [string, string, string] | undefined
    if (p !== 'test' && sub && sub.length === 3) {
      const ok = sub.every((s, j) => String(s?.kind ?? '').trim() === kinds[j])
      if (ok) {
        titles = [
          String(sub[0]?.title ?? '').trim(),
          String(sub[1]?.title ?? '').trim(),
          String(sub[2]?.title ?? '').trim(),
        ] as [string, string, string]
      }
    }

    out.push({
      id,
      title,
      pipeline: p,
      subTaskTitles: titles,
      testSteps: testSteps && testSteps.length > 0 ? testSteps : undefined,
    })
    i++
  }
  return out
}

function defaultMainTitle(pipeline: PipelineKind, intent: string): string {
  const hint = intent || '当前页面'
  if (pipeline === 'test') return `Playwright 测试：${hint}`
  if (pipeline === 'seo') return `SEO 分析：${hint}`
  return `PageSpeed 性能：${hint}`
}

function parseTitlesForPipeline(
  pipeline: PipelineKind,
  intent: string,
  custom?: [string, string, string],
): [string, string, string] {
  const pick = (i: number, fallback: string) => {
    const c = custom?.[i]?.trim()
    return c && c.length > 0 ? c : fallback
  }
  const d0 =
    pipeline === 'test'
      ? `刷新页面并解析 HTML（测试阶段）`
      : pipeline === 'seo'
        ? `刷新页面并解析 HTML（SEO 阶段）`
        : `刷新页面并解析 HTML（性能阶段）`
  const d1 =
    pipeline === 'test'
      ? `生成「${intent || '需求'}」相关 Playwright 测试（请在后续标题中保留英文 kebab 关键词便于 *.spec.ts 命名）`
      : pipeline === 'seo'
        ? `SEO 分析：${intent || '当前页面'}`
        : `PageSpeed 性能分析：${intent || '当前页面'}`
  const d2 =
    pipeline === 'test'
      ? `生成测试阶段 HTML 报告`
      : pipeline === 'seo'
        ? `生成 SEO 阶段 HTML 报告`
        : `生成性能阶段 HTML 报告`
  return [pick(0, d0), pick(1, d1), pick(2, d2)]
}

function stepCacheSuffix(mainId: string, stepIndex: number, kind: 'html_dsl' | 'code'): string {
  return `${mainId}_step${stepIndex}_${kind}`
}

/** test 主任务：多段 testSteps → 每段 parse+testCode(片段) → merge → report */
function buildTestMainWithSteps(
  mainId: string,
  mainTitle: string,
  pageUrl: string,
  stepTitles: string[],
  prevTailId: string | undefined,
): TaskPlanMain {
  const subTasks: TaskPlanStep[] = []
  let lastDep = prevTailId

  for (let i = 0; i < stepTitles.length; i++) {
    const parseId = `${mainId}_step${i}_parse`
    const testId = `${mainId}_step${i}_test`
    const htmlDslKey = `${pageUrl}::${stepCacheSuffix(mainId, i, 'html_dsl')}`
    const codeKey = `${pageUrl}::${stepCacheSuffix(mainId, i, 'code')}`

    subTasks.push({
      id: parseId,
      title: `解析 HTML（步骤 ${i + 1}/${stepTitles.length}：${stepTitles[i]})`,
      type: 'parseHtml',
      assignTo: 'parseHtmlAgent',
      dependencies: lastDep ? [lastDep] : [],
      canParallel: false,
      status: 'pending',
      cacheKey: htmlDslKey,
      groupId: mainId,
      testStepIndex: i,
    })

    subTasks.push({
      id: testId,
      title: stepTitles[i],
      type: 'testCode',
      assignTo: 'testCodeAgent',
      dependencies: [parseId],
      canParallel: false,
      status: 'pending',
      cacheKey: codeKey,
      groupId: mainId,
      testStepIndex: i,
      testStepRole: 'fragment',
    })

    lastDep = testId
  }

  const mergeId = `${mainId}_merge`
  const fragmentIds = stepTitles.map((_, i) => `${mainId}_step${i}_test`)
  subTasks.push({
    id: mergeId,
    title: `合并 ${stepTitles.length} 段测试用例为单个 spec`,
    type: 'testCode',
    assignTo: 'testCodeAgent',
    dependencies: fragmentIds,
    canParallel: false,
    status: 'pending',
    cacheKey: `${pageUrl}::${mainId}_merged_spec`,
    groupId: mainId,
    testStepRole: 'merge',
  })

  const reportId = `${mainId}_report`
  subTasks.push({
    id: reportId,
    title: `生成测试阶段 HTML 报告`,
    type: 'report',
    assignTo: 'reportAgent',
    dependencies: [mergeId],
    canParallel: false,
    status: 'pending',
    cacheKey: `${pageUrl}::${mainId}_report`,
    groupId: mainId,
    reportTypes: ['test'],
  })

  return {
    id: mainId,
    title: mainTitle,
    pipeline: 'test',
    status: 'pending',
    subTasks,
  }
}

/** seo/perf 或单段 test：parse → exec → report */
function buildSimpleMainTask(
  inp: MainTaskBuildInput,
  pageUrl: string,
  intent: string,
  prevTailId: string | undefined,
): { main: TaskPlanMain; tailId: string } {
  const { pipeline } = inp
  const mainId = inp.id?.trim() || `main_${pipeline}`
  const mainTitle = inp.title?.trim() || defaultMainTitle(pipeline, intent)
  const [tParse, tExec, tReport] = parseTitlesForPipeline(pipeline, intent, inp.subTaskTitles)

  const parseId = `${mainId}_parse`
  const execId = `${mainId}_exec`
  const reportId = `${mainId}_report`
  const mid = MID_STEP[pipeline]

  const subTasks: TaskPlanStep[] = [
    {
      id: parseId,
      title: tParse,
      type: 'parseHtml',
      assignTo: 'parseHtmlAgent',
      dependencies: prevTailId ? [prevTailId] : [],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_parse_${pipeline}_${intent.slice(0, 24)}`,
      groupId: mainId,
    },
    {
      id: execId,
      title: tExec,
      type: mid.type,
      assignTo: mid.assignTo,
      dependencies: [parseId],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_${pipeline}_exec_${intent.slice(0, 24)}`,
      groupId: mainId,
    },
    {
      id: reportId,
      title: tReport,
      type: 'report',
      assignTo: 'reportAgent',
      dependencies: [execId],
      canParallel: false,
      status: 'pending',
      cacheKey: `${pageUrl}_report_${pipeline}_${intent.slice(0, 24)}`,
      groupId: mainId,
      reportTypes: [mid.reportType],
    },
  ]

  return {
    main: { id: mainId, title: mainTitle, pipeline, status: 'pending', subTasks },
    tailId: reportId,
  }
}

function buildMainTasks(pageUrl: string, userInput: string, inputs: MainTaskBuildInput[]): TaskPlanMain[] {
  const intent = userInput.replace(/\r?\n/g, ' ').trim().slice(0, 40)
  const mains: TaskPlanMain[] = []
  let prevTailId: string | undefined

  for (let idx = 0; idx < inputs.length; idx++) {
    const inp = inputs[idx]
    const { pipeline } = inp
    const mainId = inp.id?.trim() || `main_${pipeline}_${idx}`
    const mainTitle = inp.title?.trim() || defaultMainTitle(pipeline, intent)

    if (pipeline === 'test') {
      const steps =
        inp.testSteps && inp.testSteps.length > 0
          ? inp.testSteps
          : defaultTestStepTitles(userInput, intent)

      if (steps.length >= 2) {
        const main = buildTestMainWithSteps(mainId, mainTitle, pageUrl, steps, prevTailId)
        mains.push(main)
        prevTailId = `${mainId}_report`
        continue
      }
    }

    const { main, tailId } = buildSimpleMainTask(inp, pageUrl, intent, prevTailId)
    mains.push(main)
    prevTailId = tailId
  }

  return mains
}

export async function planAgentNode(state: State) {
  let buildInputs: MainTaskBuildInput[] = []

  if (hasChatLlm()) {
    const model = createChatLlm({ temperature: 0 })
    const htmlSnapshot = await fileCacheService.readHtmlSnapshotByPageUrl(state.pageUrl)
    const response = await model.invoke([
      { role: 'system', content: PLAN_AGENT_SYSTEM_PROMPT },
      { role: 'user', content: buildPlanAgentUserMessage(state, htmlSnapshot) },
    ])
    try {
      const text = extractMessageText(response.content)
      const fromLlm = parseMainTasksFromLlmText(text)
      if (fromLlm.length > 0) buildInputs = fromLlm
      else buildInputs = defaultPipelines().map((p, i) => ({ pipeline: p, id: `main_${p}_${i}` }))
    } catch {
      buildInputs = defaultPipelines().map((p, i) => ({ pipeline: p, id: `main_${p}_${i}` }))
    }
  } else {
    buildInputs = defaultPipelines().map((p, i) => ({ pipeline: p, id: `main_${p}_${i}` }))
  }

  if (buildInputs.length === 0) {
    buildInputs = defaultPipelines().map((p, i) => ({ pipeline: p, id: `main_${p}_${i}` }))
  }

  const tasks = buildMainTasks(state.pageUrl, state.userInput, buildInputs)

  const agentOutputs: Record<string, AgentOutput> = {}
  const pageDSL: PageDSL | null = state.pageDSL ?? null

  const pipelineSummary = tasks.map((m) => m.pipeline).join(' → ')

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
        summary: `主任务 ${tasks.length} 个（流水线 ${pipelineSummary}）；test 含多步时将按步骤缓存 html/dsl 并合并测试代码`,
        data: {
          mainTasks: tasks.map((m) => ({
            id: m.id,
            title: m.title,
            pipeline: m.pipeline,
            subTasks: m.subTasks.map((s) => ({
              id: s.id,
              title: s.title,
              assignTo: s.assignTo,
              type: s.type,
              testStepRole: s.testStepRole,
              testStepIndex: s.testStepIndex,
              cacheKey: s.cacheKey,
              reportTypes: s.reportTypes,
            })),
          })),
          pageDSLReady: Boolean(pageDSL),
        },
      }),
    ],
  }
}
