import type { State } from './state'
import { pagespeedMcp } from '../mcp/pagespeed-mcp'
import { findTaskId, updateStatus } from './graph-helpers'
import { agentObservation } from './agent-observation'
import { runMcpWithStreamEvents } from './tool-stream'

function extractCoreWebVitals(result: {
  lighthouseResult: { audits: Record<string, { displayValue?: string }> }
}) {
  const audits = result.lighthouseResult.audits
  return {
    LCP: audits['largest-contentful-paint']?.displayValue,
    FCP: audits['first-contentful-paint']?.displayValue,
    CLS: audits['cumulative-layout-shift']?.displayValue,
    TBT: audits['total-blocking-time']?.displayValue,
    TTI: audits['interactive']?.displayValue,
    SI: audits['speed-index']?.displayValue,
  }
}

export async function pagespeedAgentNode(state: State) {
  const { streamEvents: toolStream, result: pair } = await runMcpWithStreamEvents(
    'pagespeedAgent',
    'pagespeed',
    { pageUrl: state.pageUrl },
    async () =>
      Promise.all([pagespeedMcp.analyze(state.pageUrl, 'mobile'), pagespeedMcp.analyze(state.pageUrl, 'desktop')]),
    ([mobile, desktop]) => ({
      mobileScore: Math.round((mobile.lighthouseResult.categories.performance.score ?? 0) * 100),
      desktopScore: Math.round((desktop.lighthouseResult.categories.performance.score ?? 0) * 100),
    }),
  )

  const [mobile, desktop] = pair
  const data = {
    mobile: {
      score: (mobile.lighthouseResult.categories.performance.score ?? 0) * 100,
      metrics: extractCoreWebVitals(mobile),
    },
    desktop: {
      score: (desktop.lighthouseResult.categories.performance.score ?? 0) * 100,
      metrics: extractCoreWebVitals(desktop),
    },
  }

  const taskId = findTaskId(state.taskPlan, 'pagespeedAgent')

  return {
    agentOutputs: { pagespeedAgent: { status: 'done', data } },
    taskPlan: taskId ? updateStatus(state.taskPlan, taskId, 'done') : state.taskPlan,
    streamEvents: [
      ...toolStream,
      agentObservation('pagespeedAgent', 'done', {
        taskId,
        summary: `移动端 ${Math.round(data.mobile.score)} 分，桌面端 ${Math.round(data.desktop.score)} 分`,
        data: {
          mobile: { score: data.mobile.score, metrics: data.mobile.metrics },
          desktop: { score: data.desktop.score, metrics: data.desktop.metrics },
        },
      }),
      {
        type: 'agent_done' as const,
        agentName: 'pagespeedAgent' as const,
        payload: { mobileScore: data.mobile.score, desktopScore: data.desktop.score },
        timestamp: Date.now(),
      },
    ],
  }
}
