import type { AgentName, StreamEvent } from '../agents/state'
import { READ_TOOL, WRITE_TOOL, PLAYWRIGHT_TOOL, executeCoreTool } from '../tools'

function pushToolCall(
  emit: (e: StreamEvent) => void,
  agentName: AgentName,
  tool: string,
  payload: Record<string, unknown>,
) {
  const t0 = Date.now()
  emit({
    type: 'tool_call',
    agentName,
    payload: { tool, ...payload, startedAt: t0 },
    timestamp: t0,
  })
  return t0
}

function pushToolResult(
  emit: (e: StreamEvent) => void,
  agentName: AgentName,
  tool: string,
  ok: boolean,
  t0: number,
  extra: Record<string, unknown>,
) {
  emit({
    type: 'tool_result',
    agentName,
    payload: { tool, ok, durationMs: Date.now() - t0, ...extra },
    timestamp: Date.now(),
  })
}

export async function invokeReadTool(
  agentName: AgentName,
  emit: (e: StreamEvent) => void,
  relativePath: string,
): Promise<{ content: string }> {
  const t0 = pushToolCall(emit, agentName, READ_TOOL, { relativePath })
  try {
    const out = await executeCoreTool(READ_TOOL, { relativePath })
    pushToolResult(emit, agentName, READ_TOOL, true, t0, {
      relativePath,
      contentLength: typeof out['content'] === 'string' ? (out['content'] as string).length : 0,
    })
    return { content: String(out['content'] ?? '') }
  } catch (e) {
    pushToolResult(emit, agentName, READ_TOOL, false, t0, { error: String(e), relativePath })
    throw e
  }
}

export async function invokeWriteTool(
  agentName: AgentName,
  emit: (e: StreamEvent) => void,
  relativePath: string,
  content: string,
): Promise<void> {
  const t0 = pushToolCall(emit, agentName, WRITE_TOOL, { relativePath, contentLength: content.length })
  try {
    await executeCoreTool(WRITE_TOOL, { relativePath, content })
    pushToolResult(emit, agentName, WRITE_TOOL, true, t0, { relativePath, bytesWritten: content.length })
  } catch (e) {
    pushToolResult(emit, agentName, WRITE_TOOL, false, t0, { error: String(e), relativePath })
    throw e
  }
}

export async function invokePlaywrightTool(
  agentName: AgentName,
  emit: (e: StreamEvent) => void,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const t0 = pushToolCall(emit, agentName, PLAYWRIGHT_TOOL, payload)
  try {
    const out = await executeCoreTool(PLAYWRIGHT_TOOL, payload)
    const ok = out['ok'] !== false
    const summary: Record<string, unknown> = { ...out }
    if (typeof summary['pageHtml'] === 'string') {
      summary['pageHtmlLength'] = (summary['pageHtml'] as string).length
      delete summary['pageHtml']
    }
    pushToolResult(emit, agentName, PLAYWRIGHT_TOOL, ok, t0, summary)
    return out
  } catch (e) {
    pushToolResult(emit, agentName, PLAYWRIGHT_TOOL, false, t0, { error: String(e) })
    throw e
  }
}
