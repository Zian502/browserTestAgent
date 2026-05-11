import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

export interface TaskPlan {
  id: string
  title: string
  type: 'parseHtml' | 'testCode' | 'seo' | 'pagespeed' | 'report'
  assignTo: AgentName
  dependencies: string[]
  canParallel: boolean
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  cacheKey?: string
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
  /** 服务端经 Playwright+CDP 得到的 HTML（与 pageUrl 对应） */
  pageHtml: Annotation<string>(),
  /** Playwright 托管会话 id（与 CDP 打开的页签对应）；空表示未启用 */
  runnerSessionId: Annotation<string>(),
  /** true：pageHtml 来自 Playwright，测试应在同一会话页签执行 */
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
