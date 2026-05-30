import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { ReportType } from '../lib/report-generator'

/** 流水线类型：与规划 LLM 输出及报告类型对齐 */
export type PipelineKind = 'test' | 'seo' | 'perf'

export type AgentName =
  | 'mainAgent'
  | 'planAgent'
  | 'parseHtmlAgent'
  | 'testCodeAgent'
  | 'reviewAgent'
  | 'seoAgent'
  | 'pagespeedAgent'
  | 'reportAgent'

/** testCodeAgent 执行失败后交给 reviewAgent 的上下文 */
export interface TestReviewContext {
  taskId?: string
  taskTitle?: string
  pageUrl: string
  userInput: string
  error?: string
  passed: number
  failed: number
  logs: string[]
  codePreview?: string
}

/** 单个子任务：对应一次 agent 执行，全局 id 在 flatten 后仍唯一 */
export type TaskPlanStepType = 'parseHtml' | 'testCode' | 'seo' | 'pagespeed' | 'report'

/** test 流水线：子任务测试代码角色 */
export type TestStepRole = 'fragment' | 'merge'

export type TaskPlanStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface TestCodeFragment {
  taskId: string
  stepIndex: number
  title: string
  code: string
  cacheKey: string
  dslCacheKey?: string
}

export interface TaskPlanStep {
  id: string
  title: string
  type: TaskPlanStepType
  assignTo: AgentName
  dependencies: string[]
  canParallel: boolean
  status: TaskPlanStatus
  cacheKey?: string
  /** 所属主任务 id（test 多段拆分时的分组键） */
  groupId?: string
  /** test 流水线内步骤序号（从 0 起） */
  testStepIndex?: number
  /** testCode 子任务：片段生成或最终合并 */
  testStepRole?: TestStepRole
  /**
   * 仅当 assignTo 为 reportAgent：本段只生成这些类型的 HTML 报告
   */
  reportTypes?: ReportType[]
}

/**
 * 主任务：由规划 LLM 生成标题与流水线类型；`subTasks` 为 agent **串行**执行顺序。
 */
export interface TaskPlanMain {
  id: string
  title: string
  pipeline: PipelineKind
  status: TaskPlanStatus
  subTasks: TaskPlanStep[]
}

export interface PageDSL {
  url: string
  title: string
  elements: {
    id: string
    type: 'button' | 'input' | 'form' | 'link' | 'modal' | 'other'
    selector: string
    testId?: string
    text?: string
    role?: string
    children?: string[]
  }[]
  forms: {
    id: string
    selector: string
    fields: { name: string; selector: string; type: string }[]
    submitButton: string
  }[]
  landmarks: Record<string, string>
}

export interface AgentOutput {
  status: 'done' | 'failed' | 'cached'
  data?: unknown
  error?: string
  fromCache?: boolean
  reportPath?: string
}

export interface StreamEvent {
  type:
    | 'plan_created'
    | 'agent_start'
    | 'agent_done'
    | 'agent_failed'
    | 'agent_observation'
    | 'skill_start'
    | 'skill_success'
    | 'skill_failure'
    | 'mcp_call'
    | 'mcp_result'
    | 'tool_start'
    | 'tool_success'
    | 'tool_failure'
    | 'report_ready'
    | 'text'
    | 'task_status'
    | 'complete'
  agentName?: AgentName
  taskId?: string
  payload?: unknown
  timestamp: number
}

export const BrowserTestState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  userInput: Annotation<string>(),
  /** GitHub 用户 id（JWT sub）；未登录时为空 */
  userId: Annotation<string | undefined>(),
  pageUrl: Annotation<string>(),
  /** 浏览器当前页 URL（首屏等于 pageUrl；每段 test 执行后更新），供 get-html / run_test 等子任务使用 */
  runnerPageUrl: Annotation<string>(),
  /** Playwright 托管会话 id（与 CDP 打开的页签对应）；空表示未启用 */
  runnerSessionId: Annotation<string>(),
  /** true：启用 Playwright；HTML 快照见 `.agent-cache/html`，解析/分析前按需 CDP 刷新并回写该文件 */
  usePlaywrightBrowser: Annotation<boolean>(),
  /** mainAgent 调 Playwright 工具时使用 */
  playwrightHeadless: Annotation<boolean>(),
  playwrightSlowMoMs: Annotation<number>(),
  /** 主任务列表；每个主任务内含有序子任务（agent 执行顺序） */
  taskPlan: Annotation<TaskPlanMain[]>(),
  nextAgent: Annotation<string>(),
  pageDSL: Annotation<PageDSL | null>(),
  agentOutputs: Annotation<Record<string, AgentOutput>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  parallelResults: Annotation<{ taskId: string; agentName: AgentName; output: AgentOutput }[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  streamEvents: Annotation<StreamEvent[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  reports: Annotation<Record<string, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  /** 按主任务 id 累积各 test 片段代码，供 merge 子任务串联 */
  /** 测试执行失败时由 testCodeAgent 写入，供 reviewAgent 消费 */
  testReviewContext: Annotation<TestReviewContext | null>({
    reducer: (_, next) => next ?? null,
    default: () => null,
  }),
  testCodeFragments: Annotation<Record<string, TestCodeFragment[]>>({
    reducer: (prev, next) => {
      const out = { ...prev }
      for (const [mainId, frags] of Object.entries(next)) {
        const byIndex = new Map((out[mainId] ?? []).map((f) => [f.stepIndex, f]))
        for (const f of frags) byIndex.set(f.stepIndex, f)
        out[mainId] = [...byIndex.values()].sort((a, b) => a.stepIndex - b.stepIndex)
      }
      return out
    },
    default: () => ({}),
  }),
})

export type State = typeof BrowserTestState.State
