import type { AgentName, StreamEvent } from '../agents/state'
import { READ_TOOL, WRITE_TOOL, PLAYWRIGHT_TOOL, executeCoreTool } from '../tools'

function emitToolStart(
  emit: (e: StreamEvent) => void,
  agentName: AgentName,
  tool: string,
  payload: Record<string, unknown>,
) {
  const t0 = Date.now()
  emit({
    type: 'tool_start',
    agentName,
    payload: { tool, ...payload, startedAt: t0 },
    timestamp: t0,
  })
  return t0
}

function emitToolSuccess(
  emit: (e: StreamEvent) => void,
  agentName: AgentName,
  tool: string,
  t0: number,
  extra: Record<string, unknown>,
) {
  emit({
    type: 'tool_success',
    agentName,
    payload: { tool, durationMs: Date.now() - t0, ...extra },
    timestamp: Date.now(),
  })
}

function emitToolFailure(
  emit: (e: StreamEvent) => void,
  agentName: AgentName,
  tool: string,
  t0: number,
  error: string,
  extra: Record<string, unknown> = {},
) {
  emit({
    type: 'tool_failure',
    agentName,
    payload: { tool, durationMs: Date.now() - t0, error, ...extra },
    timestamp: Date.now(),
  })
}

export async function invokeReadTool(
  agentName: AgentName,
  emit: (e: StreamEvent) => void,
  relativePath: string,
): Promise<{ content: string }> {
  const t0 = emitToolStart(emit, agentName, READ_TOOL, { relativePath })
  try {
    const out = await executeCoreTool(READ_TOOL, { relativePath })
    emitToolSuccess(emit, agentName, READ_TOOL, t0, {
      relativePath,
      contentLength: typeof out['content'] === 'string' ? (out['content'] as string).length : 0,
    })
    return { content: String(out['content'] ?? '') }
  } catch (e) {
    emitToolFailure(emit, agentName, READ_TOOL, t0, String(e), { relativePath })
    throw e
  }
}

export async function invokeWriteTool(
  agentName: AgentName,
  emit: (e: StreamEvent) => void,
  relativePath: string,
  content: string,
): Promise<void> {
  const t0 = emitToolStart(emit, agentName, WRITE_TOOL, { relativePath, contentLength: content.length })
  try {
    await executeCoreTool(WRITE_TOOL, { relativePath, content })
    emitToolSuccess(emit, agentName, WRITE_TOOL, t0, { relativePath, bytesWritten: content.length })
  } catch (e) {
    emitToolFailure(emit, agentName, WRITE_TOOL, t0, String(e), { relativePath })
    throw e
  }
}

export async function invokePlaywrightTool(
  agentName: AgentName,
  emit: (e: StreamEvent) => void,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const t0 = emitToolStart(emit, agentName, PLAYWRIGHT_TOOL, payload)
  try {
    const out = await executeCoreTool(PLAYWRIGHT_TOOL, payload)
    const ok = out['ok'] !== false
    const summary: Record<string, unknown> = { ...out }
    if (typeof summary['pageHtml'] === 'string') {
      summary['pageHtmlLength'] = (summary['pageHtml'] as string).length
      delete summary['pageHtml']
    }
    if (ok) {
      emitToolSuccess(emit, agentName, PLAYWRIGHT_TOOL, t0, summary)
    } else {
      emitToolFailure(emit, agentName, PLAYWRIGHT_TOOL, t0, String(out['error'] ?? 'playwright 返回失败'), summary)
    }
    return out
  } catch (e) {
    emitToolFailure(emit, agentName, PLAYWRIGHT_TOOL, t0, String(e))
    throw e
  }
}
