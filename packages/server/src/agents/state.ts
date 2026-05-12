import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { ReportType } from '../lib/report-generator'

export interface TaskPlan {
  id: string
  title: string
  type: 'parseHtml' | 'testCode' | 'seo' | 'pagespeed' | 'report'
  assignTo: AgentName
  dependencies: string[]
  canParallel: boolean
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  cacheKey?: string
  /**
   * 仅当 assignTo 为 reportAgent 时使用：本段流水线只生成这些类型的 HTML 报告
   *（避免串行多段流水线时重复生成其它阶段已产出的报告）。
   */
  reportTypes?: ReportType[]
}

export type AgentName =
  | 'mainAgent'
  | 'planAgent'
  | 'parseHtmlAgent'
  | 'testCodeAgent'
  | 'seoAgent'
  | 'pagespeedAgent'
  | 'reportAgent'

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
  pageUrl: Annotation<string>(),
  /** Playwright 托管会话 id（与 CDP 打开的页签对应）；空表示未启用 */
  runnerSessionId: Annotation<string>(),
  /** true：启用 Playwright；HTML 快照见 `.agent-cache/html`，解析/分析前按需 CDP 刷新并回写该文件 */
  usePlaywrightBrowser: Annotation<boolean>(),
  /** mainAgent 调 Playwright 工具时使用 */
  playwrightHeadless: Annotation<boolean>(),
  playwrightSlowMoMs: Annotation<number>(),
  taskPlan: Annotation<TaskPlan[]>(),
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
})

export type State = typeof BrowserTestState.State
