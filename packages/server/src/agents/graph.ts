import { StateGraph, START, END, Command, MemorySaver, type LangGraphRunnableConfig } from '@langchain/langgraph'
import { BrowserTestState, type State, type StreamEvent, type TaskPlanMain, type TaskPlanStep } from './state'
import { mainAgentNode } from './main-agent'
import { planAgentNode } from './plan-agent'
import { parseHtmlAgentNode } from './parse-html-agent'
import { testCodeAgentNode } from './test-code-agent'
import { reviewAgentNode } from './review-agent'
import { seoAgentNode } from './seo-agent'
import { pagespeedAgentNode } from './pagespeed-agent'
import { reportAgentNode } from './report-agent'
import {
  markRunning,
  allTasksFinished,
  executablePendingTasks,
  findTaskId,
  updateStatus,
  flattenTaskPlan,
} from './graph-helpers'
import { agentObservation } from './agent-observation'
import { disposePlaywrightSession } from '../lib/playwright-browser-session'

function pickNextExecutableTask(plan: TaskPlanMain[], exec: TaskPlanStep[]): TaskPlanStep {
  const order = flattenTaskPlan(plan).map((s) => s.id)
  const idx = new Map(order.map((id, i) => [id, i]))
  return [...exec].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0))[0]
}

async function dispatcherNode(state: State) {
  if (flattenTaskPlan(state.taskPlan).length === 0) {
    return new Command({ goto: END })
  }

  if (allTasksFinished(state.taskPlan)) {
    return new Command({ goto: 'finalSummary' })
  }

  const exec = executablePendingTasks(state)
  if (exec.length === 0) {
    return new Command({ goto: 'finalSummary' })
  }

  const next = pickNextExecutableTask(state.taskPlan, exec)
  const assign = next.assignTo

  const goto =
    assign === 'parseHtmlAgent'
      ? 'parseHtmlAgent'
      : assign === 'testCodeAgent'
        ? 'testCodeAgent'
        : assign === 'seoAgent'
          ? 'seoAgent'
          : assign === 'pagespeedAgent'
            ? 'pagespeedAgent'
            : assign === 'reportAgent'
              ? 'reportAgent'
              : 'finalSummary'

  if (goto === 'finalSummary') {
    return new Command({ goto: 'finalSummary' })
  }

  return new Command({
    update: {
      taskPlan: markRunning(state.taskPlan, next.id),
      streamEvents: [
        {
          type: 'agent_start' as const,
          agentName: assign,
          taskId: next.id,
          timestamp: Date.now(),
        },
      ],
    },
    goto,
  })
}

async function testCodeAgentWrapper(state: State, config: LangGraphRunnableConfig) {
  try {
    const result = await testCodeAgentNode(state, config)
    if (result instanceof Command) return result
    return result
  } catch (e) {
    const err = String(e)
    const taskId = findTaskId(state.taskPlan, 'testCodeAgent')
    return {
      agentOutputs: { testCodeAgent: { status: 'failed' as const, error: err } },
      taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
      streamEvents: [
        agentObservation('testCodeAgent', 'failed', {
          taskId,
          summary: err,
          data: { message: err },
        }),
        {
          type: 'agent_failed' as const,
          agentName: 'testCodeAgent',
          taskId,
          payload: { message: err },
          timestamp: Date.now(),
        },
      ],
    } as Partial<State>
  }
}

async function singleAgentNode(
  state: State,
  assignTo: 'testCodeAgent' | 'seoAgent' | 'pagespeedAgent',
  run: (s: State) => Promise<Record<string, unknown>>,
): Promise<Partial<State>> {
  try {
    return (await run(state)) as Partial<State>
  } catch (e) {
    const err = String(e)
    const taskId = findTaskId(state.taskPlan, assignTo)
    return {
      agentOutputs: { [assignTo]: { status: 'failed' as const, error: err } },
      taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'failed') : state.taskPlan,
      streamEvents: [
        agentObservation(assignTo, 'failed', {
          taskId,
          summary: err,
          data: { message: err },
        }),
        {
          type: 'agent_failed' as const,
          agentName: assignTo,
          taskId,
          payload: { message: err },
          timestamp: Date.now(),
        },
      ],
    } as Partial<State>
  }
}

async function finalSummaryNode(state: State) {
  if (state.runnerSessionId?.trim() && state.usePlaywrightBrowser) {
    await disposePlaywrightSession(state.runnerSessionId).catch(() => {})
  }
  const runFailed =
    Boolean(state.testReviewContext) ||
    state.taskPlan.some((m) => m.status === 'failed') ||
    state.agentOutputs?.testCodeAgent?.status === 'failed'
  return {
    streamEvents: [
      {
        type: 'complete' as const,
        payload: {
          ok: !runFailed,
          agentOutputs: state.agentOutputs,
          reports: state.reports,
        },
        timestamp: Date.now(),
      },
    ],
  }
}

export function buildGraph() {
  const checkpointer = new MemorySaver()
  const graph = new StateGraph(BrowserTestState)
    .addNode('mainAgent', mainAgentNode, { ends: ['planAgent', 'finalSummary', 'mainAgent'] })
    .addNode('planAgent', planAgentNode)
    .addNode('dispatcher', dispatcherNode, {
      ends: [
        'planAgent',
        'parseHtmlAgent',
        'testCodeAgent',
        'reviewAgent',
        'seoAgent',
        'pagespeedAgent',
        'reportAgent',
        'finalSummary',
        END,
      ],
    })
    .addNode('parseHtmlAgent', parseHtmlAgentNode, { ends: ['dispatcher'] })
    .addNode('testCodeAgent', testCodeAgentWrapper, {
      ends: ['dispatcher', 'reviewAgent'],
    })
    .addNode('reviewAgent', reviewAgentNode, { ends: ['finalSummary'] })
    .addNode('seoAgent', (s: State) => singleAgentNode(s, 'seoAgent', seoAgentNode), { ends: ['dispatcher'] })
    .addNode('pagespeedAgent', (s: State) => singleAgentNode(s, 'pagespeedAgent', pagespeedAgentNode), {
      ends: ['dispatcher'],
    })
    .addNode('reportAgent', reportAgentNode, { ends: ['dispatcher'] })
    .addNode('finalSummary', finalSummaryNode)

    .addEdge(START, 'mainAgent')
    .addEdge('planAgent', 'dispatcher')
    .addEdge('parseHtmlAgent', 'dispatcher')
    .addEdge('testCodeAgent', 'dispatcher')
    .addEdge('seoAgent', 'dispatcher')
    .addEdge('pagespeedAgent', 'dispatcher')
    .addEdge('reportAgent', 'dispatcher')
    .addEdge('finalSummary', END)

  return graph.compile({ checkpointer })
}
