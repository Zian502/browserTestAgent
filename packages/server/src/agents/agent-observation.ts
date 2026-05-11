import type { AgentName, StreamEvent } from './state'

export type AgentObservationPhase = 'start' | 'progress' | 'done' | 'failed' | 'skipped'

export const AGENT_LABEL_ZH: Record<AgentName, string> = {
  mainAgent: '入口与工具',
  planAgent: '任务规划',
  parseHtmlAgent: 'HTML 解析',
  testCodeAgent: 'Playwright 测试',
  seoAgent: 'SEO 分析',
  pagespeedAgent: 'PageSpeed 性能',
  reportAgent: '报告生成',
}

const MAX_STR = 600
const MAX_DEPTH = 4

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[…]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > MAX_STR ? `${value.slice(0, MAX_STR)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const cap = value.slice(0, 20).map((v) => sanitize(v, depth + 1))
    if (value.length > 20) cap.push(`…共 ${value.length} 项`)
    return cap
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length > 30) {
      const out: Record<string, unknown> = {}
      for (const k of keys.slice(0, 30)) out[k] = sanitize(o[k], depth + 1)
      out._truncated = `…共 ${keys.length} 个字段`
      return out
    }
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      if (k === 'code' && typeof o[k] === 'string') {
        const c = o[k] as string
        out.codePreview = c.length > 120 ? `${c.slice(0, 120)}…` : c
        out.codeLength = c.length
        continue
      }
      if (k === 'pageHtml' || k === 'rawHtml') {
        out.pageHtmlLength = typeof o[k] === 'string' ? (o[k] as string).length : 0
        continue
      }
      out[k] = sanitize(o[k], depth + 1)
    }
    return out
  }
  return String(value)
}

/** 向客户端推送可观测的 agent 阶段与数据摘要（SSE `agent_observation`） */
export function agentObservation(
  agentName: AgentName,
  phase: AgentObservationPhase,
  body: { taskId?: string; summary?: string; data?: unknown },
): StreamEvent {
  return {
    type: 'agent_observation',
    agentName,
    taskId: body.taskId,
    timestamp: Date.now(),
    payload: {
      phase,
      label: AGENT_LABEL_ZH[agentName],
      summary: body.summary,
      data: body.data === undefined ? undefined : sanitize(body.data),
    },
  }
}
