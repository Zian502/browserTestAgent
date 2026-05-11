import { StateGraph, START, END, Command, MemorySaver } from '@langchain/langgraph'
import { BrowserTestState, type State, type StreamEvent } from './state'
import { mainAgentNode } from './main-agent'
import { planAgentNode } from './plan-agent'
import { parseHtmlAgentNode } from './parse-html-agent'
import { testCodeAgentNode } from './test-code-agent'
import { seoAgentNode } from './seo-agent'
import { pagespeedAgentNode } from './pagespeed-agent'
import { reportAgentNode } from './report-agent'
import {
  allTasksFinished,
  executablePendingTasks,
  markRunning,
  markRunningBatch,
  updateStatus,
} from './graph-helpers'
import { agentObservation } from './agent-observation'
import { disposePlaywrightSession } from '../lib/playwright-browser-session'

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

  const parseTask = exec.find((t) => t.assignTo === 'parseHtmlAgent')
  if (parseTask && !state.pageDSL) {
    return new Command({
      update: {
        taskPlan: markRunning(state.taskPlan, parseTask.id),
        streamEvents: [
          {
            type: 'agent_start',
            agentName: 'parseHtmlAgent',
            taskId: parseTask.id,
            timestamp: Date.now(),
          },
        ],
      },
      goto: 'parseHtmlAgent',
    })
  }

  const reportTask = exec.find((t) => t.assignTo === 'reportAgent')
  const parallelCandidates = exec.filter((t) =>
    ['testCodeAgent', 'seoAgent', 'pagespeedAgent'].includes(t.assignTo),
  )

  const needsDsl = (t: (typeof parallelCandidates)[number]) =>
    t.assignTo === 'testCodeAgent' || t.assignTo === 'seoAgent'

  const runnableParallel = parallelCandidates.filter((t) => !needsDsl(t) || state.pageDSL != null)

  if (runnableParallel.length > 0) {
    return new Command({
      update: {
        taskPlan: markRunningBatch(
          state.taskPlan,
          runnableParallel.map((t) => t.id),
        ),
        streamEvents: runnableParallel.map((t) => ({
          type: 'agent_start' as const,
          agentName: t.assignTo,
          taskId: t.id,
          timestamp: Date.now(),
        })),
      },
      goto: 'parallelBatch',
    })
  }

  if (reportTask) {
    return new Command({
      update: {
        taskPlan: markRunning(state.taskPlan, reportTask.id),
        streamEvents: [
          {
            type: 'agent_start',
            agentName: 'reportAgent',
            taskId: reportTask.id,
            timestamp: Date.now(),
          },
        ],
      },
      goto: 'reportAgent',
    })
  }

  return new Command({ goto: 'finalSummary' })
}

function mergeParallelTaskPlans(
  base: State['taskPlan'],
  runningIds: string[],
  parts: { taskPlan?: State['taskPlan'] }[],
): State['taskPlan'] {
  const idSet = new Set(runningIds)
  let cur = [...base]
  for (const id of idSet) {
    const overlay = parts
      .map((p) => p.taskPlan?.find((t) => t.id === id))
      .find((t) => t && t.status !== 'running')
    if (overlay) {
      cur = cur.map((t) => (t.id === id ? overlay : t))
    }
  }
  return cur
}

async function parallelBatchNode(state: State) {
  const running = state.taskPlan.filter(
    (t) =>
      t.status === 'running' &&
      (t.assignTo === 'testCodeAgent' || t.assignTo === 'seoAgent' || t.assignTo === 'pagespeedAgent'),
  )

  const runners = running.map(async (t) => {
    try {
      if (t.assignTo === 'testCodeAgent') return await testCodeAgentNode(state)
      if (t.assignTo === 'seoAgent') return await seoAgentNode(state)
      return await pagespeedAgentNode(state)
    } catch (e) {
      const err = String(e)
      return {
        agentOutputs: { [t.assignTo]: { status: 'failed' as const, error: err } },
        taskPlan: updateStatus(state.taskPlan, t.id, 'failed'),
        streamEvents: [
          agentObservation(t.assignTo, 'failed', {
            taskId: t.id,
            summary: err,
            data: { message: err },
          }),
          {
            type: 'agent_failed' as const,
            agentName: t.assignTo,
            taskId: t.id,
            payload: { message: err },
            timestamp: Date.now(),
          },
        ],
      }
    }
  })

  const parts = await Promise.all(runners)

  const agentOutputs = Object.assign({}, ...parts.map((p) => p.agentOutputs ?? {}))
  const streamEvents: StreamEvent[] = []
  for (const p of parts) {
    for (const e of p.streamEvents ?? []) {
      streamEvents.push(e as StreamEvent)
    }
  }
  const taskPlan = mergeParallelTaskPlans(
    state.taskPlan,
    running.map((t) => t.id),
    parts,
  )

  return { agentOutputs, taskPlan, streamEvents }
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
      ends: ['planAgent', 'parseHtmlAgent', 'parallelBatch', 'reportAgent', 'finalSummary', END],
    })
    .addNode('parseHtmlAgent', parseHtmlAgentNode, { ends: ['dispatcher'] })
    .addNode('parallelBatch', parallelBatchNode)
    .addNode('reportAgent', reportAgentNode, { ends: ['dispatcher'] })
    .addNode('finalSummary', finalSummaryNode)

    .addEdge(START, 'mainAgent')
    .addEdge('planAgent', 'dispatcher')
    .addEdge('parseHtmlAgent', 'dispatcher')
    .addEdge('parallelBatch', 'dispatcher')
    .addEdge('reportAgent', 'dispatcher')
    .addEdge('finalSummary', END)

  return graph.compile({ checkpointer })
}
