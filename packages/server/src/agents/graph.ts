import { StateGraph, START, END, Command, MemorySaver } from '@langchain/langgraph'
import { BrowserTestState, type State, type StreamEvent } from './state'
import { mainAgentNode } from './main-agent'
import { planAgentNode } from './plan-agent'
import { parseHtmlAgentNode } from './parse-html-agent'
import { testCodeAgentNode } from './test-code-agent'
import { seoAgentNode } from './seo-agent'
import { pagespeedAgentNode } from './pagespeed-agent'
import { reportAgentNode } from './report-agent'
import { markRunning, allTasksFinished, executablePendingTasks, findTaskId, updateStatus } from './graph-helpers'
import { agentObservation } from './agent-observation'
import { disposePlaywrightSession } from '../lib/playwright-browser-session'

function pickNextExecutableTask(plan: State['taskPlan'], exec: State['taskPlan']): State['taskPlan'][number] {
  const order = new Map(plan.map((t, i) => [t.id, i]))
  return [...exec].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0]
}

async function dispatcherNode(state: State) {
  if (state.taskPlan.length === 0) {
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
  return {
    streamEvents: [
      {
        type: 'complete' as const,
        payload: {
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
        'seoAgent',
        'pagespeedAgent',
        'reportAgent',
        'finalSummary',
        END,
      ],
    })
    .addNode('parseHtmlAgent', parseHtmlAgentNode, { ends: ['dispatcher'] })
    .addNode('testCodeAgent', (s: State) => singleAgentNode(s, 'testCodeAgent', testCodeAgentNode), {
      ends: ['dispatcher'],
    })
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
