/**
 * 内置三工具：`read` / `write` / `playwright`（路径权限见 `permissions.ts`，Playwright 串行见 `playwright.ts`）。
 * 缓存、报告、压缩等在 `../lib/`。
 */
import { READ_TOOL, executeReadTool, type ReadToolInput } from './read'
import { WRITE_TOOL, executeWriteTool, type WriteToolInput } from './write'
import { PLAYWRIGHT_TOOL, executePlaywrightCoreTool } from './playwright'

export { READ_TOOL, executeReadTool, type ReadToolInput } from './read'
export { WRITE_TOOL, executeWriteTool, type WriteToolInput } from './write'
export {
  PLAYWRIGHT_TOOL,
  executePlaywrightCoreTool,
  runPlaywrightExclusive,
  type PlaywrightCoreInput,
  type PlaywrightCoreResult,
} from './playwright'
export { resolveCacheRelativePath, getAgentCacheRoot } from './read'

export type CoreToolName = typeof READ_TOOL | typeof WRITE_TOOL | typeof PLAYWRIGHT_TOOL

export async function executeCoreTool(
  tool: CoreToolName,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (tool === READ_TOOL) {
    const relativePath = String(payload['relativePath'] ?? '')
    const out = await executeReadTool({ relativePath } as ReadToolInput)
    return { ...out }
  }
  if (tool === WRITE_TOOL) {
    const relativePath = String(payload['relativePath'] ?? '')
    const content = String(payload['content'] ?? '')
    const out = await executeWriteTool({ relativePath, content } as WriteToolInput)
    return { ...out }
  }
  if (tool === PLAYWRIGHT_TOOL) {
    const op = String(payload['op'] ?? '')
    if (op === 'capture') {
      const r = await executePlaywrightCoreTool({
        op: 'capture',
        pageUrl: String(payload['pageUrl'] ?? ''),
        headless: Boolean(payload['headless']),
        slowMoMs: Number(payload['slowMoMs'] ?? 0) || 0,
        sessionId: payload['sessionId'] != null ? String(payload['sessionId']) : undefined,
      })
      return r as unknown as Record<string, unknown>
    }
    if (op === 'refresh_outer_html') {
      const r = await executePlaywrightCoreTool({
        op: 'refresh_outer_html',
        sessionId: String(payload['sessionId'] ?? ''),
      })
      return r as unknown as Record<string, unknown>
    }
    if (op === 'run_test') {
      const r = await executePlaywrightCoreTool({
        op: 'run_test',
        sessionId: String(payload['sessionId'] ?? ''),
        code: String(payload['code'] ?? ''),
        targetUrl: String(payload['targetUrl'] ?? ''),
        timeoutMs: payload['timeoutMs'] != null ? Number(payload['timeoutMs']) : undefined,
      })
      return r as unknown as Record<string, unknown>
    }
    throw new Error(`未知 Playwright 子操作：${op}`)
  }
  throw new Error(`未知内置工具：${tool}`)
}
