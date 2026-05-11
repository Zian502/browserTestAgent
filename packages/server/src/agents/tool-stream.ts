import type { AgentName, StreamEvent } from './state'

/**
 * 在 agent 节点内执行副作用并产出 `tool_call` / `tool_result`（与内置三工具事件结构一致，供 LLM 纲要等伪工具名使用）。
 */
export async function runToolWithStreamEvents<T>(
  agentName: AgentName,
  toolName: string,
  callPayload: Record<string, unknown>,
  run: () => Promise<T>,
  resultToPayload: (result: T, durationMs: number) => Record<string, unknown>,
): Promise<{ streamEvents: StreamEvent[]; result: T }> {
  const t0 = Date.now()
  const streamEvents: StreamEvent[] = [
    {
      type: 'tool_call',
      agentName,
      payload: { tool: toolName, ...callPayload, startedAt: t0 },
      timestamp: t0,
    },
  ]
  try {
    const result = await run()
    const t1 = Date.now()
    const durationMs = t1 - t0
    streamEvents.push({
      type: 'tool_result',
      agentName,
      payload: {
        tool: toolName,
        ok: true,
        durationMs,
        ...resultToPayload(result, durationMs),
      },
      timestamp: t1,
    })
    return { streamEvents, result }
  } catch (e) {
    const err = String(e)
    const t1 = Date.now()
    streamEvents.push({
      type: 'tool_result',
      agentName,
      payload: {
        tool: toolName,
        ok: false,
        durationMs: t1 - t0,
        error: err,
      },
      timestamp: t1,
    })
    throw e
  }
}

/** MCP 调用（如 PageSpeed API）通过 `mcp_call` / `mcp_result` 推送，不经内置 read/write/playwright。 */
export async function runMcpWithStreamEvents<T>(
  agentName: AgentName,
  mcpName: string,
  callPayload: Record<string, unknown>,
  run: () => Promise<T>,
  resultToPayload: (result: T, durationMs: number) => Record<string, unknown>,
): Promise<{ streamEvents: StreamEvent[]; result: T }> {
  const t0 = Date.now()
  const streamEvents: StreamEvent[] = [
    {
      type: 'mcp_call',
      agentName,
      payload: { mcp: mcpName, ...callPayload, startedAt: t0 },
      timestamp: t0,
    },
  ]
  try {
    const result = await run()
    const t1 = Date.now()
    const durationMs = t1 - t0
    streamEvents.push({
      type: 'mcp_result',
      agentName,
      payload: {
        mcp: mcpName,
        ok: true,
        durationMs,
        ...resultToPayload(result, durationMs),
      },
      timestamp: t1,
    })
    return { streamEvents, result }
  } catch (e) {
    const err = String(e)
    const t1 = Date.now()
    streamEvents.push({
      type: 'mcp_result',
      agentName,
      payload: {
        mcp: mcpName,
        ok: false,
        durationMs: t1 - t0,
        error: err,
      },
      timestamp: t1,
    })
    throw e
  }
}
